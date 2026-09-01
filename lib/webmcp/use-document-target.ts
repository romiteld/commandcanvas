"use client";

import { useEffect, useState } from "react";

import { resolveDocumentWebMcpTarget } from "@/lib/webmcp/document-target";
import type { WebMcpRegistrationTarget } from "@/lib/webmcp/registry";

// The host can expose document.modelContext after React has mounted. The dense
// startup checks make the common path fast; the low-frequency recovery check
// remains active because a host may inject or replace the surface without
// producing a page event. Resolving one document property once per second is
// intentionally cheaper and more reliable than treating a late host as
// permanently unavailable.
const STARTUP_RETRY_DELAYS_MS = [0, 50, 150, 350, 750, 1_500, 3_000] as const;
const RECOVERY_INTERVAL_MS = 1_000;

export function useDocumentWebMcpTarget(): WebMcpRegistrationTarget | null {
  // Keep the server render and the first client render identical. Agent hosts
  // can inject document.modelContext before React hydrates; reading it in the
  // state initializer would make the client render "available" over server
  // HTML that says "unavailable". The first zero-delay recovery below exposes
  // the surface immediately after hydration without producing a mismatch.
  const [target, setTarget] = useState<WebMcpRegistrationTarget | null>(null);

  useEffect(() => {
    let active = true;
    const recover = () => {
      if (!active) return;
      const nextTarget = resolveDocumentWebMcpTarget(document);
      setTarget((currentTarget) =>
        currentTarget === nextTarget ? currentTarget : nextTarget,
      );
    };
    const timers = STARTUP_RETRY_DELAYS_MS.map((delay) =>
      window.setTimeout(recover, delay),
    );
    const recoveryInterval = window.setInterval(recover, RECOVERY_INTERVAL_MS);

    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      active = false;
      for (const timer of timers) window.clearTimeout(timer);
      window.clearInterval(recoveryInterval);
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, []);

  return target;
}
