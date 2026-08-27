import {
  createServerRoomRouteDependencies,
  handleCreateRoomRequest,
  serviceUnavailableResponse,
} from "@/lib/supabase/route-handlers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const result = createServerRoomRouteDependencies();
  if (!result.ok) return serviceUnavailableResponse();
  return handleCreateRoomRequest(request, result.dependencies);
}
