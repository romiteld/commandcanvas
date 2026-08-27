import type { Metadata } from "next";

import { DemoCommandCanvas } from "@/components/command-canvas/demo-command-canvas";

export const metadata: Metadata = {
  title: "CommandCanvas: No-signup live demo",
  description:
    "Open a ready-to-use shared spatial workspace with semantic objects, realtime presence, WebMCP Site Tools, and attributable receipts.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <DemoCommandCanvas />;
}
