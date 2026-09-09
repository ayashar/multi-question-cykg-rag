import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getCases,
  investigateCase,
  getAttackGraph,
  investigateTimeRange,
  sendChatMessage,
  getChatTranscript,
  getIngestionConfig,
  updateIngestionConfig,
  getIngestionStatus,
  setApiConfig,
  resetApiConfig,
  clearLookbackStore,
  getCaseLookback,
  ApiClientError,
  Case,
  TurnRecord,
  CaseAttackGraph,
  IngestionConfig,
  IngestionStatus,
} from "../index";

interface MockCall {
  url: string;
  options?: RequestInit;
}

let lastCall: MockCall | null = null;
let mockResponse: {
  status?: number;
  statusText?: string;
  data?: unknown;
  text?: string;
} = {};

const originalFetch = globalThis.fetch;

function setupMockFetch(data: unknown, status = 200, statusText = "OK") {
  mockResponse = { data, status, statusText };
}

describe("API Client Suite", () => {
  beforeEach(() => {
    lastCall = null;
    clearLookbackStore();
    resetApiConfig();
    setApiConfig({
      baseUrl: "http://test-api:8000",
      apiKey: "test-secret-key-123",
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      lastCall = { url: input.toString(), options: init };
      const status = mockResponse.status ?? 200;
      const statusText =
        mockResponse.statusText ?? (status >= 200 && status < 300 ? "OK" : "Error");
      const ok = status >= 200 && status < 300;

      return {
        ok,
        status,
        statusText,
        json: async () => mockResponse.data,
        text: async () =>
          mockResponse.text ??
          (typeof mockResponse.data === "string"
            ? mockResponse.data
            : JSON.stringify(mockResponse.data)),
      } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearLookbackStore();
    resetApiConfig();
  });

  describe("X-API-Key and Headers Wiring", () => {
    it("injects X-API-Key header into GET requests", async () => {
      setupMockFetch([]);
      await getCases();

      assert.ok(lastCall);
      const headers = lastCall.options?.headers as Headers;
      assert.equal(headers.get("X-API-Key"), "test-secret-key-123");
    });

    it("injects X-API-Key and Content-Type: application/json into POST requests", async () => {
      setupMockFetch({
        case_id: "c-1",
        turn_index: 1,
        question: "q",
        timestamp: "2026-09-09T00:00:00Z",
        latency_seconds: 1.0,
      });

      await investigateTimeRange({
        start: "2026-09-01T00:00:00Z",
        end: "2026-09-02T00:00:00Z",
      });

      assert.ok(lastCall);
      const headers = lastCall.options?.headers as Headers;
      assert.equal(headers.get("X-API-Key"), "test-secret-key-123");
      assert.equal(headers.get("Content-Type"), "application/json");
      assert.equal(lastCall.options?.method, "POST");
    });

    it("allows updating the API key at runtime via setApiConfig", async () => {
      setApiConfig({ apiKey: "rotated-key-456" });
      setupMockFetch([]);

      await getCases();

      assert.ok(lastCall);
      const headers = lastCall.options?.headers as Headers;
      assert.equal(headers.get("X-API-Key"), "rotated-key-456");
    });
  });

  describe("Centralized lookback_hours -> case_id Auto-Reuse Rule", () => {
    it("stores lookback_hours from getCases and reuses it in investigateCase", async () => {
      const mockCases: Case[] = [
        {
          case_id: "case-alpha-1",
          alert_ids: ["a1", "a2"],
          hosts: ["srv-01"],
          src_ips: ["192.168.1.10"],
          dst_users: ["root"],
          mitre_techniques: ["T1059"],
          sigma_matched_rules: ["Rule 1"],
          alert_count: 2,
          first_seen: "2026-09-01T10:00:00Z",
          last_seen: "2026-09-01T11:00:00Z",
          max_rule_level: 8,
          noteworthy_alert_count: 1,
          urgency_score: 85.5,
        },
      ];

      setupMockFetch(mockCases);

      const cases = await getCases({ lookback_hours: 72 });
      assert.equal(cases.length, 1);
      assert.equal(getCaseLookback("case-alpha-1"), 72);

      setupMockFetch({
        case_id: "case-alpha-1",
        turn_index: 1,
        question: "Investigate...",
        mitigation_suggestions: ["Patch T1059"],
        mitre_techniques: ["T1059"],
        cited_entities: ["srv-01"],
        timestamp: "2026-09-01T11:05:00Z",
        latency_seconds: 2.1,
      });

      await investigateCase("case-alpha-1");

      assert.ok(lastCall);
      const url = new URL(lastCall.url);
      assert.equal(url.pathname, "/cases/case-alpha-1/investigate");
      assert.equal(url.searchParams.get("lookback_hours"), "72");
    });

    it("reuses lookback_hours in getAttackGraph", async () => {
      const mockCases: Case[] = [
        {
          case_id: "case-beta-2",
          alert_ids: ["a3"],
          hosts: ["srv-02"],
          src_ips: [],
          dst_users: [],
          mitre_techniques: [],
          sigma_matched_rules: [],
          alert_count: 1,
          first_seen: "2026-09-02T10:00:00Z",
          last_seen: "2026-09-02T10:30:00Z",
          max_rule_level: 5,
          noteworthy_alert_count: 0,
          urgency_score: 40.0,
        },
      ];

      setupMockFetch(mockCases);
      await getCases({ lookback_hours: 336 });

      setupMockFetch({
        case_id: "case-beta-2",
        nodes: [{ id: "alert:a3", type: "alert", label: "Suspicious login" }],
        edges: [],
        root_cause_alert_id: "a3",
        chain_order: ["a3"],
      });

      await getAttackGraph("case-beta-2");

      assert.ok(lastCall);
      const url = new URL(lastCall.url);
      assert.equal(url.pathname, "/cases/case-beta-2/attack-graph");
      assert.equal(url.searchParams.get("lookback_hours"), "336");
    });

    it("allows explicit lookback_hours to override cached lookback", async () => {
      setupMockFetch([]);
      await getCases({ lookback_hours: 24 });

      setupMockFetch({
        case_id: "case-gamma",
        turn_index: 1,
        question: "q",
        timestamp: "2026-09-03T00:00:00Z",
        latency_seconds: 1.0,
      });

      await investigateCase({ case_id: "case-gamma", lookback_hours: 100 });

      assert.ok(lastCall);
      const url = new URL(lastCall.url);
      assert.equal(url.searchParams.get("lookback_hours"), "100");
    });
  });

  describe("Individual Endpoints & Data Shape Parsing", () => {
    it("getCases parses Case array accurately", async () => {
      const mockCase: Case = {
        case_id: "c-100",
        alert_ids: ["alert-1"],
        hosts: ["host-a"],
        src_ips: ["10.0.0.1"],
        dst_users: ["admin"],
        mitre_techniques: ["T1078"],
        sigma_matched_rules: ["Admin Login"],
        alert_count: 1,
        first_seen: "2026-09-01T00:00:00Z",
        last_seen: "2026-09-01T01:00:00Z",
        max_rule_level: 10,
        noteworthy_alert_count: 1,
        urgency_score: 95.0,
      };

      setupMockFetch([mockCase]);
      const res = await getCases({ lookback_hours: 24 });

      assert.equal(res.length, 1);
      assert.equal(res[0].case_id, "c-100");
      assert.equal(res[0].max_rule_level, 10);
      assert.equal(res[0].urgency_score, 95.0);
      assert.deepEqual(res[0].mitre_techniques, ["T1078"]);
    });

    it("investigateCase parses TurnRecord accurately", async () => {
      const mockTurn: TurnRecord = {
        case_id: "c-100",
        turn_index: 1,
        question: "Investigate case",
        answer: "Detected brute force attack.",
        critical_analysis: "High likelihood of lateral movement.",
        mitigation_suggestions: ["Isolate host", "Reset admin password"],
        recommended_priority: "critical",
        confidence: "high",
        mitre_techniques: ["T1110"],
        cited_entities: ["host-a", "admin"],
        error: null,
        timestamp: "2026-09-01T01:05:00Z",
        latency_seconds: 3.42,
      };

      setupMockFetch(mockTurn);
      const res = await investigateCase("c-100", 24);

      assert.equal(res.case_id, "c-100");
      assert.equal(res.turn_index, 1);
      assert.equal(res.answer, "Detected brute force attack.");
      assert.equal(res.recommended_priority, "critical");
      assert.deepEqual(res.mitigation_suggestions, [
        "Isolate host",
        "Reset admin password",
      ]);
      assert.equal(res.latency_seconds, 3.42);
    });

    it("getAttackGraph parses CaseAttackGraph accurately", async () => {
      const mockGraph: CaseAttackGraph = {
        case_id: "c-100",
        nodes: [
          {
            id: "alert:a1",
            type: "alert",
            label: "SSH login failed",
            timestamp: "2026-09-01T00:00:00Z",
            rule_level: 6,
          },
          {
            id: "host:host-a",
            type: "host",
            label: "host-a",
          },
        ],
        edges: [
          {
            source: "host:host-a",
            target: "alert:a1",
            relation: "HAS_ALERT",
          },
        ],
        root_cause_alert_id: "a1",
        chain_order: ["a1"],
      };

      setupMockFetch(mockGraph);
      const res = await getAttackGraph("c-100", 24);

      assert.equal(res.case_id, "c-100");
      assert.equal(res.nodes.length, 2);
      assert.equal(res.edges.length, 1);
      assert.equal(res.edges[0].relation, "HAS_ALERT");
      assert.equal(res.root_cause_alert_id, "a1");
      assert.deepEqual(res.chain_order, ["a1"]);
    });

    it("investigateTimeRange posts correct body and parses TurnRecord", async () => {
      const mockTurn: TurnRecord = {
        case_id: "range-case",
        turn_index: 1,
        question: "Investigate range",
        answer: "Range analyzed.",
        critical_analysis: null,
        mitigation_suggestions: [],
        recommended_priority: "low",
        confidence: "medium",
        mitre_techniques: [],
        cited_entities: [],
        error: null,
        timestamp: "2026-09-01T02:00:00Z",
        latency_seconds: 1.5,
      };

      setupMockFetch(mockTurn);
      const res = await investigateTimeRange({
        start: "2026-09-01T00:00:00Z",
        end: "2026-09-01T04:00:00Z",
      });

      assert.ok(lastCall);
      assert.equal(lastCall.options?.method, "POST");
      assert.equal(
        lastCall.options?.body,
        JSON.stringify({
          start: "2026-09-01T00:00:00Z",
          end: "2026-09-01T04:00:00Z",
        })
      );
      assert.equal(res.case_id, "range-case");
      assert.equal(res.answer, "Range analyzed.");
    });

    it("sendChatMessage posts chat message and parses TurnRecord", async () => {
      const mockTurn: TurnRecord = {
        case_id: "c-100",
        turn_index: 2,
        question: "Which IP was the source?",
        answer: "The source IP was 10.0.0.1.",
        critical_analysis: null,
        mitigation_suggestions: [],
        recommended_priority: null,
        confidence: "high",
        mitre_techniques: [],
        cited_entities: ["10.0.0.1"],
        error: null,
        timestamp: "2026-09-01T02:10:00Z",
        latency_seconds: 0.8,
      };

      setupMockFetch(mockTurn);
      const res = await sendChatMessage("c-100", "Which IP was the source?");

      assert.ok(lastCall);
      const url = new URL(lastCall.url);
      assert.equal(url.pathname, "/investigations/c-100/chat");
      assert.equal(lastCall.options?.method, "POST");
      assert.equal(
        lastCall.options?.body,
        JSON.stringify({ message: "Which IP was the source?" })
      );
      assert.equal(res.turn_index, 2);
      assert.equal(res.answer, "The source IP was 10.0.0.1.");
    });

    it("getChatTranscript gets list of TurnRecord", async () => {
      const mockTranscript: TurnRecord[] = [
        {
          case_id: "c-100",
          turn_index: 1,
          question: "Initial directive",
          answer: "Initial diagnosis",
          critical_analysis: null,
          mitigation_suggestions: [],
          recommended_priority: "medium",
          confidence: "high",
          mitre_techniques: [],
          cited_entities: [],
          error: null,
          timestamp: "2026-09-01T01:00:00Z",
          latency_seconds: 1.0,
        },
      ];

      setupMockFetch(mockTranscript);
      const res = await getChatTranscript("c-100");

      assert.ok(lastCall);
      const url = new URL(lastCall.url);
      assert.equal(url.pathname, "/investigations/c-100/chat");
      assert.equal(lastCall.options?.method, "GET");
      assert.equal(res.length, 1);
      assert.equal(res[0].turn_index, 1);
    });

    it("getIngestionConfig parses IngestionConfig", async () => {
      const mockConfig: IngestionConfig = {
        alerts_path: "/data/alerts.jsonl",
        speed: 50000.0,
        max_gap_seconds: 0.5,
      };

      setupMockFetch(mockConfig);
      const res = await getIngestionConfig();

      assert.ok(lastCall);
      const url = new URL(lastCall.url);
      assert.equal(url.pathname, "/ingestion/config");
      assert.equal(lastCall.options?.method, "GET");
      assert.equal(res.speed, 50000.0);
      assert.equal(res.max_gap_seconds, 0.5);
      assert.equal(res.alerts_path, "/data/alerts.jsonl");
    });

    it("updateIngestionConfig puts config and parses returned IngestionConfig", async () => {
      const newConfig: IngestionConfig = {
        alerts_path: "/data/custom.jsonl",
        speed: 1000.0,
        max_gap_seconds: 0.1,
      };

      setupMockFetch(newConfig);
      const res = await updateIngestionConfig(newConfig);

      assert.ok(lastCall);
      const url = new URL(lastCall.url);
      assert.equal(url.pathname, "/ingestion/config");
      assert.equal(lastCall.options?.method, "PUT");
      assert.equal(lastCall.options?.body, JSON.stringify(newConfig));
      assert.equal(res.speed, 1000.0);
      assert.equal(res.alerts_path, "/data/custom.jsonl");
    });

    it("getIngestionStatus parses IngestionStatus", async () => {
      const mockStatus: IngestionStatus = {
        alert_count: 1420,
        earliest_alert_timestamp: "2026-08-20T00:00:00Z",
        latest_alert_timestamp: "2026-08-25T12:00:00Z",
        configured_alerts_path: "/data/alerts.jsonl",
      };

      setupMockFetch(mockStatus);
      const res = await getIngestionStatus();

      assert.ok(lastCall);
      const url = new URL(lastCall.url);
      assert.equal(url.pathname, "/ingestion/status");
      assert.equal(lastCall.options?.method, "GET");
      assert.equal(res.alert_count, 1420);
      assert.equal(res.earliest_alert_timestamp, "2026-08-20T00:00:00Z");
      assert.equal(res.latest_alert_timestamp, "2026-08-25T12:00:00Z");
    });
  });

  describe("Error Handling", () => {
    it("throws ApiClientError with parsed detail on 401 Unauthorized", async () => {
      setupMockFetch({ detail: "Missing or invalid X-API-Key." }, 401, "Unauthorized");

      await assert.rejects(
        async () => {
          await getCases();
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError);
          assert.equal(err.status, 401);
          assert.equal(err.detail, "Missing or invalid X-API-Key.");
          assert.ok(err.url.includes("/cases"));
          return true;
        }
      );
    });

    it("throws ApiClientError with parsed detail on 404 Not Found", async () => {
      setupMockFetch(
        { detail: "Case not-found not found within lookback_hours=24." },
        404,
        "Not Found"
      );

      await assert.rejects(
        async () => {
          await investigateCase("not-found", 24);
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiClientError);
          assert.equal(err.status, 404);
          assert.equal(
            err.detail,
            "Case not-found not found within lookback_hours=24."
          );
          return true;
        }
      );
    });
  });
});
