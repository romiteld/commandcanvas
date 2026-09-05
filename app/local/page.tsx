import type { Metadata } from "next";

import { LocalCommandCanvas } from "@/components/command-canvas/local-command-canvas";

export const metadata: Metadata = {
  title: "CommandCanvas interactive preview",
  description:
    "Try a sketch and its linked diagram, create and arrange objects, and inspect your changes. No account or API key required.",
  robots: { index: false, follow: false },
};

export default function LocalWorkspacePage() {
  return <LocalCommandCanvas />;
}
