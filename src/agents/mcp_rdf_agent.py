# src/agents/mcp_rdf_agent.py
"""
`import mcp_use` is deliberately NOT at module level (see git history/
PROTOTYPE.md for the incident this fixes): mcp_use/__init__.py eagerly
imports mcp_use.observability, which initializes Laminar/Langfuse tracing
integrations at import time, and that import has been observed to hang
indefinitely (blocked in a worker-thread `read()`, confirmed with `sample`
on the stuck process) even with no Laminar/Langfuse API keys configured --
i.e. even the branch that's supposed to no-op can stall. Since
src/graph/workflow.py imports this module eagerly (`from
src.agents.mcp_rdf_agent import run_mcp_agent`), an eager `import mcp_use`
here would take down the entire investigation service's startup (and
src/run.py's / eval's imports) over a CSKG-lookup dependency that most
questions never even touch. Deferred to inside get_mcp_client()/
run_mcp_agent() instead -- a hang there now only affects the one CSKG
question that triggers it (already wrapped in NODE_CALL_TIMEOUT_SECONDS by
src/graph/workflow.py's dispatch_retrieval_node), not process startup.
"""
import asyncio
import contextvars
import functools
import json
import os
import logging
import threading
import tempfile
import time
from src.agents.cskg_health import (
    CskgDependencyError,
    load_server_config,
    run_checks_async,
    server_identity,
)
from src.config.settings import llm

logger = logging.getLogger(__name__)

# --- Konfigurasi dan Inisialisasi Agen MCP ---

_mcp_client = None
MCP_MAX_STEPS = max(1, int(os.environ.get("CSKG_MCP_MAX_STEPS", "5")))
MCP_MAX_RESULT_ROWS = max(1, int(os.environ.get("CSKG_MAX_RESULT_ROWS", "10")))
CSKG_TRACE_VALUE_CHARS = 12000
CSKG_TRACE_EVENT_LIMIT = 300

# The MCP server is a child process. Its stderr is therefore not part of the
# application's Python logging tree. Keep a bounded process-local relay so a
# completed retrieval can include the server's own startup and SPARQL lines in
# the investigation trace.
_server_log_lock = threading.Lock()
_server_log_buffer: list[dict] = []
_active_cskg_trace: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "active_cskg_trace", default=None
)
_mcp_trace_handler_installed = False
_session_locks: dict[int, asyncio.Lock] = {}


def _clip(value: object, limit: int = CSKG_TRACE_VALUE_CHARS) -> str:
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False, default=str)
        except Exception:
            text = repr(value)
    return text if len(text) <= limit else text[:limit - 3] + "..."


def _record_trace_event(source: str, message: str, *, level: str = "INFO", **fields: object) -> None:
    trace = _active_cskg_trace.get()
    if trace is None:
        return
    event = {
        "ts": time.time(),
        "source": source,
        "level": level,
        "message": _clip(message),
    }
    event.update(fields)
    events = trace.setdefault("events", [])
    if len(events) < CSKG_TRACE_EVENT_LIMIT:
        events.append(event)
    # Keep the live UI informed without sending raw arguments/results over SSE.
    try:
        from src.investigation.events import bus, current_case

        case_id = current_case.get()
        if case_id:
            live_event = {
                "type": "cskg",
                "phase": source,
                "message": _clip(message, 240),
                "level": level,
            }
            for field in ("tool", "status"):
                if field in fields:
                    live_event[field] = fields[field]
            bus.publish(case_id, live_event)
    except Exception:
        # Live observability must never break a retrieval.
        pass


class _CskgServerLogFile:
    """File-like stderr sink accepted by asyncio subprocess transports."""

    def __init__(self) -> None:
        self._file = tempfile.TemporaryFile(mode="w+b")
        self._read_chars = 0
        self._lock = threading.Lock()

    def fileno(self) -> int:
        return self._file.fileno()

    def flush(self) -> None:
        self._file.flush()

    def capture(self) -> list[dict]:
        with self._lock:
            self._file.flush()
            self._file.seek(0)
            text = self._file.read().decode("utf-8", errors="replace")
            new_text = text[self._read_chars:]
            self._read_chars = len(text)
        return [{"ts": time.time(), "message": _clip(line.strip())}
                for line in new_text.splitlines() if line.strip()]


_server_log_sinks: list[_CskgServerLogFile] = []


def _capture_server_logs() -> None:
    records = []
    for sink in list(_server_log_sinks):
        try:
            records.extend(sink.capture())
        except Exception:
            continue
    if not records:
        return
    with _server_log_lock:
        _server_log_buffer.extend(records)
        if len(_server_log_buffer) > CSKG_TRACE_EVENT_LIMIT * 4:
            del _server_log_buffer[:-CSKG_TRACE_EVENT_LIMIT * 4]


class _McpTraceLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            _record_trace_event("mcp_use", record.getMessage(), level=record.levelname, logger=record.name)
        except Exception:
            # Observability must never break a retrieval.
            return


def _install_mcp_trace_handler() -> None:
    global _mcp_trace_handler_installed
    if _mcp_trace_handler_installed:
        return
    mcp_logger = logging.getLogger("mcp_use")
    mcp_logger.addHandler(_McpTraceLogHandler(level=logging.INFO))
    if mcp_logger.level == logging.NOTSET or mcp_logger.level > logging.INFO:
        mcp_logger.setLevel(logging.INFO)
    _mcp_trace_handler_installed = True


def _tool_result_text(result: object) -> str:
    content = getattr(result, "content", None) or []
    parts = []
    for item in content:
        text = getattr(item, "text", None)
        parts.append(text if text is not None else str(item))
    return "\n".join(parts) if parts else str(result)


def _instrument_connector(connector: object) -> None:
    if getattr(connector, "_cskg_trace_wrapped", False) or not hasattr(connector, "call_tool"):
        return
    original = connector.call_tool

    @functools.wraps(original)
    async def traced_call(tool_name: str, arguments: dict) -> object:
        trace = _active_cskg_trace.get()
        call = {
            "name": tool_name,
            "arguments": _clip(arguments),
            "started_at": time.time(),
        }
        if trace is not None:
            trace.setdefault("tool_calls", []).append(call)
        try:
            result = await original(tool_name, arguments)
        except Exception as exc:
            call.update({
                "error": f"{type(exc).__name__}: {exc}",
                "seconds": round(time.time() - call["started_at"], 3),
            })
            _record_trace_event("mcp_tool", f"{tool_name} failed: {type(exc).__name__}: {exc}", level="ERROR")
            raise
        call.update({
            "result": _clip(_tool_result_text(result)),
            "is_error": bool(getattr(result, "isError", False)),
            "seconds": round(time.time() - call["started_at"], 3),
        })
        _record_trace_event("mcp_tool", f"{tool_name} returned", tool=tool_name)
        return result

    connector.call_tool = traced_call
    connector._cskg_trace_wrapped = True


async def _ensure_mcp_sessions(client: object) -> list[str]:
    """Create the shared MCP sessions with a stderr relay before connecting."""
    loop = asyncio.get_running_loop()
    lock = _session_locks.setdefault(id(loop), asyncio.Lock())
    async with lock:
        sessions = client.get_all_active_sessions()
        if not sessions:
            sessions = await client.create_all_sessions(auto_initialize=False)
            for session in sessions.values():
                connector = session.connector
                if hasattr(connector, "errlog"):
                    sink = _CskgServerLogFile()
                    connector.errlog = sink
                    _server_log_sinks.append(sink)
                await session.initialize()
            _record_trace_event("mcp", "MCP handshake completed")
        else:
            _record_trace_event("mcp", "Reusing existing MCP session")
        tool_names = []
        for session in sessions.values():
            _instrument_connector(session.connector)
            tool_names.extend(tool.name for tool in await session.connector.list_tools())
        _record_trace_event("mcp", f"MCP tools discovered: {len(tool_names)}", tools=sorted(tool_names))
        return tool_names


def get_last_cskg_trace() -> dict | None:
    """Return the trace for the most recent CSKG call in this task."""
    return _active_cskg_trace.get()


def get_mcp_client():
    """Inisialisasi dan mengembalikan MCPClient (hanya sekali).

    The server definition comes from cskg_health.load_server_config(), not
    straight from the file: that resolves ${CURRENT_PYTHON}/${PROJECT_ROOT}
    (and a CSKG_PYTHON override) so browser_mcp.json no longer hard-codes
    one machine's virtualenv -- the pilot's CSKG failure was exactly a
    hard-coded interpreter whose environment had been offloaded. It is the
    same definition the independent health check launches."""
    global _mcp_client
    if _mcp_client is None:
        config = load_server_config()
        # Must be set before `import mcp_use` -- its observability
        # submodules read these via os.getenv at their own import time
        # (see module docstring above), not lazily.
        os.environ["MCP_USE_ANONYMIZED_TELEMETRY"] = "false"
        os.environ.setdefault("MCP_USE_LAMINAR", "false")
        os.environ.setdefault("MCP_USE_LANGFUSE", "false")
        from mcp_use import MCPClient
        _mcp_client = MCPClient.from_dict(config)
    return _mcp_client


# --- Readiness: fail fast, and say why ---
# Before the first CSKG question in a process (and again after a failure,
# once the cool-down passes) the server is probed with the independent
# check in cskg_health.py. A broken dependency then surfaces within one
# retrieval deadline as a CskgDependencyError naming the failing stage,
# instead of each question waiting out a 60 s timeout and reporting ''.
READINESS_FAILURE_TTL_SECONDS = float(os.environ.get("CSKG_READINESS_RETRY_SECONDS", "120"))
_readiness = {"report": None, "at": 0.0}
_readiness_locks: dict = {}


async def ensure_cskg_ready() -> dict:
    loop = asyncio.get_running_loop()
    lock = _readiness_locks.setdefault(id(loop), asyncio.Lock())
    async with lock:
        report = _readiness["report"]
        fresh = report is not None and (
            report["status"] == "ok" or time.monotonic() - _readiness["at"] < READINESS_FAILURE_TTL_SECONDS)
        if not fresh:
            report = await run_checks_async(deep=False)
            _readiness.update(report=report, at=time.monotonic())
            log = logger.info if report["status"] == "ok" else logger.error
            log(f"[cskg readiness] {report['summary']}")
    if report["status"] != "ok":
        raise CskgDependencyError(report["summary"], stage=report.get("failed_stage"), report=report)
    return report


def last_readiness_report():
    """Most recent readiness probe result for this process, or None."""
    return _readiness["report"]


def _ensure_step_budget_not_exhausted(steps_taken: int, max_steps: int) -> None:
    """Reject a returned-but-truncated answer when the tool loop hit its cap."""
    if steps_taken >= max_steps:
        raise CskgDependencyError(
            f"CSKG agent exhausted its {max_steps}-step tool budget before confirming a complete answer",
            stage="agent_step_limit",
        )


def _is_technique_mitigation_question(question: str) -> bool:
    text = question.lower()
    return 'mitigation' in text or ('att&ck' in text and 'technique' in text)


def _disallow_tools_except(tool_names, allowed_name: str) -> list[str]:
    return [name for name in tool_names if name != allowed_name]

# Exact marker MAX_STEPS-exhausted/nothing-found responses must start
# with -- src/graph/workflow.py::_context_richness matches on this (plus a
# phrase-based heuristic fallback for whenever the model doesn't follow
# this instruction exactly) to tell "found nothing" apart from "found
# something," instead of the two being indistinguishable natural-language
# prose. Without this, a CSKG "I couldn't find anything" answer was being
# counted as substantive evidence, inflating the confidence cap
# _context_richness/_cap_confidence exist to enforce.
NO_DATA_MARKER = "NO_RELEVANT_DATA_FOUND"

strict_system_prompt = f"""
You are a specialized cybersecurity assistant. You MUST answer questions ONLY by using the provided tools. Your only source of information is the knowledge graph accessed via tools.

Keep retrieval bounded: use the fewest tool calls that can answer the question, prefer one precise lookup, and do not request exhaustive lists. If a call times out, do not repeat the same query; make at most one narrower fallback. The tool loop is limited to {MCP_MAX_STEPS} steps, and each result is capped at {MCP_MAX_RESULT_ROWS} rows.

When asked to map observed behavior to ATT&CK techniques and/or recommend mitigations, use get_technique_mitigations_by_keyword with a list of up to three concise phrases drawn from the observed signals (for example, the relevant service behavior, a scan/banner phrase, and a DNS query type). Make one call; only if it returns no results, make one fallback call with alternate short phrases. It returns bounded technique IDs/titles and linked mitigation titles. Never use text_to_sparql for these tasks: it makes a separate hard-coded OpenAI GPT-4o API call, bypassing the configured OpenRouter model/provider. Do not replace graph evidence with memory, or search technique and mitigation tools separately.

This knowledge base ONLY contains public reference data: MITRE ATT&CK techniques/tactics/groups/software/mitigations,
and CVE/CVSS records. It has NO IP addresses, hostnames, domains, live threat-intelligence feeds, IOC reputation data,
or any organization-specific data whatsoever. A question that asks you to correlate, attribute, or look up a
*specific* IP address, hostname, or piece of an organization's own environment against threat intelligence cannot be
answered here at all, no matter how the tools are used -- recognize this immediately from the question itself,
without attempting tool calls first, and respond per rule 6 below.

Most tools that take a technique/group/mitigation/software name (get_mitigations_for_technique,
get_techniques_by_tactic, get_techniques_used_by_group, etc.) match against that entity's TITLE TEXT
(e.g. "Network Service Discovery"), NOT its MITRE ID (e.g. "T1046") -- passing a bare ID to one of those
tools will silently return nothing, every time, no matter how many times you retry it, because the ID
never appears as a substring of the title. If a question names a technique only by ID: first call
get_technique_by_id to resolve it to its real name, THEN use that name with a name-matching tool -- OR use
text_to_sparql to write a single query that filters on the ID directly (FILTER(STRENDS(STR(?technique),
"/T1046"))), which sidesteps the name-matching requirement entirely.

Your thought process MUST be:
    1.  **Analyze the user's question** to understand the core intent.
    2.  **Select the best tool.**.
    3.  **Execute the tool.** Prefer one precise lookup. If it fails, do not repeat the same query; use at most one narrower `text_to_sparql` fallback.
    4.  **Analyze the result.**
        - If the result is a **validation error** (like a Pydantic error), it means you provided the wrong arguments to the tool. Read the error message carefully. DO NOT use the same tool with the exact same arguments again. Correct the arguments and retry. For tools requiring `ctx`, DO NOT provide a value for it; the system handles it.
        - If the result is **empty or "not found"**, the information may not exist, or your query was too narrow. Try rephrasing your input for the tool, perhaps using a broader term.
        - If you are stuck in a loop of failures, only then you must state that you could not find the information.
    5.  **NEVER provide an answer from memory.** All answers must be based on tool results.
    6.  **If the question needs data this knowledge base doesn't have at all** (per the scope note above), OR **if,
        after reasonable attempts, no relevant information was found**, your final answer MUST begin with the exact
        marker "{NO_DATA_MARKER}" (nothing before it), followed by one short sentence saying why (out of scope, or
        what you tried). This applies even when you go on to offer a related but different reformulation of the
        question -- the marker reflects that the ORIGINAL question wasn't answered, regardless of what else you add
        after it. A downstream check relies on this exact marker to tell "found nothing" apart from "found
        something" -- do not paraphrase it, and do not include it if you DID find relevant information answering the
        question as actually asked.
"""

async def run_mcp_agent(question: str) -> str:
    """
    Runs the MCPAgent with the given question and returns the result.

    Uses agent.stream()/_consume_and_return() instead of the simpler
    agent.run() specifically to recover `tools_used_names` -- run() calls
    the exact same internal machinery but discards that information,
    returning only the final text. Without it there was no way to tell
    "the agent actually queried the knowledge graph and found nothing" apart
    from "the agent never called a single tool and just answered from its
    own reasoning" -- both can produce fluent, plausible-sounding prose (see
    NO_DATA_MARKER's own docstring for a real example of the latter slipping
    through undetected). This is a structural ground-truth signal instead of
    inferring intent from natural language.
    """
    with _server_log_lock:
        server_log_start = len(_server_log_buffer)
    trace = {
        "question": question,
        "server": server_identity(),
        "readiness": None,
        "events": [],
        "tool_calls": [],
        "server_logs": [],
    }
    _active_cskg_trace.set(trace)
    try:
        readiness = await ensure_cskg_ready()  # raises CskgDependencyError with the failing stage
        trace["readiness"] = readiness
        _record_trace_event(
            "readiness",
            readiness.get("summary", "CSKG readiness completed"),
            status=readiness.get("status"),
        )
        client = get_mcp_client()  # imports mcp_use as a side effect -- see module docstring
        from mcp_use import MCPAgent
        _install_mcp_trace_handler()
        tool_names = await _ensure_mcp_sessions(client)
        tool_limited = _is_technique_mitigation_question(question)
        disallowed_tools = []
        agent_steps = MCP_MAX_STEPS
        if tool_limited:
            # A focused ATT&CK mapping query has a single purpose-built tool.
            # Discover its registered name first, then hide the other 42
            # options from the agent so it cannot spend its budget on broad
            # searches or text_to_sparql's separate OpenAI API call.
            allowed = "get_technique_mitigations_by_keyword"
            if allowed not in tool_names:
                raise CskgDependencyError(
                    f"Required MCP tool is unavailable: {allowed}", stage="agent_tool_missing")
            disallowed_tools = _disallow_tools_except(tool_names, allowed)
            agent_steps = min(MCP_MAX_STEPS, 3)  # one lookup, one fallback, one final response
        agent = MCPAgent(
            llm=llm,
            client=client,
            max_steps=agent_steps,
            verbose=True,
            system_prompt=strict_system_prompt,
            disallowed_tools=disallowed_tools,
        )
        generator = agent.stream(question, track_execution=False)
        result, steps_taken, tools_used_names = await agent._consume_and_return(generator)
        trace["tools_used"] = tools_used_names
        trace["steps"] = steps_taken
        _record_trace_event("agent", f"MCP agent completed in {steps_taken} step(s)", tools_used=tools_used_names)
        # mcp_use returns its current text when max_steps is reached. That
        # text can omit required parts of the answer (for example,
        # mitigations after several broad searches), so it must not be
        # accepted as a successful graph lookup.
        _ensure_step_budget_not_exhausted(steps_taken, agent_steps)
        if tools_used_names:
            logger.info(f"[mcp_rdf_agent] question={question!r} steps={steps_taken} tools_used={tools_used_names}")
        else:
            logger.warning(
                f"[mcp_rdf_agent] question={question!r} answered WITHOUT calling any tool "
                f"(steps={steps_taken}) -- this is not a real knowledge-graph lookup, whatever the "
                f"response text claims"
            )
            if not str(result).startswith(NO_DATA_MARKER):
                # Fluent prose with zero tool calls came from the model's
                # own memory, not from the knowledge graph. It must not
                # reach the synthesizer as if it were CSKG evidence.
                return (f"{NO_DATA_MARKER}: the knowledge-base agent produced an answer without calling "
                        f"any knowledge-graph tool, so that answer was discarded as ungrounded.")
        return result
    except CskgDependencyError as exc:
        trace["error"] = f"{type(exc).__name__}: {exc}"
        if exc.report is not None:
            trace["readiness"] = exc.report
        raise
    except Exception as e:
        # Previously returned as an ordinary answer string ("Error during
        # MCP agent execution: ..."), which made a broken dependency look
        # like a retrieved result. Raised instead, so the dispatcher
        # records it as a dependency failure with its type and message.
        logger.error(f"An error occurred while running the MCP Agent: {type(e).__name__}: {e}")
        raise CskgDependencyError(
            f"CSKG agent run failed: {type(e).__name__}: {e or 'no message'}", stage="agent_run") from e
    finally:
        trace["server_logs"] = _server_logs_since(server_log_start)


def _server_logs_since(start: int) -> list[dict]:
    _capture_server_logs()
    with _server_log_lock:
        return list(_server_log_buffer[start:])
