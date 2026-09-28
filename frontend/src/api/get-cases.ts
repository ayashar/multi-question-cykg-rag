import { apiRequest, registerCasesLookback, type Case, type GetCasesParams } from "./client";
import { demoDelay, isDemoMode } from "@/demo/demo-data";
import { MOCK_CASES } from "@/modules/cases/data/cases-fixture";

export async function getCases(params: GetCasesParams = {}): Promise<Case[]> {
  const hours = params.lookback_hours ?? 24;
  if (!Number.isFinite(hours) || hours <= 0) throw new RangeError("lookback_hours must be a positive finite number");
  if (isDemoMode()) {
    const cases = hours <= 24 ? MOCK_CASES.slice(0, 8) : hours <= 168 ? MOCK_CASES.slice(0, 18) : MOCK_CASES;
    registerCasesLookback(cases, hours);
    return demoDelay(cases);
  }
  const cases = await apiRequest<Case[]>("/cases", {
    method: "GET", endpointKey: "getCases", params: { lookback_hours: hours },
  });
  registerCasesLookback(cases, hours);
  return cases;
}
