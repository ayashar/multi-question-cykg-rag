import { apiRequest, type IngestionConfig } from "./client";
import { demoDelay, isDemoMode, setDemoIngestionConfig } from "@/demo/demo-data";

export function updateIngestionConfig(config: IngestionConfig): Promise<IngestionConfig> {
  if (isDemoMode()) return demoDelay(setDemoIngestionConfig(config));
  return apiRequest("/ingestion/config", { method: "PUT", endpointKey: "updateIngestionConfig", body: config });
}
