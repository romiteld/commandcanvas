import "server-only";

import type { SupabaseUserVerifier } from "@/lib/supabase/server-auth";
import {
  createServerServiceClient,
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";
import {
  createPacketService,
  type PacketServiceClient,
} from "@/lib/packets/server-service";
import type { PacketRouteDependencies } from "@/lib/packets/route-handlers";

export type ServerPacketRouteDependenciesResult =
  | { ok: true; dependencies: PacketRouteDependencies }
  | { ok: false };

export function createServerPacketRouteDependencies(): ServerPacketRouteDependenciesResult {
  const config = readServerSupabaseConfig();
  if (!config.ok) return { ok: false };

  try {
    const client = createServerServiceClient<PacketServiceClient>(config.config);
    const verifier = createServerUserVerifierClient<SupabaseUserVerifier>(
      config.config,
    );
    return {
      ok: true,
      dependencies: {
        verifier,
        service: createPacketService(client),
      },
    };
  } catch {
    return { ok: false };
  }
}
