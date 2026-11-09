"use client";

import * as React from "react";
import { Bot, Check, Circle, LoaderCircle } from "lucide-react";
import type { InvestigationProgressEvent, TurnRecord } from "@/api";
import { cn } from "@/lib/utils";
import InvestigationActivityLog from "./investigation-activity-log";

export const INVESTIGATION_AGENTS = [
  { key: "guardrails", id: "agent.guardrails", label: "Guardrails Agent" },
  { key: "question_generation", id: "agent.question_generation", label: "Question Generation Agent" },
  { key: "dispatch_retrieval", id: "agent.dispatch_retrieval", label: "Retrieval Dispatcher" },
  { key: "review_evidence", id: "agent.review_evidence", label: "Evidence Review Agent" },
  { key: "synthesizer", id: "agent.synthesizer", label: "Synthesis Agent" },
  { key: "grounding_check", id: "agent.grounding_check", label: "Grounding Check Agent" },
] as const;

export type AgentState = "complete" | "active" | "pending";

export function getInvestigationAgentState(
  agent: string,
  events: InvestigationProgressEvent[],
): AgentState {
  const matching = events.filter((event) => event.type === "agent" && event.agent === agent);
  const latest = matching.at(-1);
  if (latest?.status === "complete") return "complete";
  if (latest?.status === "running") return "active";
  return "pending";
}

export interface InvestigationLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  startTime?: number;
  caseId?: string;
  events?: InvestigationProgressEvent[];
}

export interface InvestigationLogProps extends React.HTMLAttributes<HTMLElement> {
  events: InvestigationProgressEvent[];
  trace?: TurnRecord["trace"];
}

export function InvestigationLog({ events, trace, className, ...props }: InvestigationLogProps) {
  const activityEvents = events.filter((event) => event.type === "agent" && event.status === "complete" && event.messages?.length);
  const backendLogEvents = events.filter((event) => event.type === "log" && event.message);
  const completedAgents = new Set(activityEvents.map((event) => event.agent).filter(Boolean));

  return (
    <section className={cn("p-5 text-primary-1000 bg-primary-100 rounded-[10px]", className)} aria-labelledby="investigation-log-title" {...props}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 id="investigation-log-title" className="font-h6">Investigation log</h2>
        <span className="ml-auto font-b3 text-primary-700">{completedAgents.size} agents completed</span>
      </div>
      {activityEvents.length || backendLogEvents.length || trace?.retrievals?.length ? (
        <InvestigationActivityLog events={events} trace={trace} defaultOpen />
      ) : (
        <p className="font-b2 text-primary-800">No agent activity was recorded for this investigation.</p>
      )}
    </section>
  );
}

export function InvestigationLoader({ startTime, caseId, events = [], className, ...props }: InvestigationLoaderProps) {
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const origin = startTime ?? Date.now();
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - origin) / 1000)));
    update();
    const interval = window.setInterval(update, 500);
    return () => window.clearInterval(interval);
  }, [startTime]);

  const agentEvents = events.filter((event) => event.type === "agent");
  const runningEvent = [...agentEvents].reverse().find((event) => event.status === "running" && getInvestigationAgentState(event.agent ?? "", events) !== "complete");
  const latestEvent = runningEvent ?? agentEvents.at(-1);
  const activityEvents = agentEvents.filter((event) => event.status === "complete" && event.messages?.length);
  const backendLogEvents = events.filter((event) => event.type === "log" && event.message);
  const isDemo = process.env.NEXT_PUBLIC_USE_MOCK === "true";

  return (
    <div className={cn("w-full space-y-3", className)} {...props}>
      <section className="overflow-hidden border border-primary-200 bg-primary-100 text-primary-1000 shadow-xs">
        <header role="status" aria-live="polite" aria-atomic="true" className="flex flex-wrap items-start justify-between gap-4 border-b border-primary-300 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <LoaderCircle aria-hidden="true" className="mt-0.5 size-6 shrink-0 text-primary-700 motion-safe:animate-spin" />
            <div className="min-w-0">
              <p className="font-b3 font-bold uppercase tracking-[0.12em] text-primary-700">{latestEvent ? "Active agent" : "Connecting"}</p>
              <h2 className="font-h7 font-semibold">{latestEvent?.label ?? "Opening investigation stream"}</h2>
              <p className="font-b2">
                {latestEvent
                  ? latestEvent.status === "running" ? "This agent is processing the case now." : "Waiting for the next agent to start."
                  : "Waiting for the backend to send the first pipeline event."}
              </p>
              {caseId && <span className="sr-only">Case {caseId}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 font-b3 text-primary-800">
            {latestEvent?.agent_id && <span className="rounded-full border border-primary-300 bg-background/70 px-2.5 py-1 font-mono">{latestEvent.agent_id}</span>}
            <span aria-label={`${elapsed} seconds elapsed`}>+{elapsed}s</span>
          </div>
        </header>

        <div className="grid lg:grid-cols-[minmax(220px,0.34fr)_minmax(0,1fr)]">
          <ol aria-label="Investigation agents" className="border-b border-primary-300 p-4 lg:border-r lg:border-b-0">
            {INVESTIGATION_AGENTS.map((agent, index) => {
              const state = getInvestigationAgentState(agent.key, events);
              const Icon = state === "complete" ? Check : state === "active" ? LoaderCircle : Circle;
              return (
                <li
                  key={agent.id}
                  aria-current={state === "active" ? "step" : undefined}
                  data-state={state}
                  className={cn(
                    "relative flex gap-3 px-2 py-2.5 font-b3",
                    state === "active" && "bg-primary-200/70",
                    index < INVESTIGATION_AGENTS.length - 1 && "after:absolute after:top-8 after:bottom-[-10px] after:left-[17px] after:w-px after:bg-primary-300",
                  )}
                >
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "relative z-10 mt-0.5 size-4 shrink-0 bg-primary-100",
                      state === "complete" && "text-green-500",
                      state === "active" && "text-primary-700 motion-safe:animate-spin",
                      state === "pending" && "text-neutral-700",
                    )}
                  />
                  <span className="min-w-0">
                    <span className={cn("block font-semibold", state === "pending" && "text-neutral-800")}>{agent.label}</span>
                    <span className="block truncate font-mono text-[11px] text-primary-700">{agent.id}</span>
                    <span className="sr-only"> — {state === "complete" ? "complete" : state === "active" ? "in progress" : "waiting"}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="min-w-0 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Bot aria-hidden="true" className="size-5 text-primary-700" />
              <h3 className="font-b1 font-semibold">Agent activity log</h3>
              <span className="ml-auto flex items-center gap-1.5 font-b3 text-green-500"><span className="size-2 rounded-full bg-green-500 motion-safe:animate-pulse" />Live</span>
            </div>
            {activityEvents.length || backendLogEvents.length ? (
              <InvestigationActivityLog events={events} defaultOpen />
            ) : (
              <div className="flex min-h-28 items-center justify-center border border-dashed border-primary-300 bg-background/35 px-4 text-center font-b2 text-primary-800">
                Agent output will appear here as each pipeline node completes.
              </div>
            )}
          </div>
        </div>
      </section>
      <p className="font-b3 text-neutral-800">
        {isDemo
          ? "Demo mode replays sample agent events. The same pipeline timeline accompanies the existing API request when demo mode is off."
          : events.some((event) => event.source === "backend")
            ? "Live progress and agent logs are coming from the investigation backend. Case details and the report appear after the final API result arrives."
            : "The backend does not expose live progress yet, so the frontend uses a compatibility pipeline timeline while the investigation request runs."}
      </p>
    </div>
  );
}
