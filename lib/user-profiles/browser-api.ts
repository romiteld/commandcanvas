import { z } from "zod";

import {
  userProfileDraftSchema,
  userProfileSchema,
  type UserProfile,
  type UserProfileDraft,
} from "@/lib/user-profiles/contracts";
import { parseBearerJwtHeader } from "@/lib/supabase/server-auth";

const responseSchema = z.object({ profile: userProfileSchema.nullable() }).strict();
const errorSchema = z
  .object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
  .strict();

export type BrowserUserProfileResult =
  | { ok: true; value: UserProfile | null }
  | { ok: false; error: { code: string; message: string; status?: number } };

export interface BrowserUserProfileApi {
  load: (signal?: AbortSignal) => Promise<BrowserUserProfileResult>;
  save: (
    profile: UserProfileDraft,
    signal?: AbortSignal,
  ) => Promise<BrowserUserProfileResult>;
}

export function createBrowserUserProfileApi(options: {
  accessToken: string;
  fetcher?: typeof fetch;
}): BrowserUserProfileApi {
  const bearer = parseBearerJwtHeader(`Bearer ${options.accessToken}`);
  const fetcher = options.fetcher ?? fetch;
  return {
    load: (signal) => request("GET", undefined, signal),
    save: (rawProfile, signal) => {
      const profile = userProfileDraftSchema.safeParse(rawProfile);
      if (!profile.success) return Promise.resolve(invalidRequest());
      return request("PUT", JSON.stringify(profile.data), signal);
    },
  };

  async function request(
    method: "GET" | "PUT",
    body: string | undefined,
    signal?: AbortSignal,
  ): Promise<BrowserUserProfileResult> {
    if (!bearer.ok) return authenticationUnavailable();
    if (signal?.aborted) return cancelled();
    try {
      const response = await fetcher("/api/user-profile", {
        method,
        headers:
          body === undefined
            ? { authorization: `Bearer ${bearer.token}` }
            : {
                authorization: `Bearer ${bearer.token}`,
                "content-type": "application/json",
              },
        cache: "no-store",
        ...(body === undefined ? {} : { body }),
        signal,
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const error = errorSchema.safeParse(raw);
        return error.success
          ? {
              ok: false,
              error: { ...error.data.error, status: response.status },
            }
          : invalidResponse(response.status);
      }
      const parsed = responseSchema.safeParse(raw);
      return parsed.success
        ? { ok: true, value: parsed.data.profile }
        : invalidResponse(response.status);
    } catch (error) {
      if (
        signal?.aborted ||
        (error && typeof error === "object" && "name" in error && error.name === "AbortError")
      )
        return cancelled();
      return {
        ok: false,
        error: {
          code: "service_unavailable",
          message: "Your saved profile is temporarily unavailable.",
        },
      };
    }
  }
}

function authenticationUnavailable(): BrowserUserProfileResult {
  return {
    ok: false,
    error: { code: "authentication_unavailable", message: "Profile authentication is unavailable." },
  };
}

function invalidRequest(): BrowserUserProfileResult {
  return { ok: false, error: { code: "invalid_request", message: "Profile is invalid." } };
}

function cancelled(): BrowserUserProfileResult {
  return { ok: false, error: { code: "request_cancelled", message: "Profile request was cancelled." } };
}

function invalidResponse(status: number): BrowserUserProfileResult {
  return {
    ok: false,
    error: {
      code: "invalid_response",
      message: "Profile service returned an invalid response.",
      status,
    },
  };
}
