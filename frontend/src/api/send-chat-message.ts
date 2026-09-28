import { apiRequest, type SendChatMessageParams, type TurnRecord } from "./client";
import { createDemoChatTurn, demoDelay, isDemoMode } from "@/demo/demo-data";

export function sendChatMessage(input: string | SendChatMessageParams, message?: string): Promise<TurnRecord> {
  const caseId = typeof input === "string" ? input : input.case_id;
  const chatMessage = typeof input === "string" ? message ?? "" : input.message;
  if (isDemoMode()) return demoDelay(createDemoChatTurn(caseId, chatMessage), 800);
  return apiRequest(`/investigations/${encodeURIComponent(caseId)}/chat`, {
    method: "POST", endpointKey: "sendChatMessage", isInvestigation: true, caseId,
    body: { message: chatMessage },
  });
}
