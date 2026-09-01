import { z } from "zod";

const ENDPOINT = "/api/openai-credential";
const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const OPENAI_API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{17,509}$/;
const OPENAI_API_KEY_LIKE_PATTERN = /sk-[A-Za-z0-9_-]{17,509}/;
const MAX_RESPONSE_CHARS = 1_000_000;

const credentialStatusSchema = z
  .object({
    configured: z.boolean(),
    fingerprint: z
      .string()
      .regex(/^sha256:[0-9a-f]{16}$/)
      .optional(),
    updatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.configured && (value.fingerprint || value.updatedAt))
      context.addIssue({
        code: "custom",
        message: "An unconfigured credential cannot expose stored metadata.",
      });
  });
const saveInputSchema = z
  .object({
    apiKey: z.string().trim().regex(OPENAI_API_KEY_PATTERN),
    confirmSave: z.literal(true),
  })
  .strict();
const errorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().trim().min(1).max(100),
        message: z.string().trim().min(1).max(280),
      })
      .strict(),
  })
  .strict();

export type BrowserOpenAiCredentialStatus = z.infer<
  typeof credentialStatusSchema
>;

export type BrowserOpenAiCredentialResult =
  | { ok: true; value: BrowserOpenAiCredentialStatus }
  | {
      ok: false;
      error: { code: string; message: string; status?: number };
    };

export interface BrowserOpenAiCredentialApi {
  load: (signal?: AbortSignal) => Promise<BrowserOpenAiCredentialResult>;
  save: (
    input: { apiKey: string; confirmSave: true },
    signal?: AbortSignal,
  ) => Promise<BrowserOpenAiCredentialResult>;
  clear: (signal?: AbortSignal) => Promise<BrowserOpenAiCredentialResult>;
}

export interface BrowserOpenAiCredentialApiOptions {
  accessToken: string;
  fetcher?: CredentialApiFetch;
}

type CredentialApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createBrowserOpenAiCredentialApi({
  accessToken,
  fetcher = fetch,
}: BrowserOpenAiCredentialApiOptions): BrowserOpenAiCredentialApi {
  const tokenValid =
    accessToken.length <= 8_192 && JWT_PATTERN.test(accessToken);

  return {
    load(signal) {
      return requestCredentialStatus({
        tokenValid,
        accessToken,
        fetcher,
        method: "GET",
        signal,
      });
    },
    save(rawInput, signal) {
      if (!tokenValid) return Promise.resolve(authenticationUnavailable());
      const input = saveInputSchema.safeParse(rawInput);
      if (!input.success) return Promise.resolve(invalidRequest());
      return requestCredentialStatus({
        tokenValid,
        accessToken,
        fetcher,
        method: "PUT",
        body: JSON.stringify(input.data),
        signal,
      });
    },
    clear(signal) {
      return requestCredentialStatus({
        tokenValid,
        accessToken,
        fetcher,
        method: "DELETE",
        signal,
      });
    },
  };
}

interface CredentialRequestOptions {
  tokenValid: boolean;
  accessToken: string;
  fetcher: CredentialApiFetch;
  method: "GET" | "PUT" | "DELETE";
  body?: string;
  signal?: AbortSignal;
}

async function requestCredentialStatus({
  tokenValid,
  accessToken,
  fetcher,
  method,
  body,
  signal,
}: CredentialRequestOptions): Promise<BrowserOpenAiCredentialResult> {
  if (!tokenValid) return authenticationUnavailable();
  if (signal?.aborted) return cancelled();

  let response: Response;
  try {
    response = await fetcher(ENDPOINT, {
      method,
      headers:
        body === undefined
          ? { authorization: `Bearer ${accessToken}` }
          : {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
      cache: "no-store",
      ...(body === undefined ? {} : { body }),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return cancelled();
    return serviceUnavailable();
  }

  const contentType = response.headers.get("content-type");
  if (
    contentType?.split(";", 1)[0]?.trim().toLowerCase() !==
    "application/json"
  )
    return invalidResponse(response.status);

  let text: string;
  let bodyValue: unknown;
  try {
    text = await response.text();
    if (
      text.length === 0 ||
      text.length > MAX_RESPONSE_CHARS ||
      OPENAI_API_KEY_LIKE_PATTERN.test(text)
    )
      return invalidResponse(response.status);
    bodyValue = JSON.parse(text);
  } catch {
    return invalidResponse(response.status);
  }

  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(bodyValue);
    if (!parsedError.success) return invalidResponse(response.status);
    if (parsedError.data.error.code === "request_cancelled") return cancelled();
    return {
      ok: false,
      error: { ...parsedError.data.error, status: response.status },
    };
  }

  const status = credentialStatusSchema.safeParse(bodyValue);
  if (!status.success) return invalidResponse(response.status);
  return { ok: true, value: status.data };
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

function authenticationUnavailable(): BrowserOpenAiCredentialResult {
  return failure(
    "authentication_unavailable",
    "OpenAI credential authentication is unavailable.",
  );
}

function invalidRequest(): BrowserOpenAiCredentialResult {
  return failure(
    "invalid_request",
    "OpenAI credential request is invalid.",
  );
}

function serviceUnavailable(): BrowserOpenAiCredentialResult {
  return failure(
    "service_unavailable",
    "OpenAI credential service is temporarily unavailable.",
  );
}

function cancelled(): BrowserOpenAiCredentialResult {
  return failure(
    "request_cancelled",
    "OpenAI credential request was cancelled.",
  );
}

function invalidResponse(status: number): BrowserOpenAiCredentialResult {
  return {
    ok: false,
    error: {
      code: "invalid_response",
      message: "OpenAI credential service returned an invalid response.",
      status,
    },
  };
}

function failure(
  code: string,
  message: string,
): BrowserOpenAiCredentialResult {
  return { ok: false, error: { code, message } };
}
