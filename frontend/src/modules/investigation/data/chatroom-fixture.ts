import type { Case, TurnRecord } from "@/api";

export const MOCK_CHAT_ANSWER =
  "No. The alert establishes that the network signature matched; it does not, by itself, prove code execution or persistence on the destination host.";

export function createChatroomCase(caseId: string): Case {
  return {
    case_id: caseId,
    alert_ids: ["alert-001", "alert-002"],
    hosts: ["target-host"],
    src_ips: ["10.24.18.7"],
    dst_users: ["analyst"],
    mitre_techniques: ["T1078"],
    sigma_matched_rules: ["Suspicious network activity"],
    alert_count: 2,
    first_seen: "2026-09-21T00:00:00Z",
    last_seen: "2026-09-21T00:08:00Z",
    max_rule_level: 5,
    noteworthy_alert_count: 1,
    urgency_score: 62,
  };
}

export function createInitialChatTurns(caseId: string): TurnRecord[] {
  return [
    {
      case_id: caseId,
      turn_index: 1,
      question: "Investigate this case.",
      answer: MOCK_CHAT_ANSWER,
      critical_analysis: "The network signature is a strong indicator, but additional endpoint evidence is required to confirm impact.",
      mitigation_suggestions: [],
      recommended_priority: "monitor",
      confidence: "medium",
      mitre_techniques: ["T1078"],
      cited_entities: ["alert-001"],
      error: null,
      timestamp: "2026-09-21T00:10:00Z",
      latency_seconds: 4.2,
    },
    {
      case_id: caseId,
      turn_index: 2,
      question: "Does this alert prove that the target host was compromised?",
      answer: MOCK_CHAT_ANSWER,
      critical_analysis: null,
      mitigation_suggestions: [],
      recommended_priority: "monitor",
      confidence: "medium",
      mitre_techniques: [],
      cited_entities: ["alert-001"],
      error: null,
      timestamp: "2026-09-21T00:11:00Z",
      latency_seconds: 1.1,
    },
  ];
}

export function createMockFollowUpTurn(caseId: string, turnIndex: number, question: string): TurnRecord {
  return {
    case_id: caseId,
    turn_index: turnIndex,
    question,
    answer: "Mock response for this follow-up. A live answer will appear here once the chat endpoint is connected.",
    critical_analysis: null,
    mitigation_suggestions: [],
    recommended_priority: null,
    confidence: null,
    mitre_techniques: [],
    cited_entities: [],
    error: null,
    timestamp: new Date().toISOString(),
    latency_seconds: 0.8,
  };
}
