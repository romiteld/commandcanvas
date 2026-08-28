import type { Metadata } from "next";

import { CommandCanvasLanding } from "@/components/landing/command-canvas-landing";

export const metadata: Metadata = {
  title: "CommandCanvas | Where meetings become the deliverable",
  description:
    "A live spatial meeting workspace where voice, hands, collaborators, and agents create structured work together on one canvas.",
};

export default function Home() {
  return <CommandCanvasLanding />;
}
