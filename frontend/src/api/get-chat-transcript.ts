import { apiRequest, type TurnRecord } from "./client";
import { demoDelay, getDemoTranscript, isDemoMode } from "@/demo/demo-data";

export function getChatTranscript(caseId: string): Promise<TurnRecord[]> {
  if (isDemoMode()) return demoDelay(getDemoTranscript(caseId));
  return apiRequest(`/investigations/${encodeURIComponent(caseId)}/chat`, {
    method: "GET", endpointKey: "getChatTranscript",
  });
}
