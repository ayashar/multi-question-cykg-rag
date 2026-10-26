# src/agents/guardrails_agent.py
"""
Relevance gate + investigation-mode routing, one LLM call.

Used to also decide escalation ("should this auto-triggered alert be
investigated at all") -- removed once ingestion/investigation split into
two processes (see PROTOTYPE.md): nothing auto-triggers the pipeline
anymore, an analyst always invokes investigation deliberately (by opening
a case or typing a question), so there's nothing left to triage for
escalation purposes. `alert_triage_agent.py`, the standalone classifier
this module's escalation half was compared against, and
eval/evaluate_alert_triage.py, its evaluation harness, were removed in the
same pass for the same reason. src/run.py and the human-invoked
investigation flow (src/investigation/) never needed should_escalate at
all -- the field's system prompt language already forced it to True
unconditionally on every code path except eval/run_eval.py's single-alert
scoring calls, so this only removes now-dead code, not behavior anyone
was relying on live.

Per-question source routing (cypher/vector/cskg) is decided separately, by
src/agents/question_generation_agent.py at question granularity -- that
was already moved out of guardrails in an earlier redesign pass and stays
out here.
"""
from typing import Literal, Optional
from pydantic import BaseModel, Field
from langchain_core.prompts import ChatPromptTemplate
from src.config.settings import llm
from src.config.structured import structured_model


class GuardrailsOutput(BaseModel):
    decision: Literal["relevant", "irrelevant"] = Field(
        description="Checks if the question/alert is relevant to cybersecurity topics including "
        "log analysis, threat detection, vulnerability assessment and attack pattern reconstruction."
    )
    investigation_mode: Literal["full_hypothesis", "direct_question", "answer_from_context"] = Field(
        description="Only meaningful for a follow-up question in an ongoing investigation chat -- "
        "i.e. when the conversation history below is non-empty. Decide how much NEW investigation "
        "this specific follow-up needs, using the 'Evidence already gathered' section below. "
        "'answer_from_context' if that evidence already contains what's needed to answer this "
        "follow-up directly, no new retrieval required. Otherwise always choose 'direct_question' "
        "for a follow-up: produce one focused retrieval question even if the wording mentions "
        "several possible explanations. Follow-up chat must never launch a full hypothesis sweep. "
        "Always 'full_hypothesis' when there is no conversation history yet (first turn, or a "
        "manually-typed/single-shot question with nothing to reuse)."
    )
    reasoning: str = Field(description="One or two sentences covering the relevance decision.")


guardrails_prompt = ChatPromptTemplate.from_messages([
    (
        "system",
        """
        You are a gatekeeper for a security analysis system that investigates security alerts and
        answers cybersecurity questions. You make two decisions in one pass:

        1. RELEVANCE: The system draws on two kinds of information -- Log/Alert Data (records of
           system events: users, servers, hosts, processes, IPs, alert activity) and Cybersecurity
           Knowledge (a threat-intelligence knowledge base: CVE, CWE, CAPEC, MITRE ATT&CK).
           A question or alert is **relevant** if it concerns security log/alert analysis or
           general cybersecurity topics. It is **irrelevant** if completely off-topic (e.g. 'what
           is the weather?', 'tell me a joke').

        2. INVESTIGATION MODE: only meaningful when the conversation history below is non-empty
           (i.e. this is a follow-up question in an ongoing investigation). Using the "Evidence
           already gathered" section below, decide how much NEW investigation this follow-up
           actually needs -- see investigation_mode's own field description for the three options.
           When conversation history is empty (first turn, or a manually-typed/single-shot
           question), always set investigation_mode to 'full_hypothesis' -- there is no prior
           evidence to reuse yet.

           Follow-up chat is intentionally focused and cost-bounded. If prior evidence is enough,
           choose 'answer_from_context'; otherwise choose 'direct_question' and retrieve only the
           evidence needed for the latest question. Never choose 'full_hypothesis' when there is
           conversation history.

        Only allow relevant questions to pass.
        """
    ),
    (
        "human",
        "Question: {question}\n\n"
        "Alert context (structured fields, if this came from a single-alert evaluation call -- "
        "otherwise 'N/A'):\n{alert_context}\n\n"
        "Case context (static fact sheet, if this belongs to a clustered investigation case -- "
        "otherwise 'N/A'):\n{case_context}\n\n"
        "Conversation so far (prior turns, if this is a follow-up in an ongoing investigation "
        "chat -- otherwise 'N/A'):\n"
        "{conversation_context}\n\n"
        "Evidence already gathered so far in this investigation (hypotheses tested + verdicts from "
        "prior turns, if any -- otherwise 'N/A'), for judging investigation_mode:\n"
        "{prior_evidence_summary}"
    ),
])

guardrails_chain = guardrails_prompt | structured_model(llm, GuardrailsOutput)


def _render_alert_context(alert: Optional[dict]) -> str:
    """`alert` is the raw Alert fields dict (see src/ingestion/schema.py),
    only ever set by eval/run_eval.py's per-alert scoring calls now that
    nothing auto-triggers the live pipeline. None otherwise."""
    if not alert:
        return "N/A"
    lines = [
        f"Host: {alert.get('agent_name', 'unknown')}",
        f"Rule description: {alert.get('rule_description', 'unknown')}",
        f"Rule level (Wazuh severity, 0-15): {alert.get('rule_level', 'unknown')}",
        f"Rule groups: {', '.join(alert.get('rule_groups') or []) or 'none'}",
        f"Source IP: {alert.get('data_srcip') or 'none'}",
        f"Native MITRE ATT&CK technique (if tagged by the sensor itself): "
        f"{', '.join(alert.get('rule_mitre_id') or []) or 'none'}",
    ]
    return "\n".join(lines)
