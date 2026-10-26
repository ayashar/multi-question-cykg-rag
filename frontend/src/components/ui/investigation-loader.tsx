"use client";

import * as React from "react";
import { Bot, Check, Circle, LoaderCircle } from "lucide-react";
import type { InvestigationProgressEvent } from "@/api";
import { cn } from "@/lib/utils";

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

function formatElapsed(seconds: number | undefined): string {
  if (seconds === undefined) return "--";
  return `+${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

export interface InvestigationLoaderProps extends React.HTMLAttributes<HTMLDivElement> {
  startTime?: number;
  caseId?: string;
  events?: InvestigationProgressEvent[];
}

export interface InvestigationLogProps extends React.HTMLAttributes<HTMLElement> {
  events: InvestigationProgressEvent[];
}

export function InvestigationLog({ events, className, ...props }: InvestigationLogProps) {
  const activityEvents = events.filter((event) => event.type === "agent" && event.status === "complete" && event.messages?.length);
  const backendLogEvents = events.filter((event) => event.type === "log" && event.message);
  const completedAgents = new Set(activityEvents.map((event) => event.agent).filter(Boolean));

  return (
    <section className={cn("p-5 text-primary-1000 bg-primary-100 rounded-[10px]", className)} aria-labelledby="investigation-log-title" {...props}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 id="investigation-log-title" className="font-h6">Investigation log</h2>
        <span className="ml-auto font-b3 text-primary-700">{completedAgents.size} agents completed</span>
      </div>
      {activityEvents.length || backendLogEvents.length ? (
        <ol className="space-y-4" aria-label="Completed investigation agent log">
          {activityEvents.map((event, eventIndex) => (
            <li key={`${event.agent}-${eventIndex}`} className="grid gap-2 border-t border-primary-300 pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[180px_minmax(0,1fr)]">
              <div>
                <p className="font-b3 font-semibold">{event.label}</p>
                <p className="font-mono text-[11px] text-primary-700">{event.agent_id}</p>
                <p className="mt-1 font-mono text-[11px] text-primary-700">{formatElapsed(event.elapsed_seconds)}</p>
              </div>
              <div className="space-y-1.5 border-l-2 border-primary-300 pl-3">
                {event.messages?.map((message) => (
                  <p key={message} className="font-mono text-xs leading-relaxed wrap-anywhere">{message}</p>
                ))}
              </div>
            </li>
          ))}
          {backendLogEvents.length > 0 && (
            <li className="border-t border-primary-300 pt-4">
              <p className="mb-2 font-b3 font-semibold">Backend agent output</p>
              <div className="space-y-1.5 border-l-2 border-primary-300 pl-3">
                {backendLogEvents.map((event, eventIndex) => (
                  <p key={`${event.agent}-${event.timestamp}-${eventIndex}`} className="font-mono text-xs leading-relaxed wrap-anywhere">
                    {event.agent ? `[${event.agent}] ` : ""}{event.message}
                  </p>
                ))}
              </div>
            </li>
          )}
        </ol>
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
              <div className="space-y-4">
                {activityEvents.length > 0 && (
                  <ol className="max-h-[350px] space-y-4 overflow-y-auto pr-2" aria-label="Live agent activity log">
                    {activityEvents.map((event, eventIndex) => (
                      <li key={`${event.agent}-${eventIndex}`} className="space-y-2">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-[11px] text-primary-700">{formatElapsed(event.elapsed_seconds)}</span>
                          <span className="font-b3 font-semibold">{event.label}</span>
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-500">Complete</span>
                        </div>
                        <div className="space-y-1.5 border-l-2 border-primary-300 pl-3">
                          {event.messages?.map((message) => (
                            <p key={message} className="font-mono text-xs leading-relaxed text-primary-1000 wrap-anywhere">{message}</p>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
                {backendLogEvents.length > 0 && (
                  <ol className="max-h-[350px] space-y-2 overflow-y-auto border-t border-primary-300 pt-3 pr-2" aria-label="Live backend agent log">
                    {backendLogEvents.map((event, eventIndex) => (
                      <li key={`${event.agent}-${event.timestamp}-${eventIndex}`} className="border-l-2 border-primary-300 pl-3">
                        <p className="font-mono text-xs leading-relaxed text-primary-1000 wrap-anywhere">
                          {event.agent ? `[${event.agent}] ` : ""}{event.message}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
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
