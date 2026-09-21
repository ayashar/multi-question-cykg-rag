const DEFAULT_BACKEND_URL = "http://127.0.0.1:8000";
const REQUEST_TIMEOUT_MS = 120_000;

const requestHeadersToForward = ["accept", "content-type"] as const;
const responseHeadersToForward = ["cache-control", "content-disposition", "content-type"] as const;

function getBackendUrl(): URL {
  const backend = new URL(process.env.INVESTIGATION_API_URL || DEFAULT_BACKEND_URL);
  if (!["http:", "https:"].includes(backend.protocol)) {
    throw new Error("INVESTIGATION_API_URL must use HTTP or HTTPS.");
  }
  if (backend.username || backend.password) {
    throw new Error("INVESTIGATION_API_URL must not contain credentials.");
  }
  return backend;
}

function buildTargetUrl(request: Request, path: string[]): URL {
  const target = getBackendUrl();
  const basePath = target.pathname.replace(/\/$/, "");
  const encodedPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  target.pathname = `${basePath}/${encodedPath}`;
  target.search = new URL(request.url).search;
  return target;
}

function buildRequestHeaders(request: Request): Headers {
  const headers = new Headers();
  for (const name of requestHeadersToForward) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const apiKey = process.env.INVESTIGATION_API_KEY?.trim();
  if (apiKey) headers.set("X-API-Key", apiKey);
  return headers;
}

function buildResponseHeaders(response: Response): Headers {
  const headers = new Headers();
  for (const name of responseHeadersToForward) {
    const value = response.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

export async function proxyBackendRequest(request: Request, path: string[]): Promise<Response> {
  if (!path.length || path.some((segment) => !segment || segment === "." || segment === "..")) {
    return Response.json({ detail: "Invalid backend path." }, { status: 400 });
  }

  try {
    const method = request.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";
    const body = hasBody ? await request.arrayBuffer() : undefined;
    const upstream = await fetch(buildTargetUrl(request, path), {
      method,
      headers: buildRequestHeaders(request),
      body: body?.byteLength ? body : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: buildResponseHeaders(upstream),
    });
  } catch (reason) {
    const timedOut = reason instanceof DOMException && reason.name === "TimeoutError";
    return Response.json(
      { detail: timedOut ? "The investigation API timed out." : "The investigation API is unavailable." },
      { status: timedOut ? 504 : 502 },
    );
  }
}
