# src/investigation/knowledge_base.py
"""
Deterministic cross-case "learned findings" memory -- see RESEARCH_QUESTIONS.md
RQ5. Distinct from case_context/conversation_context (src/graph/workflow.py),
which are scoped to ONE investigation thread: this persists across cases,
so a later, unrelated investigation sharing a host/IP/user/MITRE technique
with an earlier one can be told what was already found.

Backed by a local RDF store (rdflib), not Neo4j -- a local Turtle file
under data/, loaded into an in-memory rdflib.Graph and queried/modified
in-process. Same pattern mcp-cskg-rdf/src/mcp-cskg-rdf/server.py already
uses as its own no-SPARQL-endpoint fallback (rdflib.Graph().parse(path,
format="turtle")). Schema (TBox) lives in
data/ontologies/learned_findings_schema.ttl; data instances (ABox) live in
data/learned_findings.ttl, grown at runtime -- kept separate on purpose.

Gate, write, and read all live here. No extra LLM call judges a finding's
quality -- quality is read straight off the already-produced TurnRecord/
SynthesizedReport fields plus the deterministic grounding_check verdict,
same philosophy as src/agents/grounding_check.py's non-LLM design.
"""
from __future__ import annotations

from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

from rdflib import Graph, Literal, Namespace, URIRef
from rdflib.namespace import RDF, XSD

from src.investigation.clustering import Case

MAX_RELATED_FINDINGS = 5

# Vocabulary (TBox, see data/ontologies/learned_findings_schema.ttl) vs.
# instance (ABox) IRI spaces kept separate on purpose -- standard OWL
# practice, keeps class/property IRIs visually distinct from data IRIs.
FINDING = Namespace("http://multi-agents-cykg-rag.local/ontology/learned-findings#")
FINDING_INSTANCE = Namespace("http://multi-agents-cykg-rag.local/finding/")
ENTITY = Namespace("http://multi-agents-cykg-rag.local/entity/")

FINDINGS_TTL_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "learned_findings.ttl"


def is_storage_worthy(
    confidence: Optional[str],
    recommended_priority: Optional[str],
    error: Optional[str],
    grounded: Optional[bool],
) -> bool:
    """All four must hold. `recommended_priority in ("monitor", "escalate")`
    excludes "ignore" (benign) by design -- don't store routine findings.
    `grounded` defaults to not-storage-worthy if missing/None (fail closed,
    not fail open) rather than assuming an unavailable grounding verdict
    means the finding was fine."""
    return (
        confidence == "high"
        and recommended_priority in ("monitor", "escalate")
        and error is None
        and bool(grounded)
    )


def _load_graph() -> Graph:
    """Empty graph if data/learned_findings.ttl doesn't exist yet -- mirrors
    src/ingestion/config.py::load_config()'s `if not CONFIG_PATH.exists()`
    pattern. Whole-graph load-modify-save; no concurrent-write handling at
    this prototype scale (single in-process FastAPI service, same
    assumption session.py's MemorySaver already makes)."""
    g = Graph()
    g.bind("finding", FINDING)
    g.bind("entity", ENTITY)
    if FINDINGS_TTL_PATH.exists():
        g.parse(FINDINGS_TTL_PATH, format="turtle")
    return g


def _save_graph(g: Graph) -> None:
    FINDINGS_TTL_PATH.parent.mkdir(parents=True, exist_ok=True)
    g.serialize(destination=str(FINDINGS_TTL_PATH), format="turtle")


def _finding_uri(case_id: str, turn_index: int) -> URIRef:
    """Deterministic per (case_id, turn_index) -- the RDF analogue of the
    old Cypher MERGE (f:LearnedFinding {case_id, turn_index})."""
    return URIRef(f"{FINDING_INSTANCE}{quote(case_id, safe='')}/{turn_index}")


def _entity_uri(kind: str, value: str) -> URIRef:
    """Deterministic per (kind, value) -- the RDF analogue of the old
    Cypher MERGE (h:Host {id: host_id}) etc.: repeated findings about the
    same host/ip/user/technique always link to the same resource. `kind`
    is one of "host"/"ip"/"user"/"technique"; percent-encoded via
    urllib.parse.quote since these string IDs come from ingested alert
    data and aren't guaranteed URI-safe."""
    return URIRef(f"{ENTITY}{kind}/{quote(value, safe='')}")


def store_finding(
    case: Case,
    case_id: str,
    turn_index: int,
    answer: str,
    critical_analysis: Optional[str],
    mitigation_suggestions: List[str],
    mitre_techniques: List[str],
    confidence: Optional[str],
    recommended_priority: Optional[str],
    timestamp: str,
) -> None:
    """Sync rdflib read-modify-write -- callers (session.py) must wrap this
    in asyncio.to_thread so it never blocks the event loop (file I/O +
    graph serialization, not a network call, but still blocking).
    Idempotent on (case_id, turn_index): existing triples with this
    finding's URI as subject are removed before the new ones are added, so
    re-storing the same turn replaces rather than duplicates its triples --
    the RDF analogue of the old Cypher MERGE. aboutHost/aboutIP/aboutUser
    come from the CASE's own hosts/src_ips/dst_users; aboutTechnique and
    the mitreTechnique literals come from THIS turn's own mitre_techniques
    argument -- mirrors the old Cypher exactly (it reused a single
    $mitre_techniques param for both)."""
    g = _load_graph()
    f_uri = _finding_uri(case_id, turn_index)

    g.remove((f_uri, None, None))

    g.add((f_uri, RDF.type, FINDING.LearnedFinding))
    g.add((f_uri, FINDING.caseId, Literal(case_id, datatype=XSD.string)))
    g.add((f_uri, FINDING.turnIndex, Literal(turn_index, datatype=XSD.integer)))
    g.add((f_uri, FINDING.answer, Literal(answer)))
    if critical_analysis is not None:
        g.add((f_uri, FINDING.criticalAnalysis, Literal(critical_analysis)))
    for m in mitigation_suggestions or []:
        g.add((f_uri, FINDING.mitigationSuggestion, Literal(m)))
    if confidence is not None:
        g.add((f_uri, FINDING.confidence, Literal(confidence)))
    if recommended_priority is not None:
        g.add((f_uri, FINDING.recommendedPriority, Literal(recommended_priority)))
    g.add((f_uri, FINDING.timestamp, Literal(timestamp, datatype=XSD.dateTime)))
    for t in mitre_techniques or []:
        g.add((f_uri, FINDING.mitreTechnique, Literal(t)))

    for host in case.hosts or []:
        h_uri = _entity_uri("host", host)
        g.add((h_uri, RDF.type, FINDING.Entity))
        g.add((f_uri, FINDING.aboutHost, h_uri))
    for ip in case.src_ips or []:
        ip_uri = _entity_uri("ip", ip)
        g.add((ip_uri, RDF.type, FINDING.Entity))
        g.add((f_uri, FINDING.aboutIP, ip_uri))
    for user in case.dst_users or []:
        u_uri = _entity_uri("user", user)
        g.add((u_uri, RDF.type, FINDING.Entity))
        g.add((f_uri, FINDING.aboutUser, u_uri))
    for tech in mitre_techniques or []:
        t_uri = _entity_uri("technique", tech)
        g.add((t_uri, RDF.type, FINDING.Entity))
        g.add((f_uri, FINDING.aboutTechnique, t_uri))

    _save_graph(g)


_ALL_FINDINGS_QUERY = """
PREFIX finding: <http://multi-agents-cykg-rag.local/ontology/learned-findings#>
SELECT ?finding ?caseId ?timestamp ?answer ?criticalAnalysis ?recommendedPriority
WHERE {
    ?finding a finding:LearnedFinding ;
             finding:caseId ?caseId ;
             finding:timestamp ?timestamp ;
             finding:answer ?answer ;
             finding:recommendedPriority ?recommendedPriority .
    OPTIONAL { ?finding finding:criticalAnalysis ?criticalAnalysis }
}
"""


def fetch_related_findings(case: Case) -> List[dict]:
    """Findings from OTHER cases (case_id excluded) linked to any of this
    case's own hosts/IPs/users/MITRE techniques, most recent first, capped
    at MAX_RELATED_FINDINGS. Returns [] without touching the graph at all
    when the case has nothing to key on -- same short-circuit as before.

    One static SPARQL SELECT (no per-case values interpolated into the
    query text -- host/IP/user strings come from ingested alert data and
    are matched in plain Python against rdflib term objects instead, the
    same "don't trust interpolated strings" posture
    src/config/settings.py::ReadOnlyNeo4jGraph takes toward LLM-generated
    Cypher) pulls each finding's scalar metadata; per-finding multi-valued
    fields (mitreTechnique literals, aboutHost/aboutIP/aboutUser links)
    are then read via plain rdflib Graph.objects() -- safe, constant
    predicate URIs, no string interpolation -- keyed off the finding URI
    already bound by the SPARQL row. Cross-case entity matching, the
    case_id exclusion, the recency sort, and the cap-at-5 limit are all
    plain Python over these results."""
    if not (case.hosts or case.src_ips or case.dst_users or case.mitre_techniques):
        return []

    g = _load_graph()

    case_host_uris = {_entity_uri("host", h) for h in case.hosts or []}
    case_ip_uris = {_entity_uri("ip", ip) for ip in case.src_ips or []}
    case_user_uris = {_entity_uri("user", u) for u in case.dst_users or []}
    case_techniques = set(case.mitre_techniques or [])

    candidates: List[dict] = []
    for row in g.query(_ALL_FINDINGS_QUERY):
        row_case_id = str(row.caseId)
        if row_case_id == case.case_id:
            continue

        f_uri = row.finding
        finding_hosts = set(g.objects(f_uri, FINDING.aboutHost))
        finding_ips = set(g.objects(f_uri, FINDING.aboutIP))
        finding_users = set(g.objects(f_uri, FINDING.aboutUser))
        finding_techniques = {str(o) for o in g.objects(f_uri, FINDING.mitreTechnique)}

        matches = (
            (finding_hosts & case_host_uris)
            or (finding_ips & case_ip_uris)
            or (finding_users & case_user_uris)
            or (finding_techniques & case_techniques)
        )
        if not matches:
            continue

        candidates.append({
            "case_id": row_case_id,
            "timestamp": str(row.timestamp),
            "answer": str(row.answer),
            "critical_analysis": str(row.criticalAnalysis) if row.criticalAnalysis is not None else None,
            "recommended_priority": str(row.recommendedPriority),
            "mitre_techniques": sorted(finding_techniques),
        })

    candidates.sort(key=lambda d: d["timestamp"], reverse=True)
    return candidates[:MAX_RELATED_FINDINGS]


def render_related_findings_section(findings: List[dict]) -> str:
    """"" (nothing appended) when findings is empty -- callers only append
    this section to case_context when there's actually something to show."""
    if not findings:
        return ""
    lines = ["\n## Related Findings From Prior Investigations"]
    for f in findings:
        lines.append(
            f"- [{f.get('timestamp')}] Case {f.get('case_id')} (priority: "
            f"{f.get('recommended_priority')}, MITRE: {', '.join(f.get('mitre_techniques') or [])}): "
            f"{f.get('critical_analysis') or f.get('answer')}"
        )
    return "\n".join(lines)
