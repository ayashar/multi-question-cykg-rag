import { apiRequest, resolveCaseLookback, type InvestigateCaseParams, type TurnRecord } from "./client";
import { createDemoInvestigation, demoDelay, getDemoCase, isDemoMode } from "@/demo/demo-data";

export async function investigateCase(input: string | InvestigateCaseParams, explicitLookback?: number): Promise<TurnRecord> {
  const caseId = typeof input === "string" ? input : input.case_id;
  if (isDemoMode()) return demoDelay(createDemoInvestigation(getDemoCase(caseId)), 900);
  const hours = resolveCaseLookback(caseId, typeof input === "string" ? explicitLookback : input.lookback_hours ?? explicitLookback);
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/investigate`, {
    method: "POST", endpointKey: "investigateCase", isInvestigation: true, caseId,
    params: { lookback_hours: hours },
  });
}
