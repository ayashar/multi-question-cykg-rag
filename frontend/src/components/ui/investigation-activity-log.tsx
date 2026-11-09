"use client";

import { useState } from "react";
import type { InvestigationProgressEvent, InvestigationTraceLog, TurnRecord } from "@/api";

type QueryEntry = {
  retrievalIndex: number;
  source: string;
  queryType: string;
  query: string;
  timestamp?: string;
};

type TimelineItem =
  | { kind: "agent" | "log" | "error"; event: InvestigationProgressEvent; timestamp: number; order: number }
  | { kind: "query"; entry: QueryEntry; timestamp: number; order: number };

function simplifyLogMessage(message: string): string {
  const compact = message.replace(/\s+/g, " ").trim();
  return compact.length > 280 ? `${compact.slice(0, 277).trimEnd()}…` : compact;
}

function traceTimestamp(line: InvestigationTraceLog | undefined): string | undefined {
  return typeof line?.ts === "number" ? new Date(line.ts * 1000).toISOString() : undefined;
}

function findRetrievalTimestamp(trace: TurnRecord["trace"], retrieval: Record<string, unknown>): string | undefined {
  const source = String(retrieval.source ?? "retrieval");
  const question = typeof retrieval.question === "string" ? retrieval.question : "";
  const matchingLine = (trace?.log ?? []).find((line) => {
    if (line.agent !== "dispatch_retrieval" || !line.message?.includes(`(${source})`)) return false;
    return !question || line.message.includes(question.slice(0, 80));
  });
  return traceTimestamp(matchingLine);
}

function getQueryEntries(trace: TurnRecord["trace"]): QueryEntry[] {
  return (trace?.retrievals ?? []).flatMap((retrieval, retrievalIndex) => {
    const queries = retrieval.queries;
    if (!queries || typeof queries !== "object" || Array.isArray(queries)) return [];
    const timestamp = findRetrievalTimestamp(trace, retrieval);
    return Object.entries(queries).map(([queryType, query]) => ({
      retrievalIndex,
      source: String(retrieval.source ?? "retrieval"),
      queryType,
      query: typeof query === "string" ? query : JSON.stringify(query, null, 2) ?? String(query),
      timestamp,
    }));
  });
}

function eventTimestamp(event: InvestigationProgressEvent): number {
  const timestamp = Date.parse(event.timestamp);
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function formatTimelineOffset(timestamp: number, origin: number): string {
  if (timestamp >= Number.MAX_SAFE_INTEGER || origin >= Number.MAX_SAFE_INTEGER) return "time unavailable";
  const seconds = Math.max(0, (timestamp - origin) / 1000);
  return `+${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

function buildTimeline(events: InvestigationProgressEvent[], queryEntries: QueryEntry[]): TimelineItem[] {
  const items: TimelineItem[] = events.map((event, order) => ({
    kind: event.type === "agent" ? "agent" : event.type === "error" ? "error" : "log",
    event,
    timestamp: eventTimestamp(event),
    order,
  }));
  const queryOffset = events.length;
  queryEntries.forEach((entry, index) => {
    items.push({
      kind: "query",
      entry,
      timestamp: entry.timestamp ? Date.parse(entry.timestamp) : Number.MAX_SAFE_INTEGER,
      order: queryOffset + index,
    });
  });
  return items.sort((left, right) => left.timestamp - right.timestamp || left.order - right.order);
}

function TimelineLabel({ kind, event, entry }: { kind: TimelineItem["kind"]; event?: InvestigationProgressEvent; entry?: QueryEntry }) {
  if (kind === "query" && entry) {
    return <span className="rounded-full bg-blue-100 px-2 py-0.5 font-b3 font-semibold text-blue-900">{entry.source === "cypher" ? "Neo4j Cypher" : entry.source}</span>;
  }
  if (kind === "agent") {
    return <span className="rounded-full bg-primary-100 px-2 py-0.5 font-b3 font-semibold text-primary-900">Agent</span>;
  }
  if (kind === "error") {
    return <span className="rounded-full bg-red-100 px-2 py-0.5 font-b3 font-semibold text-red-800">Error</span>;
  }
  return <span className="rounded-full bg-neutral-200 px-2 py-0.5 font-b3 font-semibold text-neutral-800">{event?.agent ?? "Backend log"}</span>;
}

export default function InvestigationActivityLog({
  events,
  trace,
  defaultOpen = false,
  initialMode = "simplified",
}: {
  events: InvestigationProgressEvent[];
  trace?: TurnRecord["trace"];
  defaultOpen?: boolean;
  initialMode?: "simplified" | "detailed";
}) {
  const [mode, setMode] = useState<"simplified" | "detailed">(initialMode);
  const fullLog = events.filter((event) => (
    (event.type === "agent" && event.status === "complete" && (event.label || event.messages?.length)) ||
    (event.type === "log" && event.message) ||
    event.type === "error"
  ));
  const queryEntries = getQueryEntries(trace);

  if (!fullLog.length && !queryEntries.length) return null;

  const agentEvents = fullLog.filter((event) => event.type === "agent" && event.status === "complete");
  const timeline = buildTimeline(fullLog, queryEntries);
  const timelineOrigin = timeline.find((item) => item.timestamp < Number.MAX_SAFE_INTEGER)?.timestamp ?? Number.MAX_SAFE_INTEGER;
  const simplifiedTimeline = agentEvents.length ? buildTimeline(agentEvents, []) : timeline.filter((item) => item.kind !== "query");
  const simplifiedOrigin = simplifiedTimeline.find((item) => item.timestamp < Number.MAX_SAFE_INTEGER)?.timestamp ?? Number.MAX_SAFE_INTEGER;

  return (
    <details open={defaultOpen} className="mt-3 rounded-[4px] border border-primary-200 bg-background/60">
      <summary className="cursor-pointer px-2.5 py-2 font-b3 font-semibold text-primary-800">
        Full activity log ({fullLog.length} events{queryEntries.length ? `, ${queryEntries.length} queries` : ""})
      </summary>
      <div className="border-t border-primary-200 px-2.5 py-2">
        <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Activity log display mode">
          <button
            type="button"
            aria-pressed={mode === "simplified"}
            className={`rounded border px-2 py-1 font-b3 ${mode === "simplified" ? "border-primary-600 bg-primary-100 font-semibold text-primary-900" : "border-primary-300 text-primary-800 hover:bg-primary-100"}`}
            onClick={() => setMode("simplified")}
          >
            Simplified
          </button>
          <button
            type="button"
            aria-pressed={mode === "detailed"}
            className={`rounded border px-2 py-1 font-b3 ${mode === "detailed" ? "border-primary-600 bg-primary-100 font-semibold text-primary-900" : "border-primary-300 text-primary-800 hover:bg-primary-100"}`}
            onClick={() => setMode("detailed")}
          >
            Detailed raw
          </button>
        </div>

        {mode === "simplified" ? (
          <ol className="max-h-56 space-y-2 overflow-y-auto" aria-label="Simplified response activity timeline">
            {simplifiedTimeline.map((item, index) => {
              if (item.kind === "query") return null;
              const event = item.event;
              const messages = event.type === "agent" ? event.messages ?? [] : event.message ? [event.message] : [];
              return (
                <li key={`${item.kind}-${event.agent ?? "system"}-${event.timestamp}-${index}`} className="border-l-2 border-primary-300 pl-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-primary-700">{formatTimelineOffset(item.timestamp, simplifiedOrigin)}</span>
                    <TimelineLabel kind={item.kind} event={event} />
                    <p className="font-b3 font-semibold text-primary-900">{event.type === "agent" ? event.label : event.agent ?? "Backend log"}</p>
                  </div>
                  {messages.map((message, messageIndex) => (
                    <p key={`${message}-${messageIndex}`} className="font-mono text-[11px] leading-relaxed text-primary-800 wrap-anywhere">{simplifyLogMessage(message)}</p>
                  ))}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="max-h-96 overflow-y-auto" aria-label="Detailed raw response activity timeline">
            {queryEntries.length > 0 && (
              <div aria-label="Database query trace" className="mb-3 border-b border-primary-300 pb-2">
                <h4 className="font-b3 font-semibold text-primary-900">Database and retrieval queries in timeline</h4>
                <p className="font-b3 text-primary-800">Raw queries are placed at the retrieval step that produced them.</p>
              </div>
            )}
            <ol className="space-y-3" aria-label="Detailed raw response activity timeline events">
              {timeline.map((item, index) => {
                if (item.kind === "query") {
                  return (
                    <li key={`query-${item.entry.retrievalIndex}-${item.entry.queryType}-${index}`} className="border-l-2 border-blue-400 pl-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-primary-700">{formatTimelineOffset(item.timestamp, timelineOrigin)}</span>
                        <TimelineLabel kind="query" entry={item.entry} />
                        <h5 className="font-b3 font-semibold text-primary-900">Retrieval {item.entry.retrievalIndex + 1} · {item.entry.queryType}</h5>
                      </div>
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800">{item.entry.query}</pre>
                    </li>
                  );
                }
                const event = item.event;
                return (
                  <li key={`${item.kind}-${event.timestamp}-${index}`} className={`border-l-2 pl-2 ${item.kind === "error" ? "border-red-400" : "border-primary-300"}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] text-primary-700">{formatTimelineOffset(item.timestamp, timelineOrigin)}</span>
                      <TimelineLabel kind={item.kind} event={event} />
                      <h5 className="font-b3 font-semibold text-primary-900">{event.type === "agent" ? event.label : event.agent ?? "Backend log"}</h5>
                      {event.type === "agent" && <span className="font-b3 text-primary-700">complete</span>}
                    </div>
                    {event.type === "agent" ? (
                      event.messages?.map((message, messageIndex) => (
                        <p key={`${message}-${messageIndex}`} className="mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800 wrap-anywhere">{message}</p>
                      ))
                    ) : (
                      <p className={`mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed wrap-anywhere ${item.kind === "error" ? "text-red-800" : "text-primary-800"}`}>
                        {event.type === "error" ? `[error] ${event.message ?? "Unknown error"}` : event.message}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </div>
    </details>
  );
}
