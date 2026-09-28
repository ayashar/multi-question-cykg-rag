import React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { getInvestigationAgentState, InvestigationLoader, InvestigationLog } from "../investigation-loader";
import CaseDetails from "@/modules/investigation/components/case-details";
import InvestigationReport from "@/modules/investigation/components/investigation-report";
import { buildGraphLayout, MiniAttackGraph } from "@/modules/investigation/components/attack-graph-preview";
import type { Case, CaseAttackGraph, TurnRecord } from "@/api";

test("live agent events control progress and expose completed logs", () => {
  const events = [
    { type: "agent" as const, status: "complete" as const, agent: "guardrails", agent_id: "agent.guardrails", label: "Guardrails Agent", messages: ["Decision: relevant"], timestamp: "2026-09-29T00:00:00Z", elapsed_seconds: 0.1 },
    { type: "agent" as const, status: "running" as const, agent: "question_generation", agent_id: "agent.question_generation", label: "Question Generation Agent", messages: [], timestamp: "2026-09-29T00:00:01Z", elapsed_seconds: 1 },
  ];
  assert.equal(getInvestigationAgentState("guardrails", events), "complete");
  assert.equal(getInvestigationAgentState("question_generation", events), "active");
  assert.equal(getInvestigationAgentState("synthesizer", events), "pending");
  const html = renderToStaticMarkup(<InvestigationLoader caseId="case-test" events={events} />);
  assert.equal((html.match(/data-state="active"/g) ?? []).length, 1);
  assert.equal((html.match(/data-state="complete"/g) ?? []).length, 1);
  assert.equal((html.match(/data-state="pending"/g) ?? []).length, 4);
  assert.match(html, /aria-current="step"/);
  for (const label of ["Guardrails Agent", "Question Generation Agent", "Retrieval Dispatcher", "Evidence Review Agent", "Synthesis Agent", "Grounding Check Agent"]) assert.ok(html.includes(label));
  assert.match(html, /agent\.guardrails/);
  assert.match(html, /Agent activity log/);
  assert.match(html, /Decision: relevant/);
  assert.doesNotMatch(html, /100%|Investigation complete/);
});

test("completed agent logs remain available in the details view", () => {
  const html = renderToStaticMarkup(<InvestigationLog events={[
    { type: "agent", status: "complete", agent: "guardrails", agent_id: "agent.guardrails", label: "Guardrails Agent", messages: ["Decision: relevant"], timestamp: "2026-09-29T00:00:00Z", elapsed_seconds: 0.5 },
  ]} />);
  assert.match(html, /Investigation log/);
  assert.match(html, /Guardrails Agent/);
  assert.match(html, /Decision: relevant/);
  assert.match(html, /1 agents completed/);
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

test("attack graph layout anchors the backend root cause and fans out related nodes", () => {
  const graph: CaseAttackGraph = {
    case_id: "case-graph",
    nodes: [
      { id: "alert:a1", type: "alert", label: "Suspicious POST", timestamp: "2026-09-01T00:00:00Z", rule_level: 10 },
      { id: "host:mail", type: "host", label: "mail", timestamp: null, rule_level: null },
      { id: "mitre:T1071.001", type: "mitre_technique", label: "T1071.001", timestamp: null, rule_level: null },
    ],
    edges: [
      { source: "host:mail", target: "alert:a1", relation: "HAS_ALERT" },
      { source: "alert:a1", target: "mitre:T1071.001", relation: "TRIGGERS" },
    ],
    root_cause_alert_id: "a1",
    chain_order: ["a1"],
  };

  const layout = buildGraphLayout(graph);
  assert.equal(layout.rootNodeId, "alert:a1");
  assert.equal(layout.positions.get("alert:a1")?.x, 72);
  assert.ok((layout.positions.get("host:mail")?.x ?? 0) > (layout.positions.get("alert:a1")?.x ?? 0));
  assert.ok((layout.positions.get("mitre:T1071.001")?.x ?? 0) > (layout.positions.get("alert:a1")?.x ?? 0));
  assert.ok(layout.width > 0);
  assert.ok(layout.height >= 520);

  const preview = renderToStaticMarkup(<MiniAttackGraph graph={graph} />);
  assert.match(preview, /Attack graph preview with 3 nodes and 2 relationships/);
  assert.match(preview, /Preview · Open the full graph to zoom and move/);
  assert.match(preview, /Suspicious POST/);
});
