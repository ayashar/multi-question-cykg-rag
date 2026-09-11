import { apiRequest, type IngestionConfig } from "./client";

export function getIngestionConfig(): Promise<IngestionConfig> {
  return apiRequest("/ingestion/config", { method: "GET", endpointKey: "getIngestionConfig" });
}
