import { apiRequest, type TimeRangeRequest, type TurnRecord } from "./client";
import { createDemoTimeRangeInvestigation, demoDelay, isDemoMode } from "@/demo/demo-data";

export function investigateTimeRange(payload: TimeRangeRequest): Promise<TurnRecord> {
  if (isDemoMode()) return demoDelay(createDemoTimeRangeInvestigation(payload), 900);
  return apiRequest("/investigations/time-range", {
    method: "POST", endpointKey: "investigateTimeRange", isInvestigation: true, body: payload,
  });
}
