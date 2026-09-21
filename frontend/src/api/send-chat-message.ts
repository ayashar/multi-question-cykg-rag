import { apiRequest, type SendChatMessageParams, type TurnRecord } from "./client";

export function sendChatMessage(input: string | SendChatMessageParams, message?: string): Promise<TurnRecord> {
  const caseId = typeof input === "string" ? input : input.case_id;
  return apiRequest(`/investigations/${encodeURIComponent(caseId)}/chat`, {
    method: "POST", endpointKey: "sendChatMessage", isInvestigation: true, caseId,
    body: { message: typeof input === "string" ? message ?? "" : input.message },
  });
}
