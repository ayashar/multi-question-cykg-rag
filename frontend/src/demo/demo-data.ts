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
export const INITIAL_INVESTIGATION_QUESTION =
  "Investigate the activity described in this case. Identify related MITRE ATT&CK techniques, provide an initial diagnosis of the situation, and recommend mitigation actions.";
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

export function createDemoInvestigation(value: Case, turnIndex = 1, question = INITIAL_INVESTIGATION_QUESTION): TurnRecord {
  const hosts = value.hosts.slice(0, 3);
  const hostList = hosts.join(", ") || "the affected environment";
  const techniques = value.mitre_techniques.length ? value.mitre_techniques.join(", ") : "no confirmed MITRE ATT&CK technique";
  const citedEntities = Array.from(new Set([
    ...value.alert_ids.slice(0, 6),
    ...hosts,
    ...value.src_ips.slice(0, 3),
    ...value.dst_users.slice(0, 2),
  ]));
  const recommendedPriority = value.urgency_score >= 60 ? "escalate" : value.urgency_score >= 30 ? "monitor" : "ignore";
  const confidence = value.alert_count >= 5 && citedEntities.length >= 3 ? "high" : value.alert_count > 1 ? "medium" : "low";
  return {
    case_id: value.case_id,
    turn_index: turnIndex,
    question,
    answer: `The investigation correlated ${value.alert_count} alerts involving ${hostList} between ${value.first_seen} and ${value.last_seen}. The available evidence maps to ${techniques}. Review the cited alerts and affected entities before deciding whether containment is required.`,
    critical_analysis: `The case groups alerts that share hosts, source indicators, users, or temporal proximity. Its urgency score is ${value.urgency_score.toFixed(1)}, with ${value.noteworthy_alert_count} noteworthy alerts. Correlation supports further review, but does not by itself prove successful compromise.`,
    mitigation_suggestions: [
      "Validate the highlighted alerts against the original host telemetry.",
      "Isolate affected hosts if the activity is confirmed.",
      "Review credentials and indicators shared across the related alerts.",
    ],
    recommended_priority: recommendedPriority,
    confidence,
    mitre_techniques: value.mitre_techniques,
    cited_entities: citedEntities,
    error: null,
    timestamp: new Date().toISOString(),
    latency_seconds: 1.2,
  };
}

export function startDemoInvestigation(value: Case): TurnRecord {
  const existing = transcripts.get(value.case_id)?.find(
    (turn) => turn.question === INITIAL_INVESTIGATION_QUESTION && turn.error === null,
  );
  if (existing) return existing;
  const initial = createDemoInvestigation(value);
  transcripts.set(value.case_id, [...(transcripts.get(value.case_id) ?? []), initial]);
  return initial;
}

export function createDemoAttackGraph(value: Case): CaseAttackGraph {
  const alertIds = value.alert_ids.length ? value.alert_ids : [`${value.case_id}-alert`];
  const nodes: CaseAttackGraph["nodes"] = alertIds.map((alertId, index) => ({
    id: `alert:${alertId}`,
    type: "alert",
    label: value.sigma_matched_rules[index % Math.max(1, value.sigma_matched_rules.length)] ?? `Suspicious activity in ${value.case_id}`,
    timestamp: index === alertIds.length - 1 ? value.last_seen : value.first_seen,
    rule_level: value.max_rule_level,
  }));
  const edges: CaseAttackGraph["edges"] = [];

  for (const host of value.hosts) {
    const id = `host:${host}`;
    nodes.push({ id, type: "host", label: host, timestamp: null, rule_level: null });
    for (const alertId of alertIds) edges.push({ source: id, target: `alert:${alertId}`, relation: "HAS_ALERT" });
  }
  for (const ip of value.src_ips) {
    const id = `ip:${ip}`;
    nodes.push({ id, type: "ip", label: ip, timestamp: null, rule_level: null });
    edges.push({ source: id, target: `alert:${alertIds[0]}`, relation: "ATTACK_TO" });
  }
  for (const user of value.dst_users) {
    const id = `user:${user}`;
    nodes.push({ id, type: "user", label: user, timestamp: null, rule_level: null });
    edges.push({ source: `alert:${alertIds[0]}`, target: id, relation: "TARGETS_USER" });
  }
  for (const technique of value.mitre_techniques) {
    const id = `mitre:${technique}`;
    nodes.push({ id, type: "mitre_technique", label: technique, timestamp: null, rule_level: null });
    edges.push({ source: `alert:${alertIds[0]}`, target: id, relation: "TRIGGERS" });
  }
  for (let index = 0; index < alertIds.length - 1; index++) {
    edges.push({ source: `alert:${alertIds[index]}`, target: `alert:${alertIds[index + 1]}`, relation: "PRECEDES" });
  }

  return {
    case_id: value.case_id,
    nodes,
    edges,
    root_cause_alert_id: alertIds[0],
    chain_order: alertIds,
  };
}

export function createDemoTimeRangeInvestigation(range: TimeRangeRequest): TurnRecord {
  let rangeHash = 2_166_136_261;
  for (const character of `${range.start}|${range.end}`) {
    rangeHash ^= character.charCodeAt(0);
    rangeHash = Math.imul(rangeHash, 16_777_619);
  }
  const value: Case = {
    ...MOCK_CASES[2],
    case_id: `demo-range-${(rangeHash >>> 0).toString(16).padStart(8, "0")}`,
    first_seen: range.start,
    last_seen: range.end,
  };
  return startDemoInvestigation(value);
}

export function getDemoTranscript(caseId: string): TurnRecord[] {
  return [...(transcripts.get(caseId) ?? [])];
}

export function createDemoChatTurn(caseId: string, message: string): TurnRecord {
  const history = getDemoTranscript(caseId);
  if (history.length === 0) throw new Error(`No investigation started for case ${caseId} yet.`);
  const initial = history[0];
  const turn: TurnRecord = {
    ...initial,
    turn_index: history.length + 1,
    question: message,
    answer: `The evidence currently recorded for ${caseId} remains consistent with the initial assessment. Regarding “${message}”, validate the cited entities and source telemetry before changing the case priority.`,
    timestamp: new Date().toISOString(),
    latency_seconds: 0.8,
  };
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
