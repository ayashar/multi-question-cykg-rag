"use client";

import { useState } from "react";
import type { InvestigationProgressEvent, InvestigationTraceLog, TurnRecord } from "@/api";

type RetrievalSummary = {
  retrievalIndex: number;
  source: string;
  hypothesis?: string;
  question?: string;
  rationale?: string;
  turn?: number;
  status?: string;
  error?: string;
  seconds?: number;
  verdict?: string;
  sufficient?: boolean;
  reasoning?: string;
};

type QueryEntry = RetrievalSummary & {
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

function LiveEventDetails({ event }: { event: InvestigationProgressEvent }) {
  if (event.type !== "log" || !event.details || event.details === event.message) return null;
  return (
    <details className="mt-1 rounded border border-primary-200 bg-background/50 px-2 py-1">
      <summary className="cursor-pointer font-b3 font-semibold text-primary-800">See full CSKG detail</summary>
      <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-900 wrap-anywhere">{event.details}</pre>
    </details>
  );
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

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getRetrievalSummary(retrieval: Record<string, unknown>, retrievalIndex: number): RetrievalSummary {
  return {
    retrievalIndex,
    source: optionalText(retrieval.source) ?? "retrieval",
    hypothesis: optionalText(retrieval.hypothesis),
    question: optionalText(retrieval.question),
    rationale: optionalText(retrieval.rationale),
    turn: optionalNumber(retrieval.turn),
    status: optionalText(retrieval.status),
    error: optionalText(retrieval.error),
    seconds: optionalNumber(retrieval.seconds),
    verdict: optionalText(retrieval.verdict),
    sufficient: optionalBoolean(retrieval.sufficient),
    reasoning: optionalText(retrieval.reasoning),
  };
}

function getQueryEntries(trace: TurnRecord["trace"]): QueryEntry[] {
  return (trace?.retrievals ?? []).flatMap((retrieval, retrievalIndex) => {
    const queries = retrieval.queries;
    if (!queries || typeof queries !== "object" || Array.isArray(queries)) return [];
    const summary = getRetrievalSummary(retrieval, retrievalIndex);
    const timestamp = findRetrievalTimestamp(trace, retrieval);
    return Object.entries(queries).map(([queryType, query]) => ({
      ...summary,
      queryType,
      query: typeof query === "string" ? query : JSON.stringify(query, null, 2) ?? String(query),
      timestamp,
    }));
  });
}

function prettyJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  return serialized ?? String(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function traceEntries(value: unknown): Array<[string, unknown]> {
  const record = asRecord(value);
  return record ? Object.entries(record) : [];
}

function traceText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not recorded";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return prettyJson(value);
}

function traceTime(value: unknown): string {
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  if (typeof value === "string") {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) return new Date(timestamp).toISOString();
  }
  return "time unavailable";
}

function formatSparqlQuery(query: string): string {
  const lines = query.replace(/\r\n?/g, "\n").split("\n");
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^\s*/)?.[0].length ?? 0);
  const commonIndent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.trim() ? line.slice(commonIndent) : "").join("\n").trim();
}

function queryKey(query: string): string {
  return formatSparqlQuery(query).replace(/\s+/g, " ").trim();
}

function getCskgQueries(entry: Record<string, unknown>, serverLogs: unknown[]): Array<{ ts: unknown; query: string }> {
  const recordedQueries = Array.isArray(entry.queries)
    ? entry.queries.flatMap((value) => {
        const record = asRecord(value);
        return typeof record?.query === "string" ? [{ ts: record.ts, query: record.query }] : [];
      })
    : [];
  if (recordedQueries.length) return recordedQueries;

  const marker = "[SPARQL query]";
  return serverLogs.flatMap((value) => {
    const record = asRecord(value);
    const message = typeof record?.message === "string" ? record.message : "";
    return message.startsWith(marker) && message.slice(marker.length).trim()
      ? [{ ts: record?.ts, query: message.slice(marker.length).trim() }]
      : [];
  });
}

function queryTimestamp(value: unknown): string | undefined {
  if (typeof value === "number") return new Date(value * 1000).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(Date.parse(value)).toISOString();
  return undefined;
}

function getCskgQueryEntries(trace: TurnRecord["trace"]): QueryEntry[] {
  return (trace?.cskg ?? []).flatMap((value, cskgIndex) => {
    const entry = asRecord(value);
    if (!entry) return [];
    const serverLogs = Array.isArray(entry.server_logs) ? entry.server_logs : [];
    const retrievalIndex = typeof entry.retrieval_index === "number" ? entry.retrieval_index : cskgIndex;
    const retrieval = trace?.retrievals?.[retrievalIndex];
    const summary = retrieval
      ? getRetrievalSummary(retrieval, retrievalIndex)
      : { retrievalIndex, source: "cskg" };
    return getCskgQueries(entry, serverLogs).map((query) => ({
      ...summary,
      source: "cskg",
      question: summary.question ?? optionalText(entry.question),
      queryType: "SPARQL",
      query: query.query,
      timestamp: queryTimestamp(query.ts),
    }));
  });
}

function queryTimelineTitle(entry: QueryEntry): string {
  return entry.source === "cskg" ? "SPARQL query" : `Retrieval ${entry.retrievalIndex + 1} · ${entry.queryType}`;
}

function RetrievalChain({ entry }: { entry: QueryEntry }) {
  const hasContext = Boolean(
    entry.hypothesis || entry.question || entry.rationale || entry.status || entry.error || entry.seconds !== undefined
      || entry.verdict || entry.sufficient !== undefined || entry.reasoning || entry.turn !== undefined,
  );
  if (!hasContext) return null;

  const retrievalMetadata = [
    entry.source,
    entry.status ?? "status not recorded",
    entry.seconds !== undefined ? `${entry.seconds.toFixed(2)}s` : undefined,
    entry.turn !== undefined ? `turn ${entry.turn}` : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <details className="mt-2 rounded border border-primary-200 bg-primary-50/30 px-2 py-1">
      <summary className="cursor-pointer font-b3 font-semibold text-primary-800">See investigation chain</summary>
      <dl className="mt-2 grid gap-1 sm:grid-cols-[max-content_1fr] sm:gap-x-3">
        {entry.hypothesis && (
          <>
            <dt className="font-b3 font-semibold text-primary-800">Hypothesis</dt>
            <dd className="font-b3 leading-relaxed text-primary-900 wrap-anywhere">{entry.hypothesis}</dd>
          </>
        )}
        {entry.question && (
          <>
            <dt className="font-b3 font-semibold text-primary-800">Question</dt>
            <dd className="font-b3 leading-relaxed text-primary-900 wrap-anywhere">{entry.question}</dd>
          </>
        )}
        <dt className="font-b3 font-semibold text-primary-800">Retrieval</dt>
        <dd className="font-mono text-[11px] leading-relaxed text-primary-800 wrap-anywhere">{retrievalMetadata}</dd>
        {entry.verdict && (
          <>
            <dt className="font-b3 font-semibold text-primary-800">Verdict</dt>
            <dd className="font-b3 leading-relaxed text-primary-900 wrap-anywhere">{entry.verdict}{entry.sufficient !== undefined ? ` · ${entry.sufficient ? "sufficient" : "insufficient"}` : ""}</dd>
          </>
        )}
        {entry.sufficient !== undefined && !entry.verdict && (
          <>
            <dt className="font-b3 font-semibold text-primary-800">Evidence sufficiency</dt>
            <dd className="font-b3 leading-relaxed text-primary-900">{entry.sufficient ? "sufficient" : "insufficient"}</dd>
          </>
        )}
      </dl>
      {entry.rationale && (
        <div className="mt-2">
          <h6 className="font-b3 font-semibold text-primary-800">Question rationale</h6>
          <p className="mt-1 font-b3 leading-relaxed text-primary-900 wrap-anywhere">{entry.rationale}</p>
        </div>
      )}
      {entry.reasoning && (
        <div className="mt-2">
          <h6 className="font-b3 font-semibold text-primary-800">Review reason</h6>
          <p className="mt-1 font-b3 leading-relaxed text-primary-900 wrap-anywhere">{entry.reasoning}</p>
        </div>
      )}
      {entry.error && (
        <p className="mt-2 font-b3 leading-relaxed text-red-800 wrap-anywhere"><span className="font-semibold">Retrieval error:</span> {entry.error}</p>
      )}
    </details>
  );
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function TraceFields({ value }: { value: unknown }) {
  const entries = traceEntries(value);
  if (!entries.length) return <p className="mt-1 font-b3 text-primary-700">Not recorded.</p>;
  return (
    <dl className="mt-2 grid gap-1 sm:grid-cols-[max-content_1fr] sm:gap-x-3">
      {entries.map(([key, entryValue]) => (
        <div key={key} className="contents">
          <dt className="font-b3 font-semibold text-primary-800">{key}</dt>
          <dd className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800 wrap-anywhere">{traceText(entryValue)}</dd>
        </div>
      ))}
    </dl>
  );
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
    const label = entry.source === "cypher" ? "Neo4j Cypher" : entry.source === "cskg" ? "CSKG SPARQL" : entry.source;
    return <span className="rounded-full bg-blue-100 px-2 py-0.5 font-b3 font-semibold text-blue-900">{label}</span>;
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
    (event.type === "log" && (event.message || event.query)) ||
    event.type === "error"
  ));
  const liveCskgQueryKeys = new Set(fullLog.flatMap((event) => (
    event.type === "log" && typeof event.query === "string" && event.query.trim() ? [queryKey(event.query)] : []
  )));
  const queryEntries = [
    ...getQueryEntries(trace),
    ...getCskgQueryEntries(trace).filter((entry) => !liveCskgQueryKeys.has(queryKey(entry.query))),
  ];
  const cskgEntries = trace?.cskg ?? [];

  if (!fullLog.length && !queryEntries.length && !cskgEntries.length) return null;

  const agentEvents = fullLog.filter((event) => event.type === "agent" && event.status === "complete");
  const timeline = buildTimeline(fullLog, queryEntries);
  const timelineOrigin = timeline.find((item) => item.timestamp < Number.MAX_SAFE_INTEGER)?.timestamp ?? Number.MAX_SAFE_INTEGER;
  const liveCskgEvents = fullLog.filter((event) => event.type === "log" && event.agent === "cskg");
  const simplifiedTimeline = agentEvents.length
    ? buildTimeline([...agentEvents, ...liveCskgEvents], [])
    : timeline.filter((item) => item.kind !== "query");
  const simplifiedOrigin = simplifiedTimeline.find((item) => item.timestamp < Number.MAX_SAFE_INTEGER)?.timestamp ?? Number.MAX_SAFE_INTEGER;

  return (
    <details open={defaultOpen} className="mt-3 rounded-[4px] border border-primary-200 bg-background/60">
      <summary className="cursor-pointer px-2.5 py-2 font-b3 font-semibold text-primary-800">
        Full activity log ({fullLog.length} events{queryEntries.length ? `, ${queryEntries.length} queries` : ""}{cskgEntries.length ? `, ${cskgEntries.length} CSKG traces` : ""})
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
          <ol className="max-h-56 space-y-2 overflow-y-auto" aria-label="Simplified response activity timeline" aria-live="polite">
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
                  <LiveEventDetails event={event} />
                  {event.type === "log" && typeof event.query === "string" && event.query.trim() && (
                    <details className="mt-1 rounded border border-primary-200 bg-background/50 px-2 py-1" aria-label="CSKG SPARQL">
                      <summary className="cursor-pointer font-b3 font-semibold text-primary-800">CSKG SPARQL</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-900 wrap-anywhere">{formatSparqlQuery(event.query)}</pre>
                    </details>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="max-h-96 overflow-y-auto" aria-label="Detailed raw response activity timeline">
            {cskgEntries.length > 0 && (
              <div aria-label="CSKG MCP trace" className="mb-3 border-b border-primary-300 pb-2">
                <h4 className="font-b3 font-semibold text-primary-900">CSKG / MCP internals</h4>
                <p className="font-b3 text-primary-800">
                  Includes server identity, readiness and handshake, registered tools, tool arguments/results, and CSKG server stderr. SPARQL requests appear in the shared timeline below.
                </p>
                <ol className="mt-2 space-y-3">
                  {cskgEntries.map((entry, index) => {
                    const toolCalls = Array.isArray(entry.tool_calls) ? entry.tool_calls : [];
                    const serverLogs = Array.isArray(entry.server_logs) ? entry.server_logs : [];
                    const traceEvents = Array.isArray(entry.events) ? entry.events : [];
                    const server = asRecord(entry.server);
                    const readiness = asRecord(entry.readiness);
                    const cskgQueries = getCskgQueries(entry, serverLogs);
                    const toolNames = Array.isArray(entry.tools_used) && entry.tools_used.length
                      ? entry.tools_used.map(String)
                      : toolCalls
                        .map((call) => asRecord(call)?.name)
                        .filter((name): name is string => typeof name === "string");
                    const readinessStatus = typeof readiness?.status === "string" ? readiness.status : readiness ? "reported" : "not recorded";
                    const serverName = typeof server?.name === "string" ? server.name : "not recorded";

                    return (
                      <li key={`cskg-${index}`} className="rounded border border-amber-200 bg-amber-50/20 p-2">
                        <h5 className="font-b3 font-semibold text-primary-900">
                          Retrieval {typeof entry.retrieval_index === "number" ? entry.retrieval_index + 1 : index + 1} · CSKG trace
                        </h5>
                        {typeof entry.question === "string" && (
                          <p className="mt-1 font-mono text-[11px] leading-relaxed text-primary-800 wrap-anywhere">Question: {entry.question}</p>
                        )}

                        <dl className="mt-2 grid gap-1 sm:grid-cols-[max-content_1fr] sm:gap-x-3">
                          <dt className="font-b3 font-semibold text-primary-800">Server</dt>
                          <dd className="font-mono text-[11px] text-primary-800 wrap-anywhere">{serverName}</dd>
                          <dt className="font-b3 font-semibold text-primary-800">Readiness</dt>
                          <dd className="font-mono text-[11px] text-primary-800 wrap-anywhere">{readinessStatus}</dd>
                          <dt className="font-b3 font-semibold text-primary-800">Trace size</dt>
                          <dd className="font-mono text-[11px] text-primary-800 wrap-anywhere">{countLabel(traceEvents.length, "event")} · {countLabel(toolCalls.length, "tool call")} · {countLabel(cskgQueries.length, "query")} · {countLabel(serverLogs.length, "server log line")}</dd>
                        </dl>

                        {toolNames.length > 0 && (
                          <div className="mt-2">
                            <h6 className="font-b3 font-semibold text-primary-800">Tools used</h6>
                            <ul className="mt-1 flex flex-wrap gap-1" aria-label="CSKG tools used">
                              {toolNames.map((toolName, toolIndex) => (
                                <li key={`${toolName}-${toolIndex}`} className="rounded bg-primary-100 px-1.5 py-0.5 font-mono text-[11px] text-primary-900 wrap-anywhere">{toolName}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="mt-2 space-y-1">
                          <details className="rounded border border-primary-200 bg-background/50 px-2 py-1">
                            <summary className="cursor-pointer font-b3 font-semibold text-primary-800">Server configuration and readiness</summary>
                            <h6 className="mt-2 font-b3 font-semibold text-primary-800">Server</h6>
                            <TraceFields value={server} />
                            <h6 className="mt-2 font-b3 font-semibold text-primary-800">Readiness / handshake</h6>
                            <TraceFields value={readiness} />
                          </details>

                          <details className="rounded border border-primary-200 bg-background/50 px-2 py-1">
                            <summary className="cursor-pointer font-b3 font-semibold text-primary-800">Tool calls ({toolCalls.length})</summary>
                            {toolCalls.length > 0 ? (
                              <ol className="mt-2 space-y-2">
                                {toolCalls.map((call, callIndex) => {
                                  const callRecord = asRecord(call);
                                  const callName = typeof callRecord?.name === "string" ? callRecord.name : `Tool call ${callIndex + 1}`;
                                  const callError = callRecord?.is_error === true;
                                  return (
                                    <li key={`tool-call-${callIndex}`} className="rounded border border-primary-200 p-2">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-[11px] font-semibold text-primary-900 wrap-anywhere">{callName}</span>
                                        {typeof callRecord?.seconds === "number" && <span className="font-b3 text-primary-700">{callRecord.seconds.toFixed(2)}s</span>}
                                        {callError && <span className="rounded bg-red-100 px-1.5 py-0.5 font-b3 font-semibold text-red-800">error</span>}
                                      </div>
                                      {callRecord?.arguments !== undefined && (
                                        <div className="mt-2">
                                          <h6 className="font-b3 font-semibold text-primary-800">Arguments</h6>
                                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800">{traceText(callRecord.arguments)}</pre>
                                        </div>
                                      )}
                                      {callRecord?.result !== undefined && (
                                        <div className="mt-2">
                                          <h6 className="font-b3 font-semibold text-primary-800">Result</h6>
                                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800">{traceText(callRecord.result)}</pre>
                                        </div>
                                      )}
                                    </li>
                                  );
                                })}
                              </ol>
                            ) : (
                              <p className="mt-1 font-b3 text-primary-700">No tool calls recorded.</p>
                            )}
                          </details>

                          <details className="rounded border border-primary-200 bg-background/50 px-2 py-1">
                            <summary className="cursor-pointer font-b3 font-semibold text-primary-800">Trace events ({traceEvents.length})</summary>
                            {traceEvents.length > 0 ? (
                              <ol className="mt-2 space-y-1">
                                {traceEvents.map((event, eventIndex) => {
                                  const eventRecord = asRecord(event);
                                  const message = eventRecord?.message ?? event;
                                  const metadata = [eventRecord?.source, eventRecord?.level, eventRecord?.tool, eventRecord?.status]
                                    .filter((value): value is string | number | boolean => typeof value === "string" || typeof value === "number" || typeof value === "boolean")
                                    .join(" · ");
                                  return (
                                    <li key={`trace-event-${eventIndex}`} className="border-l-2 border-primary-300 pl-2">
                                      <p className="font-mono text-[11px] text-primary-700">{traceTime(eventRecord?.ts)}{metadata ? ` · ${metadata}` : ""}</p>
                                      <p className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800 wrap-anywhere">{traceText(message)}</p>
                                    </li>
                                  );
                                })}
                              </ol>
                            ) : (
                              <p className="mt-1 font-b3 text-primary-700">No trace events recorded.</p>
                            )}
                          </details>

                          <details className="rounded border border-primary-200 bg-background/50 px-2 py-1">
                            <summary className="cursor-pointer font-b3 font-semibold text-primary-800">CSKG server log ({countLabel(serverLogs.length, "line")})</summary>
                            {serverLogs.length > 0 ? (
                              <ol className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                                {serverLogs.map((line, lineIndex) => {
                                  const logRecord = asRecord(line);
                                  return (
                                    <li key={`server-log-${lineIndex}`} className="border-l-2 border-amber-300 pl-2">
                                      <p className="font-mono text-[11px] text-primary-700">{traceTime(logRecord?.ts)}</p>
                                      <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800 wrap-anywhere">{traceText(logRecord?.message ?? line)}</pre>
                                    </li>
                                  );
                                })}
                              </ol>
                            ) : (
                              <p className="mt-1 font-b3 text-primary-700">No CSKG server log lines recorded.</p>
                            )}
                          </details>
                        </div>

                        <details className="mt-1 rounded border border-primary-200 bg-background/50 px-2 py-1">
                          <summary className="cursor-pointer font-b3 font-semibold text-primary-800">See more CSKG details · complete raw payload</summary>
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800">{prettyJson(entry)}</pre>
                        </details>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
            <ol className="space-y-3" aria-label="Detailed raw response activity timeline events" aria-live="polite">
              {timeline.map((item, index) => {
                if (item.kind === "query") {
                  return (
                    <li key={`query-${item.entry.retrievalIndex}-${item.entry.queryType}-${index}`} className="border-l-2 border-blue-400 pl-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-primary-700">{formatTimelineOffset(item.timestamp, timelineOrigin)}</span>
                        <TimelineLabel kind="query" entry={item.entry} />
                        <h5 className="font-b3 font-semibold text-primary-900">{queryTimelineTitle(item.entry)}</h5>
                      </div>
                      <RetrievalChain entry={item.entry} />
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800">{formatSparqlQuery(item.entry.query)}</pre>
                    </li>
                  );
                }
                const event = item.event;
                if (event.type === "log" && typeof event.query === "string" && event.query.trim()) {
                  const queryEntry: QueryEntry = {
                    retrievalIndex: 0,
                    source: "cskg",
                    queryType: "SPARQL",
                    query: event.query,
                    timestamp: event.timestamp,
                  };
                  return (
                    <li key={`cskg-query-${event.timestamp}-${index}`} className="border-l-2 border-blue-400 pl-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-primary-700">{formatTimelineOffset(item.timestamp, timelineOrigin)}</span>
                        <TimelineLabel kind="query" entry={queryEntry} />
                        <h5 className="font-b3 font-semibold text-primary-900">{queryTimelineTitle(queryEntry)}</h5>
                      </div>
                      <RetrievalChain entry={queryEntry} />
                      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-primary-800">{formatSparqlQuery(event.query)}</pre>
                    </li>
                  );
                }
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
                      <>
                        <p className={`mt-1 whitespace-pre-wrap font-mono text-[11px] leading-relaxed wrap-anywhere ${item.kind === "error" ? "text-red-800" : "text-primary-800"}`}>
                          {event.type === "error" ? `[error] ${event.message ?? "Unknown error"}` : event.message}
                        </p>
                        <LiveEventDetails event={event} />
                      </>
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
