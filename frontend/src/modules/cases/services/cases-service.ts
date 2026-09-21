import { type Case, type InvestigatedCaseRecord, type LookbackPreset, LOOKBACK_HOURS_MAP } from "../types";
import { MOCK_CASES } from "../data/cases-fixture";
import { getCases as fetchCases, getIngestionStatus, registerCasesLookback, getCaseLookback } from "@/api";

const INVESTIGATED_CASES_STORAGE_KEY = "kgcs_investigated_cases";

/**
 * Stores the lookback_hours used when each case_id first surfaced.
 * Shared with investigation and attack-graph requests.
 */
export { registerCasesLookback as persistLookbackForCases } from "@/api";

export { getCaseLookback as getLookbackForCase } from "@/api";

export function getInvestigatedCases(): InvestigatedCaseRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(INVESTIGATED_CASES_STORAGE_KEY) || "[]";
    const records: unknown = JSON.parse(raw);
    return Array.isArray(records) ? records.filter((record) => record?.case_id && record?.case?.case_id === record.case_id) : [];
  } catch {
    return [];
  }
}

export function recordInvestigatedCase(
  c: Case,
  lookbackHours = getCaseLookback(c.case_id),
  source: InvestigatedCaseRecord["source"] = "case-list",
): void {
  if (typeof window === "undefined") return;
  try {
    const current = getInvestigatedCases().filter((item) => item.case_id !== c.case_id);
    const updated: InvestigatedCaseRecord[] = [
      {
        case_id: c.case_id,
        investigated_at: new Date().toISOString(),
        case: c,
        lookback_hours: lookbackHours,
        source,
      },
      ...current,
    ];
    localStorage.setItem(INVESTIGATED_CASES_STORAGE_KEY, JSON.stringify(updated.slice(0, 20)));
    window.dispatchEvent(new Event("kgcs-investigation-history-change"));
  } catch (err) {
    console.warn("Failed to record investigated case:", err);
  }
}

export function isManualInvestigatedCase(caseId: string): boolean {
  return getInvestigatedCases().some(
    (record) => record.case_id === caseId && record.source === "manual-time-range",
  );
}

export function hoursCoveringTimestamp(timestamp: string, now = Date.now()): number {
  const earliest = Date.parse(timestamp);
  if (Number.isNaN(earliest)) throw new Error("Ingestion status returned an invalid earliest timestamp.");
  return Math.max(24, Math.ceil((now - earliest) / 3_600_000) + 1);
}

export async function resolveLookbackHours(preset: LookbackPreset): Promise<number> {
  if (preset !== "all") return LOOKBACK_HOURS_MAP[preset];

  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") {
    const earliest = MOCK_CASES.reduce(
      (value, item) => item.first_seen < value ? item.first_seen : value,
      MOCK_CASES[0]?.first_seen ?? new Date().toISOString(),
    );
    return hoursCoveringTimestamp(earliest);
  }

  const status = await getIngestionStatus();
  if (status.alert_count === 0) return 24;
  if (!status.earliest_alert_timestamp) throw new Error("Ingestion status did not include the earliest alert timestamp.");
  return hoursCoveringTimestamp(status.earliest_alert_timestamp);
}

export async function getCases(lookbackHours: number): Promise<Case[]> {
  const forceMock = process.env.NEXT_PUBLIC_USE_MOCK === "true";

  if (forceMock) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    let result = MOCK_CASES;
    if (lookbackHours <= 24) {
      result = MOCK_CASES.slice(0, 8);
    } else if (lookbackHours <= 168) {
      result = MOCK_CASES.slice(0, 18);
    }
    registerCasesLookback(result, lookbackHours);
    return result;
  }

  return fetchCases({ lookback_hours: lookbackHours });
}
