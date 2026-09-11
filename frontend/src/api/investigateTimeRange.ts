import { apiRequest, type TimeRangeRequest, type TurnRecord } from "./client";

export function investigateTimeRange(payload: TimeRangeRequest): Promise<TurnRecord> {
  return apiRequest("/investigations/time-range", {
    method: "POST", endpointKey: "investigateTimeRange", isInvestigation: true, body: payload,
  });
}
