import {
  apiRequest,
  resolveCaseLookback,
  type Case,
  type InvestigationProgressEvent,
  type InvestigateCaseParams,
  type TurnRecord,
} from "./client";
import { createDemoInvestigation, demoDelay, getDemoCase, isDemoMode } from "@/demo/demo-data";

export async function investigateCase(input: string | InvestigateCaseParams, explicitLookback?: number): Promise<TurnRecord> {
  const caseId = typeof input === "string" ? input : input.case_id;
  if (isDemoMode()) return demoDelay(createDemoInvestigation(getDemoCase(caseId)), 900);
  const hours = resolveCaseLookback(caseId, typeof input === "string" ? explicitLookback : input.lookback_hours ?? explicitLookback);
  return apiRequest(`/cases/${encodeURIComponent(caseId)}/investigate`, {
    method: "POST", endpointKey: "investigateCase", isInvestigation: true, caseId,
    params: { lookback_hours: hours },
  });
}

const DEMO_AGENTS = [
  ["guardrails", "agent.guardrails", "Guardrails Agent"],
  ["question_generation", "agent.question_generation", "Question Generation Agent"],
  ["dispatch_retrieval", "agent.dispatch_retrieval", "Retrieval Dispatcher"],
  ["review_evidence", "agent.review_evidence", "Evidence Review Agent"],
  ["synthesizer", "agent.synthesizer", "Synthesis Agent"],
  ["grounding_check", "agent.grounding_check", "Grounding Check Agent"],
] as const;

function demoMessages(agent: string, value: Case): string[] {
  const ips = value.src_ips.join(", ") || "case source IPs";
  const techniques = value.mitre_techniques.join(", ") || "identified techniques";
  switch (agent) {
    case "guardrails": return ["Decision: relevant", "Investigation mode: full hypothesis"];
    case "question_generation": return [
      "Generated 6 investigation questions.",
      "Hypothesis: Benign network scanning by an internal IT team.",
      `Question (cypher): Has similar activity from ${ips} previously been resolved as benign?`,
      "Hypothesis: Unauthorized scanning by a user or compromised host.",
      "Question (vector): Does the activity match known reconnaissance behavior?",
    ];
    case "dispatch_retrieval": return [
      "Retrieved evidence for 6 questions from cskg, cypher, vector.",
      "cypher: completed alert correlation.",
      "vector: completed unstructured evidence search.",
      "cskg: completed MITRE knowledge lookup.",
    ];
    case "review_evidence": return [
      "Reviewed evidence for 6 questions.",
      "confirmed: repeated suspicious scanning activity was found.",
      "inconclusive: benign internal scanning was not explicitly verified.",
    ];
    case "synthesizer": return [
      "Built the investigation findings and mitigation recommendations.",
      "Priority: escalate · Confidence: high",
    ];
    default: return ["Grounding check: passed.", `Checked entities: ${ips}; ${techniques}`];
  }
}

async function streamDemoInvestigation(
  caseId: string,
  onEvent: (event: InvestigationProgressEvent) => void,
): Promise<TurnRecord> {
  const value = getDemoCase(caseId);
  const started = Date.now();
  for (const [agent, agentId, label] of DEMO_AGENTS) {
    onEvent({ type: "agent", status: "running", agent, agent_id: agentId, label, messages: [], timestamp: new Date().toISOString(), elapsed_seconds: (Date.now() - started) / 1000 });
    await demoDelay(undefined, 450);
    onEvent({ type: "agent", status: "complete", agent, agent_id: agentId, label, messages: demoMessages(agent, value), timestamp: new Date().toISOString(), elapsed_seconds: (Date.now() - started) / 1000 });
    await demoDelay(undefined, 250);
  }
  const result = createDemoInvestigation(value);
  onEvent({ type: "result", result, timestamp: new Date().toISOString() });
  return result;
}

function createAgentEvent(
  index: number,
  status: "running" | "complete",
  started: number,
  value?: Case,
): InvestigationProgressEvent {
  const [agent, agentId, label] = DEMO_AGENTS[index];
  return {
    type: "agent",
    status,
    agent,
    agent_id: agentId,
    label,
    messages: status === "complete" ? demoMessages(agent, value ?? getDemoCase("pipeline-preview")) : [],
    timestamp: new Date().toISOString(),
    elapsed_seconds: (Date.now() - started) / 1000,
  };
}

export async function investigateCaseStream(
  input: string | InvestigateCaseParams,
  onEvent: (event: InvestigationProgressEvent) => void,
  explicitLookback?: number,
  caseValue?: Case,
): Promise<TurnRecord> {
  const caseId = typeof input === "string" ? input : input.case_id;
  if (isDemoMode()) return streamDemoInvestigation(caseId, onEvent);
  const started = Date.now();
  const timers: ReturnType<typeof setTimeout>[] = [];
  let completedThrough = -1;
  let activeIndex = 0;
  onEvent(createAgentEvent(0, "running", started, caseValue));
  const stageStarts = [1200, 10_000, 28_000, 40_000, 49_000];
  stageStarts.forEach((delay, offset) => {
    timers.push(setTimeout(() => {
      const nextIndex = offset + 1;
      onEvent(createAgentEvent(activeIndex, "complete", started, caseValue));
      completedThrough = activeIndex;
      activeIndex = nextIndex;
      onEvent(createAgentEvent(activeIndex, "running", started, caseValue));
    }, delay));
  });
  try {
    const result = await investigateCase(input, explicitLookback);
    for (let index = completedThrough + 1; index < DEMO_AGENTS.length; index++) {
      onEvent(createAgentEvent(index, "complete", started, caseValue));
    }
    onEvent({ type: "result", result, timestamp: new Date().toISOString() });
    return result;
  } catch (reason) {
    onEvent({ type: "error", message: reason instanceof Error ? reason.message : "Investigation failed.", timestamp: new Date().toISOString(), elapsed_seconds: (Date.now() - started) / 1000 });
    throw reason;
  } finally {
    timers.forEach(clearTimeout);
  }
}
