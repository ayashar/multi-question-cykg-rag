"use client";

import { RotateCw } from "lucide-react";
import { ApiErrorView } from "@/components/ui/error-states";
import { useCases } from "@/modules/cases/hooks/useCases";
import LookbackSelector from "@/modules/cases/components/LookbackSelector";
import CaseTable from "@/modules/cases/components/CaseTable";
import CaseListEmptyState from "@/modules/cases/components/CaseListEmptyState";
import CaseListSkeleton from "@/modules/cases/components/CaseListSkeleton";
import InvestigatedCasesSection from "@/modules/cases/components/InvestigatedCasesSection";
import { Button } from "@/components/ui/button";

export default function CasesPage() {
  const {
    cases,
    paginatedCases,
    preset,
    setPreset,
    isLoading,
    isRefreshing,
    error,
    page,
    totalPages,
    totalCount,
    handleNextPage,
    handlePrevPage,
    refresh,
  } = useCases("24h", 5);

  return (
    <div className="w-full space-y-10 pb-16">
      {/* Section 1: Active Cases to Investigate */}
      <section className="space-y-3">
        {/* Title and Preset Buttons */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <h1 className="font-h4 text-neutral-1000 font-bold tracking-tight text-3xl sm:text-4xl">
              Investigate what needs attention.
            </h1>
            <p className="font-b2 text-neutral-800 text-sm mt-1">
              Cases are ranked by urgency score from the investigation API.
            </p>
          </div>

          {/* Lookback Preset Selector */}
          <div className="shrink-0 sm:pt-1">
            <LookbackSelector
              activePreset={preset}
              onSelectPreset={setPreset}
              disabled={isLoading || isRefreshing}
            />
          </div>
        </div>

        {/* Counter and Refresh Bar */}
        <div className="flex items-center justify-between text-sm font-medium text-neutral-900 pt-1">
          <span>{isLoading ? "Loading..." : `${totalCount} cases`}</span>

          <Button
            type="button"
            variant="purple"
            onClick={refresh}
            disabled={isLoading || isRefreshing}
            className="bg-transparent hover:bg-neutral-200/60 text-neutral-900 gap-1.5 p-1 px-2 h-auto text-sm font-medium shadow-none"
          >
            <RotateCw
              className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin text-primary-800" : ""}`}
            />
            <span>Refresh</span>
          </Button>
        </div>

        {/* Main Table / Loading / Empty States */}
        {isLoading && <CaseListSkeleton rowCount={5} />}

        {!isLoading && error && (
          <ApiErrorView error={error} onRetry={refresh} />
        )}

        {!isLoading && !error && cases.length === 0 && (
          <CaseListEmptyState
            currentPreset={preset}
            onExpandLookback={() => setPreset("all")}
          />
        )}

        {!isLoading && !error && cases.length > 0 && (
          <CaseTable
            cases={paginatedCases}
            currentPage={page}
            totalPages={totalPages}
            onNextPage={handleNextPage}
            onPrevPage={handlePrevPage}
          />
        )}
      </section>

      {/* Section 2: Past Investigated Cases */}
      {!isLoading && (
        <InvestigatedCasesSection />
      )}
    </div>
  );
}
