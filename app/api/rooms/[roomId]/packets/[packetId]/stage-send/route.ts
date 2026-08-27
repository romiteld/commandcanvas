import {
  handleStagePacketSendRequest,
  packetServiceUnavailableResponse,
} from "@/lib/packets/route-handlers";
import { createServerPacketRouteDependencies } from "@/lib/packets/server-dependencies";

export const runtime = "nodejs";

interface StagePacketSendRouteContext {
  params: Promise<{ roomId: string; packetId: string }>;
}

export async function POST(
  request: Request,
  context: StagePacketSendRouteContext,
) {
  const result = createServerPacketRouteDependencies();
  if (!result.ok) return packetServiceUnavailableResponse();
  const { roomId, packetId } = await context.params;
  return handleStagePacketSendRequest(
    request,
    roomId,
    packetId,
    result.dependencies,
  );
}
