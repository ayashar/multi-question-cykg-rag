import type { Case } from "@/api";
export type { Case } from "@/api";

export type LookbackPreset = "24h" | "7d" | "30d" | "all";

export const LOOKBACK_HOURS_MAP: Record<LookbackPreset, number> = {
  "24h": 24,
  "7d": 168,
  "30d": 720,
  "all": 24,
};

export function formatCaseTimeSpan(firstSeen: string, lastSeen: string): string {
  const format = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? value
      : new Intl.DateTimeFormat("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "UTC",
        }).format(date);
  };
  return `${format(firstSeen)} to ${format(lastSeen)} UTC`;
}

export interface InvestigatedCaseRecord {
  case_id: string;
  investigated_at: string;
  case: Case;
}
