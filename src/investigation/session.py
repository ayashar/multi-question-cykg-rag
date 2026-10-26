# src/investigation/session.py
"""
Runs the *same* multi-agent pipeline as src/run.py/eval/, but as a
checkpointed, multi-turn investigation thread instead of a single-shot
call -- the "initial investigation, then chatroom" half of the split
described in src/investigation/__init__.py's package (see PROTOTYPE.md).

Compiles the graph a *second* time with a checkpointer
(`workflow.compile(checkpointer=FileCheckpointSaver(...))`), importing the uncompiled
`workflow` StateGraph builder from src.graph.workflow rather than its
already-compiled `app`. This is deliberate: src/run.py and eval/run_eval.py
keep calling the original uncheckpointed `app` exactly as before (no
`thread_id` needed there), so adding checkpointing here is purely additive
and can't break either of them -- LangGraph raises if you invoke a
checkpointed graph without a thread_id, which would otherwise break every
existing call site.

Resuming a conversation: the checkpointer is a FileCheckpointSaver (see
src/investigation/checkpoints.py). After every turn the case's latest
pipeline state is written to data/checkpoints/<case_id>.json, and the Case
itself to data/checkpoints/<case_id>.case.json. The audit log is reloaded on
API startup (load_transcripts) so past turns stay readable, and a follow-up
on a reloaded case picks its pipeline state back up from those files. Only
cases whose state was never saved (investigated before this existed) still
raise CaseNotResumable. This is a single-process FastAPI service (see
api.py), not a durable multi-instance backend. Each turn is additionally
appended to data/investigations.jsonl as a persistent audit trail, mirroring
the pattern src/ingestion/trigger.py used for auto_trigger_log.jsonl.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

from pydantic import BaseModel, Field

from src.graph.workflow import workflow
from src.ingestion.schema import Alert
from src.investigation.checkpoints import FileCheckpointSaver, safe_filename
from src.investigation.events import bus, current_case, install_log_handler
from src.investigation.trace import STEP_LABELS, build_trace, summarize_update
from src.investigation.clustering import Case
from src.investigation.knowledge_base import is_storage_worthy, store_finding
from src.investigation.narrative import build_case_context
from src.retrieval.case_scope import make_case_scope
from src.retrieval.temporal import now_iso

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
LOG_PATH = DATA_DIR / "investigations.jsonl"
CHECKPOINT_DIR = DATA_DIR / "checkpoints"

INITIAL_DIRECTIVE = (
    "Investigate the activity described in this case. Identify related MITRE ATT&CK "
    "techniques, provide an initial diagnosis of the situation, and recommend mitigation actions."
)

checkpointer = FileCheckpointSaver(CHECKPOINT_DIR)
checkpointed_app = workflow.compile(checkpointer=checkpointer)

# Keyed by case_id (== LangGraph thread_id). Rebuilt after a restart from the
# audit log (_transcripts) and data/checkpoints/ (_case_by_id, lazily).
# Individual retrieval calls have their own deadlines, but a provider can
# still leave the whole graph waiting indefinitely during synthesis. Keep the
# HTTP request bounded at the turn level as well.
PIPELINE_TIMEOUT_SECONDS = int(os.environ.get("INVESTIGATION_TIMEOUT_SECONDS", "480"))

# The in-memory maps are rebuilt after a restart from the audit log and
# data/checkpoints/; the checkpoint keeps follow-up turns resumable.
_transcripts: Dict[str, List["TurnRecord"]] = {}
_case_by_id: Dict[str, Case] = {}
_restored: set = set()   # cases reloaded from the audit log after a restart


class CaseNotResumable(Exception):
    """The case's turns were reloaded from the audit log after a restart and
    no saved pipeline state exists for it (it predates saved checkpoints, or
    its checkpoint file was removed)."""


class InvestigationSummary(BaseModel):
    """One conversation, for a UI's list of past investigations."""
    case_id: str
    turn_count: int
    first_question: str
    last_question: str
    last_answer_preview: Optional[str] = None
    last_timestamp: str
    recommended_priority: Optional[str] = None
    hosts: List[str] = Field(default_factory=list)
    alert_count: Optional[int] = None
    # Whether POST /investigations/{case_id}/chat will accept a follow-up.
    resumable: bool
    # A turn is in progress right now (follow GET .../events).
    running: bool = False


class InvestigationTimeoutError(TimeoutError):
    """The complete investigation turn exceeded its wall-clock deadline."""


class TurnRecord(BaseModel):
    case_id: str
    turn_index: int
    question: str
    answer: Optional[str] = None
    critical_analysis: Optional[str] = None
    mitigation_suggestions: List[str] = Field(default_factory=list)
    recommended_priority: Optional[str] = None
    confidence: Optional[str] = None
    mitre_techniques: List[str] = Field(default_factory=list)
    cited_entities: List[str] = Field(default_factory=list)
    error: Optional[str] = None
    timestamp: str
    latency_seconds: float = 0.0
    # config v3: what validation changed, and which sources were down.
    validation_notice: Optional[str] = None
    validation: Optional[dict] = None
    source_status: Optional[dict] = None
    # How the answer was reached (hypotheses, retrievals, claims, cited
    # alerts, log lines) -- see src/investigation/trace.py. For a frontend.
    trace: Optional[dict] = None


def load_transcripts() -> int:
    """Reload past turns from the audit log into the in-memory transcripts.
    Skips cases already held in memory and unreadable lines. Returns the
    number of turns loaded."""
    if not LOG_PATH.exists():
        return 0
    loaded = 0
    with open(LOG_PATH) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                record = TurnRecord.model_validate_json(line)
            except Exception:
                logger.warning("[investigation] skipped an unreadable line in %s", LOG_PATH)
                continue
            if record.case_id in _transcripts and record.case_id not in _restored:
                continue
            turns = _transcripts.setdefault(record.case_id, [])
            if any(t.turn_index == record.turn_index for t in turns):
                continue
            turns.append(record)
            _restored.add(record.case_id)
            loaded += 1
    for turns in _transcripts.values():
        turns.sort(key=lambda t: t.turn_index)
    return loaded


def _case_path(case_id: str) -> Path:
    return CHECKPOINT_DIR / f"{safe_filename(case_id)}.case.json"


def _save_case(case: Case) -> None:
    try:
        CHECKPOINT_DIR.mkdir(parents=True, exist_ok=True)
        path = _case_path(case.case_id)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(case.model_dump_json())
        tmp.replace(path)
    except Exception:
        logger.warning("[investigation] could not save case %s", case.case_id, exc_info=True)


def _load_case(case_id: str) -> Optional[Case]:
    path = _case_path(case_id)
    if not path.exists():
        return None
    try:
        case = Case.model_validate_json(path.read_text())
    except Exception:
        logger.warning("[investigation] could not read %s", path, exc_info=True)
        return None
    return case if case.case_id == case_id else None


def _persist_state(case_id: str) -> None:
    """Save the case's latest pipeline state so the conversation can be
    resumed after a restart. A failure here never fails the turn itself."""
    try:
        checkpointer.persist(case_id)
    except Exception:
        logger.warning("[investigation] could not save pipeline state for %s", case_id, exc_info=True)


def is_resumable(case_id: str) -> bool:
    if case_id not in _transcripts:
        return False
    if case_id not in _restored or case_id in _case_by_id:
        return True
    return checkpointer.has_checkpoint(case_id)


def _ensure_resumable(case_id: str) -> None:
    """For a case reloaded after a restart: bring back its Case and check its
    pipeline state was saved. Raises CaseNotResumable otherwise."""
    if case_id not in _restored or case_id in _case_by_id:
        return
    if not checkpointer.restore(case_id):
        raise CaseNotResumable(
            f"Case {case_id} was reloaded from the audit log after a restart and has no saved pipeline "
            f"state (it was investigated before conversations were saved), so it cannot take follow-ups. "
            f"Its turns remain readable.")
    case = _load_case(case_id)
    if case is not None:
        _case_by_id[case_id] = case
    _restored.discard(case_id)
    logger.info("[investigation] case=%s resumed from saved state", case_id)


def _safe_trace(result: dict, log: list) -> Optional[dict]:
    try:
        return build_trace(result, log)
    except Exception:
        logger.warning("[investigation] could not build the trace", exc_info=True)
        return None


def _append_log(record: TurnRecord) -> None:
    LOG_PATH.parent.mkdir(exist_ok=True)
    with open(LOG_PATH, "a") as f:
        f.write(record.model_dump_json() + "\n")


_RETRYABLE_PROVIDER_STATUS = {408, 409, 429, 500, 502, 503, 504, 520, 522, 524}


def _pipeline_error_message(exc: Exception) -> str:
    """Return a useful, bounded message for the UI while logging the full error."""
    if isinstance(exc, InvestigationTimeoutError):
        return "The investigation exceeded its time limit. Please retry in a moment."
    status = getattr(exc, "status_code", None)
    if status in _RETRYABLE_PROVIDER_STATUS:
        return f"The model provider is temporarily unavailable (HTTP {status}). Please retry in a moment."
    if isinstance(exc, TimeoutError) or type(exc).__name__ == "APITimeoutError":
        return "The model provider timed out. Please retry in a moment."
    return str(exc) or f"{type(exc).__name__} without a message"


async def _run_turn(case_id: str, question: str, extra_state: dict) -> TurnRecord:
    """Invokes checkpointed_app on the given thread. `grounding_retry_count`
    is always reset to 0 here even though it isn't a reducer field: without
    this, a turn that ended after a grounding-check retry (count=1) would
    leave that count sitting in the checkpoint, and the *next* turn's fresh
    synthesis would see grounding_retry_count>=1 and wrongly skip its own
    legitimate one-shot retry (see src/graph/workflow.py::decide_after_grounding)."""
    state = {
        "question": question,
        "original_question": question,
        "messages": [("human", question)],
        "grounding_retry_count": 0,
        # Also reset: a previous turn that ended still failing validation
        # would otherwise make this turn's FIRST synthesis look like a
        # retry (synthesize_node reads grounding_result to decide that).
        "grounding_result": None,
        **extra_state,
    }
    config = {"configurable": {"thread_id": case_id}, "recursion_limit": 30}
    turn_index = len(_transcripts.get(case_id, [])) + 1
    install_log_handler()
    token = current_case.set(case_id)
    bus.start_turn(case_id, turn_index, question)
    start = time.monotonic()
    async def consume_graph() -> dict:
        async for update in checkpointed_app.astream(state, config=config, stream_mode="updates"):
            for node, node_update in (update or {}).items():
                bus.publish(case_id, {
                    "type": "step_completed", "node": node,
                    "label": STEP_LABELS.get(node, node),
                    "summary": summarize_update(node, node_update),
                    "elapsed": round(time.monotonic() - start, 2),
                })
        snapshot = await checkpointed_app.aget_state(config)
        return dict(snapshot.values or {})

    try:
        result = await asyncio.wait_for(consume_graph(), timeout=PIPELINE_TIMEOUT_SECONDS)
    except asyncio.TimeoutError as exc:
        timeout_error = InvestigationTimeoutError(
            f"Investigation did not finish within {PIPELINE_TIMEOUT_SECONDS}s"
        )
        logger.error(f"[investigation] pipeline failed for case {case_id}: {timeout_error}", exc_info=True)
        result = {"answer": None, "error": _pipeline_error_message(timeout_error)}
    except Exception as e:
        logger.error(f"[investigation] pipeline failed for case {case_id}: {e}", exc_info=True)
        result = {"answer": None, "error": _pipeline_error_message(e)}
    finally:
        current_case.reset(token)
    latency = time.monotonic() - start
    _persist_state(case_id)

    report = result.get("synthesized_report") or {}
    record = TurnRecord(
        case_id=case_id,
        turn_index=turn_index,
        question=question,
        answer=result.get("answer"),
        critical_analysis=report.get("critical_analysis"),
        mitigation_suggestions=report.get("mitigation_suggestions") or [],
        recommended_priority=report.get("recommended_priority"),
        confidence=report.get("confidence"),
        mitre_techniques=report.get("mitre_techniques") or [],
        cited_entities=report.get("cited_entities") or [],
        error=result.get("error"),
        timestamp=now_iso(),
        latency_seconds=round(latency, 2),
        validation_notice=report.get("validation_notice") or None,
        validation=report.get("validation"),
        source_status=report.get("source_status"),
        trace=_safe_trace(result, bus.logs(case_id)),
    )
    logger.info(
        f"[investigation] case={case_id} turn={turn_index} latency={record.latency_seconds}s "
        f"mode={result.get('investigation_mode')} error={record.error}"
    )

    grounding_result = result.get('grounding_result') or {}
    if is_storage_worthy(
        confidence=record.confidence,
        recommended_priority=record.recommended_priority,
        error=record.error,
        # `valid` (claims and case membership checked) where available,
        # so an answer that failed validation is never written to the
        # cross-case knowledge base as a learned finding.
        grounded=grounding_result.get('valid', grounding_result.get('grounded')),
    ):
        case = _case_by_id.get(case_id)
        if case is not None:
            await asyncio.to_thread(
                store_finding,
                case=case,
                case_id=case_id,
                turn_index=record.turn_index,
                answer=record.answer or "",
                critical_analysis=record.critical_analysis,
                mitigation_suggestions=record.mitigation_suggestions,
                mitre_techniques=record.mitre_techniques,
                confidence=record.confidence,
                recommended_priority=record.recommended_priority,
                timestamp=record.timestamp,
            )
            logger.info(f"[investigation] case={case_id} turn={turn_index} -- stored as LearnedFinding")

    _transcripts.setdefault(case_id, []).append(record)
    _append_log(record)
    bus.publish(case_id, {
        "type": "turn_failed" if record.error else "turn_completed",
        "turn_index": turn_index, "error": record.error,
        "latency_seconds": record.latency_seconds,
    })
    return record


async def start_investigation(case: Case, alerts: List[Alert]) -> TurnRecord:
    """Idempotent: a case that's already been opened returns its existing
    successful initial turn instead of re-running the pipeline (and spending
    another round of LLM calls). Failed initial attempts can be retried and
    remain in the transcript/audit log. Use ask_followup for continued Q&A
    on an already-started case."""
    if case.case_id in _transcripts:
        # Re-opening a case after a restart hands us its Case again; keep it
        # so follow-ups anchor to the case's own time and can store findings.
        if case.case_id not in _case_by_id:
            _case_by_id[case.case_id] = case
            _save_case(case)
        for record in _transcripts[case.case_id]:
            if record.question == INITIAL_DIRECTIVE and record.error is None:
                return record
    _case_by_id[case.case_id] = case
    _save_case(case)
    case_context = build_case_context(case, alerts)
    return await _run_turn(case.case_id, INITIAL_DIRECTIVE, {
        "case_context": case_context,
        # Seeds question_generation_node's guaranteed mitigation-lookup
        # question (src/graph/state.py) with the case's own native+sigma
        # MITRE tags -- synthesize_node grows this set turn over turn with
        # anything newly identified.
        "known_mitre_techniques": case.mitre_techniques,
        # Restricts retrieval to this case's member alerts before any row
        # limit, and labels everything else as historical evidence (see
        # src/retrieval/case_scope.py). The reference time is the case's
        # own last_seen: nothing later than the case is "history" for it.
        "case_scope": make_case_scope(
            case.case_id, case.alert_ids, first_seen=case.first_seen, last_seen=case.last_seen,
            hosts=case.hosts, reference_time=case.last_seen),
        # Anchors temporal retrieval weighting to when the case's activity
        # actually happened, not to wall-clock "now" -- same convention
        # src/ingestion/trigger.py used (alert.timestamp) for auto-triggered
        # investigations.
        "query_timestamp": case.last_seen,
        # Turn 1's input is a fixed directive over an already-human-selected
        # case, not a question needing triage -- guardrails_node skips its
        # LLM call entirely (see src/graph/workflow.py) rather than
        # spending a call to answer something already settled by
        # construction.
        "skip_guardrails": True,
    })


async def ask_followup(case_id: str, message: str) -> TurnRecord:
    if case_id not in _transcripts:
        raise ValueError(f"No investigation started for case {case_id} yet -- call start_investigation first.")
    _ensure_resumable(case_id)
    case = _case_by_id.get(case_id)
    # case_context is deliberately NOT resent: it's a non-reducer state
    # field, so LangGraph's checkpointer keeps turn 1's value automatically
    # when a later turn's partial state update omits it. skip_guardrails,
    # by contrast, MUST be explicitly reset to False here for the same
    # reason `_run_turn` always resets grounding_retry_count -- turn 1 set
    # it True, and being a non-reducer field it would otherwise stay True
    # on every later turn too, silently skipping guardrails' investigation_
    # mode routing (the whole point of this method) forever after turn 1.
    extra = {"skip_guardrails": False}
    if case is not None:
        extra["query_timestamp"] = case.last_seen
    elif not checkpointer.has_checkpoint(case_id):
        extra["query_timestamp"] = now_iso()
    # (otherwise the saved state already holds the case's query_timestamp)
    return await _run_turn(case_id, message, extra)


def get_transcript(case_id: str) -> List[TurnRecord]:
    return _transcripts.get(case_id, [])


def summarize(case_id: str) -> Optional[InvestigationSummary]:
    turns = _transcripts.get(case_id)
    if not turns:
        return None
    first, last = turns[0], turns[-1]
    case = _case_by_id.get(case_id) or _load_case(case_id)
    preview = (last.answer or "")[:280] or None
    return InvestigationSummary(
        case_id=case_id,
        turn_count=len(turns),
        first_question=first.question,
        last_question=last.question,
        last_answer_preview=preview,
        last_timestamp=last.timestamp,
        recommended_priority=next((t.recommended_priority for t in reversed(turns) if t.recommended_priority), None),
        hosts=case.hosts if case else [],
        alert_count=case.alert_count if case else None,
        resumable=is_resumable(case_id),
        running=bus.is_running(case_id),
    )


def list_investigations() -> List[InvestigationSummary]:
    """Every conversation known to this process (including ones reloaded
    from the audit log), most recently active first."""
    summaries = [s for s in (summarize(cid) for cid in list(_transcripts)) if s is not None]
    return sorted(summaries, key=lambda s: s.last_timestamp, reverse=True)
