import type { NextConfig } from "next";

const sourceRevision = /^[0-9a-f]{40}$/.test(
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? "",
)
  ? process.env.VERCEL_GIT_COMMIT_SHA!.trim()
  : "main";

const nextConfig: NextConfig = {
  agentRules: false,
  devIndicators: false,
  env: {
    NEXT_PUBLIC_COMMANDCANVAS_SOURCE_REVISION: sourceRevision,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
          {
            key: "Permissions-Policy",
            value:
              "camera=(self), microphone=(self), accelerometer=(), autoplay=(), geolocation=(), gyroscope=(), magnetometer=(), payment=(), usb=(), xr-spatial-tracking=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
