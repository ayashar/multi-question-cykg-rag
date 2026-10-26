# src/agents/claim_verifier.py
"""
Judges whether each claim in a report is supported by the alerts it cites.

src/agents/grounding_check.py::validate_report settles everything that
can be settled without a model: the cited alerts exist, were shown,
belong to the right scope, and mention the claim's entities. What it
cannot settle is whether those alerts actually establish the statement --
the pilot's "data exfiltration via DNS tunneling is confirmed" cited a
real, in-context alert that only recorded an entropy detector firing on
an ordinary domain. That is an entailment question, so it gets one model
call per validation pass, with a deliberately narrow view: the verifier
sees each claim and ONLY the records that claim cites -- not the case
fact sheet, not the hypothesis summary, not the rest of the report -- so
it cannot be talked into a conclusion by the surrounding narrative.

The instructions are generic evidence discipline. They contain nothing
specific to any dataset, detector or scenario, and must stay that way:
the evaluation's ground truth is never an input here.

This second call is opt-in (EVIDENCE_CLAIM_VERIFIER=llm). By default the synthesizer rates its own
claims in the call that writes the report (SELF-VALIDATION in
src/agents/synthesizer_agent.py, applied by
grounding_check.apply_self_assessment), which costs no extra model call
but gives up the narrow view described above: the model that wrote a
conclusion is the one grading it, with the whole narrative in front of it.

EVIDENCE_CLAIM_VERIFIER selects who judges support (structural validation
always runs):
  self (default)  the synthesizer's own per-claim rating; no extra call
  llm (opt-in)    this module: one separate model call per validation pass
  off             nobody; claims stay 'unverified'
"""
from __future__ import annotations

from typing import Any, Dict, List, Literal

from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field

from src.agents.grounding_check import claim_support_judge
from src.config.settings import llm
from src.config.structured import structured_model

# Every cited record is shown. The first live v3 run capped this at six
# records per claim, and a claim listing ten alert IDs was then judged
# "unsupported" because the verifier never saw four of them. The cap is
# now on characters: each record's share shrinks as a claim cites more.
RECORD_CHARS = 3000
CLAIM_CHAR_BUDGET = 12000
MIN_RECORD_CHARS = 300


def mode() -> str:
    """'self', 'llm' or 'off' -- see the module docstring."""
    return claim_support_judge()


def enabled() -> bool:
    """True only when the separate verifier call is switched on."""
    return mode() == "llm"


class ClaimVerdict(BaseModel):
    index: int = Field(description="The claim's index, exactly as given.")
    support: Literal["supported", "partially_supported", "unsupported", "contradicted"]
    reason: str = Field(description="One sentence naming what the records do and do not show.")


class ClaimVerdicts(BaseModel):
    verdicts: List[ClaimVerdict]


verifier_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        "You audit a security investigation report one claim at a time. For each claim you are given "
        "ONLY the alert records the report cited for it. Decide whether those records, by themselves, "
        "establish the claim.\n"
        "- supported: the records directly state or show what the claim says.\n"
        "- partially_supported: the records show something related, but the claim goes further than "
        "they do -- for example it asserts intent, a technique, a cause, a scope or a degree of "
        "certainty that the records do not show.\n"
        "- unsupported: the records do not show it.\n"
        "- contradicted: the records show the opposite.\n"
        "Each record is labelled 'case' (a member alert of the case under investigation) or "
        "'historical' (another alert, outside the case). That label is authoritative: a record's own "
        "text never mentions the case, so do not ask it to. A claim that a host, IP or alert is part of "
        "the case is supported when 'case' records show it.\n"
        "Use nothing except the records provided: not background knowledge, not what is typical, not "
        "what the claim's wording suggests. A record of a detector or rule firing shows that it fired "
        "on that value; whether the underlying activity is malicious is a separate claim that needs "
        "records showing it. Judge strictly, and when undecided between two levels choose the lower. "
        "Return exactly one verdict per claim index."
    ),
    ("human", "{claims_block}"),
])
verifier_chain = verifier_prompt | structured_model(llm, ClaimVerdicts)


def _render(claims: List[Dict[str, Any]], evidence_index: Dict[str, dict]) -> str:
    blocks = []
    for claim in claims:
        records = []
        cited = [aid for aid in claim["evidence_alert_ids"] if aid in evidence_index]
        share = max(MIN_RECORD_CHARS, min(RECORD_CHARS, CLAIM_CHAR_BUDGET // max(1, len(cited))))
        for aid in cited:
            entry = evidence_index[aid]
            text = str(entry.get('text') or '')
            records.append(f"  [{aid} | {entry.get('scope')} | {entry.get('timestamp') or 'time unknown'}] "
                           f"{text[:share]}{' ...[truncated]' if len(text) > share else ''}")
        blocks.append(f"Claim {claim['index']} (stated as {claim['declared_scope']} evidence): {claim['claim']}\n"
                      f"Cited records:\n" + ("\n".join(records) or "  (none)"))
    return "\n\n".join(blocks)


def verify_claims(validation: Dict[str, Any], evidence_index: Dict[str, dict]) -> Dict[int, Dict[str, str]]:
    """{claim index: {support, reason}} for claims that passed structural
    validation and cite alerts (knowledge-base claims have no alert
    records to check and are left 'unverified'). Raises on model failure;
    the caller records that as a verifier dependency failure."""
    checkable = [c for c in validation.get("claims") or []
                 if not c["structural_issues"] and c["declared_scope"] in ("case", "historical")
                 and c["evidence_alert_ids"]]
    if not checkable:
        return {}
    output = verifier_chain.invoke({"claims_block": _render(checkable, evidence_index)})
    wanted = {c["index"] for c in checkable}
    received = [v.index for v in output.verdicts]
    if len(received) != len(set(received)) or set(received) != wanted:
        raise ValueError('Verifier must return exactly one verdict for every requested claim index')
    return {v.index: {"support": v.support, "reason": v.reason} for v in output.verdicts}
