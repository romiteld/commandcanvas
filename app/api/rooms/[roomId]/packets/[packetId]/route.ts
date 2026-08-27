import {
  handleUpdatePacketRequest,
  packetServiceUnavailableResponse,
} from "@/lib/packets/route-handlers";
import { createServerPacketRouteDependencies } from "@/lib/packets/server-dependencies";

export const runtime = "nodejs";

interface UpdatePacketRouteContext {
  params: Promise<{ roomId: string; packetId: string }>;
}

export async function PATCH(
  request: Request,
  context: UpdatePacketRouteContext,
) {
  const result = createServerPacketRouteDependencies();
  if (!result.ok) return packetServiceUnavailableResponse();
  const { roomId, packetId } = await context.params;
  return handleUpdatePacketRequest(
    request,
    roomId,
    packetId,
    result.dependencies,
  );
}
