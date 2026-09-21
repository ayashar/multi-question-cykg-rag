"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getChatTranscript, type TurnRecord } from "@/api";
import { ApiErrorView } from "@/components/ui/error-states";
import { InvestigationReportSkeleton } from "@/components/ui/loading";
import { getCachedInvestigationTurn } from "../services/investigationResultCache";
import ReportView from "./ReportView";

export default function InvestigationReportScreen({ caseId }: { caseId: string }) {
  const [turn, setTurn] = useState<TurnRecord | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadReport = useCallback(async () => {
    setError(null);
    setIsLoading(true);

    const cached = getCachedInvestigationTurn(caseId);
    if (cached) {
      setTurn(cached);
      setIsLoading(false);
      return;
    }

    try {
      const transcript = await getChatTranscript(caseId);
      if (transcript.length === 0) {
        throw new Error("This investigation does not have a report yet.");
      }
      setTurn(transcript[0]);
    } catch (loadError) {
      setError(loadError);
    } finally {
      setIsLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadReport(), 0);
    return () => window.clearTimeout(timer);
  }, [loadReport]);

  return (
    <div className="w-full space-y-5 pb-16">
      <Link href="/cases" className="inline-flex items-center gap-1.5 font-b2 font-semibold text-neutral-700 hover:text-primary-800">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to cases
      </Link>

      {isLoading && <InvestigationReportSkeleton />}
      {!isLoading && error !== null && <ApiErrorView error={error} onRetry={() => void loadReport()} className="mx-0" />}
      {!isLoading && error === null && turn && <ReportView turn={turn} />}
    </div>
  );
}
