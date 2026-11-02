import { apiRequest, type InvestigationSummary } from "./client";
import { demoDelay, isDemoMode } from "@/demo/demo-data";

export function getInvestigations(): Promise<InvestigationSummary[]> {
  if (isDemoMode()) return demoDelay([]);
  return apiRequest("/investigations", {
    method: "GET",
    endpointKey: "getInvestigations",
  });
}
