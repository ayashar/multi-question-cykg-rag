import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { clearLookbackStore, registerCaseLookback, resetApiConfig, type Case, type TurnRecord } from "@/api";
import { buildInvestigationReport, getInvestigationHref, loadInvestigationCase, parseLookbackHours, runCaseInvestigation } from "@/modules/investigation/services/investigation-service";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; clearLookbackStore(); resetApiConfig(); });
const value: Case = {
  case_id: "fr2-test", alert_ids: ["alert-1"], hosts: ["server-1"], src_ips: ["10.0.0.1"], dst_users: ["admin"],
  mitre_techniques: ["T1078"], sigma_matched_rules: [], alert_count: 1,
  first_seen: "2022-01-21T00:00:00Z", last_seen: "2022-01-21T01:00:00Z",
  max_rule_level: 8, noteworthy_alert_count: 1, urgency_score: 82,
};
const turn: TurnRecord = {
  case_id: value.case_id, turn_index: 1, question: "Investigate", answer: "Review the authentication events.",
  critical_analysis: "Evidence is incomplete.", mitigation_suggestions: ["Verify the login with the account owner."],
  recommended_priority: "monitor", confidence: "medium", mitre_techniques: ["T1078"], cited_entities: ["alert-1"],
  error: null, timestamp: "2026-09-21T00:00:00Z", latency_seconds: 45,
};

test("FR2 shares concurrent investigation POSTs and keeps the original discovery window", async () => {
  registerCaseLookback(value.case_id, 8760);
  let calls = 0;
  let finish!: (response: Response) => void;
  globalThis.fetch = async (input, options) => {
    calls++;
    assert.equal(options?.method, "POST");
    assert.equal(new URL(String(input)).searchParams.get("lookback_hours"), "8760");
    return new Promise((resolve) => { finish = resolve; });
  };
  const first = runCaseInvestigation(value, 24);
  const second = runCaseInvestigation(value, 24);
  assert.equal(first, second);
  assert.equal(calls, 1);
  finish(Response.json(turn));
  assert.deepEqual(await first, turn);
});

test("a rejected FR2 request is released so retry makes a fresh request", async () => {
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(runCaseInvestigation(value), /Failed to fetch/);
  globalThis.fetch = async () => Response.json(turn);
  assert.deepEqual(await runCaseInvestigation(value), turn);
});

test("direct FR2 links recover case context with the supplied window", async () => {
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/backend/cases");
    assert.equal(url.searchParams.get("lookback_hours"), "12000");
    return Response.json([value]);
  };
  assert.deepEqual(await loadInvestigationCase(value.case_id, 12000), value);
});

test("unknown cases expose a useful 404 instead of starting an unrelated investigation", async () => {
  globalThis.fetch = async () => Response.json([]);
  await assert.rejects(loadInvestigationCase("missing-fr2-case", 720), /lookback_hours=720/);
});

test("report downloads include evidence and refuse failed or mismatched turns", () => {
  const report = buildInvestigationReport(value, turn);
  for (const text of [value.case_id, "server-1", "admin", "alert-1", "T1078", "Evidence is incomplete.", "Verify the login"]) assert.ok(report.includes(text));
  assert.throws(() => buildInvestigationReport(value, { ...turn, error: "Pipeline unavailable" }), /successful report/);
  assert.throws(() => buildInvestigationReport(value, { ...turn, case_id: "other" }), /successful report/);
});

test("case links encode IDs and validate lookback query values", () => {
  assert.equal(getInvestigationHref("case/a?b", 720), "/cases/case%2Fa%3Fb?lookback_hours=720");
  assert.equal(parseLookbackHours("720.5"), 720.5);
  for (const invalid of ["", "0", "-1", "Infinity", "invalid", ["24", "720"], undefined]) assert.equal(parseLookbackHours(invalid), undefined);
});
