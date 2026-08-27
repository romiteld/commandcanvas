import {
  createServerRoomRouteDependencies,
  handleCommandRequest,
  serviceUnavailableResponse,
} from "@/lib/supabase/route-handlers";

export const runtime = "nodejs";

interface CommandRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function POST(request: Request, context: CommandRouteContext) {
  const result = createServerRoomRouteDependencies();
  if (!result.ok) return serviceUnavailableResponse();
  const { roomId } = await context.params;
  return handleCommandRequest(request, roomId, result.dependencies);
}
