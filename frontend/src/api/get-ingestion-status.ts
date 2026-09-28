import { apiRequest, type IngestionStatus } from "./client";
import { demoDelay, getDemoIngestionStatus, isDemoMode } from "@/demo/demo-data";

export function getIngestionStatus(): Promise<IngestionStatus> {
  if (isDemoMode()) return demoDelay(getDemoIngestionStatus());
  return apiRequest("/ingestion/status", { method: "GET", endpointKey: "getIngestionStatus" });
}
