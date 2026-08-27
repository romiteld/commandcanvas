import {
  handlePreparePacketRequest,
  packetServiceUnavailableResponse,
} from "@/lib/packets/route-handlers";
import { createServerPacketRouteDependencies } from "@/lib/packets/server-dependencies";

export const runtime = "nodejs";

interface PreparePacketRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function POST(
  request: Request,
  context: PreparePacketRouteContext,
) {
  const result = createServerPacketRouteDependencies();
  if (!result.ok) return packetServiceUnavailableResponse();
  const { roomId } = await context.params;
  return handlePreparePacketRequest(request, roomId, result.dependencies);
}
