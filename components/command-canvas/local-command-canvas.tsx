"use client";

import { useState } from "react";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import { createCanvasStore } from "@/lib/canvas/canvas-store";

export function LocalCommandCanvas() {
  const [store] = useState(() =>
    createCanvasStore("room-local", {
      actor: {
        id: "participant-local-host",
        displayName: "Danny",
        type: "human",
      },
      createId,
      now: () => new Date().toISOString(),
    }),
  );

  return <CommandCanvasRoom store={store} />;
}

function createId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `${prefix}-${suffix}`;
}
