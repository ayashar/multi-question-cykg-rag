import { apiRequest, registerCasesLookback, type Case, type GetCasesParams } from "./client";

export async function getCases(params: GetCasesParams = {}): Promise<Case[]> {
  const hours = params.lookback_hours ?? 24;
  if (!Number.isFinite(hours) || hours <= 0) throw new RangeError("lookback_hours must be a positive finite number");
  const cases = await apiRequest<Case[]>("/cases", {
    method: "GET", endpointKey: "getCases", params: { lookback_hours: hours },
  });
  registerCasesLookback(cases, hours);
  return cases;
}
