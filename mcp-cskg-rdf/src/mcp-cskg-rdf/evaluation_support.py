"""Opt-in experiment telemetry and first-response SPARQL cache.

No credentials, prompts, or model answers are written to telemetry. Cached SELECT
responses are public knowledge-base data. A growing query cache is not a source snapshot.
"""
import hashlib
import io
import json
import os
from pathlib import Path
import time
import uuid
from rdflib.query import Result


def event(kind, **fields):
    path = os.environ.get('PROPOSAL_TELEMETRY_PATH')
    if not path:
        return
    record = {'kind': kind, 'time': time.time(), **fields}
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT, 0o600)
    try:
        os.write(fd, (json.dumps(record) + '\n').encode())
    finally:
        os.close(fd)


class CachedGraph:
    def __init__(self, graph, source):
        self.graph, self.source = graph, source

    def __getattr__(self, name):
        return getattr(self.graph, name)

    def query(self, query, *args, **kwargs):
        directory = os.environ.get('PROPOSAL_CSKG_CACHE')
        if not directory:
            return self.graph.query(query, *args, **kwargs)
        key = hashlib.sha256(json.dumps([self.source, str(query), args, kwargs], sort_keys=True, default=str).encode()).hexdigest()
        path = Path(directory) / (key + '.json')
        if path.exists():
            event('source_query', key=key, cache='hit')
            return Result.parse(source=io.BytesIO(path.read_bytes()), format='json')
        try:
            result = self.graph.query(query, *args, **kwargs)
            payload = result.serialize(format='json')
        except Exception as exc:
            event('source_query', key=key, cache='miss', status='failed', error_type=type(exc).__name__)
            raise
        path.parent.mkdir(parents=True, exist_ok=True)
        # Atomic publish; concurrent first responders use the first complete value.
        temporary = path.with_suffix('.' + uuid.uuid4().hex + '.tmp')
        temporary.write_bytes(payload if isinstance(payload, bytes) else payload.encode())
        try:
            try:
                os.link(temporary, path)
            except FileExistsError:
                pass
        finally:
            temporary.unlink()
        event('source_query', key=key, cache='miss', status='cached')
        return Result.parse(source=io.BytesIO(path.read_bytes()), format='json')
