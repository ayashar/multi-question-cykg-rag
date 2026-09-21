import type { TurnRecord } from "@/api";

const CACHE_PREFIX = "kgcs_investigation_turn:";

export function cacheInvestigationTurn(turn: TurnRecord): void {
  if (typeof window === "undefined") return;

  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${turn.case_id}`, JSON.stringify(turn));
  } catch {
    // Navigation still works when storage is unavailable; the report route
    // can recover the turn from the transcript endpoint.
  }
}

export function getCachedInvestigationTurn(caseId: string): TurnRecord | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${caseId}`);
    return raw ? (JSON.parse(raw) as TurnRecord) : null;
  } catch {
    return null;
  }
}
