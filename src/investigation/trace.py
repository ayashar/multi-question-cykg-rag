# src/investigation/trace.py
"""
What a frontend needs in order to show *why* an investigation turn reached
its answer, built from the pipeline's final state.

`TurnRecord` (session.py) carries the report. This module adds the trail
behind it: the hypotheses and questions that were generated, what each
retrieval returned and which hypotheses its review ruled in or out, every
claim with its support rating and cited alerts, and the text of the alerts
those claims cite. It is plain JSON, bounded in size, and read-only: it
copies from the state and never feeds anything back into the pipeline.

Also here: the one-line summaries the live event stream shows for each
pipeline step (events.py).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

ALERT_TEXT_CHARS = 700        # evidence_index texts repeat the alert as raw dicts; the first line is the readable one
MAX_ALERTS = 120
MAX_LOG_LINES = 400
LOG_LINE_CHARS = 400

# Node name -> what a person reading the progress bar should see.
STEP_LABELS = {
    "guardrails": "Checking the request",
    "question_generation": "Generating hypotheses and questions",
    "dispatch_retrieval": "Retrieving evidence",
    "review_evidence": "Reviewing evidence against each hypothesis",
    "synthesizer": "Writing the report",
    "grounding_check": "Validating claims against the cited alerts",
}
STEP_ORDER = list(STEP_LABELS)


def _first_line(text: Any, limit: int = ALERT_TEXT_CHARS) -> str:
    line = str(text or "").strip().split("\n", 1)[0]
    return line if len(line) <= limit else line[:limit - 3] + "..."


def _question(q: dict) -> dict:
    return {"hypothesis": q.get("hypothesis"), "question": q.get("question"),
            "source": q.get("source"), "rationale": q.get("rationale")}


def _retrieval(r: dict) -> dict:
    evidence = r.get("evidence") or {}
    review = r.get("review") or {}
    retrieval = r.get("retrieval") or {}
    return {
        **_question(r),
        "turn": r.get("turn"),
        "status": retrieval.get("status"),
        "error": retrieval.get("message") if retrieval.get("status") == "failed" else None,
        "seconds": retrieval.get("seconds"),
        "verdict": review.get("hypothesis_verdict"),
        "sufficient": review.get("sufficient"),
        "reasoning": review.get("reasoning"),
        # Row counts and the actual queries, not the rows: the rows are the alerts in `alerts` below.
        "scope_enforcement": evidence.get("scope_enforcement"),
        "case_rows": evidence.get("case_rows"),
        "case_rows_total": evidence.get("case_rows_total"),
        "historical_rows": evidence.get("historical_rows"),
        "historical_rows_total": evidence.get("historical_rows_total"),
        "case_alert_ids": evidence.get("case_alert_ids") or [],
        "historical_alert_ids": evidence.get("historical_alert_ids") or [],
        "queries": evidence.get("queries"),
        "notes": evidence.get("notes") or [],
    }


def _claims(state: dict) -> List[dict]:
    """Validated claims where grounding ran (they carry the final support
    rating and its source), else the report's own."""
    grounded = (state.get("grounding_result") or {}).get("claims")
    claims = grounded if grounded else ((state.get("synthesized_report") or {}).get("claims") or [])
    out = []
    for c in claims:
        out.append({
            "claim": c.get("claim"),
            "scope": c.get("scope") or c.get("declared_scope"),
            "alert_ids": c.get("evidence_alert_ids") or [],
            "support": c.get("support"),
            "support_reason": c.get("support_reason"),
            "support_source": c.get("support_source"),
            "valid": c.get("valid"),
            "issues": c.get("structural_issues") or [],
        })
    return out


def _alerts(state: dict) -> Dict[str, dict]:
    index = state.get("evidence_index") or {}
    cited = {a for c in _claims(state) for a in c["alert_ids"]}
    # Cited alerts first, so the cap never drops one a claim points at.
    order = [a for a in index if a in cited] + [a for a in index if a not in cited]
    return {a: {"scope": index[a].get("scope"), "timestamp": index[a].get("timestamp"),
                "host": index[a].get("host"), "time_relation": index[a].get("time_relation"),
                "text": _first_line(index[a].get("text")), "cited": a in cited}
            for a in order[:MAX_ALERTS]}


def build_trace(state: Optional[dict], log: Optional[List[dict]] = None) -> dict:
    """The trail behind one turn, from the pipeline's final state."""
    state = state or {}
    grounding = state.get("grounding_result") or {}
    report = state.get("synthesized_report") or {}
    return {
        "mode": state.get("investigation_mode"),
        "hypotheses": [_question(q) for q in state.get("generated_questions") or []],
        "retrievals": [_retrieval(r) for r in state.get("question_results") or []],
        "claims": _claims(state),
        "alerts": _alerts(state),
        "validation": {
            "valid": grounding.get("valid"),
            "violations": [v.get("detail") for v in grounding.get("violations") or []],
            "summary": grounding.get("summary"),
            "claim_judge": (grounding.get("claim_verifier") or {}).get("status"),
            "retried": bool(state.get("grounding_retry_count")),
            "adjustments": grounding.get("adjustments") or {},
        },
        "source_status": state.get("source_status") or report.get("source_status"),
        "dependency_failures": state.get("dependency_failures") or [],
        "uncertainty": report.get("uncertainty") or [],
        "log": (log or [])[-MAX_LOG_LINES:],
    }


def summarize_update(node: str, update: Optional[dict]) -> str:
    """One line about what a node just produced, for the progress stream.
    Never raises: a missing field only shortens the line."""
    update = update or {}
    try:
        if node == "question_generation":
            qs = update.get("generated_questions") or []
            by_source: Dict[str, int] = {}
            for q in qs:
                by_source[q.get("source", "?")] = by_source.get(q.get("source", "?"), 0) + 1
            return f"{len(qs)} question(s): " + ", ".join(f"{n} {s}" for s, n in sorted(by_source.items())) if qs else "no questions"
        if node == "dispatch_retrieval":
            status = update.get("source_status") or {}
            parts = [f"{k} {v.get('status')}" for k, v in status.items() if v.get("status") != "not_queried"]
            return "; ".join(parts) or "nothing to retrieve"
        if node == "review_evidence":
            verdicts: Dict[str, int] = {}
            for r in update.get("question_results") or []:
                v = (r.get("review") or {}).get("hypothesis_verdict")
                if v:
                    verdicts[v] = verdicts.get(v, 0) + 1
            return ", ".join(f"{n} {v.replace('_', ' ')}" for v, n in sorted(verdicts.items())) or "reviewed"
        if node == "synthesizer":
            report = update.get("synthesized_report") or {}
            return f"priority {report.get('recommended_priority')}, confidence {report.get('confidence')}" if report else "report drafted"
        if node == "grounding_check":
            g = update.get("grounding_result") or {}
            if not g:
                return "checked"
            return "claims valid" if g.get("valid", g.get("grounded")) else f"{len(g.get('violations') or [])} issue(s) found"
        if node == "guardrails":
            return "request accepted" if update.get("is_relevant", True) else "request out of scope"
    except Exception:  # a summary must never break the run
        return ""
    return ""
