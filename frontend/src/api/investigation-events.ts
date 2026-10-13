import {
  getApiConfig,
  type InvestigationProgressEvent,
  type InvestigationServerEvent,
} from "./client";

const EVENT_TYPES = [
  "turn_started",
  "step_completed",
  "log",
  "turn_completed",
  "turn_failed",
] as const;

const STEP_ORDER = [
  "guardrails",
  "question_generation",
  "dispatch_retrieval",
  "review_evidence",
  "synthesizer",
  "grounding_check",
] as const;

const STEP_LABELS: Record<string, string> = {
  guardrails: "Guardrails Agent",
  question_generation: "Question Generation Agent",
  dispatch_retrieval: "Retrieval Dispatcher",
  review_evidence: "Evidence Review Agent",
  synthesizer: "Synthesis Agent",
  grounding_check: "Grounding Check Agent",
};

export interface InvestigationEventStream {
  ready: Promise<boolean>;
  close: () => void;
}

export function getInvestigationEventsUrl(caseId: string): string {
  const { baseUrl } = getApiConfig();
  const origin = typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : "http://localhost";
  const url = new URL(
    `${baseUrl}/investigations/${encodeURIComponent(caseId)}/events`,
    origin,
  );
  // The server waits for the next turn when this stream is opened before POST.
  url.searchParams.set("wait", "true");
  return url.toString();
}

function parseServerEvent(message: MessageEvent<string>): InvestigationServerEvent | null {
  try {
    const parsed: unknown = JSON.parse(message.data);
    if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return null;
    return parsed as InvestigationServerEvent;
  } catch {
    return null;
  }
}

function timestampFor(event: InvestigationServerEvent): string {
  return typeof event.ts === "number"
    ? new Date(event.ts * 1000).toISOString()
    : new Date().toISOString();
}

function toProgressEvents(event: InvestigationServerEvent): InvestigationProgressEvent[] {
  const timestamp = timestampFor(event);

  if (event.type === "step_completed" && event.node) {
    const agent = event.node;
    const completed: InvestigationProgressEvent = {
      type: "agent",
      status: "complete",
      agent,
      agent_id: `agent.${agent}`,
      label: event.label ?? STEP_LABELS[agent] ?? agent,
      messages: event.summary ? [event.summary] : [],
      timestamp,
      elapsed_seconds: event.elapsed,
      source: "backend",
    };
    const nextIndex = STEP_ORDER.indexOf(agent as (typeof STEP_ORDER)[number]) + 1;
    const next = STEP_ORDER[nextIndex];
    if (!next) return [completed];
    return [
      completed,
      {
        type: "agent",
        status: "running",
        agent: next,
        agent_id: `agent.${next}`,
        label: STEP_LABELS[next],
        messages: [],
        timestamp,
        elapsed_seconds: event.elapsed,
        source: "backend",
      },
    ];
  }

  if (event.type === "log") {
    return [{
      type: "log",
      agent: event.agent,
      agent_id: event.agent ? `agent.${event.agent}` : undefined,
      label: event.agent ? STEP_LABELS[event.agent] ?? event.agent : "Investigation agent",
      message: event.message ?? "",
      level: event.level,
      timestamp,
      elapsed_seconds: event.elapsed,
      source: "backend",
    }];
  }

  if (event.type === "turn_failed") {
    return [{
      type: "error",
      message: event.error ?? "The investigation failed.",
      timestamp,
      elapsed_seconds: event.elapsed,
      source: "backend",
    }];
  }

  return [];
}

/**
 * Opens the backend SSE stream before the investigation POST. If the server
 * does not expose the new endpoint, `ready` resolves false and callers can
 * retain their existing compatibility timeline.
 */
export function openInvestigationEventStream(
  caseId: string,
  onEvent: (event: InvestigationProgressEvent) => void,
  readyTimeoutMs = 1000,
): InvestigationEventStream {
  if (typeof window === "undefined" || typeof EventSource === "undefined") {
    return { ready: Promise.resolve(false), close: () => undefined };
  }

  let source: EventSource | null = null;
  let opened = false;
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: (ready: boolean) => void;
  const ready = new Promise<boolean>((resolve) => { resolveReady = resolve; });

  const settle = (value: boolean) => {
    if (settled) return;
    settled = true;
    if (timeout) clearTimeout(timeout);
    resolveReady(value);
  };

  const close = () => {
    if (timeout) clearTimeout(timeout);
    source?.close();
    source = null;
  };

  try {
    source = new EventSource(getInvestigationEventsUrl(caseId));
    source.onopen = () => {
      opened = true;
      settle(true);
    };
    source.onerror = () => {
      // A missing route (the current backend) should fall back immediately.
      // Once connected, stop retries and let the final POST response decide
      // whether the investigation succeeded.
      if (!opened) {
        close();
        settle(false);
      } else {
        close();
      }
    };

    for (const eventType of EVENT_TYPES) {
      source.addEventListener(eventType, (message) => {
        const event = parseServerEvent(message as MessageEvent<string>);
        if (!event) return;
        for (const progressEvent of toProgressEvents(event)) onEvent(progressEvent);
        if (event.type === "turn_completed" || event.type === "turn_failed") close();
      });
    }

    timeout = setTimeout(() => {
      if (!opened) {
        close();
        settle(false);
      }
    }, readyTimeoutMs);
  } catch {
    close();
    settle(false);
  }

  return { ready, close };
}

export async function runWithInvestigationEventStream<T>(
  caseId: string,
  request: () => Promise<T>,
  onEvent: (event: InvestigationProgressEvent) => void,
  fallback: () => Promise<T>,
): Promise<T> {
  // Keep non-browser callers (including the Node test suite) on the exact
  // existing request path; EventSource is only meaningful in a browser.
  if (typeof window === "undefined") return fallback();
  const stream = openInvestigationEventStream(caseId, onEvent);
  if (!(await stream.ready)) {
    stream.close();
    return fallback();
  }
  try {
    return await request();
  } finally {
    stream.close();
  }
}
