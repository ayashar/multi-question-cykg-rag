import { apiRequest, type Case, type TimeRangeRequest, type TurnRecord } from "./client";
import { createDemoTimeRangeInvestigation, demoDelay, isDemoMode } from "@/demo/demo-data";

export function resolveTimeRange(payload: TimeRangeRequest): Promise<Case> {
  return apiRequest("/investigations/time-range/resolve", {
    method: "GET", endpointKey: "resolveTimeRange", params: payload,
  });
}

export function investigateTimeRange(payload: TimeRangeRequest): Promise<TurnRecord> {
  if (isDemoMode()) return demoDelay(createDemoTimeRangeInvestigation(payload), 900);
  return apiRequest("/investigations/time-range", {
    method: "POST", endpointKey: "investigateTimeRange", isInvestigation: true, body: payload,
  });
}
