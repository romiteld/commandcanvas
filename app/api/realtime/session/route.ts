import {
  handleRealtimeSessionRequest,
  realtimeSessionUnavailableResponse,
} from "@/lib/realtime-voice/route-handler";
import { createServerRealtimeSessionDependencies } from "@/lib/realtime-voice/server-dependencies";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const result = createServerRealtimeSessionDependencies();
  if (!result.ok) return realtimeSessionUnavailableResponse();
  return handleRealtimeSessionRequest(request, result.dependencies);
}
