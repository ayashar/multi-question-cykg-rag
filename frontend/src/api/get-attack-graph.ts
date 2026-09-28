import { apiRequest, resolveCaseLookback, type GetAttackGraphParams, type CaseAttackGraph } from "./client";
import { createDemoAttackGraph, demoDelay, getDemoCase, isDemoMode } from "@/demo/demo-data";

export async function getAttackGraph(input: string | GetAttackGraphParams, explicitLookback?: number): Promise<CaseAttackGraph> {
  const caseId = typeof input === "string" ? input : input.case_id;
  if (isDemoMode()) return demoDelay(createDemoAttackGraph(getDemoCase(caseId)));
  const hours = resolveCaseLookback(caseId, typeof input === "string" ? explicitLookback : input.lookback_hours ?? explicitLookback);
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/attack-graph`, {
    method: "GET", endpointKey: "getAttackGraph", params: { lookback_hours: hours },
  });
}
