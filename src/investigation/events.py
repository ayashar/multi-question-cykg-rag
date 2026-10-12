# src/investigation/events.py
"""
Live progress for an investigation turn, for a frontend to subscribe to
(GET /investigations/{case_id}/events in api.py, as server-sent events).

One bucket of events per case holds the CURRENT turn: it is cleared when a
new turn starts and keeps its history after the turn ends, so a client that
connects late (or reconnects) can replay what it missed. Publishing is
thread-safe: the retrieval agents log from worker threads, and their
`agent.*` log lines are forwarded here as `log` events by CaseLogHandler.

Process-local and in-memory, like the rest of session.py's state.
"""
from __future__ import annotations

import asyncio
import contextvars
import logging
import threading
import time
from typing import Any, AsyncIterator, Dict, List, Optional

from src.investigation.trace import LOG_LINE_CHARS, MAX_LOG_LINES

# Which case the current task is working on. Set by session._run_turn, and
# copied into asyncio.to_thread workers, so the log handler can attribute a
# line to its case without the agents knowing about any of this.
current_case: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar("current_case", default=None)

END_EVENTS = ("turn_completed", "turn_failed")


class EventBus:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._history: Dict[str, List[dict]] = {}
        self._subs: Dict[str, List[tuple]] = {}   # case_id -> [(loop, queue)]
        self._running: set = set()

    def start_turn(self, case_id: str, turn_index: int, question: str) -> None:
        with self._lock:
            self._history[case_id] = []
            self._running.add(case_id)
        self.publish(case_id, {"type": "turn_started", "turn_index": turn_index, "question": question})

    def publish(self, case_id: str, event: Dict[str, Any]) -> None:
        event = {"ts": time.time(), **event}
        with self._lock:
            history = self._history.setdefault(case_id, [])
            if event["type"] == "log" and sum(1 for e in history if e["type"] == "log") >= MAX_LOG_LINES:
                subs = list(self._subs.get(case_id, []))   # still live-streamed, just not kept for replay
            else:
                history.append(event)
                subs = list(self._subs.get(case_id, []))
            if event["type"] in END_EVENTS:
                self._running.discard(case_id)
        for loop, queue in subs:
            try:
                loop.call_soon_threadsafe(queue.put_nowait, event)
            except RuntimeError:   # subscriber's loop already closed
                pass

    def is_running(self, case_id: str) -> bool:
        with self._lock:
            return case_id in self._running

    def logs(self, case_id: str) -> List[dict]:
        with self._lock:
            return [e for e in self._history.get(case_id, []) if e["type"] == "log"]

    async def subscribe(self, case_id: str, *, wait: bool = False, timeout: float = 600.0,
                        heartbeat: float = 15.0) -> AsyncIterator[Optional[dict]]:
        """Yields events of the current turn, then live ones, ending after
        the turn's end event. Yields None every `heartbeat` seconds of
        silence so the HTTP layer can send a keep-alive.

        Connecting while idle: replays the last turn and ends -- unless
        `wait`, which skips that replay and waits for the next turn (for a
        client that opens the stream before POSTing the question)."""
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        with self._lock:
            history = list(self._history.get(case_id, []))
            running = case_id in self._running
            if not (wait and not running):
                self._subs.setdefault(case_id, []).append((loop, queue))
            else:
                history = []
                self._subs.setdefault(case_id, []).append((loop, queue))
        try:
            for event in history:
                yield event
            if history and history[-1]["type"] in END_EVENTS:
                return
            if not running and not wait and not history:
                return   # nothing has ever run for this case
            deadline = loop.time() + timeout
            while loop.time() < deadline:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=heartbeat)
                except asyncio.TimeoutError:
                    yield None
                    continue
                yield event
                if event["type"] in END_EVENTS:
                    return
        finally:
            with self._lock:
                subs = self._subs.get(case_id, [])
                self._subs[case_id] = [s for s in subs if s[1] is not queue]


bus = EventBus()


class CaseLogHandler(logging.Handler):
    """Forwards the pipeline's `agent.*` log lines to the running case's
    event stream. Attached once, to the parent "agent" logger."""

    def emit(self, record: logging.LogRecord) -> None:
        case_id = current_case.get()
        if not case_id:
            return
        try:
            message = record.getMessage()
        except Exception:
            return
        bus.publish(case_id, {"type": "log", "agent": record.name.split(".", 1)[-1],
                              "level": record.levelname, "message": message[:LOG_LINE_CHARS]})


_installed = False


def install_log_handler() -> None:
    global _installed
    if _installed:
        return
    logger = logging.getLogger("agent")
    logger.addHandler(CaseLogHandler(level=logging.INFO))
    if logger.level == logging.NOTSET or logger.level > logging.INFO:
        logger.setLevel(logging.INFO)
    _installed = True
