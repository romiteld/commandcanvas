import { createEmptyCanvasState, type CanvasState } from "@/lib/canvas/command-engine";
import { newCanvasObjectSchema, type NewCanvasObject } from "@/lib/canvas/object-model";

export const LOCAL_PREVIEW_ROOM_ID = "room-local";
export const LOCAL_PREVIEW_SKETCH_ID = "sample-rough-sketch";
export const LOCAL_PREVIEW_DIAGRAM_ID = "sample-structured-diagram";

/** Prepared starting content, not an inference result or a visitor's activity. */
export function createLocalPreviewState(): CanvasState {
  const objects: NewCanvasObject[] = [
    {
      id: LOCAL_PREVIEW_SKETCH_ID,
      type: "sketch",
      title: "Rough sketch · sample",
      x: 28,
      y: 48,
      width: 280,
      height: 280,
      zIndex: 1,
      payload: {
        strokes: [
          stroke("sample-top-box", [[70, 25], [204, 28], [201, 80], [68, 78], [70, 25]]),
          stroke("sample-first-link", [[136, 82], [140, 118], [133, 110], [140, 118], [146, 110]]),
          stroke("sample-middle-box", [[65, 121], [207, 119], [210, 172], [66, 174], [65, 121]]),
          stroke("sample-second-link", [[138, 176], [140, 204], [133, 197], [140, 204], [148, 196]]),
          stroke("sample-bottom-box", [[67, 207], [205, 204], [209, 255], [66, 257], [67, 207]]),
        ],
      },
    },
    {
      id: LOCAL_PREVIEW_DIAGRAM_ID,
      type: "diagram",
      title: "Structured diagram · sample",
      x: 332,
      y: 48,
      width: 300,
      height: 280,
      zIndex: 2,
      payload: {
        kind: "flowchart",
        sourceSketchId: LOCAL_PREVIEW_SKETCH_ID,
        interpretationSummary: "Prepared example: capture an idea, review it, then decide the next step. No AI request has run.",
        nodes: [
          { id: "sample-capture", label: "Capture an idea", kind: "process", x: 70, y: 20, width: 160, height: 52 },
          { id: "sample-review", label: "Review together", kind: "process", x: 70, y: 110, width: 160, height: 52 },
          { id: "sample-decide", label: "Decide next step", kind: "process", x: 70, y: 200, width: 160, height: 52 },
        ],
        edges: [
          { id: "sample-capture-review", from: "sample-capture", to: "sample-review" },
          { id: "sample-review-decide", from: "sample-review", to: "sample-decide" },
        ],
      },
    },
    {
      id: "sample-keep-the-original",
      type: "note",
      title: "Keep the original",
      x: 150,
      y: 380,
      width: 360,
      height: 170,
      zIndex: 3,
      payload: {
        text: "The sketch and diagram above are prepared examples. They remain separate, linked objects. Move either one, create your own note, or draw another idea. Your actions appear in Activity.",
        tone: "sand",
      },
    },
  ];
  const state = createEmptyCanvasState(LOCAL_PREVIEW_ROOM_ID);
  for (const rawObject of objects) {
    const object = newCanvasObjectSchema.parse(rawObject);
    state.objects[object.id] = {
      ...object,
      roomId: LOCAL_PREVIEW_ROOM_ID,
      minimized: false,
      pinned: false,
      createdBy: "prepared-sample",
      createdAt: "2026-09-05T00:00:00.000Z",
      updatedAt: "2026-09-05T00:00:00.000Z",
      deletedAt: null,
      version: 1,
      metadata: { preparedSample: true },
      rotation: 0,
      parentId: null,
    };
  }
  return state;
}

function stroke(id: string, points: number[][]) {
  return { id, color: "#526782", width: 3, points: points.map(([x, y]) => ({ x, y })) };
}
