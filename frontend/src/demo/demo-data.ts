import type {
  Case,
  CaseAttackGraph,
  IngestionConfig,
  IngestionStatus,
  TimeRangeRequest,
  TurnRecord,
} from "@/api/client";
import { MOCK_CASES } from "@/modules/cases/data/cases-fixture";

const DEMO_DELAY_MS = 650;
const transcripts = new Map<string, TurnRecord[]>();
let ingestionConfig: IngestionConfig = {
  alerts_path: "data/alerts-sample.jsonl",
  speed: 100000,
  max_gap_seconds: 0.2,
};

export function isDemoMode(): boolean {
  return process.env.NEXT_PUBLIC_USE_MOCK === "true";
}

export async function demoDelay<T>(value: T, delay = DEMO_DELAY_MS): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, delay));
  return value;
}

export function getDemoCase(caseId: string): Case {
  return MOCK_CASES.find((item) => item.case_id === caseId) ?? { ...MOCK_CASES[0], case_id: caseId };
}

export function createDemoInvestigation(value: Case, turnIndex = 1, question = "Investigate this case."): TurnRecord {
  const hostList = value.hosts.slice(0, 3).join(", ") || "the affected environment";
  const techniques = value.mitre_techniques.length ? value.mitre_techniques.join(", ") : "no mapped technique";
  return {
    case_id: value.case_id,
    turn_index: turnIndex,
    question,
    answer: `Demo finding: ${value.alert_count} related alerts were correlated across ${hostList}. The activity maps to ${techniques} and should be reviewed before containment.`,
    critical_analysis: `This is frontend-only dummy data. The sample demonstrates how evidence, confidence, priority, and citations appear without contacting the investigation API. Urgency score: ${value.urgency_score.toFixed(1)}.`,
    mitigation_suggestions: [
      "Validate the highlighted alerts against the original host telemetry.",
      "Isolate affected hosts if the activity is confirmed.",
      "Review credentials and indicators shared across the related alerts.",
    ],
    recommended_priority: value.urgency_score >= 60 ? "escalate" : "monitor",
    confidence: value.alert_count >= 5 ? "high" : "medium",
    mitre_techniques: value.mitre_techniques,
    cited_entities: [...value.alert_ids.slice(0, 6), ...value.hosts.slice(0, 2)],
    error: null,
    timestamp: new Date().toISOString(),
    latency_seconds: 1.2,
  };
}

export function createDemoAttackGraph(value: Case): CaseAttackGraph {
  const alertId = value.alert_ids[0] ?? `${value.case_id}-alert`;
  const alertNodeId = `alert:${alertId}`;
  const nodes: CaseAttackGraph["nodes"] = [{
    id: alertNodeId,
    type: "alert",
    label: value.sigma_matched_rules[0] ?? `Suspicious activity in ${value.case_id}`,
    timestamp: value.first_seen,
    rule_level: value.max_rule_level,
  }];
  const edges: CaseAttackGraph["edges"] = [];

  for (const host of value.hosts.slice(0, 3)) {
    const id = `host:${host}`;
    nodes.push({ id, type: "host", label: host, timestamp: value.first_seen, rule_level: null });
    edges.push({ source: id, target: alertNodeId, relation: "HAS_ALERT" });
  }
  for (const ip of value.src_ips.slice(0, 2)) {
    const id = `ip:${ip}`;
    nodes.push({ id, type: "ip", label: ip, timestamp: value.first_seen, rule_level: null });
    edges.push({ source: id, target: alertNodeId, relation: "ATTACK_TO" });
  }
  for (const user of value.dst_users.slice(0, 2)) {
    const id = `user:${user}`;
    nodes.push({ id, type: "user", label: user, timestamp: value.first_seen, rule_level: null });
    edges.push({ source: alertNodeId, target: id, relation: "TARGETS_USER" });
  }
  for (const technique of value.mitre_techniques.slice(0, 3)) {
    const id = `mitre:${technique}`;
    nodes.push({ id, type: "mitre_technique", label: technique, timestamp: value.first_seen, rule_level: null });
    edges.push({ source: alertNodeId, target: id, relation: "TRIGGERS" });
  }

  return {
    case_id: value.case_id,
    nodes,
    edges,
    root_cause_alert_id: alertId,
    chain_order: [alertId],
  };
}

export function createDemoTimeRangeInvestigation(range: TimeRangeRequest): TurnRecord {
  const start = Date.parse(range.start).toString(36);
  const value: Case = {
    ...MOCK_CASES[2],
    case_id: `range-demo-${start}`,
    first_seen: range.start,
    last_seen: range.end,
  };
  return createDemoInvestigation(value, 1, `Investigate activity from ${range.start} to ${range.end}.`);
}

export function getDemoTranscript(caseId: string): TurnRecord[] {
  if (!transcripts.has(caseId)) {
    transcripts.set(caseId, [createDemoInvestigation(getDemoCase(caseId))]);
  }
  return [...(transcripts.get(caseId) ?? [])];
}

export function createDemoChatTurn(caseId: string, message: string): TurnRecord {
  const history = getDemoTranscript(caseId);
  const turn = createDemoInvestigation(getDemoCase(caseId), history.length + 1, message);
  turn.answer = `Demo response: the current evidence for ${caseId} remains consistent with the initial assessment. Your question was: “${message}”`;
  transcripts.set(caseId, [...history, turn]);
  return turn;
}

export function getDemoIngestionConfig(): IngestionConfig {
  return { ...ingestionConfig };
}

export function setDemoIngestionConfig(value: IngestionConfig): IngestionConfig {
  ingestionConfig = { ...value };
  return getDemoIngestionConfig();
}

export function getDemoIngestionStatus(): IngestionStatus {
  const starts = MOCK_CASES.map((item) => item.first_seen).sort();
  const ends = MOCK_CASES.map((item) => item.last_seen).sort();
  return {
    alert_count: MOCK_CASES.reduce((total, item) => total + item.alert_count, 0),
    earliest_alert_timestamp: starts[0] ?? null,
    latest_alert_timestamp: ends.at(-1) ?? null,
    configured_alerts_path: ingestionConfig.alerts_path,
  };
}
