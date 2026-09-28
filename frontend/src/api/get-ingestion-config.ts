import { apiRequest, type IngestionConfig } from "./client";
import { demoDelay, getDemoIngestionConfig, isDemoMode } from "@/demo/demo-data";

export function getIngestionConfig(): Promise<IngestionConfig> {
  if (isDemoMode()) return demoDelay(getDemoIngestionConfig());
  return apiRequest("/ingestion/config", { method: "GET", endpointKey: "getIngestionConfig" });
}
