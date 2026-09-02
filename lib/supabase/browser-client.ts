import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface PublicSupabaseEnvironment {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface PublicSupabaseConfig {
  url: string;
  publishableKey: string;
}

export type PublicSupabaseConfigResult =
  | { ok: true; config: PublicSupabaseConfig }
  | {
      ok: false;
      code: "supabase_public_config_invalid";
      message: string;
    };

const browserClientOptions = {
  auth: {
    autoRefreshToken: true,
    detectSessionInUrl: false,
    persistSession: true,
  },
} as const;

let sharedBrowserClient: SupabaseClient | null = null;

type BrowserClientFactory<Client> = (
  url: string,
  publishableKey: string,
  options: typeof browserClientOptions,
) => Client;

export function readPublicSupabaseConfig(
  environment: PublicSupabaseEnvironment,
): PublicSupabaseConfigResult {
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey =
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!url || !publishableKey || !isTrustedSupabaseUrl(url))
    return {
      ok: false,
      code: "supabase_public_config_invalid",
      message: "Realtime collaboration is not configured.",
    };

  return { ok: true, config: { url, publishableKey } };
}

export function createBrowserSupabaseClient<Client = SupabaseClient>(
  environment: PublicSupabaseEnvironment,
  factory: BrowserClientFactory<Client> = createClient as BrowserClientFactory<Client>,
):
  | { ok: true; client: Client }
  | Extract<PublicSupabaseConfigResult, { ok: false }> {
  const config = readPublicSupabaseConfig(environment);
  if (!config.ok) return config;

  if (factory === createClient && sharedBrowserClient)
    return { ok: true, client: sharedBrowserClient as Client };

  const client = factory(
    config.config.url,
    config.config.publishableKey,
    browserClientOptions,
  );
  if (factory === createClient) sharedBrowserClient = client as SupabaseClient;
  return { ok: true, client };
}

function isTrustedSupabaseUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
