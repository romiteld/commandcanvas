# One-click judge instructions

Open **<https://commandcanvas.vercel.app/demo>**. This is a limited judge preview: temporary, bounded, and secondary to the signed workspace. Review the boundary and choose **Continue limited judge preview**. Only then does the page create an anonymous authenticated browser identity and capped room with semantic objects. Canvas, collaboration, hand input, typed commands, and deterministic fallbacks need no OpenAI key. The preview does not save an OpenAI key and cannot send production email. Optional embedded Live voice and direct OpenAI sketch interpretation require your own OpenAI API key for the current tab.

## Core path

1. Open the command drawer. To exercise embedded Live voice, enter your own project-scoped OpenAI API key in **Your OpenAI API key**, press **Start** once, and say **Bring in our project board**. The regular `gpt-realtime-2.1` session listens for later commands until you stop it or the bounded session ends. There is no Run click in this path. The key stays in memory for this tab and is not saved by CommandCanvas. If you do not provide a key, type the same request in **Human command** and press **Run**.
   For a hands-free thought card, say **Start a new thought**. Wait for one selected **New thought** card, then speak one or more sentences. Each completed user turn appears inside that same card. The start phrase, **Finish thought**, and assistant speech are excluded. Say **Finish thought** before using other voice tools. Each accepted transcript update produces a canonical mutation and receipt and can be undone.
2. Click **Sketch** and draw a rough visual, or enable Hand input, switch the on-canvas mode to **Draw**, and trace it directly on the canvas with your index finger. For a concrete test, draw three bars labeled Q1, Q2, and Q3, then say **These are quarterly signups: Q1 is 12, Q2 is 19, and Q3 is 31.** Repeated lines remain one active sketch. Say **Finish drawing**, or use **Finish sketch** as the visible fallback.
3. Select the finished sketch and say **Make this sketch professional** as a separate command. CommandCanvas uses the sketch PNG, bounded prior spoken explanation, and instruction to auto-select a supported structured visual. Direct model interpretation uses the same per-tab key. In this example, a schema-validated bar chart appears beside the preserved source. If the key is missing or invalid, or live model access is unavailable, the page reports the failure without replacing the source or fabricating a result.
4. Move, resize, or rotate the result. Pin, minimize, restore, trash, recover, undo, and redo all have visible non-gesture controls.
5. Turn on **Select many**, choose two objects, click **Group**, move the semantic frame, then click **Ungroup**.
6. Click **Prepare meeting packet**. Review the exact object snapshot and demo recipient, then click **Approve packet**.
7. Click **Request email send**. Nothing is sent until you press **SEND** in the explicit confirmation. The limited judge preview is always preview-only, even when a standard-room Resend integration is configured. **Preview only: not sent** means no provider call was made and no email was sent.
8. Use **Reset demo** to remove the current temporary room and create a clean fixture room. Reset does not reset durable voice or model-use allowances.

The current structured-output surface supports a generic diagram, architecture diagram, flowchart, pie chart, bar chart, and line chart. The quarterly-signups example is a short judge path, not a restriction on meeting type or audience.

## Collaboration and meeting media

Click **Copy invite**, open the capability link in a second private or incognito browser window, and move the second participant’s cursor or create a note. Both windows should show actual Supabase Presence and the same durable revision.

Meeting media is optional. In both windows, press **Start camera + mic**. The filmstrip is limited to four present participants. Audio and video travel peer-to-peer; Supabase carries only bounded signaling on the dedicated private media topic. The controlled two-browser path is verified, but physical iPhone devices, arbitrary cross-network traversal, and TURN behavior are not. There is no TURN relay, so a restrictive network may prevent the media connection without affecting the canvas.

## Standard passwordless meeting path

The limited judge preview presents no signup form. Standard hosted meetings begin at
**<https://commandcanvas.vercel.app/meet>** and use a six-digit Supabase Email
OTP with no password or third-party account. A host can create a room, enter an
exact participant email, and choose **Send invitation** or **Copy invitation**.
The invitation uses `/meet#invite=...`; CommandCanvas scrubs that fragment
before constructing its Supabase client or making application requests. The
invited person enters the same email and OTP, then CommandCanvas atomically
checks the verified email, creates participant membership, and consumes the
24-hour invitation.

Three mail boundaries are intentionally separate. Supabase Auth sends OTP mail
through its own configured mailer or custom SMTP. An authenticated host can
submit one exact-email meeting invitation through the server-side Resend API
path; invitation recipients do not use an address allowlist. Approved meeting
packets use a separate server-side Resend API path, a packet-recipient
allowlist, and the explicit host **SEND** gate. The limited judge preview never calls
Resend. A copy-link, preview-only, submitted, failed, and delivered result each
mean different things and are reported separately.

## Continuous voice versus ChatGPT Site Tools

**Live voice** is a regular paid `gpt-realtime-2.1` session inside CommandCanvas. It requires the person's own OpenAI API credential: temporary for the current `/demo` tab, or explicitly saved by a verified non-anonymous `/meet` user. It has a narrower tool catalog for safe canvas creation, selected-object operations, local focus, grouping, rotation, undo, redo, recoverable trash, bounded thought capture, and sketch transformation. An explicit spoken discard moves the selected object to recoverable trash and remains undoable; it never permanently deletes data. Live voice cannot manage rooms, approve packets, or send email. Microphone audio travels to OpenAI only while Live voice is on.

**ChatGPT Site Tools**, where supported by the current ChatGPT host rollout, are the ten WebMCP tools registered through `document.modelContext` on the same live page. They use the ChatGPT account already signed into the surrounding ChatGPT host. CommandCanvas never receives that ChatGPT credential. They include canvas read, object creation and transformation, object state, recoverable discard, grouping and ungrouping, undo and redo, sketch transformation, packet preparation, and approved-send staging. In a supported host, ask **What is on this canvas?**, then **Create a note titled Judge feedback saying The spatial object model is clear.** The final send still requires the host’s explicit **SEND** click.

A ChatGPT subscription does not supply or pay for OpenAI API calls made by embedded Live voice or direct sketch interpretation. In the limited `/demo` judge preview, those features use the key entered for the current tab. It is held only in memory, never written to the URL, `localStorage`, `sessionStorage`, Supabase, receipts, or application logs, and has no deployment-owner fallback. The same-origin authenticated server route sees it transiently while creating the requested provider call. Use a project-scoped key with an appropriate budget.

A verified non-anonymous `/meet` user may explicitly save, replace, or delete their own project-scoped key. CommandCanvas encrypts it through Supabase Vault. The raw saved value is never returned to the browser; the server resolves it only at the provider boundary. Saving is optional and does not introduce a deployment-owner fallback.

Native Chrome 153 discovery is tested separately from ChatGPT built-in-browser invocation. If the host does not expose Site Tools, the status honestly reads **Site Tools unavailable** and all essential pointer and typed controls remain functional. Live voice also remains available when the feature is enabled and the person supplies a valid temporary or saved account credential. A verified Realtime voice path must not be treated as proof of ChatGPT Site Tools discovery.

## Hand input

Hand input is optional. Enable it from the system drawer, then close the drawer and work on the full canvas. The small preview is only a sensor and skeleton check; it is not the movement boundary. A comfortable central camera region maps across the complete canvas. CommandCanvas starts MediaPipe Hand Landmarker in a browser worker and uses a visibly labeled same-model in-page recovery path only if worker initialization or runtime fails. Choose **Draw** and make a deliberate index-finger point to draw repeated strokes directly on the main canvas; open your palm to lift the pen. Choose **Move**, then pinch one hand to grab and move, or pinch both hands over an object and spread to resize. Over blank canvas, drag an open palm to pan the local viewport or use two hands to zoom it around their midpoint. The overlay exposes target, open-hand, pinch, held-object, resizing, panning, and canvas-zoom states so accepted gestures are visible. Throw a held object through either red side edge to move it to recoverable trash, or downward into the blue dock to minimize it. These actions open no confirmation drawer; Undo restores the object.

Local processing is the default and keeps camera frames in the browser. Production also exposes **Use private GPU hand tracking** as a separate consent. Only while that option and Hand input are active may one bounded JPEG or WebP frame at a time go to the configured relay; it returns semantic landmarks and retains no raw frames. It never sends camera frames to ChatGPT, OpenAI, Supabase, or WebMCP. Disable the option to close the relay and return to local MediaPipe. The GPU service, model weights, and operations source are not distributed by this MIT application. Their exact AGPL image source is public at commit [`ee5c2afcfbfc8427b39e2f13e170785c87bce2e3`](https://github.com/romiteld/commandcanvas/tree/ee5c2afcfbfc8427b39e2f13e170785c87bce2e3) on the isolated `hand-relay-source` branch. Do not treat static CUDA measurements, fake media, browser events, or a visible state label as proof of current physical ergonomics. The exact release still needs a physical-camera rehearsal across local and relay modes. If that rehearsal does not succeed, use pointer or touch.

The detailed evidence and known unverified boundaries are maintained in `docs/verification-ledger.md`.
