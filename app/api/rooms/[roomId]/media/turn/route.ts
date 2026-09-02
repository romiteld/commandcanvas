import {
  handleMeetingTurnCredentialRequest,
  meetingTurnUnavailableResponse,
} from "@/lib/meeting/turn-route";
import { createServerMeetingTurnDependencies } from "@/lib/meeting/turn-server";

export const runtime = "nodejs";
export const maxDuration = 10;

interface MeetingTurnRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function POST(request: Request, context: MeetingTurnRouteContext) {
  const result = createServerMeetingTurnDependencies();
  if (!result.ok) return meetingTurnUnavailableResponse();
  const { roomId } = await context.params;
  return handleMeetingTurnCredentialRequest(
    request,
    roomId,
    result.dependencies,
  );
}
