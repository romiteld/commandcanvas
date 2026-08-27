import type { CanvasCommand } from "@/lib/canvas/object-model";

export function createDemoSeedCommands(): CanvasCommand[] {
  return [
    {
      type: "object.create",
      object: {
        id: "board-launch-readiness",
        type: "task_board",
        title: "Launch readiness",
        x: 92,
        y: 86,
        width: 520,
        height: 310,
        zIndex: 1,
        payload: {
          columns: [
            {
              id: "column-next",
              title: "Next",
              tasks: [
                {
                  id: "task-launch-narrative",
                  title: "Confirm launch narrative",
                  owner: "Daniel",
                  priority: "high",
                },
                {
                  id: "task-judge-path",
                  title: "Verify no-signup judge path",
                  owner: "Sarah",
                  priority: "high",
                },
              ],
            },
            {
              id: "column-progress",
              title: "In progress",
              tasks: [
                {
                  id: "task-webmcp-proof",
                  title: "Record WebMCP tool proof",
                  owner: "Daniel",
                  priority: "medium",
                },
              ],
            },
            {
              id: "column-done",
              title: "Done",
              tasks: [
                {
                  id: "task-realtime-contract",
                  title: "Realtime room contract",
                  owner: "Team",
                  priority: "medium",
                },
              ],
            },
          ],
        },
      },
    },
    {
      type: "object.create",
      object: {
        id: "schedule-submission-week",
        type: "schedule",
        title: "Submission week",
        x: 654,
        y: 88,
        width: 440,
        height: 306,
        zIndex: 2,
        payload: {
          timezone: "America/New_York",
          days: [
            {
              date: "2026-08-31",
              label: "Mon, Aug 31",
              entries: [
                {
                  id: "entry-webmcp-dry-run",
                  time: "10:00",
                  title: "WebMCP dry run",
                  owner: "Daniel",
                },
              ],
            },
            {
              date: "2026-09-01",
              label: "Tue, Sep 1",
              entries: [
                {
                  id: "entry-demo-recording",
                  time: "14:00",
                  title: "Record final demo",
                  owner: "Team",
                },
              ],
            },
          ],
        },
      },
    },
    {
      type: "object.create",
      object: {
        id: "note-decision-preserve-source",
        type: "note",
        title: "Decision",
        x: 292,
        y: 452,
        width: 360,
        height: 164,
        zIndex: 3,
        payload: {
          text: "Preserve the rough sketch beside every structured interpretation.",
          tone: "violet",
        },
      },
    },
  ];
}
