import {
  handleLoadLatestPacketRequest,
  packetServiceUnavailableResponse,
} from "@/lib/packets/route-handlers";
import { createServerPacketRouteDependencies } from "@/lib/packets/server-dependencies";

export const runtime = "nodejs";

interface LatestPacketRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function GET(
  request: Request,
  context: LatestPacketRouteContext,
) {
  const result = createServerPacketRouteDependencies();
  if (!result.ok) return packetServiceUnavailableResponse();
  const { roomId } = await context.params;
  return handleLoadLatestPacketRequest(request, roomId, result.dependencies);
}
