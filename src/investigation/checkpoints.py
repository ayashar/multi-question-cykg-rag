# src/investigation/checkpoints.py
"""
File-backed LangGraph checkpointer, so an investigation conversation can be
resumed after the API process restarts.

LangGraph's InMemorySaver keeps every checkpoint in process memory; this
subclass behaves identically while the process runs, and additionally
writes each thread's LATEST checkpoint (per namespace) to
`<directory>/<thread_id>.json` when `persist(thread_id)` is called --
session.py calls it once at the end of every turn. A thread that is not in
memory (e.g. after a restart) is loaded back from that file the first time
LangGraph asks for it, so the next turn continues from where the previous
process left off: same messages, cached evidence, case scope, known MITRE
techniques, and so on.

Only the latest checkpoint is kept on disk, not the full step history:
resuming a conversation needs nothing more, and it keeps files small.
Values are stored exactly as LangGraph's own serializer produced them
(base64-encoded inside JSON) -- nothing here pickles or interprets state.

No new dependency: langgraph-checkpoint-sqlite is not in uv.lock, and this
is a single-process service (see api.py), so per-thread files are enough.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Any, Optional

from langgraph.checkpoint.memory import InMemorySaver

logger = logging.getLogger(__name__)

FORMAT_VERSION = 1
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _enc(typed: tuple) -> list:
    kind, data = typed
    return [kind, base64.b64encode(data or b"").decode("ascii")]


def _dec(item: list) -> tuple:
    kind, data = item
    return (kind, base64.b64decode(data))


def safe_filename(thread_id: str) -> str:
    """case ids are `case-<hex>`; anything else is hashed so a thread id can
    never escape the checkpoint directory."""
    if _SAFE_ID.match(thread_id):
        return thread_id
    return "id-" + hashlib.sha256(thread_id.encode("utf-8")).hexdigest()[:32]


class FileCheckpointSaver(InMemorySaver):
    def __init__(self, directory: Path, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.directory = Path(directory)
        self._io_lock = threading.Lock()

    def path_for(self, thread_id: str) -> Path:
        return self.directory / f"{safe_filename(thread_id)}.json"

    # -- disk -> memory ---------------------------------------------------

    def _in_memory(self, thread_id: str) -> bool:
        # storage is a defaultdict: a membership test does not create the key.
        return thread_id in self.storage and any(self.storage[thread_id].values())

    def restore(self, thread_id: str) -> bool:
        """Load the thread's saved checkpoint into memory unless it is already
        there. Returns True when the thread is (now) available."""
        if self._in_memory(thread_id):
            return True
        path = self.path_for(thread_id)
        if not path.exists():
            return False
        try:
            payload = json.loads(path.read_text())
            if payload.get("version") != FORMAT_VERSION or payload.get("thread_id") != thread_id:
                logger.warning("[checkpoints] ignoring %s: wrong format or thread id", path)
                return False
            for ns, saved in payload["namespaces"].items():
                checkpoint_id = saved["checkpoint_id"]
                self.storage[thread_id][ns][checkpoint_id] = (
                    _dec(saved["checkpoint"]), _dec(saved["metadata"]), None)
                for channel, version, value in saved["blobs"]:
                    self.blobs[(thread_id, ns, channel, version)] = _dec(value)
                if saved["writes"]:
                    outer = self.writes.setdefault((thread_id, ns, checkpoint_id), {})
                    for task_id, idx, channel, value, task_path in saved["writes"]:
                        outer[(task_id, idx)] = (task_id, channel, _dec(value), task_path)
        except Exception:
            logger.error("[checkpoints] could not load %s", path, exc_info=True)
            self.delete_thread(thread_id, remove_file=False)
            return False
        logger.info("[checkpoints] restored thread %s from %s", thread_id, path)
        return True

    def has_checkpoint(self, thread_id: str) -> bool:
        return self._in_memory(thread_id) or self.path_for(thread_id).exists()

    def get_tuple(self, config):
        thread_id = config["configurable"]["thread_id"]
        if not self._in_memory(thread_id):
            self.restore(thread_id)
        return super().get_tuple(config)

    # -- memory -> disk ---------------------------------------------------

    def persist(self, thread_id: str) -> Optional[Path]:
        """Write the thread's latest checkpoint to disk (atomic replace).
        Returns the file path, or None when the thread has no checkpoint."""
        if not self._in_memory(thread_id):
            return None
        namespaces = {}
        for ns, checkpoints in self.storage[thread_id].items():
            if not checkpoints:
                continue
            checkpoint_id = max(checkpoints.keys())
            checkpoint, metadata, _parent = checkpoints[checkpoint_id]
            versions = self.serde.loads_typed(checkpoint).get("channel_versions", {})
            blobs = [[channel, version, _enc(self.blobs[(thread_id, ns, channel, version)])]
                     for channel, version in versions.items()
                     if (thread_id, ns, channel, version) in self.blobs]
            writes = [[task_id, idx, channel, _enc(value), task_path]
                      for (task_id, idx), (_tid, channel, value, task_path)
                      in self.writes.get((thread_id, ns, checkpoint_id), {}).items()]
            namespaces[ns] = {
                "checkpoint_id": checkpoint_id,
                "checkpoint": _enc(checkpoint),
                "metadata": _enc(metadata),
                "blobs": blobs,
                "writes": writes,
            }
        if not namespaces:
            return None
        payload = {"version": FORMAT_VERSION, "thread_id": thread_id, "namespaces": namespaces}
        path = self.path_for(thread_id)
        with self._io_lock:
            self.directory.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(payload))
            os.replace(tmp, path)
        return path

    def delete_thread(self, thread_id: str, remove_file: bool = True) -> None:
        super().delete_thread(thread_id)
        for key in [k for k in self.blobs if k[0] == thread_id]:
            del self.blobs[key]
        if remove_file:
            self.path_for(thread_id).unlink(missing_ok=True)
