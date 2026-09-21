import { apiRequest, type IngestionConfig } from "./client";

export function updateIngestionConfig(config: IngestionConfig): Promise<IngestionConfig> {
  return apiRequest("/ingestion/config", { method: "PUT", endpointKey: "updateIngestionConfig", body: config });
}
