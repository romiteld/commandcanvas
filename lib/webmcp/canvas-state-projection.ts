import type {
  ActivityReceipt,
  CanvasState,
} from "@/lib/canvas/command-engine";
import type { CanvasObject } from "@/lib/canvas/object-model";

export const WEBMCP_CANVAS_STATE_RESULT_BYTE_BUDGET = 32_768;

const CANVAS_STATE_DATA_BYTE_BUDGET = 30_000;
const OBJECT_SUMMARY_LIMIT = 50;
const RECEIPT_SUMMARY_LIMIT = 20;
const NOTE_TEXT_LIMIT = 800;
const TASKS_PER_COLUMN_LIMIT = 3;
const SCHEDULE_DAY_LIMIT = 7;
const SCHEDULE_ENTRIES_PER_DAY_LIMIT = 2;
const DIAGRAM_NODE_LIMIT = 12;
const DIAGRAM_EDGE_LIMIT = 16;
const RECEIPT_AFFECTED_OBJECT_LIMIT = 12;

type TruncationReason = "object_limit" | "receipt_limit" | "byte_budget";

interface ProjectionInput {
  scope?: "all" | "selected";
  includeReceipts?: boolean;
}

export function projectCanvasState(
  state: CanvasState,
  selectedObjectId: string | null,
  input: ProjectionInput,
) {
  const activeObjects = Object.values(state.objects).filter(
    (object) => !object.deletedAt,
  );
  const scopedObjects =
    input.scope === "selected"
      ? activeObjects.filter((object) => object.id === selectedObjectId)
      : prioritizeSelectedObject(activeObjects, selectedObjectId);
  const consideredObjects = scopedObjects.slice(0, OBJECT_SUMMARY_LIMIT);
  const requestedReceipts = input.includeReceipts === true;
  const receiptCandidates = requestedReceipts
    ? state.receipts.slice(-RECEIPT_SUMMARY_LIMIT)
    : [];

  const objects: ReturnType<typeof summarizeObject>[] = [];
  const receipts: ReturnType<typeof summarizeReceipt>[] = [];
  let objectsOmittedForBytes = 0;
  let receiptsOmittedForBytes = 0;

  for (const object of consideredObjects) {
    const summary = summarizeObject(object);
    const candidateObjects = [...objects, summary];
    if (
      serializedBytes(
        assembleProjection({
          state,
          selectedObjectId,
          requestedReceipts,
          scopedObjectCount: scopedObjects.length,
          objects: candidateObjects,
          receipts,
          objectsOmittedForBytes,
          receiptsOmittedForBytes,
        }),
      ) <= CANVAS_STATE_DATA_BYTE_BUDGET
    )
      objects.push(summary);
    else objectsOmittedForBytes += 1;
  }

  for (const receipt of receiptCandidates) {
    const summary = summarizeReceipt(receipt);
    const candidateReceipts = [...receipts, summary];
    if (
      serializedBytes(
        assembleProjection({
          state,
          selectedObjectId,
          requestedReceipts,
          scopedObjectCount: scopedObjects.length,
          objects,
          receipts: candidateReceipts,
          objectsOmittedForBytes,
          receiptsOmittedForBytes,
        }),
      ) <= CANVAS_STATE_DATA_BYTE_BUDGET
    )
      receipts.push(summary);
    else receiptsOmittedForBytes += 1;
  }

  return assembleProjection({
    state,
    selectedObjectId,
    requestedReceipts,
    scopedObjectCount: scopedObjects.length,
    objects,
    receipts,
    objectsOmittedForBytes,
    receiptsOmittedForBytes,
  });
}

function assembleProjection(input: {
  state: CanvasState;
  selectedObjectId: string | null;
  requestedReceipts: boolean;
  scopedObjectCount: number;
  objects: ReturnType<typeof summarizeObject>[];
  receipts: ReturnType<typeof summarizeReceipt>[];
  objectsOmittedForBytes: number;
  receiptsOmittedForBytes: number;
}) {
  const objectReasons: TruncationReason[] = [];
  if (input.scopedObjectCount > OBJECT_SUMMARY_LIMIT)
    objectReasons.push("object_limit");
  if (input.objectsOmittedForBytes > 0) objectReasons.push("byte_budget");

  const receiptReasons: TruncationReason[] = [];
  if (
    input.requestedReceipts &&
    input.state.receipts.length > RECEIPT_SUMMARY_LIMIT
  )
    receiptReasons.push("receipt_limit");
  if (input.receiptsOmittedForBytes > 0) receiptReasons.push("byte_budget");

  return {
    roomId: input.state.roomId,
    revision: input.state.revision,
    selectedObjectId: input.selectedObjectId,
    objects: input.objects,
    receipts: input.receipts,
    truncation: {
      resultByteBudget: WEBMCP_CANVAS_STATE_RESULT_BYTE_BUDGET,
      objects: {
        total: input.scopedObjectCount,
        returned: input.objects.length,
        omitted: input.scopedObjectCount - input.objects.length,
        limit: OBJECT_SUMMARY_LIMIT,
        reasons: objectReasons,
      },
      receipts: {
        requested: input.requestedReceipts,
        total: input.state.receipts.length,
        returned: input.receipts.length,
        omitted: input.state.receipts.length - input.receipts.length,
        limit: RECEIPT_SUMMARY_LIMIT,
        reasons: receiptReasons,
      },
    },
  };
}

function prioritizeSelectedObject(
  objects: CanvasObject[],
  selectedObjectId: string | null,
) {
  if (!selectedObjectId) return objects;
  const selected = objects.find((object) => object.id === selectedObjectId);
  if (!selected) return objects;
  return [selected, ...objects.filter((object) => object.id !== selectedObjectId)];
}

function summarizeObject(object: CanvasObject) {
  return {
    id: object.id,
    type: object.type,
    title: object.title,
    spatial: {
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      zIndex: object.zIndex,
      rotation: object.rotation ?? 0,
    },
    state: {
      minimized: object.minimized,
      pinned: object.pinned,
      parentId: object.parentId ?? null,
    },
    createdBy: object.createdBy,
    updatedAt: object.updatedAt,
    version: object.version,
    payload: summarizePayload(object),
  };
}

function summarizePayload(object: CanvasObject) {
  switch (object.type) {
    case "note": {
      const text = object.payload.text.slice(0, NOTE_TEXT_LIMIT);
      return {
        tone: object.payload.tone,
        text,
        originalCharacterCount: object.payload.text.length,
        returnedCharacterCount: text.length,
        omittedCharacterCount: object.payload.text.length - text.length,
      };
    }
    case "task_board": {
      const taskCount = object.payload.columns.reduce(
        (total, column) => total + column.tasks.length,
        0,
      );
      const columns = object.payload.columns.map((column) => ({
        id: column.id,
        title: column.title,
        taskCount: column.tasks.length,
        tasks: column.tasks.slice(0, TASKS_PER_COLUMN_LIMIT).map((task) => ({
          id: task.id,
          title: task.title,
          owner: task.owner,
          dueDate: task.dueDate,
          priority: task.priority,
        })),
      }));
      const returnedTaskCount = columns.reduce(
        (total, column) => total + column.tasks.length,
        0,
      );
      return {
        columnCount: object.payload.columns.length,
        taskCount,
        returnedTaskCount,
        omittedTaskCount: taskCount - returnedTaskCount,
        columns,
      };
    }
    case "schedule": {
      const entryCount = object.payload.days.reduce(
        (total, day) => total + day.entries.length,
        0,
      );
      const days = object.payload.days.slice(0, SCHEDULE_DAY_LIMIT).map((day) => ({
        date: day.date,
        label: day.label,
        entryCount: day.entries.length,
        entries: day.entries
          .slice(0, SCHEDULE_ENTRIES_PER_DAY_LIMIT)
          .map((entry) => ({
            id: entry.id,
            time: entry.time,
            title: entry.title,
            owner: entry.owner,
          })),
      }));
      const returnedEntryCount = days.reduce(
        (total, day) => total + day.entries.length,
        0,
      );
      return {
        timezone: object.payload.timezone,
        dayCount: object.payload.days.length,
        returnedDayCount: days.length,
        omittedDayCount: object.payload.days.length - days.length,
        entryCount,
        returnedEntryCount,
        omittedEntryCount: entryCount - returnedEntryCount,
        days,
      };
    }
    case "sketch": {
      const colors = Array.from(
        new Set(object.payload.strokes.map((stroke) => stroke.color)),
      );
      return {
        strokeCount: object.payload.strokes.length,
        pointCount: object.payload.strokes.reduce(
          (total, stroke) => total + stroke.points.length,
          0,
        ),
        colors,
        coordinateDetail: "omitted" as const,
      };
    }
    case "diagram": {
      const nodes = object.payload.nodes.slice(0, DIAGRAM_NODE_LIMIT).map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        x: node.x,
        y: node.y,
      }));
      const edges = object.payload.edges.slice(0, DIAGRAM_EDGE_LIMIT).map((edge) => ({
        id: edge.id,
        from: edge.from,
        to: edge.to,
        label: edge.label,
      }));
      return {
        kind: object.payload.kind,
        sourceSketchId: object.payload.sourceSketchId,
        interpretationSummary: object.payload.interpretationSummary,
        nodeCount: object.payload.nodes.length,
        returnedNodeCount: nodes.length,
        omittedNodeCount: object.payload.nodes.length - nodes.length,
        edgeCount: object.payload.edges.length,
        returnedEdgeCount: edges.length,
        omittedEdgeCount: object.payload.edges.length - edges.length,
        nodes,
        edges,
      };
    }
    case "frame":
      return {
        tone: object.payload.tone,
        container: true as const,
      };
  }
}

function summarizeReceipt(receipt: ActivityReceipt) {
  const affectedObjectIds = receipt.affectedObjectIds.slice(
    0,
    RECEIPT_AFFECTED_OBJECT_LIMIT,
  );
  const description = receipt.description.slice(0, 240);
  return {
    id: receipt.id,
    revision: receipt.revision,
    occurredAt: receipt.occurredAt,
    actor: receipt.actor,
    source: receipt.source,
    action: receipt.action,
    affectedObjectIds,
    affectedObjectCount: receipt.affectedObjectIds.length,
    omittedAffectedObjectCount:
      receipt.affectedObjectIds.length - affectedObjectIds.length,
    description,
    originalDescriptionCharacterCount: receipt.description.length,
    omittedDescriptionCharacterCount:
      receipt.description.length - description.length,
    undoOfReceiptId: receipt.undoOfReceiptId,
  };
}

function serializedBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
