const COMMANDCANVAS_PRODUCTION_ORIGIN =
  "https://commandcanvas.vercel.app";

export function assertLiveProbeTarget(
  rawTarget: string,
  liveProbeApproved: boolean,
) {
  const target = parseOrigin(rawTarget, "Browser probe target");
  if (isLoopback(target)) return;
  if (target.protocol !== "https:")
    throw new Error("A public browser probe target must use HTTPS.");
  if (!liveProbeApproved)
    throw new Error(
      "Set WEBMCP_LIVE_PROBE=true to authorize a non-loopback browser probe.",
    );
}

export function assertWebMcpProbeTargets(
  rawTarget: string,
  rawApiProxyOrigin: string | undefined,
  liveProbeApproved: boolean,
) {
  assertLiveProbeTarget(rawTarget, liveProbeApproved);
  if (!rawApiProxyOrigin) return;
  const apiProxyOrigin = requireProductionApiProxyOrigin(rawApiProxyOrigin);
  assertLiveProbeTarget(apiProxyOrigin, liveProbeApproved);
}

export function requireProductionApiProxyOrigin(rawOrigin: string) {
  const origin = parseOrigin(rawOrigin, "CommandCanvas API proxy").origin;
  if (origin !== COMMANDCANVAS_PRODUCTION_ORIGIN)
    throw new Error(
      "The browser-test API proxy may target only the canonical CommandCanvas production origin.",
    );
  return origin;
}

function parseOrigin(rawValue: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(rawValue);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  if (parsed.username || parsed.password)
    throw new Error(`${label} must not contain credentials.`);
  return parsed;
}

function isLoopback(url: URL) {
  return url.hostname === "127.0.0.1" || url.hostname === "localhost";
}
