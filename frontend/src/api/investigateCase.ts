import { apiRequest, resolveCaseLookback, type InvestigateCaseParams, type TurnRecord } from "./client";

export async function investigateCase(input: string | InvestigateCaseParams, explicitLookback?: number): Promise<TurnRecord> {
  const caseId = typeof input === "string" ? input : input.case_id;
  const hours = resolveCaseLookback(caseId, typeof input === "string" ? explicitLookback : input.lookback_hours ?? explicitLookback);
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/investigate`, {
    method: "POST", endpointKey: "investigateCase", isInvestigation: true, caseId,
    params: { lookback_hours: hours },
  });
}
