import {
  handleExecutePacketSendRequest,
  packetServiceUnavailableResponse,
} from "@/lib/packets/route-handlers";
import { createServerPacketRouteDependencies } from "@/lib/packets/server-dependencies";

export const runtime = "nodejs";

interface ExecutePacketSendRouteContext {
  params: Promise<{ roomId: string; sendRequestId: string }>;
}

export async function POST(
  request: Request,
  context: ExecutePacketSendRouteContext,
) {
  const result = createServerPacketRouteDependencies();
  if (!result.ok) return packetServiceUnavailableResponse();
  const { roomId, sendRequestId } = await context.params;
  return handleExecutePacketSendRequest(
    request,
    roomId,
    sendRequestId,
    result.dependencies,
  );
}
