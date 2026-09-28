"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowUpRight, FileText, GitMerge, LayoutGrid, LoaderCircle } from "lucide-react";
import { ApiClientError, resolveCaseLookback, type Case, type InvestigationProgressEvent, type TurnRecord } from "@/api";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApiErrorView, CaseNotFoundError, TurnResult } from "@/components/ui/error-states";
import { InvestigationLoader, InvestigationLog } from "@/components/ui/investigation-loader";
import { isManualInvestigatedCase, recordInvestigatedCase } from "@/modules/cases/services/cases-service";
import { cn } from "@/lib/utils";
import {
  getInvestigationHref,
  getPreparedTimeRangeInvestigation,
  loadInvestigationCase,
  rerunPreparedTimeRangeInvestigation,
  runCaseInvestigation,
} from "../services/investigation-service";
import CaseDetails from "./case-details";
import InvestigationReport from "./investigation-report";
import AttackGraphPreview from "./attack-graph-preview";
import InvestigationChatroom from "./investigation-chatroom";

type View = "details" | "report" | "graph" | "chat";
const views = [
  { id: "details", label: "Details", icon: LayoutGrid },
  { id: "report", label: "Report", icon: FileText },
  { id: "graph", label: "Attack Graph", icon: GitMerge },
  { id: "chat", label: "Chatbot", icon: MessageSquare },
] as const;

export default function CaseInvestigation({
  caseId,
  lookbackHours,
  initialView = "details",
  reopenSaved = false,
  chatUnavailable = false,
}: {
  caseId: string;
  lookbackHours?: number;
  initialView?: View;
  reopenSaved?: boolean;
  chatUnavailable?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState<Case | null>(null);
  const [turn, setTurn] = useState<TurnRecord | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(!reopenSaved && !chatUnavailable);
  const [startTime, setStartTime] = useState<number>();
  const [attempt, setAttempt] = useState(0);
  const [progressEvents, setProgressEvents] = useState<InvestigationProgressEvent[]>([]);
  const [view, setView] = useState<View>("details");
  const [isManualTimeRange, setIsManualTimeRange] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef<Partial<Record<View, number>>>({});

  useEffect(() => {
    let cancelled = false;
    async function investigate() {
      if (chatUnavailable) {
        setIsLoading(false);
        return;
      }

      try {
        if (reopenSaved && attempt === 0) {
          const saved = getInvestigatedCase(caseId);
          if (saved?.turn?.case_id === caseId && saved.turn.error === null) {
            setValue(saved.case);
            setTurn(saved.turn);
            setIsManualTimeRange(saved.source === "manual-time-range");
            setIsLoading(false);
            return;
          }
        }

        setIsLoading(true);
        const prepared = getPreparedTimeRangeInvestigation(caseId);
        if (!prepared && isManualInvestigatedCase(caseId)) {
          throw new Error("The saved manual investigation is incomplete. Start it again from Time Span Case.");
        }
        const selected = prepared?.value ?? await loadInvestigationCase(caseId, lookbackHours);
        if (cancelled) return;
        setValue(selected);
        setIsManualTimeRange(Boolean(prepared));
        if (prepared) setView("report");
        setStartTime(Date.now());
        const result = prepared
          ? attempt === 0
            ? prepared.turn
            : (await rerunPreparedTimeRangeInvestigation(caseId)).turn
          : await runCaseInvestigation(selected, lookbackHours, (event) => {
              if (!cancelled) setProgressEvents((current) => [...current, event]);
            });
        if (cancelled) return;
        if (result.case_id !== caseId) throw new Error("The returned investigation belongs to a different case.");
        setTurn(result);
        if (result.error === null) {
          recordInvestigatedCase(
            selected,
            prepared ? undefined : resolveCaseLookback(caseId, lookbackHours) ?? 336,
            prepared ? "manual-time-range" : "case-list",
            result,
          );
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason : new Error("Could not investigate this case."));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void investigate();
    return () => { cancelled = true; };
  }, [caseId, lookbackHours, attempt, reopenSaved, chatUnavailable]);

  useEffect(() => {
    if (!value || !turn || turn.error !== null || turn.case_id !== value.case_id) return;
    if (getInvestigatedCase(caseId)?.turn?.timestamp === turn.timestamp) return;
    recordInvestigatedCase(
      value,
      isManualTimeRange ? undefined : resolveCaseLookback(caseId, lookbackHours) ?? 336,
      isManualTimeRange ? "manual-time-range" : "case-list",
      turn,
    );
  }, [caseId, isManualTimeRange, lookbackHours, turn, value]);

  const retry = () => {
    setTurn(null);
    setError(null);
    setView(initialView);
    setStartTime(Date.now());
    setProgressEvents([]);
    setIsLoading(true);
    setAttempt((previous) => previous + 1);
  };
  const showView = (next: View) => {
    const currentPosition = window.scrollY;
    scrollPositions.current[view] = currentPosition;
    const nextPosition = scrollPositions.current[next] ?? currentPosition;
    setView(next);
    requestAnimationFrame(() => {
      content.current?.focus({ preventScroll: true });
      window.scrollTo(0, nextPosition);
    });
  };
  const ready = !isLoading && !error && value !== null && turn?.error === null;

  return (
    <div className="w-full space-y-5 pb-12 text-primary-1000">
      {view === "graph" ? (
        <Button
          type="button"
          aria-label="Back to case details"
          onClick={() => showView("details")}
          className="bg-primary-600 font-b2 text-white hover:bg-primary-700"
        >
          <ArrowLeft aria-hidden="true" className="size-5" />Back
        </Button>
      ) : (
        <Link href="/cases" className={cn(buttonVariants(), "bg-primary-600 font-b2 text-white hover:bg-primary-700")}>
          <ArrowLeft aria-hidden="true" className="size-5" />Back
        </Link>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="font-b1">INVESTIGATION</p>
          <h1 className="font-h4 text-2xl sm:text-[34px] wrap-anywhere">{caseId}</h1>
          {isManualTimeRange && <p className="font-b3 text-primary-700">Manual time-range investigation</p>}
          {process.env.NEXT_PUBLIC_USE_MOCK === "true" && <p className="font-b3 text-primary-700">Demo mode · sample data</p>}
        </div>
        {(ready || chatUnavailable) && <nav aria-label="Investigation views" className="flex flex-wrap gap-2 sm:gap-3">
          {views.map(({ id, label, icon: Icon }) => {
            const graphUnavailable = isManualTimeRange && id === "graph";
            const unavailableBeforeInvestigation = chatUnavailable && id !== "chat";
            return (
              <Button
                key={id}
                type="button"
                aria-pressed={view === id}
                onClick={() => showView(id)}
                disabled={graphUnavailable || unavailableBeforeInvestigation}
                title={graphUnavailable ? "Attack graph is unavailable for manual time-range investigations." : undefined}
                variant={view === id ? "primary" : "secondary"}
                className={cn(
                  "font-b2 disabled:cursor-not-allowed disabled:opacity-55",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />{label}
              </Button>
            );
          })}
        </nav>}
      </div>

      {isLoading && <section aria-label="Investigation in progress" className="space-y-5">
        <p className="font-b1">Investigation can take several seconds. Your case stays visible while the result is prepared.</p>
        <InvestigationLoader key={attempt} caseId={caseId} events={progressEvents} startTime={startTime} />
        <Button type="button" disabled className="bg-neutral-200 font-b2 text-neutral-800">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />Preparing report…
        </Button>
      </section>}

      {!isLoading && error && (
        error instanceof ApiClientError && error.status === 404
          ? <CaseNotFoundError caseId={caseId} lookbackHours={lookbackHours} errorDetail={error.detail}
              onBackToCases={() => router.push("/cases")}
              onRetryWithLookback={(hours) => router.replace(getInvestigationHref(caseId, hours))} />
          : <ApiErrorView error={error} onRetry={retry} />
      )}

      <div ref={content} tabIndex={-1} className="space-y-5 outline-none" aria-label={`${views.find((item) => item.id === view)?.label} content`}>
        {!isLoading && view === "details" && value && <CaseDetails value={value} manualTimeRange={isManualTimeRange} />}
        {!isLoading && turn && value && <TurnResult turn={turn} onRetry={retry}>
          {view === "report" && <InvestigationReport value={value} turn={turn} />}
          {view === "details" && <div className="grid items-start gap-3 lg:grid-cols-2">
            <section className="space-y-4 rounded-[10px] bg-primary-100 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-h6">Investigation findings</h2>
                <Button type="button" onClick={() => showView("report")} className="bg-primary-600 text-white hover:bg-primary-700">View report<ArrowUpRight aria-hidden="true" className="size-4" /></Button>
              </div>
              <div className="space-y-2 rounded-[4px] border-l-3 border-green-500 bg-green-400 p-4 text-white">
                <h3 className="font-b1 font-medium">AI Summary</h3>
                <p className="font-b2 whitespace-pre-wrap line-clamp-6 wrap-anywhere">{turn.answer || "The investigation returned no narrative. Open the report to review available findings."}</p>
              </div>
              <dl className="flex flex-wrap gap-x-8 gap-y-3 font-b2">
                <div><dt>Priority</dt><dd className="font-semibold capitalize">{turn.recommended_priority ?? "Not provided"}</dd></div>
                <div><dt>Confidence</dt><dd className="font-semibold capitalize">{turn.confidence ?? "Not provided"}</dd></div>
              </dl>
            </section>
            <section className="space-y-4 rounded-[10px] bg-primary-100 p-5">
              <div className="flex items-center justify-between gap-3"><h2 className="font-h6">Attack Graph</h2>
                <Button type="button" disabled={isManualTimeRange} onClick={() => showView("graph")} className="bg-primary-600 text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-55">See more<ArrowUpRight aria-hidden="true" className="size-4" /></Button>
              </div>
              <div className="rounded-[4px] bg-background p-3"><AttackGraphPreview caseId={caseId} lookbackHours={lookbackHours} manualTimeRange={isManualTimeRange} /></div>
            </section>
          </div>}
          {view === "graph" && <section aria-labelledby="attack-graph-title" className="space-y-5">
            <div>
              <h2 id="attack-graph-title" className="font-h6">Attack Graph</h2>
              <p className="font-b2">Explore the reconstructed evidence by zooming and moving around the canvas.</p>
            </div>
            <AttackGraphPreview caseId={caseId} lookbackHours={lookbackHours} manualTimeRange={isManualTimeRange} expanded />
          </section>}
          <div className={view === "chat" ? undefined : "hidden"}>
            <InvestigationChatroom caseId={caseId} value={value} initialTurns={[turn]} />
          </div>
        </TurnResult>}
        {!isLoading && view === "details" && <InvestigationLog events={progressEvents} />}
      </div>
    </div>
  );
}
