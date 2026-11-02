"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { type Case, type LookbackPreset } from "../types";
import { getInvestigations, type InvestigationSummary } from "@/api";
import {
  excludeInvestigatedCases,
  getCases,
  INVESTIGATED_CASES_STORAGE_KEY,
  parseInvestigatedCases,
  recordInvestigatedCase,
  resolveLookbackHours,
} from "../services/cases-service";
import { listInvestigations } from "@/api";

const PRESET_KEY = "cskg_active_lookback_preset";
const HOURS_KEY = "cskg_active_lookback_hours";
const PRESET_EVENT = "cskg-lookback-change";
const validPresets = new Set<LookbackPreset>(["24h", "7d", "30d", "all"]);

const subscribeHistory = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("cskg-investigation-history-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("cskg-investigation-history-change", callback);
  };
};

const getHistorySnapshot = () => {
  try { return localStorage.getItem(INVESTIGATED_CASES_STORAGE_KEY) ?? "[]"; }
  catch { return "[]"; }
};

const subscribePreset = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener(PRESET_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(PRESET_EVENT, callback);
  };
};

const getPresetSnapshot = (): LookbackPreset => {
  try {
    const stored = sessionStorage.getItem(PRESET_KEY) as LookbackPreset | null;
    return stored && validPresets.has(stored) ? stored : "24h";
  } catch {
    return "24h";
  }
};

export function useCases(initialPreset: LookbackPreset = "24h", itemsPerPage: number = 5) {
  const storedPreset = useSyncExternalStore(subscribePreset, getPresetSnapshot, () => initialPreset);
  const storedHistory = useSyncExternalStore(subscribeHistory, getHistorySnapshot, () => "[]");
  const preset = storedPreset;
  const [fetchedCases, setFetchedCases] = useState<Case[]>([]);
  const [serverInvestigations, setServerInvestigations] = useState<InvestigationSummary[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [page, setPage] = useState<number>(1);
  const latestRequest = useRef(0);

  const setPreset = useCallback((next: LookbackPreset) => {
    try { sessionStorage.setItem(PRESET_KEY, next); } catch { /* Persistence is optional. */ }
    window.dispatchEvent(new Event(PRESET_EVENT));
  }, []);

  const fetchCaseList = useCallback(
    async (selectedPreset: LookbackPreset, isManualRefresh = false) => {
      const request = ++latestRequest.current;
      if (isManualRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      try {
        const hours = await resolveLookbackHours(selectedPreset);
        try { sessionStorage.setItem(HOURS_KEY, String(hours)); } catch { /* Persistence is optional. */ }
        const [data, investigations] = await Promise.all([
          getCases(hours),
          getInvestigations().catch(() => []),
        ]);
        if (request !== latestRequest.current) return;
        // Investigations live on the backend too; browser history alone misses
        // cases investigated in another browser/session or evicted from storage.
        try {
          const done = new Set((await listInvestigations()).filter((s) => s.turn_count > 0).map((s) => s.case_id));
          const known = new Set(parseInvestigatedCases(getHistorySnapshot()).map((r) => r.case_id));
          data.filter((c) => done.has(c.case_id) && !known.has(c.case_id))
            .forEach((c) => recordInvestigatedCase(c, hours));
        } catch { /* Backend history is best-effort. */ }
        if (request !== latestRequest.current) return;
        setFetchedCases(data);
        setServerInvestigations(investigations);
        setPage(1);
      } catch (err: unknown) {
        if (request !== latestRequest.current) return;
        setError(err instanceof Error ? err : new Error("Failed to load cases"));
      } finally {
        if (request === latestRequest.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    // Fetching is the external synchronization; the helper owns its UI lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchCaseList(preset);
  }, [fetchCaseList, preset]);

  const cases = useMemo(() => {
    const localHistory = parseInvestigatedCases(storedHistory);
    const completedServerHistory = serverInvestigations.filter(
      (summary) => summary.turn_count > 0 && summary.last_answer_preview != null,
    );
    return excludeInvestigatedCases(fetchedCases, [...localHistory, ...completedServerHistory]);
  }, [fetchedCases, serverInvestigations, storedHistory]);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(cases.length / itemsPerPage));
  }, [cases.length, itemsPerPage]);

  const currentPage = Math.min(page, totalPages);

  const paginatedCases = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return cases.slice(startIndex, startIndex + itemsPerPage);
  }, [cases, currentPage, itemsPerPage]);

  const handleNextPage = () => {
    setPage((prev) => Math.min(prev + 1, totalPages));
  };

  const handlePrevPage = () => {
    setPage((prev) => Math.max(prev - 1, 1));
  };

  return {
    cases,
    paginatedCases,
    preset,
    setPreset,
    isLoading,
    isRefreshing,
    error,
    page: currentPage,
    totalPages,
    totalCount: cases.length,
    setPage,
    handleNextPage,
    handlePrevPage,
    refresh: () => fetchCaseList(preset, true),
  };
}
