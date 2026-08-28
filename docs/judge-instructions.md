# One-click judge instructions

Open **<https://commandcanvas.vercel.app/demo>**. No signup, login form, password, third-party account, API key, or configuration is required. The page creates an anonymous authenticated browser identity behind the scenes and opens a ready room with semantic objects.

## Core path

1. Open the command drawer. Under **Live voice**, press **Start** once and say **Bring in our project board**. The regular `gpt-realtime-2.1` session listens for later commands until you stop it or the bounded session ends. There is no Run click in this path. If live voice is disabled, type the same request in **Human command** and press **Run**.
2. Click **Sketch** and draw two or three boxes with arrows, or enable Hand input, switch the on-canvas mode to **Draw**, and trace them directly on the canvas with your index finger. Repeated lines remain one active sketch. Click **Finish sketch** when done.
3. Select **Rough architecture** and say **Make that usable as an architecture diagram**. The original sketch remains while a structured diagram appears beside it. If live model access is unavailable, the page reports the failure without replacing the source or fabricating a result.
4. Move, resize, or rotate the result. Pin, minimize, restore, trash, recover, undo, and redo all have visible non-gesture controls.
5. Turn on **Select many**, choose two objects, click **Group**, move the semantic frame, then click **Ungroup**.
6. Click **Prepare meeting packet**. Review the exact object snapshot and demo recipient, then click **Approve packet**.
7. Click **Request email send**. Nothing is sent until you press **SEND** in the explicit confirmation. The public environment is preview-only unless Resend and the recipient allowlist are configured. Preview-only means no email was sent.
8. Use **Reset demo** at any time to remove the current demo room and create a clean fixture room.

## Collaboration and meeting media

Click **Copy invite**, open the capability link in a second private or incognito browser window, and move the second participant’s cursor or create a note. Both windows should show actual Supabase Presence and the same durable revision.

Meeting media is optional. In both windows, press **Start camera + mic**. The filmstrip is limited to four present participants. Audio and video travel peer-to-peer; Supabase carries only bounded signaling on the dedicated private media topic. The controlled two-browser path is verified, but physical iPhone devices, arbitrary cross-network traversal, and TURN behavior are not. There is no TURN relay, so a restrictive network may prevent the media connection without affecting the canvas.

## Continuous voice versus ChatGPT Site Tools

**Live voice** is a regular paid `gpt-realtime-2.1` session inside CommandCanvas. It has a narrower tool catalog for safe canvas creation, selected-object operations, local focus, grouping, rotation, undo, redo, and sketch transformation. It cannot discard objects, manage rooms, approve packets, or send email. Microphone audio travels to OpenAI only while Live voice is on.

**ChatGPT Site Tools** are the ten WebMCP tools registered through `document.modelContext` on the same live page. They include canvas read, object creation and transformation, object state, recoverable discard, grouping and ungrouping, undo and redo, sketch transformation, packet preparation, and approved-send staging. Ask **What is on this canvas?**, then **Create a note titled Judge feedback saying The spatial object model is clear.** The final send still requires the host’s explicit **SEND** click.

Native Chrome 153 discovery is tested separately from ChatGPT built-in-browser invocation. If the host does not expose Site Tools, the status honestly reads **Site Tools unavailable** and all essential pointer, typed, and Live voice controls remain functional. A verified paid Realtime voice path must not be treated as proof of ChatGPT Site Tools discovery.

## Hand input

Hand input is optional. If a physical-camera rehearsal succeeds, enable it and complete the large visible calibration surface. CommandCanvas starts the pinned YOLO26 21-keypoint detector; the system drawer names YOLO as the active engine and labels MediaPipe only if YOLO failed and recovery was required. Choose **Draw** and point your index finger to draw repeated strokes directly on the main canvas. Choose **Move**, then pinch one hand to grab and move, pinch both hands and spread to resize, or hold an open palm over an object to focus or restore it. Throw a held object through either red side edge to move it to recoverable trash, or downward into the blue dock to minimize it. These actions open no confirmation drawer; Undo restores the object. Camera frames stay in the browser and only semantic canvas commands leave the tracking layer. The YOLO worker, browser gesture state machine, and Chromium fake-camera lifecycle are verified; physical iPhone camera behavior and general real-hand accuracy are not. If the rehearsal does not succeed, use pointer or touch.

The detailed evidence and known unverified boundaries are maintained in `docs/verification-ledger.md`.
