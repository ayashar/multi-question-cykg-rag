import {
  ApiClientError, getApiConfig, getCaseLookback, investigateCaseStream, investigateTimeRange,
  registerCaseLookback, resolveCaseLookback, type Case, type InvestigationProgressEvent, type TimeRangeRequest, type TurnRecord,
} from "@/api";
import { getCases, getInvestigatedCases } from "@/modules/cases/services/cases-service";
import { createDemoTimeRangeInvestigation as createApiDemoTimeRangeInvestigation } from "@/demo/demo-data";

const selectedCases = new Map<string, Case>();
interface PendingInvestigation {
  promise: Promise<TurnRecord>;
  listeners: Set<(event: InvestigationProgressEvent) => void>;
}

const pendingInvestigations = new Map<string, PendingInvestigation>();
const CASE_KEY = "kgcs_selected_case:";
const TIME_RANGE_KEY = "kgcs_time_range_investigation:";
const TIME_RANGE_STORE_KEY = "kgcs_time_range_investigations";
const MAX_PERSISTED_TIME_RANGE_INVESTIGATIONS = 20;

export interface PreparedTimeRangeInvestigation {
  value: Case;
  turn: TurnRecord;
  range: TimeRangeRequest;
  progress_events?: InvestigationProgressEvent[];
}

const preparedTimeRangeInvestigations = new Map<string, PreparedTimeRangeInvestigation>();

function isPreparedTimeRangeInvestigation(value: unknown): value is PreparedTimeRangeInvestigation {
  if (!value || typeof value !== "object") return false;
  const prepared = value as Partial<PreparedTimeRangeInvestigation>;
  return Boolean(
    prepared.value?.case_id &&
    prepared.turn?.case_id === prepared.value.case_id &&
    prepared.range?.start &&
    prepared.range?.end &&
    !Number.isNaN(Date.parse(prepared.range.start)) &&
    !Number.isNaN(Date.parse(prepared.range.end)) &&
    Date.parse(prepared.range.start) < Date.parse(prepared.range.end),
  );
}

function readPersistedTimeRangeInvestigations(): PreparedTimeRangeInvestigation[] {
  if (typeof window === "undefined") return [];
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(TIME_RANGE_STORE_KEY) || "[]");
    return Array.isArray(stored) ? stored.filter(isPreparedTimeRangeInvestigation) : [];
  } catch {
    return [];
  }
}

function persistTimeRangeInvestigation(prepared: PreparedTimeRangeInvestigation): void {
  if (typeof window === "undefined") return;
  try {
    const current = readPersistedTimeRangeInvestigations().filter(
      (item) => item.value.case_id !== prepared.value.case_id,
    );
    localStorage.setItem(
      TIME_RANGE_STORE_KEY,
      JSON.stringify([prepared, ...current].slice(0, MAX_PERSISTED_TIME_RANGE_INVESTIGATIONS)),
    );
  } catch {
    // The in-memory copy remains available when storage is blocked.
  }
}

export function rememberInvestigationCase(value: Case): void {
  selectedCases.set(value.case_id, value);
  try { sessionStorage.setItem(`${CASE_KEY}${value.case_id}`, JSON.stringify(value)); }
  catch { /* The in-memory copy remains available when storage is blocked. */ }
}

export function rememberTimeRangeInvestigation(
  range: TimeRangeRequest,
  turn: TurnRecord,
  progressEvents?: InvestigationProgressEvent[],
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
  const prepared: PreparedTimeRangeInvestigation = progressEvents
    ? { value, turn, range, progress_events: progressEvents }
    : { value, turn, range };
  preparedTimeRangeInvestigations.set(turn.case_id, prepared);
  rememberInvestigationCase(value);
  persistTimeRangeInvestigation(prepared);
  return prepared;
}

export function getPreparedTimeRangeInvestigation(caseId: string): PreparedTimeRangeInvestigation | null {
  const cached = preparedTimeRangeInvestigations.get(caseId);
  if (cached) return cached;
  const persisted = readPersistedTimeRangeInvestigations().find(
    (item) => item.value.case_id === caseId,
  );
  if (persisted) {
    preparedTimeRangeInvestigations.set(caseId, persisted);
    selectedCases.set(caseId, persisted.value);
    return persisted;
  }

  // Migrate manual investigations created before durable local storage was added.
  try {
    const stored = JSON.parse(sessionStorage.getItem(`${TIME_RANGE_KEY}${caseId}`) || "null") as PreparedTimeRangeInvestigation | null;
    if (isPreparedTimeRangeInvestigation(stored) && stored.value.case_id === caseId) {
      preparedTimeRangeInvestigations.set(caseId, stored);
      selectedCases.set(caseId, stored.value);
      persistTimeRangeInvestigation(stored);
      sessionStorage.removeItem(`${TIME_RANGE_KEY}${caseId}`);
      return stored;
    }
  } catch { /* A missing prepared result falls back to the ordinary case flow. */ }
  return null;
}

export function clearTimeRangeInvestigationMemoryCache(): void {
  preparedTimeRangeInvestigations.clear();
  selectedCases.clear();
}

export function createDemoTimeRangeInvestigation(range: TimeRangeRequest): TurnRecord {
  return createApiDemoTimeRangeInvestigation(range);
}

const TIME_RANGE_AGENTS = [
  ["guardrails", "agent.guardrails", "Guardrails Agent", ["Decision: relevant", "Investigation mode: manual time range"]],
  ["question_generation", "agent.question_generation", "Question Generation Agent", ["Generated investigation questions for the selected time window."]],
  ["dispatch_retrieval", "agent.dispatch_retrieval", "Retrieval Dispatcher", ["Retrieved alert, graph, and historical evidence for the selected interval."]],
  ["review_evidence", "agent.review_evidence", "Evidence Review Agent", ["Reviewed and correlated evidence across the requested time range."]],
  ["synthesizer", "agent.synthesizer", "Synthesis Agent", ["Built investigation findings and mitigation recommendations."]],
  ["grounding_check", "agent.grounding_check", "Grounding Check Agent", ["Grounding check: passed."]],
] as const;

function timeRangeAgentEvent(
  stage: (typeof TIME_RANGE_AGENTS)[number],
  status: "running" | "complete",
  started: number,
): InvestigationProgressEvent {
  return {
    type: "agent",
    status,
    agent: stage[0],
    agent_id: stage[1],
    label: stage[2],
    messages: status === "complete" ? [...stage[3]] : [],
    timestamp: new Date().toISOString(),
    elapsed_seconds: (Date.now() - started) / 1000,
  };
}

export async function runTimeRangeInvestigation(
  range: TimeRangeRequest,
  onProgress?: (event: InvestigationProgressEvent) => void,
): Promise<TurnRecord> {
  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") {
    const started = Date.now();
    for (const stage of TIME_RANGE_AGENTS) {
      onProgress?.(timeRangeAgentEvent(stage, "running", started));
      await new Promise((resolve) => setTimeout(resolve, 350));
      onProgress?.(timeRangeAgentEvent(stage, "complete", started));
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    const result = createDemoTimeRangeInvestigation(range);
    onProgress?.({ type: "result", result, timestamp: new Date().toISOString() });
    return result;
  }
  const started = Date.now();
  onProgress?.(timeRangeAgentEvent(TIME_RANGE_AGENTS[0], "running", started));
  try {
    const result = await investigateTimeRange(range);
    TIME_RANGE_AGENTS.forEach((stage) => onProgress?.(timeRangeAgentEvent(stage, "complete", started)));
    onProgress?.({ type: "result", result, timestamp: new Date().toISOString() });
    return result;
  } catch (reason) {
    onProgress?.({
      type: "error",
      message: reason instanceof Error ? reason.message : "Investigation failed.",
      timestamp: new Date().toISOString(),
      elapsed_seconds: (Date.now() - started) / 1000,
    });
    throw reason;
  }
}

export async function rerunPreparedTimeRangeInvestigation(caseId: string): Promise<PreparedTimeRangeInvestigation> {
  const prepared = getPreparedTimeRangeInvestigation(caseId);
  if (!prepared) throw new Error("The original manual time range is no longer available.");
  const progressEvents: InvestigationProgressEvent[] = [];
  const turn = await runTimeRangeInvestigation(prepared.range, (event) => progressEvents.push(event));
  if (turn.case_id !== caseId) throw new Error("The returned investigation belongs to a different case.");
  return rememberTimeRangeInvestigation(prepared.range, turn, progressEvents);
}

export function getInvestigationHref(caseId: string, lookbackHours = getCaseLookback(caseId)): string {
  const path = `/cases/${encodeURIComponent(caseId)}`;
  return lookbackHours ? `${path}?lookback_hours=${lookbackHours}` : path;
}

export function getPastInvestigationHref(caseId: string, lookbackHours = getCaseLookback(caseId)): string {
  const href = getInvestigationHref(caseId, lookbackHours);
  return `${href}${href.includes("?") ? "&" : "?"}reopen=1`;
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
export function runCaseInvestigation(
  value: Case,
  lookbackHours?: number,
  onProgress?: (event: InvestigationProgressEvent) => void,
): Promise<TurnRecord> {
  const hours = resolveCaseLookback(value.case_id, lookbackHours) ?? 336;
  const config = getApiConfig();
  const key = JSON.stringify([config.baseUrl, value.case_id, hours]);
  const pending = pendingInvestigations.get(key);
  if (pending) {
    if (onProgress) pending.listeners.add(onProgress);
    return pending.promise;
  }

  const listeners = new Set<(event: InvestigationProgressEvent) => void>();
  if (onProgress) listeners.add(onProgress);
  const request = investigateCaseStream(value.case_id, (event) => {
    for (const listener of listeners) listener(event);
  }, hours, value)
    .finally(() => pendingInvestigations.delete(key));
  pendingInvestigations.set(key, { promise: request, listeners });
  return request;
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
