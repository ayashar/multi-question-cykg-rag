# src/investigation/narrative.py
"""
Renders a Case (src/investigation/clustering.py) + its member alerts into
the static text fact sheet fed into the pipeline as `state['case_context']`
(see src/graph/state.py, src/graph/workflow.py's `_render_conversation_context`
sibling). This is the case-level analogue of the old
src/ingestion/trigger.py::build_question -- but deliberately a fact sheet,
not a question: the actual investigative ask (turn 1's directive, or a
later chat follow-up) is passed separately as `question`/`original_question`
by src/investigation/session.py, so case_context can stay constant across
every turn of one investigation thread while the question changes turn to
turn.
"""
from __future__ import annotations

from typing import List
from collections import defaultdict
import json

from src.ingestion.schema import Alert
from src.investigation.clustering import Case
from src.investigation.knowledge_base import fetch_related_findings, render_related_findings_section
from src.retrieval.representative import representative_rows

MAX_ALERTS_IN_NARRATIVE = 15
MAX_ACTIVITY_GROUPS = 30


def _source(alert):
    if alert.decoder_name == 'aminer' or 'aminer' in alert.rule_groups:
        return 'aminer'
    if 'suricata' in (alert.decoder_name or '').lower() or any('suricata' in g.lower() for g in alert.rule_groups):
        return 'suricata'
    return 'wazuh_or_other'


def select_context_alerts(alerts):
    lookup = {a.id: a for a in alerts}
    rows = [{'alertId': a.id, 'timestamp': a.timestamp, 'host': a.agent_name,
             'source': _source(a), 'title': a.rule_description, 'rule_id': f'{_source(a)}:{a.rule_id}',
             'severity': a.rule_level} for a in alerts]
    return [lookup[r['alertId']] for r in representative_rows(rows, MAX_ALERTS_IN_NARRATIVE)]


def _log_excerpt(alert):
    text = alert.full_log or ''
    try:
        raw = json.loads(text)
        if isinstance(raw, dict) and isinstance(raw.get('LogData'), dict):
            component = raw.get('AnalysisComponent') or {}
            # Show actual log evidence before AMiner's long detector metadata.
            text = json.dumps({'raw_logs': raw['LogData'].get('RawLogData'),
                               'values': component.get('AffectedLogAtomValues'),
                               'message': component.get('Message')}, ensure_ascii=False)
    except (ValueError, TypeError):
        pass
    return text[:800].replace('\n', ' ') + (' [excerpt truncated]' if len(text) > 800 else '')


def _alert_line(alert: Alert) -> str:
    bits = [f"Alert {alert.id} [{alert.timestamp}] {alert.agent_name} (level {alert.rule_level}): {alert.rule_description}"]
    if alert.data_srcip:
        bits.append(f"source IP {alert.data_srcip}")
    if alert.data_dstuser:
        bits.append(f"user {alert.data_dstuser}")
    if alert.rule_mitre_id:
        bits.append("MITRE (native): " + ", ".join(alert.rule_mitre_id))
    if alert.sigma_mitre_id:
        bits.append("MITRE (sigma-matched): " + ", ".join(alert.sigma_mitre_id))
    if alert.full_log:
        bits.append(f"log: {_log_excerpt(alert)}")
    return " | ".join(bits)


def build_case_context(case: Case, alerts: List[Alert], *, include_related_findings: bool = True) -> str:
    """Exact member alerts summarized by activity, with diverse bounded excerpts.

    Counts describe detector observations, not attack counts or causal claims.
    """
    lines = [
        f"Case {case.case_id}: {case.alert_count} alert(s) across host(s) {', '.join(case.hosts)} "
        f"between {case.first_seen} and {case.last_seen}.",
        f"Max severity (Wazuh rule_level, 0-15): {case.max_rule_level}. "
        f"Urgency score: {case.urgency_score}/100.",
    ]
    if case.src_ips:
        lines.append(f"Source IP(s) involved: {', '.join(case.src_ips)}")
    if case.dst_users:
        lines.append(f"Target user(s) involved: {', '.join(case.dst_users)}")
    if case.mitre_techniques:
        lines.append(f"MITRE ATT&CK technique(s) across member alerts (native + sigma-matched): "
                      f"{', '.join(case.mitre_techniques)}")
    if case.sigma_matched_rules:
        lines.append(f"Sigma detection rule(s) that matched (src/investigation/sigma_rules/): "
                      f"{', '.join(case.sigma_matched_rules)}")

    groups = defaultdict(list)
    for alert in alerts:
        groups[(_source(alert), alert.agent_name, alert.rule_id, alert.rule_description)].append(alert)
    shown = select_context_alerts(alerts)
    represented = {(_source(a), a.agent_name, a.rule_id, a.rule_description) for a in shown}
    ordered = sorted(groups, key=lambda key: (key not in represented, -len(groups[key]), key))
    lines.append(f'\nActivity groups: {len(groups)} total; {min(len(groups), MAX_ACTIVITY_GROUPS)} summarized. '
                 'Counts cover all members of each listed group, not only excerpts. '
                 'These are detector observations, not confirmed attacks.')
    for key in ordered[:MAX_ACTIVITY_GROUPS]:
        members = sorted(groups[key], key=lambda a: (a.timestamp, a.id))
        source, host, rule, title = key
        lines.append(f'- Group source={source}, host={host}, rule={rule}, title={title}: '
                     f'count={len(members)}; first={members[0].timestamp}; last={members[-1].timestamp}; '
                     f'max_severity={max(a.rule_level for a in members)}; '
                     f'example_ids={members[0].id}, {members[-1].id}')
    lines.append('Coverage is partial: omitted groups/excerpts require targeted retrieval. '
                 'Do not classify the entire case from one group. Temporal order and shared entities '
                 'do not establish root cause. Sensor/Sigma technique tags are hypotheses, not proof.')
    lines.append(
        f"\nMember alerts ({len(shown)} of {len(alerts)} shown, diversity-selected then ordered chronologically):"
    )
    lines.extend(f"- {_alert_line(a)}" for a in shown)

    related_section = (render_related_findings_section(fetch_related_findings(case))
                       if include_related_findings else "")
    if related_section:
        lines.append(related_section)

    return "\n".join(lines)
