import {
  createServerRoomRouteDependencies,
  handleJoinRoomRequest,
  serviceUnavailableResponse,
} from "@/lib/supabase/route-handlers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const result = createServerRoomRouteDependencies();
  if (!result.ok) return serviceUnavailableResponse();
  return handleJoinRoomRequest(request, result.dependencies);
}
