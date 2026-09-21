import { apiRequest, type IngestionStatus } from "./client";

export function getIngestionStatus(): Promise<IngestionStatus> {
  return apiRequest("/ingestion/status", { method: "GET", endpointKey: "getIngestionStatus" });
}
