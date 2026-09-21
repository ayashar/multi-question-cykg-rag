import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { getInvestigationStageIndex, InvestigationLoader } from "../investigation-loader";
import CaseDetails from "@/modules/investigation/components/case-details";
import InvestigationReport from "@/modules/investigation/components/investigation-report";
import type { Case, TurnRecord } from "@/api";

test("estimated stages advance at boundaries and never imply a finished backend request", () => {
  for (const [seconds, expected] of [[0, 0], [11, 0], [12, 1], [25, 1], [26, 2], [41, 2], [42, 3], [3600, 3]]) {
    assert.equal(getInvestigationStageIndex(seconds), expected);
  }
  const html = renderToStaticMarkup(<InvestigationLoader caseId="case-test" />);
  assert.equal((html.match(/data-state="active"/g) ?? []).length, 1);
  assert.equal((html.match(/data-state="pending"/g) ?? []).length, 3);
  assert.match(html, /aria-current="step"/);
  for (const label of ["Reviewing evidence", "Correlating related alerts", "Building investigation findings", "Preparing report CTA"]) assert.ok(html.includes(label));
  assert.doesNotMatch(html, /100%|Investigation complete/);
});

const value: Case = {
  case_id: "c", alert_ids: Array.from({ length: 7 }, (_, i) => `alert-${i}`), hosts: [], src_ips: [], dst_users: [],
  mitre_techniques: [], sigma_matched_rules: [], alert_count: 7, first_seen: "2022-01-21T00:00:00Z",
  last_seen: "2022-01-21T01:00:00Z", max_rule_level: 5, noteworthy_alert_count: 0, urgency_score: 40,
};
const turn: TurnRecord = {
  case_id: "c", turn_index: 1, question: "q", answer: "Real findings", critical_analysis: null,
  mitigation_suggestions: [], recommended_priority: null, confidence: null, mitre_techniques: [], cited_entities: [],
  error: null, timestamp: "2026-09-21T00:00:00Z", latency_seconds: 30,
};

test("case details render real metadata, timezone, and expandable evidence", () => {
  const html = renderToStaticMarkup(<CaseDetails value={value} />);
  assert.match(html, /7 alerts/);
  assert.match(html, /UTC\+7/);
  assert.match(html, /40\.0/);
  assert.match(html, /Medium/);
  assert.match(html, /See more \(2\)/);
  assert.match(html, /aria-expanded="false"/);
  assert.doesNotMatch(html, />alert-5</);
  assert.match(html, /Not available/);
});

test("failed report content and download actions are suppressed, null fields stay explicit", () => {
  const failed = renderToStaticMarkup(<InvestigationReport value={value} turn={{ ...turn, error: "Pipeline failed" }} />);
  assert.match(failed, /Pipeline Failure/);
  assert.doesNotMatch(failed, /Real findings|Download report/);
  const successful = renderToStaticMarkup(<InvestigationReport value={value} turn={turn} />);
  assert.match(successful, /Real findings/);
  assert.match(successful, /Download report/);
  assert.match(successful, /Not provided/);
  assert.doesNotMatch(successful, /No threats found/);
});
