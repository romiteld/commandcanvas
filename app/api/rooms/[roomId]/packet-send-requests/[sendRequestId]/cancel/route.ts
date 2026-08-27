import {
  handleCancelPacketSendRequest,
  packetServiceUnavailableResponse,
} from "@/lib/packets/route-handlers";
import { createServerPacketRouteDependencies } from "@/lib/packets/server-dependencies";

export const runtime = "nodejs";

interface CancelPacketSendRouteContext {
  params: Promise<{ roomId: string; sendRequestId: string }>;
}

export async function POST(
  request: Request,
  context: CancelPacketSendRouteContext,
) {
  const result = createServerPacketRouteDependencies();
  if (!result.ok) return packetServiceUnavailableResponse();
  const { roomId, sendRequestId } = await context.params;
  return handleCancelPacketSendRequest(
    request,
    roomId,
    sendRequestId,
    result.dependencies,
  );
}
