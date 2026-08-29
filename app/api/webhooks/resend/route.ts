import {
  createServerResendWebhookDependencies,
  handleResendWebhookRequest,
} from "@/lib/resend/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = createServerResendWebhookDependencies();
  if (!result.ok)
    return Response.json(
      { ok: false, error: { code: "webhook_unavailable" } },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  return handleResendWebhookRequest(request, result.dependencies);
}
