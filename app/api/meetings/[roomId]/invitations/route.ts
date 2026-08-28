import {
  createServerMeetingRouteDependencies,
  handleCreateMeetingInvitationRequest,
  meetingServiceUnavailableResponse,
} from "@/lib/supabase/meeting-route-handlers";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
) {
  const result = createServerMeetingRouteDependencies();
  if (!result.ok) return meetingServiceUnavailableResponse();
  const { roomId } = await context.params;
  return handleCreateMeetingInvitationRequest(
    request,
    roomId,
    result.dependencies,
  );
}
