import type { Metadata } from "next";

import { LocalCommandCanvas } from "@/components/command-canvas/local-command-canvas";

export const metadata: Metadata = {
  title: "CommandCanvas local workspace",
  description:
    "Use the spatial canvas locally when hosted collaboration is unavailable.",
  robots: { index: false, follow: false },
};

export default function LocalWorkspacePage() {
  return <LocalCommandCanvas />;
}
