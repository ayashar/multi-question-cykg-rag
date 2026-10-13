# src/agents/grounding_check.py
"""
Verification pass on the synthesizer's structured output.

Two layers, both non-LLM. Whether the cited alerts actually support a
claim is a third question this module does not answer itself. The default
is the synthesizer's own per-claim rating, written in the call that produces
the report and applied by apply_self_assessment (no extra model call).
EVIDENCE_CLAIM_VERIFIER=llm opts in to a separate model call
(src/agents/claim_verifier.py, merged by apply_claim_verdicts); off disables
semantic support checks. Neither model judgement is independently annotated
ground truth, and a self-rating is not independent of the report it grades.

1. Entity presence (`check_grounding`, unchanged): every entity the
   report cites must literally appear somewhere in the retrieved context.

2. Claim and case-membership validation (`validate_report`, added after
   the russellmitchell-cases-fused pilot). Entity presence alone passed
   that pilot's reports as "grounded" while:
     - a follow-up answer listed two hosts as "involved in this case"
       citing alerts that were not members of the case, and
     - "confirmed DNS tunneling" was accepted because the string
       `worldbank.org` occurred in the context -- the check knew the
       entity existed, not whether any alert supported the claim.
   This layer checks each structured claim (SynthesizedReport.claims)
   against the alerts it cites: that each cited alert is real and was
   actually shown to the model, whether it is a member of the case or
   historical, that the claim's declared scope matches, and that the
   entities the claim is about occur in those specific alerts' own
   content rather than merely somewhere in the prompt.

defengraph_vs_agcyrag_analysis.md Sec.5.4: "a grounding check, not a full
agentic loop" -- still one bounded retry, driven by `valid` instead of
entity presence alone.
"""
from __future__ import annotations

import os
import re
from typing import Any, Dict, Iterable, List, Optional, Set

from pydantic import BaseModel

MITRE_ID_RE = re.compile(r"\bT\d{4}(?:\.\d{3})?\b")
IP_RE = re.compile(r"\b\d{1,3}(?:\.\d{1,3}){3}\b")
_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:\-]*[A-Za-z0-9]|[A-Za-z0-9]")
_CASE_CONTEXT_ALERT_RE = re.compile(r"^- Alert (\S+) \[", re.MULTILINE)

SUPPORTED, PARTIAL, UNSUPPORTED, CONTRADICTED, UNVERIFIED = (
    "supported", "partially_supported", "unsupported", "contradicted", "unverified")
# A negative finding ("no sign of lateral movement was found") has no alert
# to cite by definition. The first live v3 run flagged every such claim as
# "cites no alert", failing all four reports for stating what the evidence
# did not contain. Such claims now carry scope 'not_found': accepted
# without citations, labelled as not checkable, and never counted as
# support for anything.
NOT_CHECKABLE = "not_checkable"
_SUPPORT_RATINGS = (SUPPORTED, PARTIAL, UNSUPPORTED, CONTRADICTED)
_CONFIDENCE_RANK = {"low": 0, "medium": 1, "high": 2}


def claim_support_judge() -> str:
    """Who decides whether a claim's cited alerts support it
    (EVIDENCE_CLAIM_VERIFIER): 'self' -- the synthesizer's own rating, no
    extra model call; 'llm' -- a separate verifier call (opt-in)
    (src/agents/claim_verifier.py); 'off' -- nobody. Lives here, free of
    model imports, so the evaluation runner can record it cheaply."""
    value = os.environ.get("EVIDENCE_CLAIM_VERIFIER", "self").strip().lower()
    if value in ("off", "0", "false", "none"):
        return "off"
    if value in ('llm', 'verifier', 'separate'):
        return 'llm'
    if value == 'self':
        return 'self'
    raise ValueError('EVIDENCE_CLAIM_VERIFIER must be llm, self, or off')


class GroundingResult(BaseModel):
    grounded: bool
    checked_entities: List[str]
    ungrounded_entities: List[str]


def _extract_entities(report: Dict[str, Any]) -> List[str]:
    entities = set()
    for e in report.get("cited_entities") or []:
        if e:
            entities.add(str(e).strip())
    for e in report.get("mitre_techniques") or []:
        if e:
            entities.add(str(e).strip())
    final_answer = report.get("final_answer") or ""
    entities.update(MITRE_ID_RE.findall(final_answer))
    entities.update(IP_RE.findall(final_answer))
    return sorted(entities)


def check_grounding(report: Dict[str, Any], context_blobs: List[str]) -> GroundingResult:
    """`report` is a SynthesizedReport dict (e.g. `.model_dump()`).
    `context_blobs` are the raw retrieved-context strings (cypher context,
    vector context, mcp_rdf context) the report was supposed to be grounded
    in."""
    haystack = "\n".join(b for b in context_blobs if b).lower()
    entities = _extract_entities(report)
    ungrounded = [e for e in entities if e.lower() not in haystack]
    return GroundingResult(
        grounded=len(ungrounded) == 0,
        checked_entities=entities,
        ungrounded_entities=ungrounded,
    )


# --------------------------------------------------------------------------
# Evidence index helpers
# --------------------------------------------------------------------------

def case_context_alerts(case_context: Optional[str], case_alert_ids: Iterable[str]) -> Dict[str, str]:
    """Member alerts quoted in the case fact sheet
    (src/investigation/narrative.py::_alert_line) -> {alert_id: line}.
    These were shown to the model, so they are citable case evidence."""
    members, found = set(case_alert_ids), {}
    for line in (case_context or "").splitlines():
        m = _CASE_CONTEXT_ALERT_RE.match(line)
        if m and m.group(1) in members:
            found[m.group(1)] = line
    return found


def _tokens(text: str) -> Set[str]:
    return {t.rstrip(".:") for t in _TOKEN_RE.findall(text or "")}


def _id_prefix(ids: Iterable[str]) -> str:
    """Longest common prefix of the case's alert IDs, used only to notice
    an ID-shaped token that matches no real alert (a fabricated citation)."""
    prefix = os.path.commonprefix(list(ids)[:2000])
    cut = max(prefix.rfind("-"), prefix.rfind("_"), prefix.rfind(":"))
    return prefix[:cut + 1] if cut >= 3 else ""


# --------------------------------------------------------------------------
# Claim / membership validation
# --------------------------------------------------------------------------

def validate_report(report: Dict[str, Any], *, context_blobs: List[str], evidence_index: Dict[str, dict],
                    case_scope: Optional[Dict[str, Any]], cskg_has_data: bool = True) -> Dict[str, Any]:
    """Deterministic validation. Returns a plain dict (stored in
    state['grounding_result']) that keeps check_grounding's three keys and
    adds `claims`, `citations`, `violations` and `valid`.

    `evidence_index` is {alert_id: {scope, text, timestamp, host, sources}}
    for every alert whose content was shown to the model this
    investigation (retrieved rows plus the case fact sheet's excerpts).
    Without a `case_scope` (general questions, per-alert eval) only the
    entity-presence layer applies and `valid == grounded`."""
    base = check_grounding(report, context_blobs)
    result: Dict[str, Any] = {**base.model_dump(), "valid": base.grounded, "violations": [], "claims": [],
                              "citations": {}, "case_scoped": bool(case_scope)}
    if not base.grounded:
        result["violations"].append({"type": "ungrounded_entity", "blocking": True,
                                     "detail": f"Cited but absent from every retrieved context: {base.ungrounded_entities}"})
    if not case_scope:
        return result

    members = set(case_scope["alert_ids"])
    known = set(evidence_index) | members
    prefix = _id_prefix(members)

    def classify(aid: str) -> str:
        if aid in evidence_index:
            return evidence_index[aid].get("scope") or ("case" if aid in members else "historical")
        if aid in members:
            return "member_not_shown"   # real member, but its content never reached the model
        return "unknown"

    violations = result["violations"]
    claims_out: List[Dict[str, Any]] = []
    cited_in_claims: Set[str] = set()
    for index, claim in enumerate(report.get("claims") or []):
        declared = claim.get("scope")
        ids = [str(a).strip() for a in claim.get("evidence_alert_ids") or [] if str(a).strip()]
        cited_in_claims.update(ids)
        scopes = {aid: classify(aid) for aid in ids}
        issues: List[str] = []
        if declared == "not_found" and ids:
            issues.append("not_found_with_citations: a claim that nothing was found cannot rest on specific alerts; "
                          "state what those alerts show as a 'case' or 'historical' claim instead")
        if declared in ("case", "historical") and not ids:
            issues.append("no_evidence: the claim cites no alert")
        unknown = [a for a, s in scopes.items() if s == "unknown"]
        if unknown:
            issues.append(f"unknown_alert: {unknown} match no alert in the evidence or the case")
        not_shown = [a for a, s in scopes.items() if s == "member_not_shown"]
        if not_shown:
            issues.append(f"alert_not_in_evidence: {not_shown} are case members whose content was never retrieved")
        outside = [a for a, s in scopes.items() if s == "historical"]
        if declared == "case" and outside:
            issues.append(f"historical_cited_as_case: {outside} are NOT members of this case")
        if declared == "knowledge_base" and not cskg_has_data:
            issues.append("knowledge_base_unavailable: no knowledge-base data was retrieved this investigation")
        usable = [a for a in ids if a in evidence_index and not (declared == "case" and scopes[a] == "historical")]
        if usable and declared in ("case", "historical"):
            cited_text = "\n".join(str(evidence_index[a].get("text") or "") for a in usable).lower()
            missing = [e for e in claim.get("entities") or [] if e and str(e).lower() not in cited_text]
            if missing:
                issues.append(f"entity_not_in_cited_evidence: {missing} do not occur in the alerts this claim cites")
        claims_out.append({"index": index, "claim": claim.get("claim"), "declared_scope": declared,
                           "evidence_alert_ids": ids, "citation_scopes": scopes, "entities": claim.get("entities") or [],
                           "structural_issues": issues,
                           # The synthesizer's own rating, kept as written; it becomes
                           # `support` only through apply_self_assessment.
                           "self_support": claim.get("support"),
                           "self_support_reason": claim.get("support_reason") or None,
                           "support": NOT_CHECKABLE if declared == "not_found" and not issues else UNVERIFIED,
                           "support_reason": ("Negative finding: there is no alert to check it against."
                                              if declared == "not_found" and not issues else None),
                           "valid": not issues})
        for issue in issues:
            violations.append({"type": issue.split(":", 1)[0], "blocking": True, "claim_index": index,
                               "detail": f"Claim {index} ({claim.get('claim')!r}): {issue}"})

    # Alert IDs mentioned in prose must be accounted for by a claim.
    prose = " ".join(str(report.get(k) or "") for k in ("final_answer", "critical_analysis", "contextual_linkage"))
    prose += " " + " ".join(str(e) for e in report.get("cited_entities") or [])
    tokens = _tokens(prose)
    mentioned = {t for t in tokens if t in known}
    fabricated = sorted(t for t in tokens if prefix and t.startswith(prefix) and t not in known)
    if fabricated:
        violations.append({"type": "unknown_alert", "blocking": True,
                           "detail": f"The report mentions alert IDs that match no real alert: {fabricated}"})
    unclaimed = sorted(mentioned - cited_in_claims)
    if unclaimed:
        violations.append({"type": "alert_not_in_claims", "blocking": True,
                           "detail": f"Alert IDs mentioned in the report but not attached to any claim: {unclaimed}"})
    if not claims_out and (report.get("recommended_priority") or "ignore") != "ignore":
        violations.append({"type": "no_claims", "blocking": True,
                           "detail": "The report recommends action but lists no claims to check."})

    all_cited = sorted(mentioned | cited_in_claims | set(fabricated))
    by_scope: Dict[str, List[str]] = {"case": [], "historical": [], "member_not_shown": [], "unknown": []}
    for aid in all_cited:
        by_scope.setdefault(classify(aid), []).append(aid)
    result.update(claims=claims_out, citations=by_scope,
                  valid=not any(v["blocking"] for v in violations))
    return result


def _needs_support_rating(claim: Dict[str, Any]) -> bool:
    """Claims whose substance can be checked against alerts: structurally
    sound 'case'/'historical' claims that cite something."""
    return (not claim["structural_issues"] and claim["declared_scope"] in ("case", "historical")
            and bool(claim["evidence_alert_ids"]))


def apply_claim_verdicts(result: Dict[str, Any], verdicts: Dict[int, Dict[str, str]], *,
                         blocking: bool = True, source: str = "verifier") -> Dict[str, Any]:
    """Merges per-claim support judgements ({index: {support, reason}})
    into a validate_report() result. A claim judged anything but
    'supported' stops counting as valid. `blocking` says whether that also
    fails the report and sends it back for the one retry."""
    for claim in result.get("claims") or []:
        verdict = verdicts.get(claim["index"])
        if not verdict:
            if source == 'verifier' and _needs_support_rating(claim):
                claim['valid'] = False
                result['violations'].append({
                    'type': 'claim_unverified', 'blocking': blocking, 'claim_index': claim['index'],
                    'detail': f"Claim {claim['index']} has no independent support verdict; do not treat it as verified."})
            continue
        claim["support"], claim["support_reason"] = verdict["support"], verdict.get("reason")
        claim["support_source"] = source
        if verdict["support"] != SUPPORTED:
            claim["valid"] = False
            result["violations"].append({
                "type": f"claim_{verdict['support']}", "blocking": blocking, "claim_index": claim["index"],
                "detail": f"Claim {claim['index']} ({claim['claim']!r}) is {verdict['support'].replace('_', ' ')} "
                          f"by the alerts it cites: {verdict.get('reason')}"})
    result["valid"] = not any(v["blocking"] for v in result["violations"])
    return result


def apply_self_assessment(result: Dict[str, Any]) -> Dict[str, Any]:
    """Uses the synthesizer's own per-claim rating as the support
    judgement, instead of a second model call.

    - A claim the synthesizer rated below 'supported' stops counting as
      valid, which lowers confidence/priority through
      validation_adjustments and is named in the validation notice. It is
      NOT blocking: sending a report back because its author flagged its
      own claim would mostly teach it to stop flagging.
    - A checkable claim with no rating was not self-checked at all. That is
      blocking (one retry asks for the rating); if it is still missing the
      claim stays 'unverified' and does not count as valid.

    This is the report grading itself in the same pass that wrote it, so it
    is weaker than an independent judgement and should be reported as
    self-assessment. The deterministic checks in validate_report do not
    depend on it."""
    verdicts: Dict[int, Dict[str, str]] = {}
    for claim in result.get("claims") or []:
        if not _needs_support_rating(claim):
            continue
        rating = claim.get("self_support")
        if rating in _SUPPORT_RATINGS:
            verdicts[claim["index"]] = {"support": rating, "reason": claim.get("self_support_reason")}
            continue
        claim["valid"] = False
        claim["support_reason"] = "The report did not rate whether its cited alerts support this claim."
        result["violations"].append({
            "type": "not_self_assessed", "blocking": True, "claim_index": claim["index"],
            "detail": f"Claim {claim['index']} ({claim['claim']!r}) has no support rating: re-read the alerts it "
                      f"cites and set `support` and `support_reason` for it"})
    return apply_claim_verdicts(result, verdicts, blocking=False, source="self")


def summarize_claims(result: Dict[str, Any]) -> Dict[str, Any]:
    claims = result.get("claims") or []
    return {
        "claims_total": len(claims),
        "claims_valid": sum(c["valid"] for c in claims),
        "case_claims_valid": sum(c["valid"] and c["declared_scope"] == "case" for c in claims),
        "claims_by_support": {s: sum(c["support"] == s for c in claims)
                              for s in (SUPPORTED, PARTIAL, UNSUPPORTED, CONTRADICTED, UNVERIFIED, NOT_CHECKABLE)},
        "claims_with_structural_issues": sum(bool(c["structural_issues"]) for c in claims),
        "cited_alerts": {k: len(v) for k, v in (result.get("citations") or {}).items()},
    }


def validation_adjustments(report: Dict[str, Any], result: Dict[str, Any]) -> Dict[str, Any]:
    """What a case report may still assert once validation is final.
    Only ever lowers. Rules (case investigations only):
      - no valid case-scope claim at all  -> confidence 'low', and
        'escalate' becomes 'monitor': nothing verified about this case
        justifies paging a human;
      - some claim failed validation      -> confidence at most 'medium'.
    Returns {} when nothing changes."""
    if not result.get("case_scoped"):
        return {}
    summary = summarize_claims(result)
    changes: Dict[str, Any] = {}
    if summary["case_claims_valid"] == 0:
        cap, reason = "low", "no claim about this case is supported by case-local evidence"
        if report.get("recommended_priority") == "escalate":
            changes["recommended_priority"] = {"from": "escalate", "to": "monitor", "reason": reason}
    elif summary["claims_valid"] < summary["claims_total"]:
        cap, reason = "medium", (f"{summary['claims_total'] - summary['claims_valid']} of "
                                 f"{summary['claims_total']} claim(s) failed validation")
    else:
        return changes
    current = report.get("confidence") or "low"
    if _CONFIDENCE_RANK.get(current, 0) > _CONFIDENCE_RANK[cap]:
        changes["confidence"] = {"from": current, "to": cap, "reason": reason}
    return changes


def retry_note(result: Dict[str, Any], limit: int = 12) -> str:
    """Correction text handed back to the synthesizer for its one retry."""
    lines = [v["detail"] for v in result.get("violations") or [] if v.get("blocking")][:limit]
    if not lines:
        return ""
    return ("\n**IMPORTANT CORRECTION**: a previous draft of this report failed validation. Fix every item "
            "below. Where the evidence does not support a statement, remove it or restate it as what the cited "
            "alerts actually show -- do not look for different wording that keeps the same unsupported "
            "conclusion. Cite only alerts that appear in the context, and cite an alert as case evidence only "
            "if it is in the CASE-LOCAL section or the Case Context.\n- " + "\n- ".join(lines))
