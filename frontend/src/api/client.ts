export interface Case {
  case_id: string;
  alert_ids: string[];
  hosts: string[];
  src_ips: string[];
  dst_users: string[];
  mitre_techniques: string[];
  sigma_matched_rules: string[];
  alert_count: number;
  first_seen: string;
  last_seen: string;
  max_rule_level: number;
  noteworthy_alert_count: number;
  urgency_score: number;
}

export interface TurnRecord {
  case_id: string;
  turn_index: number;
  question: string;
  answer: string | null;
  critical_analysis: string | null;
  mitigation_suggestions: string[];
  recommended_priority: "ignore" | "monitor" | "escalate" | null;
  confidence: "low" | "medium" | "high" | null;
  mitre_techniques: string[];
  cited_entities: string[];
  error: string | null;
  timestamp: string;
  latency_seconds: number;
}

export type AttackGraphNodeType =
  | "alert"
  | "host"
  | "ip"
  | "user"
  | "mitre_technique";

export interface AttackGraphNode {
  id: string;
  type: AttackGraphNodeType;
  label: string;
  timestamp: string | null;
  rule_level: number | null;
}

export type AttackGraphRelation =
  | "HAS_ALERT"
  | "ATTACK_TO"
  | "CONNECTS_TO"
  | "TARGETS_USER"
  | "TRIGGERS"
  | "PRECEDES";

export interface AttackGraphEdge {
  source: string;
  target: string;
  relation: AttackGraphRelation;
}

export interface CaseAttackGraph {
  case_id: string;
  nodes: AttackGraphNode[];
  edges: AttackGraphEdge[];
  root_cause_alert_id: string | null;
  chain_order: string[];
}

export interface IngestionConfig {
  alerts_path: string | null;
  speed: number;
  max_gap_seconds: number;
}

export interface IngestionStatus {
  alert_count: number;
  earliest_alert_timestamp: string | null;
  latest_alert_timestamp: string | null;
  configured_alerts_path: string | null;
}

export interface TimeRangeRequest {
  start: string;
  end: string;
}

export interface ChatRequest {
  message: string;
}

export interface GetCasesParams {
  lookback_hours?: number;
}

export interface InvestigateCaseParams {
  case_id: string;
  lookback_hours?: number;
}

export interface GetAttackGraphParams {
  case_id: string;
  lookback_hours?: number;
}

export interface SendChatMessageParams {
  case_id: string;
  message: string;
}

export interface ApiConfig {
  baseUrl: string;
}

export type ApiEndpointKey =
  | "getCases"
  | "investigateCase"
  | "getAttackGraph"
  | "investigateTimeRange"
  | "sendChatMessage"
  | "getChatTranscript"
  | "getIngestionConfig"
  | "updateIngestionConfig"
  | "getIngestionStatus"
  | "apiRequest";

export interface ApiLoadingState {
  isLoading: boolean;
  activeCalls: number;
  activeEndpoints: Record<string, number>;
  isInvestigating: boolean;
  investigationCaseId?: string;
  investigationStartTime?: number;
}

let activeCallsCount = 0;
const activeEndpointMap = new Map<string, number>();
let activeInvestigationCount = 0;
let currentInvestigationCaseId: string | undefined = undefined;
let currentInvestigationStartTime: number | undefined = undefined;

type LoadingListener = (state: ApiLoadingState) => void;
const loadingListeners = new Set<LoadingListener>();

let currentLoadingState: ApiLoadingState = {
  isLoading: false,
  activeCalls: 0,
  activeEndpoints: {},
  isInvestigating: false,
  investigationCaseId: undefined,
  investigationStartTime: undefined,
};

function updateAndNotifyLoading(): void {
  currentLoadingState = {
    isLoading: activeCallsCount > 0,
    activeCalls: activeCallsCount,
    activeEndpoints: Object.fromEntries(activeEndpointMap.entries()),
    isInvestigating: activeInvestigationCount > 0,
    investigationCaseId: currentInvestigationCaseId,
    investigationStartTime: currentInvestigationStartTime,
  };
  for (const listener of loadingListeners) {
    listener(currentLoadingState);
  }
}

export function getApiLoadingState(): ApiLoadingState {
  return currentLoadingState;
}

export function subscribeApiLoading(listener: LoadingListener): () => void {
  loadingListeners.add(listener);
  listener(currentLoadingState);
  return () => {
    loadingListeners.delete(listener);
  };
}

export function startApiLoading(
  endpointKey: ApiEndpointKey,
  options?: { isInvestigation?: boolean; caseId?: string }
): void {
  activeCallsCount++;
  activeEndpointMap.set(
    endpointKey,
    (activeEndpointMap.get(endpointKey) ?? 0) + 1
  );

  if (options?.isInvestigation) {
    activeInvestigationCount++;
    if (currentInvestigationStartTime === undefined) {
      currentInvestigationStartTime = Date.now();
      currentInvestigationCaseId = options.caseId;
    }
  }

  updateAndNotifyLoading();
}

export function stopApiLoading(
  endpointKey: ApiEndpointKey,
  options?: { isInvestigation?: boolean }
): void {
  activeCallsCount = Math.max(0, activeCallsCount - 1);

  const currentCount = activeEndpointMap.get(endpointKey) ?? 1;
  if (currentCount <= 1) {
    activeEndpointMap.delete(endpointKey);
  } else {
    activeEndpointMap.set(endpointKey, currentCount - 1);
  }

  if (options?.isInvestigation) {
    activeInvestigationCount = Math.max(0, activeInvestigationCount - 1);
    if (activeInvestigationCount === 0) {
      currentInvestigationStartTime = undefined;
      currentInvestigationCaseId = undefined;
    }
  }

  updateAndNotifyLoading();
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly detail: string;
  readonly url: string;

  constructor(status: number, statusText: string, detail: string, url: string) {
    super(`API Error ${status} (${statusText}) at ${url}: ${detail}`);
    this.name = "ApiClientError";
    this.status = status;
    this.statusText = statusText;
    this.detail = detail;
    this.url = url;
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }
}

const DEFAULT_BASE_URL = "/backend";

let currentConfig: ApiConfig = {
  baseUrl: DEFAULT_BASE_URL.replace(/\/+$/, ""),
};

export function getApiConfig(): ApiConfig {
  return { ...currentConfig };
}

export function setApiConfig(config: Partial<ApiConfig>): void {
  currentConfig = {
    baseUrl:
      config.baseUrl !== undefined
        ? config.baseUrl.replace(/\/+$/, "")
        : currentConfig.baseUrl,
  };
}

export function resetApiConfig(): void {
  currentConfig = {
    baseUrl: DEFAULT_BASE_URL,
  };
}

const caseLookbackMap = new Map<string, number>();
const LOOKBACK_STORAGE_KEY = "kgcs_case_lookback_map";

function restoreLookbacks(): void {
  if (typeof window === "undefined") return;
  try {
    const stored = JSON.parse(sessionStorage.getItem(LOOKBACK_STORAGE_KEY) || "{}");
    for (const [id, hours] of Object.entries(stored)) {
      if (typeof hours === "number" && Number.isFinite(hours) && hours > 0 && !caseLookbackMap.has(id)) {
        caseLookbackMap.set(id, hours);
      }
    }
  } catch { /* Storage is optional. */ }
}

export function registerCaseLookback(caseId: string, lookbackHours: number): void {
  restoreLookbacks();
  if (caseId && Number.isFinite(lookbackHours) && lookbackHours > 0 && !caseLookbackMap.has(caseId)) {
    caseLookbackMap.set(caseId, lookbackHours);
    try {
      if (typeof window !== "undefined") sessionStorage.setItem(LOOKBACK_STORAGE_KEY, JSON.stringify(Object.fromEntries(caseLookbackMap)));
    } catch { /* Retain the in-memory fallback. */ }
  }
}

export function registerCasesLookback(cases: Case[], lookbackHours: number): void {
  for (const c of cases) {
    if (c?.case_id) {
      registerCaseLookback(c.case_id, lookbackHours);
    }
  }
}

export function getCaseLookback(caseId: string): number | undefined {
  restoreLookbacks();
  return caseLookbackMap.get(caseId);
}

export function clearLookbackStore(): void {
  caseLookbackMap.clear();
  try {
    if (typeof window !== "undefined") sessionStorage.removeItem(LOOKBACK_STORAGE_KEY);
  } catch { /* Storage is optional. */ }
}

export function resolveCaseLookback(caseId: string, explicit?: number): number | undefined {
  if (explicit !== undefined && (!Number.isFinite(explicit) || explicit <= 0)) {
    throw new RangeError("lookback_hours must be a positive finite number");
  }
  const stored = getCaseLookback(caseId);
  return stored === undefined ? explicit : Math.max(stored, explicit ?? stored);
}

export function getLookbackStoreEntries(): Record<string, number> {
  return Object.fromEntries(caseLookbackMap.entries());
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  params?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  endpointKey?: ApiEndpointKey;
  isInvestigation?: boolean;
  caseId?: string;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const endpointKey = options.endpointKey ?? "apiRequest";
  startApiLoading(endpointKey, {
    isInvestigation: options.isInvestigation,
    caseId: options.caseId,
  });

  try {
    const { baseUrl } = getApiConfig();
    const {
      params,
      body,
      headers: customHeaders,
      ...fetchOptions
    } = options;
    delete (fetchOptions as Record<string, unknown>).endpointKey;
    delete (fetchOptions as Record<string, unknown>).isInvestigation;
    delete (fetchOptions as Record<string, unknown>).caseId;

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(
      `${baseUrl}${normalizedPath}`,
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "http://localhost",
    );

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value));
        }
      }
    }

    const headers = new Headers(customHeaders);

    let serializedBody: BodyInit | undefined;
    if (body !== undefined) {
      if (typeof body === "string") {
        serializedBody = body;
      } else {
        serializedBody = JSON.stringify(body);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
      }
    }

    const response = await fetch(url.toString(), {
      ...fetchOptions,
      headers,
      body: serializedBody,
    });

    if (!response.ok) {
      let errorDetail = response.statusText;
      try {
        const text = await response.text();
        errorDetail = text || errorDetail;
        const errorJson = JSON.parse(text);
        if (errorJson && typeof errorJson === "object") {
          if ("detail" in errorJson) {
            errorDetail =
              typeof errorJson.detail === "string"
                ? errorJson.detail
                : JSON.stringify(errorJson.detail);
          } else if ("message" in errorJson) {
            errorDetail = String(errorJson.message);
          } else {
            errorDetail = JSON.stringify(errorJson);
          }
        }
      } catch { /* Keep the plain-text body, or status text if the body could not be read. */ }

      throw new ApiClientError(
        response.status,
        response.statusText,
        errorDetail,
        url.toString()
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } finally {
    stopApiLoading(endpointKey, {
      isInvestigation: options.isInvestigation,
    });
  }
}
