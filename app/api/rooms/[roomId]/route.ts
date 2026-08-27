import {
  createServerRoomRouteDependencies,
  handleDeleteDemoRoomRequest,
  serviceUnavailableResponse,
} from "@/lib/supabase/route-handlers";

export const runtime = "nodejs";

interface RoomRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function DELETE(request: Request, context: RoomRouteContext) {
  const result = createServerRoomRouteDependencies();
  if (!result.ok) return serviceUnavailableResponse();
  const { roomId } = await context.params;
  return handleDeleteDemoRoomRequest(request, roomId, result.dependencies);
}
