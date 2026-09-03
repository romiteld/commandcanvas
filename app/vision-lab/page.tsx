import type { Metadata } from "next";

import { VisionLabCapture } from "@/components/vision-lab/vision-lab-capture";

export const metadata: Metadata = {
  title: "CommandCanvas Vision Lab",
  description: "Private hand capture for verified CommandCanvas owners.",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

export default function VisionLabPage() {
  return <VisionLabCapture />;
}
