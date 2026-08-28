import { z } from "zod";

import { diagramPayloadSchema } from "@/lib/canvas/object-model";
import {
  sketchTransformRequestSchema,
  type SketchTransformRequest,
} from "@/lib/vision/diagram-transform";

const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_RESPONSE_CHARS = 1_000_000;

const transformValueSchema = z
  .object({
    provider: z.literal("openai"),
    model: z.enum(["gpt-5.6-terra", "gpt-5.6-sol"]),
    responseId: z.string().trim().min(1).max(160),
    sourceSketchId: z
      .string()
      .min(2)
      .max(96)
      .regex(/^[a-z][a-z0-9-]*$/),
    payload: diagramPayloadSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceSketchId !== value.payload.sourceSketchId)
      context.addIssue({
        code: "custom",
        path: ["sourceSketchId"],
        message: "Diagram source does not match its payload.",
      });
  });

const successResponseSchema = z
  .object({ ok: z.literal(true), transform: transformValueSchema })
  .strict();
const errorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().trim().min(1).max(80),
        message: z.string().trim().min(1).max(240),
      })
      .strict(),
  })
  .strict();

export type BrowserSketchTransformValue = z.infer<typeof transformValueSchema>;

export type BrowserSketchTransformResult =
  | { ok: true; value: BrowserSketchTransformValue }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        status?: number;
      };
    };

export interface BrowserSketchTransformApi {
  transform: (
    input: SketchTransformRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserSketchTransformResult>;
}

export interface BrowserSketchTransformApiOptions {
  accessToken: string;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
}

export function createBrowserSketchTransformApi(
  options: BrowserSketchTransformApiOptions,
): BrowserSketchTransformApi {
  const accessToken = options.accessToken;
  const tokenValid =
    accessToken.length <= 8_192 && jwtPattern.test(accessToken);
  const fetcher = options.fetcher ?? fetch;

  return {
    async transform(rawInput, signal) {
      if (!tokenValid)
        return failure(
          "authentication_unavailable",
          "Sketch interpretation authentication is unavailable.",
        );
      if (signal?.aborted) return cancelled();
      const input = sketchTransformRequestSchema.safeParse(rawInput);
      if (!input.success)
        return failure("invalid_request", "Sketch interpretation request is invalid.");

      let response: Response;
      try {
        response = await fetcher(
          `/api/rooms/${input.data.roomId}/transform-sketch`,
          {
            method: "POST",
            cache: "no-store",
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(input.data),
            signal,
          },
        );
      } catch (error) {
        if (signal?.aborted || isAbortError(error)) return cancelled();
        return failure(
          "service_unavailable",
          "Sketch interpretation is temporarily unavailable.",
        );
      }

      const contentType = response.headers.get("content-type");
      if (
        contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
        "application/json"
      )
        return invalidResponse();
      let body: unknown;
      try {
        const text = await response.text();
        if (text.length === 0 || text.length > MAX_RESPONSE_CHARS)
          return invalidResponse();
        body = JSON.parse(text);
      } catch {
        return invalidResponse();
      }

      if (!response.ok) {
        const parsedError = errorResponseSchema.safeParse(body);
        if (!parsedError.success) return invalidResponse();
        if (parsedError.data.error.code === "request_cancelled")
          return cancelled();
        return {
          ok: false,
          error: {
            ...parsedError.data.error,
            status: response.status,
          },
        };
      }

      const parsed = successResponseSchema.safeParse(body);
      if (
        !parsed.success ||
        parsed.data.transform.sourceSketchId !== input.data.sketchObjectId ||
        (input.data.outputKind !== "auto" &&
          parsed.data.transform.payload.kind !== input.data.outputKind)
      )
        return invalidResponse();
      return { ok: true, value: parsed.data.transform };
    },
  };
}

function isAbortError(error: unknown) {
  return (
    error instanceof DOMException
      ? error.name === "AbortError"
      : Boolean(
          error &&
            typeof error === "object" &&
            "name" in error &&
            error.name === "AbortError",
        )
  );
}

function invalidResponse(): BrowserSketchTransformResult {
  return failure(
    "invalid_response",
    "Sketch interpretation returned an invalid response.",
  );
}

function cancelled(): BrowserSketchTransformResult {
  return failure(
    "request_cancelled",
    "Sketch interpretation was cancelled.",
  );
}

function failure(code: string, message: string): BrowserSketchTransformResult {
  return { ok: false, error: { code, message } };
}
