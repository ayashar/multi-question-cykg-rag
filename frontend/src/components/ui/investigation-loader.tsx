"use client";

import * as React from "react";
import { CheckCircle2, Clock, ShieldAlert, Network, Brain, FileSearch, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface InvestigationStage {
  id: number;
  label: string;
  description: string;
  minSeconds: number;
  icon: React.ComponentType<{ className?: string }>;
}

export const INVESTIGATION_STAGES: InvestigationStage[] = [
  {
    id: 1,
    label: "Triage & Alert Clustering",
    description: "Structuring case context and correlating alert indicators...",
    minSeconds: 0,
    icon: ShieldAlert,
  },
  {
    id: 2,
    label: "Graph & Vector Retrieval",
    description: "Querying Neo4j knowledge graph and vector embeddings...",
    minSeconds: 7,
    icon: Network,
  },
  {
    id: 3,
    label: "CSKG & MITRE ATT&CK Enrichment",
    description: "Querying SEPSES cybersecurity knowledge graph via SPARQL...",
    minSeconds: 19,
    icon: FileSearch,
  },
  {
    id: 4,
    label: "Multi-Agent Evidence Review",
    description: "Evaluating sufficiency and cross-host attack chain hypotheses...",
    minSeconds: 33,
    icon: Brain,
  },
  {
    id: 5,
    label: "Report Synthesis & Grounding",
    description: "Synthesizing diagnostic narrative and grounded mitigations...",
    minSeconds: 46,
    icon: Sparkles,
  },
];

export interface InvestigationLoaderProps
  extends React.HTMLAttributes<HTMLDivElement> {
  startTime?: number;
  caseId?: string;
  onCancel?: () => void;
}

export function InvestigationLoader({
  startTime,
  caseId,
  className,
  ...props
}: InvestigationLoaderProps) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const origin = startTime ?? Date.now();
    const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - origin) / 1000);
      setElapsed(seconds);
    }, 500);

    return () => clearInterval(interval);
  }, [startTime]);

  const currentStageIndex = React.useMemo(() => {
    let index = 0;
    for (let i = 0; i < INVESTIGATION_STAGES.length; i++) {
      if (elapsed >= INVESTIGATION_STAGES[i].minSeconds) {
        index = i;
      }
    }
    return index;
  }, [elapsed]);

  const progressPercent = Math.min(
    Math.round((elapsed / 55) * 92),
    95
  );

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}s`;
  };

  return (
    <div
      className={cn(
        "w-full max-w-2xl mx-auto rounded-[3px] border border-neutral-300 bg-background p-6 shadow-xs select-none",
        className
      )}
      {...props}
    >
      <div className="flex items-center justify-between border-b border-neutral-200 pb-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[3px] bg-primary-100 flex items-center justify-center text-primary-800">
            <Brain className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <h3 className="font-h7 text-neutral-1000 font-semibold">
              Deep Investigation in Progress
            </h3>
            {caseId ? (
              <p className="font-b3 text-neutral-700">Case ID: {caseId}</p>
            ) : (
              <p className="font-b3 text-neutral-700">
                Multi-agent LangGraph workflow running (est. 15-55s)
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 bg-neutral-100 px-3 py-1.5 rounded-full border border-neutral-200">
          <Clock className="w-4 h-4 text-neutral-700 animate-spin" />
          <span className="font-b3 font-mono font-medium text-neutral-900">
            {formatTime(elapsed)}
          </span>
        </div>
      </div>

      <div className="mb-6">
        <div className="flex justify-between font-b3 text-neutral-800 mb-1.5 font-medium">
          <span>{INVESTIGATION_STAGES[currentStageIndex].label}</span>
          <span className="font-mono">{progressPercent}%</span>
        </div>
        <div className="w-full h-2 rounded-full bg-neutral-200 overflow-hidden">
          <div
            className="h-full bg-primary-600 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="space-y-3">
        {INVESTIGATION_STAGES.map((stage, idx) => {
          const isDone = idx < currentStageIndex;
          const isCurrent = idx === currentStageIndex;
          const isPending = idx > currentStageIndex;
          const Icon = stage.icon;

          return (
            <div
              key={stage.id}
              className={cn(
                "flex items-start gap-3 p-3 rounded-[3px] transition-all duration-300",
                isCurrent && "bg-primary-100/40 border border-primary-300",
                isDone && "opacity-80 bg-neutral-100/60",
                isPending && "opacity-40"
              )}
            >
              <div
                className={cn(
                  "w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                  isDone && "bg-green-100 text-green-500",
                  isCurrent && "bg-primary-600 text-neutral-100 animate-pulse",
                  isPending && "bg-neutral-200 text-neutral-600"
                )}
              >
                {isDone ? (
                  <CheckCircle2 className="w-4 h-4" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <p
                    className={cn(
                      "font-b2 font-medium truncate",
                      isCurrent && "text-primary-900 font-bold",
                      isDone && "text-neutral-900",
                      isPending && "text-neutral-600"
                    )}
                  >
                    {stage.label}
                  </p>
                  {isCurrent && (
                    <span className="font-b5 uppercase tracking-wider px-2 py-0.5 rounded-[3px] bg-primary-600 text-neutral-100 font-bold">
                      Running
                    </span>
                  )}
                </div>
                <p className="font-b3 text-neutral-700 mt-0.5 leading-snug">
                  {stage.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
