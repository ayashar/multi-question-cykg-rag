import { apiRequest, type TurnRecord } from "./client";

export function getChatTranscript(caseId: string): Promise<TurnRecord[]> {
  return apiRequest(`/investigations/${encodeURIComponent(caseId)}/chat`, {
    method: "GET", endpointKey: "getChatTranscript",
  });
}
