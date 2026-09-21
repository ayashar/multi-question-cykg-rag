"use client";

import * as React from "react";
import { Check, Circle, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export const INVESTIGATION_STAGES = [
  { label: "Reviewing evidence", minSeconds: 0 },
  { label: "Correlating related alerts", minSeconds: 12 },
  { label: "Building investigation findings", minSeconds: 26 },
  { label: "Preparing report CTA", minSeconds: 42 },
] as const;

export function getInvestigationStageIndex(elapsedSeconds: number): number {
  let index = 0;
  for (let i = 1; i < INVESTIGATION_STAGES.length; i++) {
    if (elapsedSeconds >= INVESTIGATION_STAGES[i].minSeconds) index = i;
  }
  return index;
}

export interface InvestigationLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  startTime?: number;
  caseId?: string;
}

export function InvestigationLoader({ startTime, caseId, className, ...props }: InvestigationLoaderProps) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const origin = startTime ?? Date.now();
    const interval = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - origin) / 1000)));
    }, 500);
    return () => window.clearInterval(interval);
  }, [startTime]);

  const current = getInvestigationStageIndex(elapsed);

  return (
    <div className={cn("w-full space-y-3", className)} {...props}>
      <div className="bg-primary-100 p-5 text-primary-1000">
        <div role="status" aria-live="polite" aria-atomic="true" className="flex items-start gap-3">
          <LoaderCircle aria-hidden="true" className="mt-1 size-6 shrink-0 text-primary-700 motion-safe:animate-spin" />
          <div>
            <h2 className="font-h7 font-medium">{INVESTIGATION_STAGES[current].label}</h2>
            <p className="font-b2">
              {elapsed < 55
                ? "This usually takes 15–55 seconds."
                : "Taking a little longer. Your investigation is still running."}
            </p>
            {caseId && <span className="sr-only">Case {caseId}</span>}
          </div>
        </div>
        <ol aria-label="Estimated investigation steps" className="mt-7 grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:flex xl:flex-wrap xl:justify-between">
          {INVESTIGATION_STAGES.map((stage, index) => {
            const complete = index < current;
            const active = index === current;
            const Icon = complete ? Check : active ? LoaderCircle : Circle;
            return (
              <li key={stage.label} aria-current={active ? "step" : undefined}
                data-state={complete ? "complete" : active ? "active" : "pending"}
                className={cn("flex items-center gap-2 font-b3", complete ? "text-green-500" : active ? "font-medium text-primary-800" : "text-neutral-800")}>
                <Icon aria-hidden="true" className={cn("size-5 shrink-0", active && "motion-safe:animate-spin")} />
                <span>{stage.label}</span>
                <span className="sr-only">{complete ? " — estimated complete" : active ? " — in progress" : " — upcoming"}</span>
              </li>
            );
          })}
        </ol>
      </div>
      <p className="font-b3 text-neutral-800">
        Steps are time-based estimates, not live backend progress. Your report becomes available when the investigation finishes.
      </p>
    </div>
  );
}
