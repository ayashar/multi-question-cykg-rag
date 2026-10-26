"""Deterministic, label-blind coverage sampling; never a maliciousness classifier."""
from datetime import datetime


def representative_rows(rows, limit):
    """Cover activity types, hosts, sources, and five temporal bins before repeats.

    All groups have a chance irrespective of volume. Returned order is temporal;
    aggregates remain aggregates and are not interpreted as individual alerts.
    """
    if limit <= 0:
        return []
    if len(rows) <= limit:
        return list(rows)
    def stamp(row):
        try:
            return datetime.fromisoformat(str(row.get('timestamp', '')).replace('Z', '+00:00')).timestamp()
        except (ValueError, TypeError):
            return None
    stamps = [stamp(r) for r in rows]
    known = [s for s in stamps if s is not None]
    lo, hi = (min(known), max(known)) if known else (0, 0)
    features = []
    for row, ts in zip(rows, stamps):
        fs = set()
        for name, keys in [('activity', ('rule_id', 'title')), ('host', ('host', 'hostId')),
                           ('source', ('source',))]:
            value = next((row[k] for k in keys if row.get(k) is not None), None)
            if value is not None:
                fs.add((name, str(value)))
        if ts is not None:
            fs.add(('time', min(4, int(5 * (ts - lo) / (hi - lo))) if hi > lo else 0))
        features.append(fs)
    weights = {'activity': 4, 'host': 3, 'source': 2, 'time': 1}
    remaining, selected, covered = set(range(len(rows))), [], set()
    for _ in range(min(limit, len(rows))):
        def key(i):
            try:
                severity = max(0, min(15, float(rows[i].get('severity') or 0))) / 100
            except (TypeError, ValueError):
                severity = 0
            gain = sum(weights[f[0]] for f in features[i] - covered)
            return (-gain - severity, stamps[i] if stamps[i] is not None else 0,
                    str(rows[i].get('alertId', rows[i].get('id', ''))), i)
        choice = min(remaining, key=key)
        selected.append(choice)
        covered.update(features[choice])
        remaining.remove(choice)
    return [rows[i] for i in sorted(selected, key=lambda i: (stamps[i] or 0, i))]
