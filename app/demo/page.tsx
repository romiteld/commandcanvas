import type { Metadata } from "next";

import { DemoCommandCanvas } from "@/components/command-canvas/demo-command-canvas";
import { DemoEntry } from "@/components/command-canvas/demo-entry";
import { isPrivateHandRelayConfigured } from "@/lib/gesture/private-hand-relay-server";

export const metadata: Metadata = {
  title: "CommandCanvas: Limited judge preview",
  description:
    "Review a capped shared spatial workspace with semantic objects, realtime presence, WebMCP Site Tools, and attributable receipts.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return (
    <DemoEntry>
      <DemoCommandCanvas
        privateGpuRelayEnabled={isPrivateHandRelayConfigured()}
      />
    </DemoEntry>
  );
}
