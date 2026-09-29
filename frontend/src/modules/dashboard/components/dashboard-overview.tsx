"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCases } from "@/modules/cases/hooks/use-cases";
import { getInvestigatedCases } from "@/modules/cases/services/cases-service";
import { MOCK_CASES } from "@/modules/cases/data/cases-fixture";
import { getUrgencyStripeColor } from "@/modules/cases/components/urgency-indicator";
import type { Case, InvestigatedCaseRecord } from "@/modules/cases/types";
import {
  getInvestigationHref,
  getPastInvestigationHref,
  rememberInvestigationCase,
  rememberTimeRangeInvestigation,
  runTimeRangeInvestigation,
} from "@/modules/investigation/services/investigation-service";
import { validateTimeRange } from "@/modules/investigation/services/time-range-validation";

const historySubscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("kgcs-investigation-history-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("kgcs-investigation-history-change", callback);
  };
};

const historySnapshot = () => {
  try {
    return localStorage.getItem("kgcs_investigated_cases") ?? "[]";
  } catch {
    return "[]";
  }
};

function displayHost(value: Case): { primary: string; secondary: string } {
  const primary = value.hosts[0] ?? value.dst_users[0] ?? "Unknown host";
  const secondary = value.hosts[1] ?? value.src_ips[0] ?? "No secondary entity";
  return { primary, secondary };
}

function DashboardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[3px] bg-primary-600 px-4 text-sm text-white transition hover:bg-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-800"
    >
      {children}
      <ArrowUpRight className="size-4" aria-hidden="true" />
    </Link>
  );
}

function PastInvestigationRows({ records, fallback }: { records: InvestigatedCaseRecord[]; fallback: Case[] }) {
  const rows = records.length > 0
    ? records.slice(0, 4).map((record) => ({ case: record.case, record }))
    : fallback.slice(0, 4).map((value) => ({ case: value, record: undefined }));

  return (
    <div className="overflow-hidden rounded-[2px]">
      <div className="grid grid-cols-[minmax(62px,.7fr)_minmax(0,1fr)_minmax(0,1.2fr)_22px] bg-primary-500 px-2 py-2 text-xs font-bold text-white sm:text-sm">
        <span>Urgency</span>
        <span>Case</span>
        <span>Host/User</span>
        <span className="sr-only">Open</span>
      </div>
      <div className="divide-y divide-primary-100 bg-primary-300/70">
        {rows.map(({ case: value, record }) => {
          const entity = displayHost(value);
          const href = record
            ? getPastInvestigationHref(value.case_id, record.lookback_hours)
            : getInvestigationHref(value.case_id);
          return (
            <Link
              key={value.case_id}
              href={href}
              onClick={() => rememberInvestigationCase(value)}
              aria-label={`Open ${value.case_id}`}
              className="relative grid min-h-14 grid-cols-[minmax(62px,.7fr)_minmax(0,1fr)_minmax(0,1.2fr)_22px] items-center px-2 py-2 text-xs text-primary-1000 transition hover:bg-primary-300"
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${getUrgencyStripeColor(value.urgency_score)}`} />
              <strong className="pl-1 text-sm font-medium">{value.urgency_score.toFixed(1)}</strong>
              <span className="truncate font-mono text-[11px] font-semibold">{value.case_id}</span>
              <span className="min-w-0 pl-1">
                <span className="block truncate font-semibold">{entity.primary}</span>
                <span className="block truncate text-[10px] text-primary-900">{entity.secondary}</span>
              </span>
              <ChevronRight className="size-4 justify-self-center" aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function CaseQueue({ cases, isLoading }: { cases: Case[]; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="space-y-px" aria-label="Loading cases">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="h-[61px] animate-pulse bg-primary-300/50" />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[2px]">
      <div className="grid grid-cols-[minmax(62px,.65fr)_minmax(0,1.05fr)_minmax(0,1.15fr)_44px] bg-primary-500 px-2 py-2 text-xs font-bold text-white sm:text-sm">
        <span>Urgency</span>
        <span>Case</span>
        <span>Host/User</span>
        <span className="text-right">Alerts</span>
      </div>
      <div className="divide-y divide-primary-100 bg-primary-300/70">
        {cases.slice(0, 5).map((value) => {
          const entity = displayHost(value);
          return (
            <Link
              key={value.case_id}
              href={getInvestigationHref(value.case_id)}
              onClick={() => rememberInvestigationCase(value)}
              aria-label={`Investigate ${value.case_id}`}
              className="relative grid min-h-[61px] grid-cols-[minmax(62px,.65fr)_minmax(0,1.05fr)_minmax(0,1.15fr)_44px] items-center px-2 py-2 text-xs text-primary-1000 transition hover:bg-primary-300"
            >
              <span className={`absolute inset-y-0 left-0 w-1 ${getUrgencyStripeColor(value.urgency_score)}`} />
              <strong className="pl-1 text-sm font-medium">{value.urgency_score.toFixed(1)}</strong>
              <span className="truncate font-mono text-[11px] font-semibold">{value.case_id}</span>
              <span className="min-w-0 pl-1">
                <span className="block truncate font-semibold">{entity.primary}</span>
                <span className="block truncate text-[10px] text-primary-900">{entity.secondary}</span>
              </span>
              <strong className="text-right text-base">{value.alert_count}</strong>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardOverview() {
  const router = useRouter();
  const { cases, isLoading, error } = useCases("24h", 5);
  const storedHistory = useSyncExternalStore(historySubscribe, historySnapshot, () => "[]");
  const history = useMemo(() => {
    void storedHistory;
    return getInvestigatedCases();
  }, [storedHistory]);
  const displayCases = cases.length > 0 ? cases : MOCK_CASES.slice(0, 5);
  const latestRecord = history.find((record) => record.turn);
  const latestCase = latestRecord?.case ?? displayCases[0] ?? MOCK_CASES[0];
  const latestCaseHref = latestRecord
    ? getPastInvestigationHref(latestCase.case_id, latestRecord.lookback_hours)
    : getInvestigationHref(latestCase.case_id);
  const latestChatHref = `${latestCaseHref}${latestCaseHref.includes("?") ? "&" : "?"}view=chat`;
  const latestAnswer = latestRecord?.turn?.answer
    ?? "The alert establishes that suspicious network activity was detected. Review the related evidence before deciding whether containment is required.";
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [rangeError, setRangeError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleTimeRangeSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateTimeRange(start, end);
    const message = validation.errors.start
      ?? validation.errors.end
      ?? validation.errors.range
      ?? "";
    setRangeError(message);
    if (!validation.payload) return;

    setIsSubmitting(true);
    try {
      const turn = await runTimeRangeInvestigation(validation.payload);
      rememberTimeRangeInvestigation(validation.payload, turn);
      router.push(getInvestigationHref(turn.case_id));
    } catch (requestError) {
      setRangeError(requestError instanceof Error ? requestError.message : "Unable to start the investigation.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] pb-10">
      <section className="mb-5">
        <h1 className="text-3xl font-bold tracking-tight text-black-600 sm:text-[36px] sm:leading-tight">
          Welcome back, User!
        </h1>
        <p className="mt-1 text-base text-neutral-1000">Monitor your case</p>
      </section>

      <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,.98fr)_minmax(0,1.02fr)] xl:grid-rows-[350px_minmax(220px,auto)]">
        <section className="rounded-[10px] bg-primary-100 p-5 xl:col-start-1 xl:row-start-1" aria-labelledby="past-investigation-title">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 id="past-investigation-title" className="text-2xl font-bold text-black-600">Past Investigation</h2>
            <DashboardLink href="/past-investigation">See More</DashboardLink>
          </div>
          <PastInvestigationRows records={history} fallback={displayCases} />
        </section>

        <section className="rounded-[10px] bg-primary-100 p-5 xl:col-start-1 xl:row-start-2" aria-labelledby="latest-chat-title">
          <div className="mb-3 flex items-center gap-3">
            <h2 id="latest-chat-title" className="text-2xl font-bold text-black-600">Latest Chat</h2>
          </div>
          <div className="rounded-[2px] bg-primary-300/45 p-3">
            <div className="max-w-[90%] rounded-[3px] border-l-4 border-primary-800 bg-green-400 px-3 py-3 text-white shadow-sm">
              <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-green-100">
                <span className="truncate font-mono">{latestCase?.case_id ?? "No case selected"}</span>
                <Link
                  href={latestChatHref}
                  onClick={() => rememberInvestigationCase(latestCase)}
                  aria-label={`Continue chat for ${latestCase.case_id}`}
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm font-medium underline-offset-2 transition hover:text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  continue <ChevronRight className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
              <p className="line-clamp-3 text-sm leading-relaxed sm:text-base">{latestAnswer}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[10px] bg-primary-100 p-5 xl:col-start-2 xl:row-span-2 xl:row-start-1" aria-labelledby="start-investigating-title">
          <h2 id="start-investigating-title" className="text-2xl font-bold text-black-600">Start Investigating</h2>
          <p className="mt-1 text-lg text-neutral-1000">Investigate case by your preferred time span</p>

          <form onSubmit={handleTimeRangeSubmit} noValidate className="mt-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="grid gap-2">
                <label className="text-xs font-medium uppercase text-primary-1000" htmlFor="dashboard-range-start">Start</label>
                <input
                  id="dashboard-range-start"
                  type="datetime-local"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className="h-10 rounded-[3px] border border-primary-600 bg-primary-100 px-3 text-sm outline-none focus:ring-2 focus:ring-primary-400"
                />
                <label className="mt-1 text-xs font-medium uppercase text-primary-1000" htmlFor="dashboard-range-end">End</label>
                <input
                  id="dashboard-range-end"
                  type="datetime-local"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  className="h-10 rounded-[3px] border border-primary-600 bg-primary-100 px-3 text-sm outline-none focus:ring-2 focus:ring-primary-400"
                />
              </div>
              <Button type="submit" disabled={isSubmitting} className="h-10 bg-primary-600 px-5 text-sm text-white hover:bg-primary-700 disabled:opacity-60">
                <Search className="size-4" aria-hidden="true" />
                {isSubmitting ? "Investigating…" : "Investigate"}
              </Button>
            </div>
            {rangeError && <p role="alert" className="mt-2 text-xs font-semibold text-red-400">{rangeError}</p>}
          </form>

          <div className="mb-3 mt-7 flex items-center justify-between gap-3">
            <h3 className="text-lg font-medium leading-tight text-black-600">Or investigate from case listed</h3>
            <DashboardLink href="/cases">See More</DashboardLink>
          </div>

          {error && cases.length === 0 && (
            <p className="mb-2 rounded-[3px] bg-red-100 px-3 py-2 text-xs text-red-500">
              Live cases are unavailable, so sample cases are shown.
            </p>
          )}
          <CaseQueue cases={displayCases} isLoading={isLoading && cases.length === 0} />
        </section>
      </div>
    </div>
  );
}
