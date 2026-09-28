import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import type { Case, TurnRecord } from "@/api";
import SourceConfiguration from "@/modules/ingestion/components/source-configuration";
import InvestigationChatroom from "@/modules/investigation/components/investigation-chatroom";

const value: Case = {
  case_id: "case-ui",
  alert_ids: ["alert-1"],
  hosts: ["host-a"],
  src_ips: ["10.0.0.1"],
  dst_users: ["analyst"],
  mitre_techniques: ["T1078"],
  sigma_matched_rules: ["Suspicious activity"],
  alert_count: 1,
  first_seen: "2026-09-21T00:00:00Z",
  last_seen: "2026-09-21T00:01:00Z",
  max_rule_level: 5,
  noteworthy_alert_count: 1,
  urgency_score: 60,
};

const firstTurn: TurnRecord = {
  case_id: "case-ui",
  turn_index: 1,
  question: "Investigate this case",
  answer: "Initial findings",
  critical_analysis: "Initial critical analysis",
  mitigation_suggestions: ["Monitor the host"],
  recommended_priority: "monitor",
  confidence: "medium",
  mitre_techniques: ["T1078"],
  cited_entities: ["alert-1"],
  error: null,
  timestamp: "2026-09-21T00:02:00Z",
  latency_seconds: 12,
};

test("FR4 renders the complete first report inside the shared chat content", () => {
  const followUp: TurnRecord = {
    ...firstTurn,
    turn_index: 2,
    question: "What should I verify next?",
    answer: "Verify endpoint telemetry.",
    critical_analysis: null,
    mitigation_suggestions: [],
    recommended_priority: "escalate",
    confidence: "high",
    mitre_techniques: [],
    cited_entities: [],
  };
  const failedFollowUp: TurnRecord = {
    ...followUp,
    turn_index: 3,
    question: "Did the retry fail?",
    answer: null,
    error: "Pipeline failed",
  };

  const html = renderToStaticMarkup(
    <InvestigationChatroom
      caseId="case-ui"
      value={value}
      initialTurns={[failedFollowUp, followUp, firstTurn]}
    />,
  );

  assert.match(html, /<details/);
  assert.match(html, /Initial investigation report/);
  assert.match(html, /Investigation report/);
  assert.match(html, /Initial critical analysis/);
  assert.match(html, /Mitigation suggestions/);
  assert.match(html, /Confidence/);
  assert.match(html, /Priority/);
  assert.match(html, /Pipeline Failure/);
  assert.ok(html.indexOf("Initial findings") < html.indexOf("What should I verify next?"));
  assert.ok(html.indexOf("What should I verify next?") < html.indexOf("Did the retry fail?"));
  assert.doesNotMatch(html, /aria-label="Investigation views"/);
  assert.doesNotMatch(html, /Graph data is not connected/);
});

test("FR6 explains the operational effect of saving ingestion settings", () => {
  const html = renderToStaticMarkup(<SourceConfiguration />);

  assert.match(html, /Saving does not start or restart ingestion/);
  assert.match(html, /restart the separate ingestion process manually/);
  assert.match(html, /not a live SIEM connection/);
  assert.match(html, /data\/alerts\.jsonl/);
});
