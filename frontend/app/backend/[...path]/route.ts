import { proxyBackendRequest } from "@/api/backend-proxy";

interface BackendRouteContext {
  params: Promise<{ path: string[] }>;
}

async function handle(request: Request, context: BackendRouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyBackendRequest(request, path);
}

export const dynamic = "force-dynamic";
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
