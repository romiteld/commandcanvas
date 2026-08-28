import {
  handlePrivateHandRelaySessionRequest,
  privateHandRelayUnavailableResponse,
} from "@/lib/gesture/private-hand-relay-route";
import { createServerPrivateHandRelayDependencies } from "@/lib/gesture/private-hand-relay-server";

export const runtime = "nodejs";
export const maxDuration = 10;

interface PrivateHandRelayRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function POST(
  request: Request,
  context: PrivateHandRelayRouteContext,
) {
  const result = createServerPrivateHandRelayDependencies();
  if (!result.ok) return privateHandRelayUnavailableResponse();
  const { roomId } = await context.params;
  return handlePrivateHandRelaySessionRequest(
    request,
    roomId,
    result.dependencies,
  );
}
