# src/retrieval/scoped_fetch.py
"""
Database access shared by the case-scoped Cypher and vector retrieval
paths (src/agents/cypher_agent.py, src/agents/vector_agent.py). Kept apart
from src/retrieval/case_scope.py so that module stays import-light and
unit-testable without Neo4j.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple
import os

_RESOLVE_ALERTS_CYPHER = """
MATCH (a:Alert) WHERE a.id IN $ids
OPTIONAL MATCH (h:Host)-[:HAS_ALERT]->(a)
RETURN a.id AS id, a.timestamp AS timestamp, head(collect(h.id)) AS host
"""


def fetch_capped(query: str, params: Dict[str, Any], cap: int, graph: Any = None,
                 timeout: Optional[float] = None) -> Tuple[List[dict], bool]:
    """Runs a read query and returns at most `cap` rows plus whether more
    existed. Rows are streamed and the remainder discarded server-side, so
    a broad query cannot pull an unbounded result into memory -- and,
    unlike GraphCypherQAChain's `graph.query(q)[:top_k]`, the caller
    learns that truncation happened.

    Uses the same connection and the same write-clause guard as the
    existing LLM-Cypher path (ReadOnlyNeo4jGraph in src/config/settings.py);
    this is still the one place LLM-authored Cypher is executed."""
    from src.config.settings import _WRITE_CYPHER_RE, read_only_graph
    if _WRITE_CYPHER_RE.search(query):
        raise ValueError(f"Refusing to execute a write/schema-mutating Cypher query: {query!r}")
    graph = graph if graph is not None else read_only_graph.resolve()
    driver, database = getattr(graph, "_driver", None), getattr(graph, "_database", None)
    if driver is None:  # non-standard graph object (tests): no streaming available
        rows = graph.query(query, params)
        return rows[:cap], len(rows) > cap
    from neo4j import Query
    query_timeout = timeout if timeout is not None else float(os.environ.get("CYPHER_QUERY_TIMEOUT_SECONDS", "120"))
    rows: List[dict] = []
    truncated = False
    with driver.session(database=database) as session:
        result = session.run(Query(text=query, timeout=query_timeout), params)
        for record in result:
            if len(rows) >= cap:
                truncated = True
                break
            rows.append(record.data())
        result.consume()
    return rows, truncated


def resolve_alerts(candidate_ids: Iterable[str], graph: Any = None) -> Dict[str, dict]:
    """Which of these strings are real Alert IDs, with each one's
    timestamp and host. This is the ground truth provenance is built
    from -- membership is never inferred from what an ID looks like."""
    ids = list(dict.fromkeys(candidate_ids))
    if not ids:
        return {}
    rows, _ = fetch_capped(_RESOLVE_ALERTS_CYPHER, {"ids": ids}, len(ids) + 1, graph=graph)
    return {r["id"]: {"timestamp": r.get("timestamp"), "host": r.get("host")} for r in rows}


def is_cypher_syntax_error(exc: BaseException) -> bool:
    """True for errors that mean 'this server rejected the rewritten
    query's syntax/semantics', as opposed to connectivity or timeouts."""
    try:
        from neo4j.exceptions import ClientError
    except ImportError:  # pragma: no cover
        return False
    code: Optional[str] = getattr(exc, "code", None)
    return isinstance(exc, ClientError) and bool(code) and code.startswith("Neo.ClientError.Statement")
