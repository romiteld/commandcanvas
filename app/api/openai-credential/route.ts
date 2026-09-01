import {
  createServerOpenAiCredentialRouteDependencies,
  handleDeleteOpenAiCredentialRequest,
  handleGetOpenAiCredentialRequest,
  handlePutOpenAiCredentialRequest,
  openAiCredentialUnavailableResponse,
} from "@/lib/openai-credentials/route-handler";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(request: Request) {
  const result = createServerOpenAiCredentialRouteDependencies();
  if (!result.ok) return openAiCredentialUnavailableResponse();
  return handleGetOpenAiCredentialRequest(request, result.dependencies);
}

export async function PUT(request: Request) {
  const result = createServerOpenAiCredentialRouteDependencies();
  if (!result.ok) return openAiCredentialUnavailableResponse();
  return handlePutOpenAiCredentialRequest(request, result.dependencies);
}

export async function DELETE(request: Request) {
  const result = createServerOpenAiCredentialRouteDependencies();
  if (!result.ok) return openAiCredentialUnavailableResponse();
  return handleDeleteOpenAiCredentialRequest(request, result.dependencies);
}
