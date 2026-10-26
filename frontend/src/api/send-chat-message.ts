import { apiRequest, type InvestigationProgressEvent, type SendChatMessageParams, type TurnRecord } from "./client";
import { runWithInvestigationEventStream } from "./investigation-events";
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

export function sendChatMessageStream(
  caseId: string,
  message: string,
  onEvent: (event: InvestigationProgressEvent) => void,
): Promise<TurnRecord> {
  if (isDemoMode()) return sendChatMessage(caseId, message);
  return runWithInvestigationEventStream(
    caseId,
    () => sendChatMessage(caseId, message),
    onEvent,
    () => sendChatMessage(caseId, message),
  );
}
