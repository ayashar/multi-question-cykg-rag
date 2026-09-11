"use client";

import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { type Case, type LookbackPreset } from "../types";
import { getCases, resolveLookbackHours } from "../services/casesService";

const PRESET_KEY = "kgcs_active_lookback_preset";
const HOURS_KEY = "kgcs_active_lookback_hours";
const PRESET_EVENT = "kgcs-lookback-change";
const validPresets = new Set<LookbackPreset>(["24h", "7d", "30d", "all"]);

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
  const preset = storedPreset;
  const [cases, setCases] = useState<Case[]>([]);
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
        const data = await getCases(hours);
        if (request !== latestRequest.current) return;
        setCases(data);
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

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(cases.length / itemsPerPage));
  }, [cases.length, itemsPerPage]);

  const paginatedCases = useMemo(() => {
    const startIndex = (page - 1) * itemsPerPage;
    return cases.slice(startIndex, startIndex + itemsPerPage);
  }, [cases, page, itemsPerPage]);

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
    page,
    totalPages,
    totalCount: cases.length,
    setPage,
    handleNextPage,
    handlePrevPage,
    refresh: () => fetchCaseList(preset, true),
  };
}
