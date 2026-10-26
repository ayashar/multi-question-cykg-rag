import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  getInvestigationEventsUrl,
  openInvestigationEventStream,
  resetApiConfig,
  setApiConfig,
  type InvestigationProgressEvent,
} from "../index";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalEventSource = Object.getOwnPropertyDescriptor(globalThis, "EventSource");

class FakeEventSource {
  static latest: FakeEventSource | undefined;
  readonly url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private readonly listeners = new Map<string, (event: Event) => void>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.set(type, listener as EventListener);
  }

  close(): void {
    this.closed = true;
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

afterEach(() => {
  resetApiConfig();
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalEventSource) Object.defineProperty(globalThis, "EventSource", originalEventSource);
  else Reflect.deleteProperty(globalThis, "EventSource");
  FakeEventSource.latest = undefined;
});

test("SSE stream maps backend steps and logs into frontend progress events", async () => {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { origin: "http://frontend.local" } },
  });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: FakeEventSource });
  setApiConfig({ baseUrl: "/backend" });

  const events: InvestigationProgressEvent[] = [];
  const stream = openInvestigationEventStream("case-sse", (event) => events.push(event));
  const source = FakeEventSource.latest;
  assert.ok(source);
  assert.equal(getInvestigationEventsUrl("case-sse"), "http://frontend.local/backend/investigations/case-sse/events?wait=true");

  source.emitOpen();
  assert.equal(await stream.ready, true);
  source.emit("step_completed", {
    type: "step_completed",
    node: "question_generation",
    label: "Generating hypotheses and questions",
    summary: "4 question(s): 2 cypher, 2 vector",
    elapsed: 2.5,
  });
  source.emit("log", {
    type: "log",
    agent: "question_generation",
    level: "INFO",
    message: "Generated investigation questions.",
  });

  assert.equal(events[0].type, "agent");
  assert.equal(events[0].status, "complete");
  assert.equal(events[0].source, "backend");
  assert.equal(events[0].agent, "question_generation");
  assert.equal(events[1].status, "running");
  assert.equal(events[2].type, "log");
  assert.equal(events[2].message, "Generated investigation questions.");
  stream.close();
  assert.equal(source.closed, true);
});
