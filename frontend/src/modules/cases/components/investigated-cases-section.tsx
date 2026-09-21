"use client";

import { useState, useSyncExternalStore } from "react";
import { Case } from "../types";
import { getInvestigatedCases } from "../services/cases-service";
import CaseTable from "./case-table";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("kgcs-investigation-history-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("kgcs-investigation-history-change", callback);
  };
};
const getSnapshot = () => {
  try { return localStorage.getItem("kgcs_investigated_cases") || "[]"; }
  catch { return "[]"; }
};
const getServerSnapshot = () => "[]";

export default function InvestigatedCasesSection() {
  const historySnapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const history = historySnapshot === "[]" ? [] : getInvestigatedCases();
  const investigatedCases: Case[] = history.map((h) => h.case);
  const [page, setPage] = useState<number>(1);
  const itemsPerPage = 5;

  if (investigatedCases.length === 0) {
    return null;
  }

  const totalPages = Math.max(1, Math.ceil(investigatedCases.length / itemsPerPage));
  const paginatedCases = investigatedCases.slice((page - 1) * itemsPerPage, page * itemsPerPage);

  return (
    <section className="space-y-3 pt-6">
      <div>
        <h2 className="font-h5 text-neutral-1000 font-bold tracking-tight text-2xl sm:text-3xl">
          See again your investigated cases.
        </h2>
        <p className="font-b2 text-neutral-800 text-sm mt-0.5">
          Lists of cases that you had investigated.
        </p>
      </div>

      <div className="flex items-center justify-between text-sm font-medium text-neutral-900 pt-1">
        <span>{investigatedCases.length} cases</span>
      </div>

      <CaseTable
        actionLabel="View investigation"
        lookbacks={Object.fromEntries(history.map((record) => [record.case_id, record.lookback_hours]))}
        cases={paginatedCases}
        currentPage={page}
        totalPages={totalPages}
        onNextPage={() => setPage((p) => Math.min(p + 1, totalPages))}
        onPrevPage={() => setPage((p) => Math.max(p - 1, 1))}
      />
    </section>
  );
}
