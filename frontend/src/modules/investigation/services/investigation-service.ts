import {
  ApiClientError, getApiConfig, getCaseLookback, investigateCase, investigateTimeRange,
  registerCaseLookback, resolveCaseLookback, type Case, type TimeRangeRequest, type TurnRecord,
} from "@/api";
import { getCases, getInvestigatedCases } from "@/modules/cases/services/cases-service";

const selectedCases = new Map<string, Case>();
const pendingInvestigations = new Map<string, Promise<TurnRecord>>();
const CASE_KEY = "kgcs_selected_case:";
const TIME_RANGE_KEY = "kgcs_time_range_investigation:";

export interface PreparedTimeRangeInvestigation {
  value: Case;
  turn: TurnRecord;
  range: TimeRangeRequest;
}

const preparedTimeRangeInvestigations = new Map<string, PreparedTimeRangeInvestigation>();

export function rememberInvestigationCase(value: Case): void {
  selectedCases.set(value.case_id, value);
  try { sessionStorage.setItem(`${CASE_KEY}${value.case_id}`, JSON.stringify(value)); }
  catch { /* The in-memory copy remains available when storage is blocked. */ }
}

export function rememberTimeRangeInvestigation(
  range: TimeRangeRequest,
  turn: TurnRecord,
): PreparedTimeRangeInvestigation {
  const value: Case = {
    case_id: turn.case_id,
    alert_ids: [],
    hosts: [],
    src_ips: [],
    dst_users: [],
    mitre_techniques: turn.mitre_techniques,
    sigma_matched_rules: [],
    alert_count: 0,
    first_seen: range.start,
    last_seen: range.end,
    max_rule_level: 0,
    noteworthy_alert_count: 0,
    urgency_score: 0,
  };
  const prepared = { value, turn, range };
  preparedTimeRangeInvestigations.set(turn.case_id, prepared);
  rememberInvestigationCase(value);
  try { sessionStorage.setItem(`${TIME_RANGE_KEY}${turn.case_id}`, JSON.stringify(prepared)); }
  catch { /* The in-memory copy remains available when storage is blocked. */ }
  return prepared;
}

export function getPreparedTimeRangeInvestigation(caseId: string): PreparedTimeRangeInvestigation | null {
  const cached = preparedTimeRangeInvestigations.get(caseId);
  if (cached) return cached;
  try {
    const stored = JSON.parse(sessionStorage.getItem(`${TIME_RANGE_KEY}${caseId}`) || "null") as PreparedTimeRangeInvestigation | null;
    if (stored?.value?.case_id === caseId && stored?.turn?.case_id === caseId && stored.range?.start && stored.range?.end) {
      preparedTimeRangeInvestigations.set(caseId, stored);
      selectedCases.set(caseId, stored.value);
      return stored;
    }
  } catch { /* A missing prepared result falls back to the ordinary case flow. */ }
  return null;
}

export async function rerunPreparedTimeRangeInvestigation(caseId: string): Promise<PreparedTimeRangeInvestigation> {
  const prepared = getPreparedTimeRangeInvestigation(caseId);
  if (!prepared) throw new Error("The original manual time range is no longer available.");
  const turn = await investigateTimeRange(prepared.range);
  if (turn.case_id !== caseId) throw new Error("The returned investigation belongs to a different case.");
  return rememberTimeRangeInvestigation(prepared.range, turn);
}

export function getInvestigationHref(caseId: string, lookbackHours = getCaseLookback(caseId)): string {
  const path = `/cases/${encodeURIComponent(caseId)}`;
  return lookbackHours ? `${path}?lookback_hours=${lookbackHours}` : path;
}

export function parseLookbackHours(value: string | string[] | undefined): number | undefined {
  const hours = typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(hours) && hours > 0 ? hours : undefined;
}

export async function loadInvestigationCase(caseId: string, lookbackHours?: number): Promise<Case> {
  const cached = selectedCases.get(caseId);
  if (cached) return cached;
  try {
    const stored = JSON.parse(sessionStorage.getItem(`${CASE_KEY}${caseId}`) || "null") as Case | null;
    if (stored?.case_id === caseId && Array.isArray(stored.alert_ids) && Array.isArray(stored.hosts)) return stored;
  } catch { /* A direct URL can recover the case from the API. */ }

  const previous = getInvestigatedCases().find((record) => record.case_id === caseId);
  if (previous) {
    if (previous.lookback_hours) registerCaseLookback(caseId, previous.lookback_hours);
    return previous.case;
  }

  const hours = resolveCaseLookback(caseId, lookbackHours) ?? 336;
  const cases = await getCases(hours);
  const value = cases.find((item) => item.case_id === caseId);
  if (!value) {
    throw new ApiClientError(404, "Not Found", `Case ${caseId} not found within lookback_hours=${hours}. Reuse the original discovery window or expand it.`, "/cases");
  }
  rememberInvestigationCase(value);
  return value;
}

/** Share an in-flight POST across remounts so React Strict Mode cannot run it twice. */
export function runCaseInvestigation(value: Case, lookbackHours?: number): Promise<TurnRecord> {
  const hours = resolveCaseLookback(value.case_id, lookbackHours) ?? 336;
  const config = getApiConfig();
  const key = JSON.stringify([config.baseUrl, config.apiKey, value.case_id, hours]);
  const pending = pendingInvestigations.get(key);
  if (pending) return pending;

  const request = (process.env.NEXT_PUBLIC_USE_MOCK === "true"
    ? demoInvestigation(value)
    : investigateCase(value.case_id, hours)
  ).finally(() => pendingInvestigations.delete(key));
  pendingInvestigations.set(key, request);
  return request;
}

async function demoInvestigation(value: Case): Promise<TurnRecord> {
  await new Promise((resolve) => setTimeout(resolve, 48_000));
  return {
    case_id: value.case_id, turn_index: 1, question: "Investigate this case.",
    answer: `Demo report for ${value.alert_count} alerts associated with ${value.hosts.join(", ") || "this case"}. This is sample data, not a live security assessment.`,
    critical_analysis: "The demo uses case metadata only. Run the investigation API to receive evidence-backed findings.",
    mitigation_suggestions: [], recommended_priority: null, confidence: null,
    mitre_techniques: value.mitre_techniques, cited_entities: value.alert_ids,
    error: null, timestamp: new Date().toISOString(), latency_seconds: 48,
  };
}

export function buildInvestigationReport(value: Case, turn: TurnRecord): string {
  if (turn.error !== null || turn.case_id !== value.case_id) {
    throw new Error("A successful report for this case is required before downloading.");
  }
  const bullets = (values: string[]) => values.length ? values.map((item) => `- ${item}`).join("\n") : "Not provided.";
  return [
    `# Investigation report — ${value.case_id}`,
    `Generated: ${turn.timestamp}\nTurn: ${turn.turn_index}\nDuration: ${turn.latency_seconds}s`,
    `## Case details\nHosts: ${value.hosts.join(", ") || "Not available"}\nUsers: ${value.dst_users.join(", ") || "Not available"}\nSource IPs: ${value.src_ips.join(", ") || "Not available"}\nFirst seen: ${value.first_seen}\nLast seen: ${value.last_seen}\nAlerts: ${value.alert_count}\nUrgency: ${value.urgency_score}`,
    `## Assessment\nPriority: ${turn.recommended_priority ?? "Not provided"}\nConfidence: ${turn.confidence ?? "Not provided"}`,
    `## Investigation findings\n${turn.answer || "No narrative was returned."}`,
    `## Critical analysis\n${turn.critical_analysis || "Not provided."}`,
    `## Mitigation suggestions\n${bullets(turn.mitigation_suggestions)}`,
    `## MITRE ATT&CK\n${bullets(turn.mitre_techniques)}`,
    `## Cited entities\n${bullets(turn.cited_entities)}`,
    `## Alert IDs\n${bullets(value.alert_ids)}`,
  ].join("\n\n") + "\n";
}
