# src/agents/vector_agent.py
import os
from langchain_core.prompts import ChatPromptTemplate
from langchain_neo4j.vectorstores.neo4j_vector import remove_lucene_chars
from pydantic import BaseModel, Field
from typing import List, Optional
from src.config.settings import llm, graph, vector_index
from src.config.structured import structured_model
from src.retrieval.temporal import weight_and_sort_records, weight_and_sort_documents
from src.retrieval import case_scope as cs

# --- Entity Extraction ---
class LogEntities(BaseModel):
    """Identifies information about resources in the log."""

    entity_values: List[str] = Field(
        ...,
        description="All entities such as User, Server, Service, Host, "
        "System, Software, Device, Process, Machine, Session, or Document file names that appear in the text.",
    )

entity_prompt = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            "You are an expert at extracting entities from text related to system logs. "
            "Extract the name or ID of entities such as User, Server, Service, "
            "Host, System, Software, Device, Process, Machine, Session, and the filename of the Document.",
        ),
        (
            "human",
            "Use the given format to extract information from"
            "the following input: {question}",
        ),
    ]
)

entity_chain = entity_prompt | structured_model(llm, LogEntities)

# --- Helper Functions ---
def generate_full_text_query(input: str) -> str:
    """
    Generate a full-text search query for a given input string.

    This function constructs a query string suitable for a full-text search.
    It processes the input string by splitting it into words and appending a
    similarity threshold (~2 changed characters) to each word, then combines
    them using the AND operator. Useful for mapping entities from user questions
    to database values, and allows for some misspelings.
    """
    full_text_query = ""
    words = [el for el in remove_lucene_chars(input).split() if el]
    for word in words[:-1]:
        full_text_query += f" {word}~2 AND"
    full_text_query += f" {words[-1]}~2"
    return full_text_query.strip()

def structured_retriever(question: str, query_timestamp: Optional[str] = None) -> str:
    """
    Collects the neighborhood of resources mentioned
    in the question
    """
    result = ""

    entities = entity_chain.invoke({"question": question})
    print(f"\n--- Extracted Entities: {entities.entity_values} ---")

    for entity_value in entities.entity_values:
        query = generate_full_text_query(entity_value)
        if not query:
            continue

        # Raw fields, not a pre-formatted string, so results can be
        # temporally re-ranked (weight_and_sort_records) before display.
        rows = graph.query(
            """
            CALL db.index.fulltext.queryNodes('entities', $query, {limit: 10})
            YIELD node AS entity

            MATCH (chunk:Chunk)-[:HAS_ENTITY]->(entity)

            OPTIONAL MATCH (chunk)-[:PART_OF]->(doc:Document)

            WITH entity, chunk, doc,
                 CASE WHEN 'Document' IN labels(entity)
                      THEN entity.fileName
                      ELSE entity.id
                 END AS entity_name

            RETURN entity_name AS entity_name,
                   coalesce(doc.fileName, 'N/A') AS doc_name,
                   left(chunk.text, 250) AS chunk_text,
                   chunk.timestamp AS event_timestamp
            LIMIT 10
            """,
            {"query": query},
        )
        if query_timestamp:
            rows = weight_and_sort_records(rows, query_timestamp, preferred_keys=("event_timestamp",))
        if rows:
            result += "\n".join(
                f"Entity '{row['entity_name']}' found in document '{row['doc_name']}'. "
                f"The context of the text is: '{row['chunk_text']}...'"
                for row in rows
            )
    return result

# --- Case-scoped search ---
# Same 4-document budget for the case channel as the unscoped
# similarity_search default (k=4), plus a small labelled historical channel.
CASE_VECTOR_TOP_K = int(os.environ.get("EVIDENCE_CASE_VECTOR_TOP_K", "4"))
HISTORICAL_VECTOR_TOP_K = int(os.environ.get("EVIDENCE_HISTORICAL_VECTOR_TOP_K", "2"))
_HISTORICAL_INDEX_FETCH_MAX = 1000
_HISTORICAL_TEXT_CHARS = 1000
_CHUNK_SUFFIX = "-chunk"  # src/ingestion/graph_loader.py: Chunk.id = Alert.id + '-chunk'

# Exact cosine ranking over the case's own chunks: the scope is the MATCH
# itself, so nothing outside the case can occupy a result slot. (The ANN
# index cannot be pre-filtered, and post-filtering its top-k is precisely
# the limit-before-scope error this replaces.)
_CASE_SIMILARITY_CYPHER = """
MATCH (c:Chunk) WHERE c.id IN $chunk_ids AND c.embedding IS NOT NULL
WITH c, vector.similarity.cosine(c.embedding, $qvec) AS score
RETURN c.id AS chunk_id, c.text AS text, c.timestamp AS timestamp, score
ORDER BY score DESC, c.id LIMIT $k
"""
_CASE_EMBEDDINGS_CYPHER = """
MATCH (c:Chunk) WHERE c.id IN $chunk_ids AND c.embedding IS NOT NULL
RETURN c.id AS chunk_id, c.text AS text, c.timestamp AS timestamp, c.embedding AS embedding
"""
_HISTORICAL_SIMILARITY_CYPHER = """
CALL db.index.vector.queryNodes($index, $fetch_k, $qvec) YIELD node, score
WITH node, score
WHERE NOT node.id IN $chunk_ids{cutoff}
RETURN node.id AS chunk_id, node.text AS text, node.timestamp AS timestamp, score
ORDER BY score DESC LIMIT $k
"""
_SCOPED_ENTITY_CYPHER = """
CALL db.index.fulltext.queryNodes('entities', $query, {{limit: 10}})
YIELD node AS entity
MATCH (chunk:Chunk)-[:HAS_ENTITY]->(entity)
WHERE {predicate}
WITH entity, chunk,
     CASE WHEN 'Document' IN labels(entity) THEN entity.fileName ELSE entity.id END AS entity_name
RETURN entity_name AS entity_name, chunk.id AS chunk_id,
       left(chunk.text, 250) AS chunk_text, chunk.timestamp AS event_timestamp
ORDER BY chunk.timestamp DESC, chunk.id
LIMIT $k
"""


def _alert_id(chunk_id: str) -> str:
    return chunk_id[:-len(_CHUNK_SUFFIX)] if chunk_id.endswith(_CHUNK_SUFFIX) else chunk_id


def _case_similarity(qvec: List[float], chunk_ids: List[str], k: int, query_fn) -> tuple:
    """(rows, method). Ranks in the database when the server has
    vector.similarity.cosine; otherwise pulls the case's embeddings and
    ranks locally -- same result, and the method used is recorded."""
    try:
        return query_fn(_CASE_SIMILARITY_CYPHER, {"chunk_ids": chunk_ids, "qvec": qvec, "k": k}), "db_cosine"
    except Exception as exc:
        from src.retrieval.scoped_fetch import is_cypher_syntax_error
        if not is_cypher_syntax_error(exc):
            raise
    import numpy as np
    rows = query_fn(_CASE_EMBEDDINGS_CYPHER, {"chunk_ids": chunk_ids})
    if not rows:
        return [], "client_cosine"
    matrix = np.asarray([r.pop("embedding") for r in rows], dtype=float)
    q = np.asarray(qvec, dtype=float)
    scores = matrix @ q / (np.linalg.norm(matrix, axis=1) * np.linalg.norm(q) + 1e-12)
    for row, score in zip(rows, scores):
        row["score"] = float(score)
    rows.sort(key=lambda r: (-r["score"], r["chunk_id"]))
    return rows[:k], "client_cosine"


def query_vector_search_scoped(question: str, case_scope: dict, *, query_fn=None, embed_fn=None,
                               entities_fn=None, resolve_fn=None) -> dict:
    """Case-scoped counterpart of query_vector_search. Returns the same
    structured two-channel result as cypher_agent.run_scoped_cypher.
    `query_fn(cypher, params) -> rows`, `embed_fn(text) -> vector`,
    `entities_fn(question) -> [str]` and `resolve_fn(ids) -> {id: meta}` are
    injectable for offline tests."""
    if query_fn is None:
        query_fn = lambda q, p: graph.query(q, p)
    if embed_fn is None:
        from src.config.settings import get_embeddings
        embed_fn = get_embeddings().embed_query
    if entities_fn is None:
        entities_fn = lambda q: entity_chain.invoke({"question": q}).entity_values
    from src.config.settings import VECTOR_INDEX_NAME

    reference_time = case_scope.get("reference_time")
    chunk_ids = [aid + _CHUNK_SUFFIX for aid in case_scope["alert_ids"]]
    cutoff_clause = " AND datetime({var}.timestamp) <= datetime($cutoff)" if reference_time else ""
    base = {"chunk_ids": chunk_ids, **({"cutoff": reference_time} if reference_time else {})}
    notes = []

    qvec = list(embed_fn(question))
    case_docs, method = _case_similarity(qvec, chunk_ids, CASE_VECTOR_TOP_K, query_fn)
    fetch_k = min(HISTORICAL_VECTOR_TOP_K + len(chunk_ids), _HISTORICAL_INDEX_FETCH_MAX)
    hist_docs = query_fn(
        _HISTORICAL_SIMILARITY_CYPHER.format(cutoff=cutoff_clause.format(var="node")),
        {**base, "index": VECTOR_INDEX_NAME, "fetch_k": fetch_k, "qvec": qvec, "k": HISTORICAL_VECTOR_TOP_K})
    if fetch_k < HISTORICAL_VECTOR_TOP_K + len(chunk_ids):
        notes.append("Historical similarity search examined the index's top "
                     f"{fetch_k} neighbours only; with a case this large it may be incomplete.")

    entities = list(entities_fn(question))
    print(f"\n--- Extracted Entities: {entities} ---")
    case_entity_rows, hist_entity_rows = [], []
    for entity_value in entities:
        ft_query = generate_full_text_query(entity_value) if remove_lucene_chars(entity_value).split() else ""
        if not ft_query:
            continue
        case_entity_rows += query_fn(
            _SCOPED_ENTITY_CYPHER.format(predicate="chunk.id IN $chunk_ids"),
            {"chunk_ids": chunk_ids, "query": ft_query, "k": cs.CASE_TOP_K})
        hist_entity_rows += query_fn(
            _SCOPED_ENTITY_CYPHER.format(predicate="NOT chunk.id IN $chunk_ids" + cutoff_clause.format(var="chunk")),
            {**base, "query": ft_query, "k": cs.HISTORICAL_TOP_K})

    def doc_row(d, limit=None):
        text = d.get("text") or ""
        return {"alert_id": _alert_id(d["chunk_id"]), "timestamp": d.get("timestamp"),
                "similarity": round(float(d.get("score") or 0.0), 4), "match": "semantic",
                "text": text if limit is None else text[:limit]}

    def entity_row(r):
        return {"alert_id": _alert_id(r["chunk_id"]), "timestamp": r.get("event_timestamp"),
                "match": f"entity '{r['entity_name']}'", "text": r.get("chunk_text")}

    def dedupe(rows):
        seen, out = set(), []
        for r in rows:
            if r["alert_id"] not in seen:
                seen.add(r["alert_id"])
                out.append(r)
        return out

    case_rows = dedupe([doc_row(d) for d in case_docs] + [entity_row(r) for r in case_entity_rows])
    hist_rows = dedupe([doc_row(d, _HISTORICAL_TEXT_CHARS) for d in hist_docs] + [entity_row(r) for r in hist_entity_rows])
    meta = {r["alert_id"]: {"timestamp": r.get("timestamp"), "host": None} for r in case_rows + hist_rows}
    if resolve_fn is None:
        from src.retrieval.scoped_fetch import resolve_alerts as resolve_fn
    try:  # adds each alert's host to its provenance; timestamps above are already authoritative
        for aid, info in resolve_fn([r["alert_id"] for r in case_rows + hist_rows]).items():
            meta[aid] = {**meta.get(aid, {}), **{k: v for k, v in info.items() if v is not None}}
    except Exception as exc:  # host is descriptive only -- never fail retrieval over it
        notes.append(f"Host lookup for provenance failed ({type(exc).__name__}); hosts shown as unknown.")
    return cs.build_scoped_result(
        source="vector", scope=case_scope, case_rows=case_rows, case_total=len(case_rows), case_truncated=False,
        historical_rows=hist_rows, historical_total=len(hist_rows), historical_truncated=False,
        alert_meta=meta, enforcement="db_predicate", queries={"case_similarity": method}, notes=notes)


# --- Main Search Function ---
def query_vector_search(question: str, query_timestamp: Optional[str] = None, case_scope: Optional[dict] = None):
    """
    Query the graph and vector index using a vector approach for vector similarity search.
    This is for questions that require finding similar concepts or descriptions.

    `query_timestamp`, when given (the triggering alert's timestamp for
    auto-triggered queries, "now" for manual ones), re-ranks both the
    structured and unstructured results by recency (src/retrieval/temporal.py,
    ported from DefenGraph eq. 5) so recent events outrank stale ones with
    otherwise-similar relevance.
    """
    print(f"--- Executing Vector Search for: {question} ---")
    if case_scope:
        # Case investigation: structured two-channel result (see
        # query_vector_search_scoped); dispatch_retrieval_node renders it.
        return query_vector_search_scoped(question, case_scope)
    structured_data = structured_retriever(question, query_timestamp)
    unstructured_docs = vector_index.similarity_search(question)
    if query_timestamp:
        unstructured_docs = weight_and_sort_documents(unstructured_docs, query_timestamp)
    unstructured_data = [el.page_content for el in unstructured_docs]
    final_data = f"""Structured data:
    {structured_data}
    Unstructured data:
    {"#Resource ". join(unstructured_data)}
    """
    return final_data
