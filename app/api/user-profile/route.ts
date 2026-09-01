import {
  createServerUserProfileRouteDependencies,
  handleGetUserProfileRequest,
  handlePutUserProfileRequest,
  userProfileUnavailableResponse,
} from "@/lib/user-profiles/route-handler";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(request: Request) {
  const result = createServerUserProfileRouteDependencies();
  if (!result.ok) return userProfileUnavailableResponse();
  return handleGetUserProfileRequest(request, result.dependencies);
}

export async function PUT(request: Request) {
  const result = createServerUserProfileRouteDependencies();
  if (!result.ok) return userProfileUnavailableResponse();
  return handlePutUserProfileRequest(request, result.dependencies);
}
