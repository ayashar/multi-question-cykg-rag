import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { proxyBackendRequest } from "../backend-proxy";

const originalFetch = globalThis.fetch;
const originalBackendUrl = process.env.INVESTIGATION_API_URL;
const originalApiKey = process.env.INVESTIGATION_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalBackendUrl === undefined) delete process.env.INVESTIGATION_API_URL;
  else process.env.INVESTIGATION_API_URL = originalBackendUrl;
  if (originalApiKey === undefined) delete process.env.INVESTIGATION_API_KEY;
  else process.env.INVESTIGATION_API_KEY = originalApiKey;
});

test("backend proxy injects the server key and preserves method, query, and JSON body", async () => {
  process.env.INVESTIGATION_API_URL = "https://investigation.internal/api/";
  process.env.INVESTIGATION_API_KEY = "server-only-key";
  let target = "";
  let options: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    target = String(input);
    options = init;
    return Response.json({ case_id: "manual-1" }, { status: 201 });
  };

  const requestBody = JSON.stringify({ start: "2026-09-01T00:00:00Z", end: "2026-09-02T00:00:00Z" });
  const request = new Request("http://frontend.local/backend/investigations/time-range?trace=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": "browser-supplied-key",
    },
    body: requestBody,
  });
  const response = await proxyBackendRequest(request, ["investigations", "time-range"]);

  assert.equal(target, "https://investigation.internal/api/investigations/time-range?trace=false");
  assert.equal(options?.method, "POST");
  assert.equal(new Headers(options?.headers).get("X-API-Key"), "server-only-key");
  assert.equal(new Headers(options?.headers).get("Content-Type"), "application/json");
  assert.equal(new TextDecoder().decode(options?.body as ArrayBuffer), requestBody);
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { case_id: "manual-1" });
});

test("backend proxy omits credentials when the server key is not configured", async () => {
  delete process.env.INVESTIGATION_API_KEY;
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("X-API-Key"), null);
    return Response.json([]);
  };

  const response = await proxyBackendRequest(
    new Request("http://frontend.local/backend/cases?lookback_hours=24"),
    ["cases"],
  );
  assert.equal(response.status, 200);
});

test("backend proxy rejects invalid paths and hides upstream connection errors", async () => {
  const invalid = await proxyBackendRequest(
    new Request("http://frontend.local/backend/cases"),
    [".."],
  );
  assert.equal(invalid.status, 400);

  globalThis.fetch = async () => {
    throw new Error("connect ECONNREFUSED 10.0.0.5:8000");
  };
  const unavailable = await proxyBackendRequest(
    new Request("http://frontend.local/backend/cases"),
    ["cases"],
  );
  assert.equal(unavailable.status, 502);
  assert.deepEqual(await unavailable.json(), { detail: "The investigation API is unavailable." });
});
