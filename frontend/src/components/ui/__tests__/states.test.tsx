import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiErrorView, CaseNotFoundError, TurnResult } from "../error-states";
import { InvestigationLoader } from "../investigation-loader";
import { ApiClientError, type TurnRecord } from "@/api";
import CaseTable from "@/modules/cases/components/case-table";
import CaseListEmptyState from "@/modules/cases/components/case-list-empty-state";
import LookbackSelector from "@/modules/cases/components/lookback-selector";
import type { Case } from "@/modules/cases/types";
import { getUrgencyStripeColor } from "@/modules/cases/components/urgency-indicator";

test("auth dispatcher supplies one retry callback", () => {
  const retry = () => {};
  const element = ApiErrorView({ error: new ApiClientError(401, "Unauthorized", "Invalid key", "/cases"), onRetry: retry });
  assert.equal(element.props.onRetry, retry);
  assert.equal(element.props.onSuccess, undefined);
});

test("404 preserves backend detail and expands rather than narrowing a wide window", () => {
  const html = renderToStaticMarkup(<CaseNotFoundError errorDetail="Case missing within lookback_hours=8760. Reuse your original window." onRetryWithLookback={() => {}} />);
  assert.match(html, /Reuse your original window/);
  assert.match(html, /17520/);
  const other = renderToStaticMarkup(<CaseNotFoundError errorDetail="Investigation has not been started." />);
  assert.match(other, /Investigation has not been started/);
  assert.doesNotMatch(other, /Current Lookback/);
});

test("HTTP 200 pipeline errors suppress successful report content", () => {
  const turn: TurnRecord = {
    case_id: "c", turn_index: 1, question: "Investigate", answer: null,
    critical_analysis: null, mitigation_suggestions: [], recommended_priority: null,
    confidence: null, mitre_techniques: [], cited_entities: [], error: "Pipeline failed",
    timestamp: "2022-01-21T00:00:00Z", latency_seconds: 30,
  };
  const failed = renderToStaticMarkup(<TurnResult turn={turn}><p>No threats found</p></TurnResult>);
  assert.match(failed, /Pipeline Failure/);
  assert.doesNotMatch(failed, /No threats found/);
  const success = renderToStaticMarkup(<TurnResult turn={{ ...turn, error: null }}><p>No threats found</p></TurnResult>);
  assert.match(success, /No threats found/);
});

test("investigation progress is explicitly estimated and accessible", () => {
  const html = renderToStaticMarkup(<InvestigationLoader />);
  assert.match(html, /role="status"/);
  assert.match(html, /not live backend progress/);
});

const caseRow: Case = {
  case_id: "case-low", alert_ids: [], hosts: ["mail"], src_ips: ["10.0.0.1"],
  dst_users: [], mitre_techniques: ["T1078"], sigma_matched_rules: [], alert_count: 7,
  first_seen: "2022-01-21T10:00:00Z", last_seen: "2022-01-21T11:00:00Z",
  max_rule_level: 3, noteworthy_alert_count: 1, urgency_score: 10,
};

test("case table preserves order and renders every required FR1 field", () => {
  const high = { ...caseRow, case_id: "case-high", hosts: [], src_ips: [], urgency_score: 90 };
  const html = renderToStaticMarkup(
    <CaseTable cases={[caseRow, high]} currentPage={1} totalPages={1} onNextPage={() => {}} onPrevPage={() => {}} />,
  );
  assert.ok(html.indexOf("case-low") < html.indexOf("case-high"));
  assert.match(html, /mail/);
  assert.match(html, />7</);
  assert.match(html, /T1078/);
  assert.match(html, /10\.0/);
  assert.match(html, /90\.0/);
  assert.match(html, /2022/);
  assert.match(html, /UTC/);
  assert.match(html, /case-high[\s\S]*?Not available/);
  assert.match(html, /href="\/cases\/case-low"/);
  assert.match(html, /aria-label="Investigate case-low"/);
  assert.doesNotMatch(html, /Available when case investigation is implemented/);
});

test("lookback selector and empty result are explicit and accessible", () => {
  const selector = renderToStaticMarkup(<LookbackSelector activePreset="7d" onSelectPreset={() => {}} />);
  assert.match(selector, /aria-label="Case lookback window"/);
  assert.match(selector, /aria-pressed="true"[^>]*>7d/);
  assert.match(selector, />24h</);
  assert.match(selector, />30d</);
  assert.match(selector, />All</);

  const empty = renderToStaticMarkup(<CaseListEmptyState currentPreset="24h" onExpandLookback={() => {}} />);
  assert.match(empty, /No urgent activity right now/);
  assert.match(empty, /Expand Lookback to All Time/);
});

test("urgency thresholds use distinct score colors", () => {
  assert.notEqual(getUrgencyStripeColor(10), getUrgencyStripeColor(40));
  assert.notEqual(getUrgencyStripeColor(40), getUrgencyStripeColor(70));
});
