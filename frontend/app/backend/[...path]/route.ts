import { proxyBackendRequest } from "@/api/backend-proxy";
import { createClient } from "@/lib/supabase/server";

interface BackendRouteContext {
  params: Promise<{ path: string[] }>;
}

async function handle(request: Request, context: BackendRouteContext): Promise<Response> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return Response.json({ detail: "Authentication required." }, { status: 401 });
  }
  const { path } = await context.params;
  return proxyBackendRequest(request, path, data.user.id);
}

export const dynamic = "force-dynamic";
export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const HEAD = handle;
export const OPTIONS = handle;
