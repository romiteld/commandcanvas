import {
  createServerMeetingRouteDependencies,
  handleCreateMeetingRequest,
  meetingServiceUnavailableResponse,
} from "@/lib/supabase/meeting-route-handlers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const result = createServerMeetingRouteDependencies();
  if (!result.ok) return meetingServiceUnavailableResponse();
  return handleCreateMeetingRequest(request, result.dependencies);
}
