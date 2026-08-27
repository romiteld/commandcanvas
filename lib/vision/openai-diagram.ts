import "server-only";

import {
  buildDiagramTransformPrompt,
  extractDiagramPayloadFromResponse,
  sketchTransformRequestSchema,
  type SketchTransformRequest,
} from "@/lib/vision/diagram-transform";
import { sketchPayloadSchema, type DiagramPayload, type SketchPayload } from "@/lib/canvas/object-model";

const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_PROVIDER_RESPONSE_CHARS = 1_000_000;
const allowedModels = new Set(["gpt-5.6-terra", "gpt-5.6-sol"] as const);

export type OpenAiDiagramModel = "gpt-5.6-terra" | "gpt-5.6-sol";

export type OpenAiDiagramConfigResult =
  | { ok: true; apiKey: string; model: OpenAiDiagramModel }
  | {
      ok: false;
      code: "vision_unconfigured";
      message: "Sketch interpretation is not configured.";
    };

export type OpenAiDiagramTransformResult =
  | {
      ok: true;
      payload: DiagramPayload;
      responseId: string;
      model: OpenAiDiagramModel;
    }
  | {
      ok: false;
      code:
        | "vision_unconfigured"
        | "provider_unavailable"
        | "invalid_provider_response"
        | "request_cancelled";
      message: string;
    };

export interface OpenAiDiagramTransformInput extends SketchTransformRequest {
  sketch: SketchPayload;
  safetyIdentifier: string;
  signal?: AbortSignal;
}

export interface OpenAiDiagramTransformer {
  transform: (
    input: OpenAiDiagramTransformInput,
  ) => Promise<OpenAiDiagramTransformResult>;
}

export interface OpenAiDiagramTransformerOptions {
  apiKey: string;
  model?: OpenAiDiagramModel;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}

export function readOpenAiDiagramConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): OpenAiDiagramConfigResult {
  const apiKey = environment.OPENAI_API_KEY?.trim() ?? "";
  const rawModel = environment.OPENAI_VISION_MODEL?.trim() || "gpt-5.6-terra";
  if (
    apiKey.length < 20 ||
    /\s/.test(apiKey) ||
    !allowedModels.has(rawModel as OpenAiDiagramModel)
  )
    return unconfigured();
  return {
    ok: true,
    apiKey,
    model: rawModel as OpenAiDiagramModel,
  };
}

export function createOpenAiDiagramTransformer(
  options: OpenAiDiagramTransformerOptions,
): OpenAiDiagramTransformer {
  const model = options.model ?? "gpt-5.6-terra";
  const apiKey = options.apiKey.trim();
  if (
    apiKey.length < 20 ||
    /\s/.test(apiKey) ||
    !allowedModels.has(model)
  )
    throw new Error("OpenAI diagram transformer configuration is invalid.");
  const fetcher = options.fetcher ?? fetch;

  return {
    async transform(rawInput) {
      if (rawInput.signal?.aborted) return cancelled();
      const request = sketchTransformRequestSchema.safeParse({
        roomId: rawInput.roomId,
        sketchObjectId: rawInput.sketchObjectId,
        sourceVersion: rawInput.sourceVersion,
        instruction: rawInput.instruction,
        outputKind: rawInput.outputKind,
        imageDataUrl: rawInput.imageDataUrl,
      });
      const sketch = sketchPayloadSchema.safeParse(rawInput.sketch);
      if (
        !request.success ||
        !sketch.success ||
        !/^cc_[a-z0-9_-]{16,96}$/i.test(rawInput.safetyIdentifier)
      )
        return invalidProviderResponse();

      let prompt: ReturnType<typeof buildDiagramTransformPrompt>;
      try {
        prompt = buildDiagramTransformPrompt(request.data, sketch.data);
      } catch {
        return invalidProviderResponse();
      }

      let response: Response;
      try {
        response = await fetcher(OPENAI_RESPONSES_ENDPOINT, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            model,
            store: false,
            reasoning: { effort: "low" },
            safety_identifier: rawInput.safetyIdentifier,
            max_output_tokens: 4_000,
            ...prompt,
          }),
          signal: rawInput.signal,
        });
      } catch (error) {
        if (rawInput.signal?.aborted || isAbortError(error)) return cancelled();
        return providerUnavailable();
      }

      if (!response.ok) return providerUnavailable();
      const contentType = response.headers.get("content-type");
      if (
        contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return invalidProviderResponse();

      let rawResponse: unknown;
      try {
        const text = await response.text();
        if (text.length === 0 || text.length > MAX_PROVIDER_RESPONSE_CHARS)
          return invalidProviderResponse();
        rawResponse = JSON.parse(text);
      } catch {
        return invalidProviderResponse();
      }

      const projected = projectResponsesOutput(rawResponse);
      if (!projected) return invalidProviderResponse();
      const extracted = extractDiagramPayloadFromResponse(
        request.data,
        { output_text: projected.outputText },
      );
      if (!extracted.ok) return invalidProviderResponse();

      return {
        ok: true,
        payload: extracted.value.payload,
        responseId: projected.responseId,
        model,
      };
    },
  };
}

function projectResponsesOutput(
  value: unknown,
): { responseId: string; outputText: string } | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim())
    return null;
  if (!Array.isArray(value.output)) return null;

  const outputTexts: string[] = [];
  for (const item of value.output) {
    if (!isRecord(item) || item.type !== "message" || !Array.isArray(item.content))
      continue;
    for (const part of item.content) {
      if (
        isRecord(part) &&
        part.type === "output_text" &&
        typeof part.text === "string"
      )
        outputTexts.push(part.text);
    }
  }
  if (outputTexts.length !== 1) return null;
  return { responseId: value.id, outputText: outputTexts[0] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : isRecord(error) && error.name === "AbortError"
  );
}

function unconfigured(): Extract<OpenAiDiagramConfigResult, { ok: false }> {
  return {
    ok: false,
    code: "vision_unconfigured",
    message: "Sketch interpretation is not configured.",
  };
}

function providerUnavailable(): Extract<
  OpenAiDiagramTransformResult,
  { ok: false }
> {
  return {
    ok: false,
    code: "provider_unavailable",
    message: "Sketch interpretation is temporarily unavailable.",
  };
}

function invalidProviderResponse(): Extract<
  OpenAiDiagramTransformResult,
  { ok: false }
> {
  return {
    ok: false,
    code: "invalid_provider_response",
    message: "The model returned an invalid diagram.",
  };
}

function cancelled(): Extract<
  OpenAiDiagramTransformResult,
  { ok: false }
> {
  return {
    ok: false,
    code: "request_cancelled",
    message: "Sketch interpretation was cancelled.",
  };
}
