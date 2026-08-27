import {
  handleSketchTransformRequest,
} from "@/lib/vision/route-handler";
import {
  createServerSketchTransformDependencies,
} from "@/lib/vision/server-dependencies";

export const runtime = "nodejs";
export const maxDuration = 60;

interface TransformSketchRouteContext {
  params: Promise<{ roomId: string }>;
}

export async function POST(
  request: Request,
  context: TransformSketchRouteContext,
) {
  const result = createServerSketchTransformDependencies();
  if (!result.ok)
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: "service_unavailable",
          message: "Sketch interpretation is unavailable.",
        },
      }),
      {
        status: 503,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  const { roomId } = await context.params;
  return handleSketchTransformRequest(request, roomId, result.dependencies);
}
