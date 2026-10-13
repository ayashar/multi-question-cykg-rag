import { apiRequest, type InvestigationTrace } from "./client";

export function getTurnTrace(caseId: string, turnIndex: number): Promise<InvestigationTrace> {
  if (!Number.isInteger(turnIndex) || turnIndex < 1) {
    return Promise.reject(new RangeError("turn_index must be a positive integer"));
  }
  return apiRequest(`/investigations/${encodeURIComponent(caseId)}/turns/${turnIndex}/trace`, {
    method: "GET",
    endpointKey: "getTurnTrace",
  });
}
