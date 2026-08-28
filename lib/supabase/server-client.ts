import "server-only";

import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

export const serverSupabaseEnvNames = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
] as const;

export type ServerSupabaseEnvName = (typeof serverSupabaseEnvNames)[number];

export interface ServerSupabaseConfig {
  supabaseUrl: string;
  publishableKey: string;
  secretKey: string;
}

export type ServerSupabaseConfigResult =
  | { ok: true; config: ServerSupabaseConfig }
  | {
      ok: false;
      error: {
        code: "missing_supabase_server_config";
        missing: ServerSupabaseEnvName[];
        message: string;
      };
    };

type ServerEnvironment = Readonly<Record<string, string | undefined>>;

interface ServerClientOptions {
  auth: {
    autoRefreshToken: false;
    detectSessionInUrl: false;
    persistSession: false;
  };
}

export type ServerServiceClientFactory<Client> = (
  supabaseUrl: string,
  secretKey: string,
  options: ServerClientOptions,
) => Client;

export function readServerSupabaseConfig(
  environment: ServerEnvironment = process.env,
): ServerSupabaseConfigResult {
  const values = Object.fromEntries(
    serverSupabaseEnvNames.map((name) => [name, environment[name]?.trim() ?? ""]),
  ) as Record<ServerSupabaseEnvName, string>;
  const missing = serverSupabaseEnvNames.filter((name) => values[name] === "");

  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        code: "missing_supabase_server_config",
        missing,
        message: `Missing server configuration: ${missing.join(", ")}.`,
      },
    };
  }

  return {
    ok: true,
    config: {
      supabaseUrl: values.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      secretKey: values.SUPABASE_SECRET_KEY,
    },
  };
}

export function createServerServiceClient<Client = SupabaseClient>(
  config: ServerSupabaseConfig,
  factory: ServerServiceClientFactory<Client> =
    createSupabaseClient as unknown as ServerServiceClientFactory<Client>,
): Client {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase service client is server-only.");
  }

  return factory(config.supabaseUrl, config.secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

export function createServerUserVerifierClient<Client = SupabaseClient>(
  config: ServerSupabaseConfig,
  factory: ServerServiceClientFactory<Client> =
    createSupabaseClient as unknown as ServerServiceClientFactory<Client>,
): Client {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase user verifier is server-only.");
  }

  return factory(config.supabaseUrl, config.publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}
