import { describe, expect, it, vi } from "vitest";

import {
  createBrowserSupabaseClient,
  readPublicSupabaseConfig,
} from "@/lib/supabase/browser-client";

describe("browser Supabase client boundary", () => {
  it("requires only the public URL and publishable key", () => {
    expect(
      readPublicSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toEqual({
      ok: true,
      config: {
        url: "https://project.supabase.co",
        publishableKey: "sb_publishable_test",
      },
    });
  });

  it("returns an honest configuration error without echoing provided values", () => {
    expect(
      readPublicSupabaseConfig({
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "secret-looking-value",
      }),
    ).toEqual({
      ok: false,
      code: "supabase_public_config_invalid",
      message: "Realtime collaboration is not configured.",
    });
  });

  it("creates a persistent browser auth client with no service secret", () => {
    const factory = vi.fn().mockReturnValue({ client: true });

    const result = createBrowserSupabaseClient(
      {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      },
      factory,
    );

    expect(result).toEqual({ ok: true, client: { client: true } });
    expect(factory).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_publishable_test",
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
        },
      },
    );
  });
});
