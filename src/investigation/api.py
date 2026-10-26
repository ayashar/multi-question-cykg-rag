# src/investigation/api.py
"""
The human-invoked investigation process (see PROTOTYPE.md's architecture
section). A separate process from ingestion (src/ingestion/run_live.py) --
this only reads from Neo4j (src/investigation/clustering.py) and invokes
the pipeline (src/investigation/session.py); it never ingests anything
itself. Run with `uv run -m src.investigation.run_api`.

Routes:
  GET  /cases                          ranked list of recent activity cases
  POST /cases/{case_id}/investigate    launch/resume a case's investigation
  GET  /cases/{case_id}/attack-graph   reconstructed attack graph for a case
  POST /investigations/time-range      launch/resume an ad-hoc time-range investigation
  GET  /investigations                 past conversations, most recent first (to resume one)
  GET  /investigations/{case_id}       one conversation's summary (incl. whether it can be resumed)
  POST /investigations/{case_id}/chat  ask a follow-up in an open investigation
  GET  /investigations/{case_id}/chat  read an investigation's transcript (add ?include_trace=true for the full trace)
  GET  /investigations/{case_id}/turns/{turn_index}/trace  how one turn reached its answer
  GET  /investigations/{case_id}/events  live progress of the running turn (server-sent events)
  GET  /ingestion/config                read the configured ingestion source
  PUT  /ingestion/config                configure what run_live.py replays next time it's started
  GET  /ingestion/status                counts of what's already in the graph

The /ingestion/* routes are config/monitoring only -- they let an operator
(e.g. via a UI) set up what src/ingestion/run_live.py will replay, and see
what it's ingested so far. They never start, stop, or otherwise control
that process: it stays a separate, operator-started background process
(see PROTOTYPE.md), and a config change here only takes effect the next
time it's (re)started.

Frontend access: browsers can't set headers on an EventSource, so the events
route also accepts the key as `?api_key=` (that route only). Cross-origin
browser calls are allowed from INVESTIGATION_CORS_ORIGINS (comma-separated;
default: the usual local dev servers on ports 3000 and 5173).

Resuming a conversation: past turns are reloaded from data/investigations.jsonl
at startup, and each case's pipeline state is saved under data/checkpoints/
after every turn (see session.py), so a follow-up on a reloaded case simply
continues it. List conversations with GET /investigations, check
`resumable`, read the transcript with GET .../chat, then POST .../chat as
usual. Only cases investigated before state was saved return 409.

Access control: see SECURITY_ASSESSMENT.md. Set INVESTIGATION_API_KEY to
require a matching `X-API-Key` header on every request -- unset (the local-
dev default) leaves the service open, matching this repo's existing
convention for optional/only-enforced-when-configured env vars.
"""
from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from src.config.settings import graph
from src.ingestion.config import IngestionConfig, load_config, save_config
from src.investigation import attack_graph, clustering, session
from src.investigation.events import bus

INVESTIGATION_API_KEY = os.environ.get("INVESTIGATION_API_KEY")


async def require_api_key(request: Request, x_api_key: str = Header(default="")) -> None:
    if not INVESTIGATION_API_KEY:
        return
    # EventSource can't send headers, so the events route alone takes the key as a query parameter.
    if not x_api_key and request.url.path.endswith("/events"):
        x_api_key = request.query_params.get("api_key", "")
    if x_api_key != INVESTIGATION_API_KEY:
        raise HTTPException(status_code=401, detail="Missing or invalid X-API-Key.")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    session.load_transcripts()
    yield


app = FastAPI(title="AgCyRAG Investigation API", dependencies=[Depends(require_api_key)], lifespan=lifespan)

_DEFAULT_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.environ.get("INVESTIGATION_CORS_ORIGINS", _DEFAULT_ORIGINS).split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TimeRangeRequest(BaseModel):
    start: str  # ISO-8601, e.g. "2022-01-21T00:00:00Z"
    end: str


class ChatRequest(BaseModel):
    message: str


@app.get("/cases")
async def get_cases(lookback_hours: float = 24.0) -> list[clustering.Case]:
    return clustering.list_cases(lookback_hours=lookback_hours)


@app.post("/cases/{case_id}/investigate")
async def investigate_case(case_id: str, lookback_hours: float = clustering.DEFAULT_FIND_LOOKBACK_HOURS) -> session.TurnRecord:
    """`lookback_hours` must cover whatever window you used to list this
    case via GET /cases -- case_id is a hash of an alert set (see
    clustering.py), and re-clustering over a window that doesn't reach the
    case's alerts won't find it. Pass the same (or a wider) lookback_hours
    you used there, e.g. if you listed cases with a replayed historical
    dataset far from wall-clock "now"."""
    case = clustering.find_case(case_id, lookback_hours=lookback_hours)
    if case is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"Case {case_id} not found within lookback_hours={lookback_hours}. "
                f"If you listed it via GET /cases?lookback_hours=<bigger value>, pass the same "
                f"lookback_hours here, e.g. POST /cases/{case_id}/investigate?lookback_hours=<bigger value>."
            ),
        )
    alerts = clustering.fetch_alerts_by_ids(case.alert_ids)
    return await session.start_investigation(case, alerts)


@app.get("/cases/{case_id}/attack-graph")
async def get_attack_graph(
    case_id: str, lookback_hours: float = clustering.DEFAULT_FIND_LOOKBACK_HOURS
) -> attack_graph.CaseAttackGraph:
    """Nodes/edges for the reconstructed attack graph (src/investigation/
    attack_graph.py) -- same lookback_hours caveat as .../investigate."""
    case = clustering.find_case(case_id, lookback_hours=lookback_hours)
    if case is None:
        raise HTTPException(
            status_code=404,
            detail=f"Case {case_id} not found within lookback_hours={lookback_hours}.",
        )
    alerts = clustering.fetch_alerts_by_ids(case.alert_ids)
    return attack_graph.build_attack_graph(case, alerts)


@app.post("/investigations/time-range")
async def investigate_time_range(body: TimeRangeRequest) -> session.TurnRecord:
    case = clustering.case_from_range(body.start, body.end)
    if case is None:
        raise HTTPException(status_code=404, detail=f"No alerts found between {body.start} and {body.end}.")
    alerts = clustering.fetch_alerts_by_ids(case.alert_ids)
    return await session.start_investigation(case, alerts)


@app.get("/investigations")
async def list_investigations() -> list[session.InvestigationSummary]:
    return session.list_investigations()


@app.get("/investigations/{case_id}")
async def get_investigation(case_id: str) -> session.InvestigationSummary:
    summary = session.summarize(case_id)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"No investigation started for case {case_id} yet.")
    return summary


@app.post("/investigations/{case_id}/chat")
async def chat(case_id: str, body: ChatRequest) -> session.TurnRecord:
    try:
        return await session.ask_followup(case_id, body.message)
    except session.CaseNotResumable as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@app.get("/investigations/{case_id}/chat")
async def get_chat(case_id: str, include_trace: bool = False) -> list[session.TurnRecord]:
    """The transcript. Traces are large, so they are left out unless asked
    for -- fetch one turn's via .../turns/{turn_index}/trace instead."""
    turns = session.get_transcript(case_id)
    if include_trace:
        return turns
    return [t.model_copy(update={"trace": None}) for t in turns]


@app.get("/investigations/{case_id}/turns/{turn_index}/trace")
async def get_turn_trace(case_id: str, turn_index: int) -> dict:
    for turn in session.get_transcript(case_id):
        if turn.turn_index == turn_index:
            if turn.trace is None:
                raise HTTPException(status_code=404, detail="This turn has no recorded trace.")
            return turn.trace
    raise HTTPException(status_code=404, detail=f"No turn {turn_index} for case {case_id}.")


def _sse(event: dict) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, default=str)}\n\n"


@app.get("/investigations/{case_id}/events")
async def investigation_events(case_id: str, wait: bool = False, heartbeat: float = 15.0) -> StreamingResponse:
    """Server-sent events for the case's current turn: turn_started,
    step_completed, log, then turn_completed or turn_failed (the stream ends
    there). Connecting late replays the turn so far. With nothing running it
    replays the last turn and ends; pass ?wait=true to open the stream
    before POSTing the question and wait for the next turn instead."""
    async def stream():
        async for event in bus.subscribe(case_id, wait=wait, heartbeat=heartbeat):
            yield ": keep-alive\n\n" if event is None else _sse(event)
    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class IngestionStatus(BaseModel):
    alert_count: int
    earliest_alert_timestamp: Optional[str] = None
    latest_alert_timestamp: Optional[str] = None
    configured_alerts_path: Optional[str] = None


_INGESTION_STATUS_CYPHER = """
MATCH (a:Alert)
RETURN count(a) AS alert_count, min(a.timestamp) AS earliest_timestamp, max(a.timestamp) AS latest_timestamp
"""


@app.get("/ingestion/config")
async def get_ingestion_config() -> IngestionConfig:
    return load_config()


@app.put("/ingestion/config")
async def update_ingestion_config(body: IngestionConfig) -> IngestionConfig:
    """Takes effect the next time run_live.py is (re)started -- this process
    never runs ingestion itself and cannot make a currently-running instance
    pick up the change."""
    if body.alerts_path is not None and not Path(body.alerts_path).exists():
        raise HTTPException(status_code=400, detail=f"alerts_path {body.alerts_path!r} does not exist on this machine.")
    return save_config(body)


@app.get("/ingestion/status")
async def get_ingestion_status() -> IngestionStatus:
    """Read-only counts of what's already in the graph -- this process has
    no visibility into whether run_live.py is currently running.
    latest_alert_timestamp is the closest available proxy: recent suggests
    ingestion is active or just finished, stale suggests it's idle or
    stopped."""
    rows = graph.query(_INGESTION_STATUS_CYPHER)
    row = rows[0] if rows else {}
    return IngestionStatus(
        alert_count=row.get("alert_count") or 0,
        earliest_alert_timestamp=row.get("earliest_timestamp"),
        latest_alert_timestamp=row.get("latest_timestamp"),
        configured_alerts_path=load_config().alerts_path,
    )
