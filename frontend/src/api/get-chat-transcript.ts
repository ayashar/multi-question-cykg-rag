import { apiRequest, type TurnRecord } from "./client";
import { demoDelay, getDemoTranscript, isDemoMode } from "@/demo/demo-data";

export function getChatTranscript(caseId: string, includeTrace = false): Promise<TurnRecord[]> {
  if (isDemoMode()) return demoDelay(getDemoTranscript(caseId));
  return apiRequest(`/investigations/${encodeURIComponent(caseId)}/chat`, {
    method: "GET", endpointKey: "getChatTranscript",
    params: includeTrace ? { include_trace: true } : undefined,
  });
}

export interface InvestigationSummary {
  case_id: string;
  turn_count: number;
  last_timestamp: string;
  resumable: boolean;
  running?: boolean;
}

/** Cases the backend has already investigated (persisted server-side). */
export function listInvestigations(): Promise<InvestigationSummary[]> {
  if (isDemoMode()) return Promise.resolve([]);
  return apiRequest("/investigations", { method: "GET", endpointKey: "listInvestigations" });
}
