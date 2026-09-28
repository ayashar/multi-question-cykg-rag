"use client";

import { useState, useSyncExternalStore } from "react";
import { History } from "lucide-react";
import CaseTable from "@/modules/cases/components/case-table";
import { MOCK_CASES } from "@/modules/cases/data/cases-fixture";
import { getInvestigatedCases } from "@/modules/cases/services/cases-service";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("kgcs-investigation-history-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("kgcs-investigation-history-change", callback);
  };
};
const getSnapshot = () => localStorage.getItem("kgcs_investigated_cases") || "[]";
const getServerSnapshot = () => "[]";

export default function PastInvestigationPage() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const records = snapshot === "[]" ? [] : getInvestigatedCases();
  const demoFallback = records.length === 0 && process.env.NEXT_PUBLIC_USE_MOCK === "true";
  const cases = demoFallback ? MOCK_CASES.slice(0, 5) : records.map((record) => record.case);
  const lookbacks = Object.fromEntries(records.map((record) => [record.case_id, record.lookback_hours]));
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(cases.length / 5));
  const visibleCases = cases.slice((page - 1) * 5, page * 5);

  return (
    <section className="w-full space-y-6 pb-16">
      <div>
        <p className="font-b3 font-semibold uppercase tracking-wider text-neutral-700">History</p>
        <h1 className="mt-1 font-h4 font-bold tracking-tight text-neutral-1000">Past investigations.</h1>
        <p className="font-b2 text-neutral-800">Reopen cases that were previously reviewed in this browser.</p>
      </div>
      {demoFallback && <div className="rounded-[3px] border border-primary-300 bg-primary-100/50 px-4 py-3 font-b2 text-primary-900">Demo mode · sample history is shown until you investigate a case yourself.</div>}
      {cases.length > 0 ? <CaseTable
        actionLabel="View investigation"
        lookbacks={lookbacks}
        cases={visibleCases}
        currentPage={page}
        totalPages={totalPages}
        onNextPage={() => setPage((value) => Math.min(totalPages, value + 1))}
        onPrevPage={() => setPage((value) => Math.max(1, value - 1))}
      /> : <div className="rounded-[8px] border border-dashed border-neutral-400 p-10 text-center"><History className="mx-auto size-8 text-neutral-600" aria-hidden="true" /><p className="mt-3 font-h7 font-semibold">No investigation history yet</p><p className="font-b2 text-neutral-800">Investigated cases will appear here.</p></div>}
    </section>
  );
}
