import type { Metadata } from "next";

import { MeetingCommandCanvas } from "@/components/command-canvas/meeting-command-canvas";
import { isPrivateHandRelayConfigured } from "@/lib/gesture/private-hand-relay-server";

export const metadata: Metadata = {
  title: "CommandCanvas meeting",
  description:
    "Create or join an email-verified live spatial collaboration room.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function MeetingPage() {
  return (
    <MeetingCommandCanvas
      privateGpuRelayEnabled={isPrivateHandRelayConfigured()}
    />
  );
}
