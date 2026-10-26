# src/retrieval/case_scope.py
"""
Case-scoped retrieval: restrict evidence to the case under investigation
BEFORE any row limit is applied, and expose everything else as a separate,
labelled "historical" channel.

Why this exists (pilot run russellmitchell-cases-fused, config v2): the
Cypher agent's GraphCypherQAChain executes the LLM's query and immediately
slices the result to top_k=10 (`self.graph.query(q)[: self.top_k]`). The
generated queries anchor on a host and `ORDER BY a.timestamp`, so the ten
rows that survived were that host's OLDEST alerts in the whole graph, not
the case's own. In the pilot's initial turn 14 of 18 retrieved alert IDs
belonged to other cases, and a follow-up answer named hosts and cited
alerts that were never members of the case.

The fix is to put the scope into the database query itself:

    case channel        every Alert node pattern gets
                        `WHERE <var>.id IN $case_alert_ids`
    historical channel  every Alert node pattern gets
                        `WHERE (NOT <var>.id IN $case_alert_ids
                                AND datetime(<var>.timestamp) <= datetime($scope_cutoff))`

Neo4j then filters before ORDER BY / LIMIT / aggregation, so a row limit
(the LLM's own, or ours) can no longer cut the case's alerts out. The two
channels are executed separately and never merged; each row that reaches
a prompt is rendered under an explicit header, and every alert ID keeps a
provenance record (scope, timestamp, host, position relative to the case
window) that src/agents/grounding_check.py validates citations against.

This module is deliberately free of network/LLM imports so it can be unit
tested offline (eval/test_case_scope.py).
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence, Set, Tuple

# Rows shown to the LLM per channel, per question. The case default equals
# the old GraphCypherQAChain top_k so the v2 -> v3 comparison isolates the
# effect of scoping rather than of showing more rows. Env names start with
# EVIDENCE_ so eval/run_case_alert_eval.py's environment hash covers them.
CASE_TOP_K = int(os.environ.get("EVIDENCE_CASE_TOP_K", "10"))
HISTORICAL_TOP_K = int(os.environ.get("EVIDENCE_HISTORICAL_TOP_K", "5"))
# Safety caps on rows pulled from Neo4j per channel (streamed; the rest is
# discarded server-side). The case cap bounds memory for very large cases;
# hitting it is reported, never silent.
CASE_FETCH_CAP = int(os.environ.get("EVIDENCE_CASE_FETCH_CAP", "2000"))
HISTORICAL_FETCH_CAP = int(os.environ.get("EVIDENCE_HISTORICAL_FETCH_CAP", "2000"))

CASE_PARAM = "case_alert_ids"
CUTOFF_PARAM = "scope_cutoff"

CASE_PREDICATE = "{var}.id IN $" + CASE_PARAM
HISTORICAL_PREDICATE = (
    "(NOT {var}.id IN $" + CASE_PARAM + " AND datetime({var}.timestamp) <= datetime($" + CUTOFF_PARAM + "))"
)
# Used when no reference time is known (should not happen for a case
# investigation, which always carries query_timestamp).
HISTORICAL_PREDICATE_NO_CUTOFF = "(NOT {var}.id IN $" + CASE_PARAM + ")"

# Schema facts from src/ingestion/graph_loader.py: which end of each
# relationship is the Alert node. Lets an unlabeled endpoint such as
# `(h:Host)-[:HAS_ALERT]->(a)` still be recognised and scoped.
ALERT_AT_HEAD = {"HAS_ALERT", "ATTACK_TO"}                    # (x)-[:R]->(alert)
ALERT_AT_TAIL = {"CONNECTS_TO", "TARGETS_USER", "TRIGGERS"}   # (alert)-[:R]->(x)

SCOPE_CASE = "case"
SCOPE_HISTORICAL = "historical"


class ScopeRewriteError(ValueError):
    """The query could not be scoped with certainty. Callers must NOT run
    it as if it were case-local; see query_cypher's post-filter fallback."""


def make_case_scope(case_id: str, alert_ids: Sequence[str], *, first_seen: Optional[str] = None,
                    last_seen: Optional[str] = None, hosts: Optional[Sequence[str]] = None,
                    reference_time: Optional[str] = None) -> Dict[str, Any]:
    """The `state['case_scope']` contract. `reference_time` is the
    knowledge cutoff for the historical channel (the checkpoint cutoff in
    eval/, the case's last_seen in the live investigation flow)."""
    ids = list(dict.fromkeys(alert_ids))
    if not ids:
        raise ValueError("A case scope needs at least one member alert ID")
    return {"case_id": case_id, "alert_ids": ids, "first_seen": first_seen, "last_seen": last_seen,
            "hosts": list(hosts or []), "reference_time": reference_time or last_seen}


# --------------------------------------------------------------------------
# Cypher rewriting
# --------------------------------------------------------------------------

_IDENT = r"[A-Za-z_][A-Za-z0-9_]*"
# variable? labels? then properties / inline WHERE / end. Labels may be
# joined with ':' '|' '&' and optionally back-quoted.
_NODE_HEAD_RE = re.compile(
    r"^\s*(?P<var>" + _IDENT + r")?\s*"
    r"(?P<labels>(?::\s*!?\s*`?" + _IDENT + r"`?\s*(?:[|&]\s*:?\s*!?\s*`?" + _IDENT + r"`?\s*)*)*)"
    r"(?P<rest>\{.*|WHERE\b.*|)\s*$",
    re.IGNORECASE | re.DOTALL,
)
_CLAUSE_WORDS = {"MATCH", "OPTIONAL", "MERGE", "CREATE", "WHERE", "AND", "OR", "NOT", "XOR", "WITH",
                 "RETURN", "IN", "ON", "SET", "DELETE", "UNWIND", "CASE", "WHEN", "THEN", "ELSE", "BY"}
_REL_RE = re.compile(r"^\s*(?P<left><)?\s*-\s*(?:\[(?P<body>[^\[\]]*)\])?\s*-\s*(?P<right>>)?\s*$", re.DOTALL)


def _mask_strings(query: str) -> str:
    """Same length as `query`, with the contents of string literals and
    comments replaced by spaces so structural scanning can't be fooled by
    a parenthesis or keyword inside a quoted value."""
    out, i, n = list(query), 0, len(query)
    while i < n:
        ch = query[i]
        if ch in "'\"":
            j = i + 1
            while j < n and query[j] != ch:
                j += 2 if query[j] == "\\" else 1
            for k in range(i + 1, min(j, n)):
                out[k] = " "
            i = j + 1
        elif query.startswith("//", i):
            j = query.find("\n", i)
            j = n if j < 0 else j
            for k in range(i, j):
                out[k] = " "
            i = j
        else:
            i += 1
    return "".join(out)


def _paren_spans(masked: str) -> List[Tuple[int, int]]:
    spans, stack = [], []
    for i, ch in enumerate(masked):
        if ch == "(":
            stack.append(i)
        elif ch == ")":
            if not stack:
                raise ScopeRewriteError("Unbalanced parentheses in generated Cypher")
            spans.append((stack.pop(), i))
    if stack:
        raise ScopeRewriteError("Unbalanced parentheses in generated Cypher")
    return sorted(spans)


def _preceding_word(masked: str, start: int) -> str:
    j = start
    while j > 0 and (masked[j - 1].isalnum() or masked[j - 1] in "_.`"):
        j -= 1
    return masked[j:start]


def _split_inline_where(masked_inner: str) -> Optional[int]:
    """Offset of a top-level inline WHERE inside a node pattern, or None."""
    depth = 0
    for m in re.finditer(r"[{}]|\bWHERE\b", masked_inner, re.IGNORECASE):
        tok = m.group(0)
        if tok == "{":
            depth += 1
        elif tok == "}":
            depth -= 1
        elif depth == 0:
            return m.start()
    return None


def _node_patterns(query: str, masked: str) -> List[Dict[str, Any]]:
    nodes = []
    for start, end in _paren_spans(masked):
        word = _preceding_word(masked, start)
        if word and word.upper() not in _CLAUSE_WORDS:
            continue  # function call: count(a), datetime(a.timestamp), toLower(...)
        inner_masked = masked[start + 1:end]
        m = _NODE_HEAD_RE.match(inner_masked)
        if not m:
            continue  # a parenthesised expression, not a node pattern
        if not (m.group("var") or m.group("labels") or m.group("rest")) and inner_masked.strip():
            continue
        if m.group("var") and m.group("var").upper() in _CLAUSE_WORDS:
            continue
        labels = re.findall(_IDENT, m.group("labels") or "")
        nodes.append({"start": start, "end": end, "var": m.group("var"), "labels": labels,
                      "inner": query[start + 1:end], "inner_masked": inner_masked})
    return nodes


def _rel_types(body: Optional[str]) -> Set[str]:
    if not body:
        return set()
    head = body.split("{", 1)[0]
    if ":" not in head:
        return set()
    return {t.upper() for t in re.findall(_IDENT, head.split(":", 1)[1].split("*", 1)[0])}


def _infer_alert_nodes(nodes: List[Dict[str, Any]], masked: str) -> Set[int]:
    """Indexes of node patterns that must be Alert nodes: labelled `Alert`,
    or sitting on the Alert end of a relationship whose type fixes it."""
    alert = {i for i, n in enumerate(nodes) if any(l.lower() == "alert" for l in n["labels"])}
    for i in range(len(nodes) - 1):
        left, right = nodes[i], nodes[i + 1]
        if right["start"] < left["end"]:
            continue  # nested, not adjacent
        m = _REL_RE.match(masked[left["end"] + 1:right["start"]])
        if not m:
            continue
        types = _rel_types(m.group("body"))
        head_types, tail_types = types & ALERT_AT_HEAD, types & ALERT_AT_TAIL
        if not (head_types or tail_types):
            continue
        if head_types and tail_types:
            raise ScopeRewriteError("Relationship pattern mixes types with the Alert on different ends")
        if m.group("left") and m.group("right"):
            raise ScopeRewriteError("Bidirectional relationship arrow")
        if m.group("right"):
            source, target = i, i + 1
        elif m.group("left"):
            source, target = i + 1, i
        else:
            # Undirected: decide by which endpoint carries a non-Alert label.
            def non_alert(n):
                return bool(n["labels"]) and not any(l.lower() == "alert" for l in n["labels"])
            if non_alert(left) and not non_alert(right):
                alert.add(i + 1)
            elif non_alert(right) and not non_alert(left):
                alert.add(i)
            elif i in alert or (i + 1) in alert:
                pass
            else:
                raise ScopeRewriteError("Cannot tell which end of an undirected relationship is the Alert")
            continue
        inferred = target if head_types else source
        labels = nodes[inferred]["labels"]
        if labels and not any(l.lower() == "alert" for l in labels):
            continue  # explicitly another label: a schema-invalid pattern, not an Alert to scope
        alert.add(inferred)
    return alert


def rewrite_alert_patterns(query: str, predicate_template: str) -> Tuple[str, int]:
    """Adds `WHERE <predicate>` inside every Alert node pattern.
    Returns (rewritten_query, number_of_patterns_scoped). Raises
    ScopeRewriteError when no Alert pattern can be identified -- such a
    query cannot be made case-local and must not be treated as if it were."""
    masked = _mask_strings(query)
    nodes = _node_patterns(query, masked)
    alert_idx = _infer_alert_nodes(nodes, masked)
    if not alert_idx:
        raise ScopeRewriteError("No Alert node pattern found; query cannot be restricted to a case")
    taken = set(re.findall(_IDENT, masked))
    with_positions = [m.start() for m in re.finditer(r"\bWITH\b", masked, re.IGNORECASE)]
    pieces, cursor, counter = [], 0, 0
    scoped_at: Dict[str, int] = {}  # variable -> position where it last received the predicate
    for i, node in enumerate(nodes):
        if i not in alert_idx:
            continue
        # A variable already scoped earlier in the same query part (no WITH
        # in between, so it is still the same binding) needs no second
        # predicate: `MATCH (a:Alert WHERE ..) OPTIONAL MATCH (a)-[:TRIGGERS]->(m)`.
        prior = scoped_at.get(node["var"]) if node["var"] else None
        if prior is not None and not any(prior < w < node["start"] for w in with_positions):
            continue
        if node["var"]:
            scoped_at[node["var"]] = node["start"]
        if node["start"] < cursor:
            raise ScopeRewriteError("Nested Alert node patterns are not supported")
        var, inner, inner_masked = node["var"], node["inner"], node["inner_masked"]
        if not var:
            counter += 1
            var = f"scopedAlert{counter}"
            while var in taken:
                counter += 1
                var = f"scopedAlert{counter}"
            taken.add(var)
            lead = len(inner) - len(inner.lstrip())
            inner = inner[:lead] + var + inner[lead:]
            inner_masked = inner_masked[:lead] + var + inner_masked[lead:]
        predicate = predicate_template.format(var=var)
        where_at = _split_inline_where(inner_masked)
        if where_at is None:
            new_inner = inner.rstrip() + " WHERE " + predicate
        else:
            existing = inner[where_at + len("WHERE"):].strip()
            new_inner = inner[:where_at] + "WHERE " + predicate + " AND (" + existing + ")"
        pieces.append(query[cursor:node["start"] + 1])
        pieces.append(new_inner)
        cursor = node["end"]
    pieces.append(query[cursor:])
    return "".join(pieces), len(pieces) // 2


def scope_cypher(query: str, has_cutoff: bool = True) -> Dict[str, Any]:
    """Derives the two scoped variants of one generated query."""
    case_query, n = rewrite_alert_patterns(query, CASE_PREDICATE)
    historical_query, _ = rewrite_alert_patterns(
        query, HISTORICAL_PREDICATE if has_cutoff else HISTORICAL_PREDICATE_NO_CUTOFF)
    return {"case": case_query, "historical": historical_query, "alert_patterns": n}


_TRAILING_LIMIT_RE = re.compile(r"\s+LIMIT\s+\d+\s*;?\s*$", re.IGNORECASE)


def strip_trailing_limit(query: str) -> str:
    """Post-filter fallback only: a trailing LIMIT written by the LLM would
    otherwise be applied before our client-side case partition."""
    return _TRAILING_LIMIT_RE.sub("", query.rstrip().rstrip(";"))


# --------------------------------------------------------------------------
# Provenance
# --------------------------------------------------------------------------

def candidate_id_strings(rows: Iterable[Any], limit: int = 5000) -> List[str]:
    """Every short, whitespace-free string value in the rows (recursively)
    -- the only values that can be an Alert.id. Resolved against the
    database by the caller; nothing is guessed from ID shape."""
    found: Dict[str, None] = {}

    def walk(value):
        if len(found) >= limit:
            return
        if isinstance(value, str):
            if 0 < len(value) <= 200 and not any(c.isspace() for c in value):
                found.setdefault(value)
        elif isinstance(value, dict):
            for v in value.values():
                walk(v)
        elif isinstance(value, (list, tuple, set)):
            for v in value:
                walk(v)

    for row in rows:
        walk(row)
    return list(found)


def row_alert_ids(row: Any, known_alert_ids: Set[str]) -> List[str]:
    return [s for s in candidate_id_strings([row]) if s in known_alert_ids]


def time_relation(timestamp: Optional[str], first_seen: Optional[str], last_seen: Optional[str]) -> str:
    """Where an out-of-case alert sits relative to the case's own window."""
    from src.retrieval.temporal import _parse_ts
    try:
        ts = _parse_ts(timestamp)
        if first_seen and ts < _parse_ts(first_seen):
            return "before_case_window"
        if last_seen and ts > _parse_ts(last_seen):
            return "after_case_window"
        return "during_case_window"
    except (ValueError, TypeError, AttributeError):
        return "unknown"


def partition_rows(rows: List[dict], case_ids: Set[str], known_alert_ids: Set[str]) -> Dict[str, List[dict]]:
    """Client-side partition (post-check for the DB-scoped path, and the
    whole mechanism for the post-filter fallback). A row goes to `case`
    only if every alert it references is a member; rows that reference no
    resolvable alert at all cannot be attributed to the case."""
    out = {"case": [], "historical": [], "mixed": [], "unattributed": []}
    for row in rows:
        refs = row_alert_ids(row, known_alert_ids)
        if not refs:
            out["unattributed"].append(row)
        elif all(r in case_ids for r in refs):
            out["case"].append(row)
        elif not any(r in case_ids for r in refs):
            out["historical"].append(row)
        else:
            out["mixed"].append(row)
    return out


def provenance_for(alert_ids: Iterable[str], alert_meta: Dict[str, dict], scope: Dict[str, Any]) -> Dict[str, dict]:
    case_ids = set(scope["alert_ids"])
    result = {}
    for aid in alert_ids:
        meta = alert_meta.get(aid) or {}
        in_case = aid in case_ids
        result[aid] = {
            "scope": SCOPE_CASE if in_case else SCOPE_HISTORICAL,
            "timestamp": meta.get("timestamp"),
            "host": meta.get("host"),
            "time_relation": "member" if in_case else time_relation(
                meta.get("timestamp"), scope.get("first_seen"), scope.get("last_seen")),
        }
    return result


# --------------------------------------------------------------------------
# Rendering (what the LLM sees)
# --------------------------------------------------------------------------

CASE_HEADER = "=== CASE-LOCAL EVIDENCE ==="
HISTORICAL_HEADER = "=== HISTORICAL EVIDENCE (NOT part of this case) ==="


def _count_note(shown: int, total: int, truncated: bool) -> str:
    return f"showing {shown} of {total}{'+' if truncated else ''} matching row(s)"


def render_scoped(result: Dict[str, Any]) -> str:
    """Text form of a scoped retrieval result. Every row sits under a
    header naming its channel; historical rows additionally carry their
    own inline provenance tag so a copied row can't lose its label."""
    scope_id = result.get("case_id", "?")
    case, hist = result["case_evidence"], result["historical_evidence"]
    lines = [
        CASE_HEADER,
        f"Alerts that ARE members of case {scope_id} ({_count_note(len(case['rows']), case['total_rows'], case['truncated'])}). "
        f"Only this section is evidence about what happened in this case.",
    ]
    lines += [str(r) for r in case["rows"]] or ["(no matching rows among this case's member alerts)"]
    lines += [
        "",
        HISTORICAL_HEADER,
        f"Other alerts in the environment at or before {result.get('reference_time') or 'the reference time'} that are NOT "
        f"members of case {scope_id} ({_count_note(len(hist['rows']), hist['total_rows'], hist['truncated'])}). "
        f"Background only: usable for recurrence/baseline questions, never as evidence of this case's own activity.",
    ]
    prov = hist.get("provenance") or {}
    for row, ids in zip(hist["rows"], hist.get("row_alert_ids") or [[] for _ in hist["rows"]]):
        tags = "; ".join(
            f"alert {aid} @ {prov.get(aid, {}).get('timestamp', '?')} on host {prov.get(aid, {}).get('host', '?')}, "
            f"{prov.get(aid, {}).get('time_relation', 'unknown')}" for aid in ids) or "no single alert (aggregate)"
        lines.append(f"[historical | {tags}] {row}")
    if not hist["rows"]:
        lines.append("(no matching rows outside this case)")
    for note in result.get("notes") or []:
        lines += ["", f"NOTE: {note}"]
    return "\n".join(lines)


def has_case_rows(result: Any) -> bool:
    return isinstance(result, dict) and bool((result.get("case_evidence") or {}).get("rows"))


def has_any_rows(result: Any) -> bool:
    return isinstance(result, dict) and bool(
        (result.get("case_evidence") or {}).get("rows") or (result.get("historical_evidence") or {}).get("rows"))


# --------------------------------------------------------------------------
# Result assembly (shared by the Cypher and vector agents)
# --------------------------------------------------------------------------

EVIDENCE_TEXT_CHARS = 4000  # per alert, kept for claim validation


def build_scoped_result(*, source: str, scope: Dict[str, Any], case_rows: List[dict], case_total: int,
                        case_truncated: bool, historical_rows: List[dict], historical_total: int,
                        historical_truncated: bool, alert_meta: Dict[str, dict], enforcement: str,
                        queries: Optional[Dict[str, str]] = None, notes: Optional[List[str]] = None) -> Dict[str, Any]:
    """One retrieval answer with its two channels kept apart. `alert_meta`
    is {alert_id: {timestamp, host}} for every real alert referenced by
    the shown rows (see scoped_fetch.resolve_alerts)."""
    case_ids = set(scope["alert_ids"])
    known = set(alert_meta) | case_ids
    case_row_ids = [row_alert_ids(r, known) for r in case_rows]
    hist_row_ids = [row_alert_ids(r, known) for r in historical_rows]
    shown_ids = list(dict.fromkeys(a for ids in case_row_ids + hist_row_ids for a in ids))
    provenance = provenance_for(shown_ids, alert_meta, scope)
    alert_text: Dict[str, str] = {}
    for row, ids in list(zip(case_rows, case_row_ids)) + list(zip(historical_rows, hist_row_ids)):
        text = str(row)[:EVIDENCE_TEXT_CHARS]
        for aid in ids:
            if aid not in alert_text:
                alert_text[aid] = text
            elif text not in alert_text[aid] and len(alert_text[aid]) < 2 * EVIDENCE_TEXT_CHARS:
                alert_text[aid] += "\n" + text
    result = {
        "scoped": True, "source": source, "case_id": scope["case_id"],
        "reference_time": scope.get("reference_time"), "scope_enforcement": enforcement,
        "queries": queries or {},
        "case_evidence": {"rows": case_rows, "total_rows": case_total, "truncated": case_truncated,
                          "row_alert_ids": case_row_ids,
                          "alert_ids": list(dict.fromkeys(a for ids in case_row_ids for a in ids))},
        "historical_evidence": {"rows": historical_rows, "total_rows": historical_total,
                                "truncated": historical_truncated, "row_alert_ids": hist_row_ids,
                                "alert_ids": list(dict.fromkeys(a for ids in hist_row_ids for a in ids)),
                                "provenance": {a: provenance[a] for ids in hist_row_ids for a in ids},
                                "definition": "Alerts that are not members of the case, at or before the reference time."},
        "provenance": provenance, "alert_text": alert_text, "notes": list(notes or []),
    }
    result["rendered"] = render_scoped(result)
    return result
