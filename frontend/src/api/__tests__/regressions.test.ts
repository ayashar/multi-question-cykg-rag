import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCases as getScreenCases,
  hoursCoveringTimestamp,
  resolveLookbackHours,
} from "@/modules/cases/services/cases-service";
import {
  getCases, investigateCase, getAttackGraph, investigateTimeRange, sendChatMessage,
  getChatTranscript, getIngestionConfig, updateIngestionConfig, getIngestionStatus,
  getCaseLookback, clearLookbackStore, getApiLoadingState, setApiConfig, resetApiConfig,
  ApiClientError, type Case,
} from "../index";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearLookbackStore();
  resetApiConfig();
});

const exampleCase: Case = {
  case_id: "case-first", alert_ids: [], hosts: [], src_ips: [], dst_users: [],
  mitre_techniques: [], sigma_matched_rules: [], alert_count: 0,
  first_seen: "2022-01-21T00:00:00Z", last_seen: "2022-01-21T00:00:00Z",
  max_rule_level: 0, noteworthy_alert_count: 0, urgency_score: 0,
};

test("first discovery survives repeat listings and narrower endpoint overrides", async () => {
  globalThis.fetch = async () => Response.json([exampleCase]);
  await getCases({ lookback_hours: 720 });
  await getCases({ lookback_hours: 24 });
  await getCases({ lookback_hours: 8760 });
  assert.equal(getCaseLookback(exampleCase.case_id), 720);
  const windows: string[] = [];
  globalThis.fetch = async (url) => {
    windows.push(new URL(String(url)).searchParams.get("lookback_hours")!);
    return Response.json({});
  };
  await investigateCase(exampleCase.case_id, 24);
  await getAttackGraph(exampleCase.case_id);
  await getAttackGraph(exampleCase.case_id, 1440);
  assert.deepEqual(windows, ["720", "720", "1440"]);
  assert.equal(getCaseLookback(exampleCase.case_id), 720);
});

test("restores the first discovery window from session storage", async () => {
  const stored = new Map<string, string>([["kgcs_case_lookback_map", JSON.stringify({ "case-restored": 8760 })]]);
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {} });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
  } });
  try {
    assert.equal(getCaseLookback("case-restored"), 8760);
    globalThis.fetch = async () => Response.json([exampleCase]);
    await getCases({ lookback_hours: 720 });
    assert.equal(JSON.parse(stored.get("kgcs_case_lookback_map")!)[exampleCase.case_id], 720);
  } finally {
    clearLookbackStore();
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});

test("all nine endpoints inject the configured key and track loading", async () => {
  setApiConfig({ apiKey: "regression-key" });
  const config = { alerts_path: null, speed: 100000, max_gap_seconds: 0.2 };
  const calls = [
    () => getCases(), () => investigateCase("c"), () => getAttackGraph("c"),
    () => investigateTimeRange({ start: "2022-01-21T00:00:00Z", end: "2022-01-22T00:00:00Z" }),
    () => sendChatMessage("c", "What happened?"), () => getChatTranscript("c"),
    () => getIngestionConfig(), () => updateIngestionConfig(config), () => getIngestionStatus(),
  ];
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "regression-key");
    assert.equal(getApiLoadingState().activeCalls, 1);
    count++;
    return Response.json([]);
  };
  for (const call of calls) {
    await call();
    assert.equal(getApiLoadingState().activeCalls, 0);
  }
  assert.equal(count, 9);
});

test("overlapping requests remain loading until both settle, including network failure", async () => {
  let finish!: (response: Response) => void;
  let fail!: (reason: Error) => void;
  globalThis.fetch = () => new Promise((resolve) => { finish = resolve; });
  const first = getCases();
  globalThis.fetch = () => new Promise((_resolve, reject) => { fail = reject; });
  const second = getIngestionStatus();
  assert.equal(getApiLoadingState().activeCalls, 2);
  finish(Response.json([]));
  await first;
  assert.equal(getApiLoadingState().activeCalls, 1);
  const rejection = assert.rejects(second, /Failed to fetch/);
  fail(new TypeError("Failed to fetch"));
  await rejection;
  assert.equal(getApiLoadingState().isLoading, false);
});

test("preserves real JSON and plain-text error bodies", async () => {
  for (const [body, status] of [[JSON.stringify({ detail: "Use lookback_hours=8760" }), 404], ["upstream pipeline unavailable", 500]] as const) {
    globalThis.fetch = async () => new Response(body, { status });
    await assert.rejects(getIngestionStatus(), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.detail, status === 404 ? "Use lookback_hours=8760" : body);
      return true;
    });
  }
});

test("cases screen service uses runtime config and surfaces errors rather than mock fallback", async () => {
  const previousMock = process.env.NEXT_PUBLIC_USE_MOCK;
  process.env.NEXT_PUBLIC_USE_MOCK = "false";
  setApiConfig({ apiKey: "screen-key" });
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "screen-key");
    assert.equal(getApiLoadingState().isLoading, true);
    return Response.json({ detail: "Missing or invalid X-API-Key." }, { status: 401 });
  };
  try {
    await assert.rejects(getScreenCases(720), (error: unknown) => {
      assert.ok(error instanceof ApiClientError);
      assert.equal(error.status, 401);
      assert.equal(error.detail, "Missing or invalid X-API-Key.");
      return true;
    });
  } finally {
    if (previousMock === undefined) delete process.env.NEXT_PUBLIC_USE_MOCK;
    else process.env.NEXT_PUBLIC_USE_MOCK = previousMock;
  }
});

test("case presets use fixed windows and All covers the earliest ingested alert", async () => {
  let called = false;
  globalThis.fetch = async (url) => {
    called = true;
    assert.equal(new URL(String(url)).pathname, "/backend/ingestion/status");
    return Response.json({
      alert_count: 1,
      earliest_alert_timestamp: "2022-01-21T00:00:00Z",
      latest_alert_timestamp: "2022-01-21T01:00:00Z",
      configured_alerts_path: null,
    });
  };
  assert.equal(await resolveLookbackHours("24h"), 24);
  assert.equal(await resolveLookbackHours("7d"), 168);
  assert.equal(await resolveLookbackHours("30d"), 720);
  assert.equal(called, false);
  assert.equal(
    await resolveLookbackHours("all"),
    hoursCoveringTimestamp("2022-01-21T00:00:00Z"),
  );
  assert.equal(called, true);
});

test("case service preserves backend urgency order", async () => {
  const low = { ...exampleCase, case_id: "low", urgency_score: 10 };
  const high = { ...exampleCase, case_id: "high", urgency_score: 90 };
  globalThis.fetch = async () => Response.json([low, high]);
  const cases = await getScreenCases(24);
  assert.deepEqual(cases.map((item) => item.case_id), ["low", "high"]);
});
