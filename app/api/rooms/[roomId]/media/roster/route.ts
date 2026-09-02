import {
  handleMeetingRosterRequest,
  meetingRosterUnavailableResponse,
} from "@/lib/meeting/media-roster-route";
import { createServerMeetingRosterDependencies } from "@/lib/meeting/media-roster-server";

export const runtime = "nodejs";
export const maxDuration = 10;

interface MeetingRosterRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function GET(request: Request, context: MeetingRosterRouteContext) {
  const result = createServerMeetingRosterDependencies();
  if (!result.ok) return meetingRosterUnavailableResponse();
  const { roomId } = await context.params;
  return handleMeetingRosterRequest(request, roomId, result.dependencies);
}
