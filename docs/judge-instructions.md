# One-click judge instructions

Open **<https://commandcanvas.vercel.app/demo>**. This is a temporary, bounded, no-signup judge preview. Review the boundary and choose **Enter no-signup preview**. Only then does the page create an anonymous authenticated browser identity and capped room with semantic objects. The judge encounters no signup form, login form, password, third-party account, or configuration before entry. Canvas, collaboration, hand input, typed commands, and deterministic fallbacks need no OpenAI key. The preview does not save an OpenAI key and cannot send production email. Optional embedded Live voice and direct OpenAI sketch interpretation require your own OpenAI API key for the current tab. Physical hand control and embedded Live voice are implemented experimental surfaces until the exact deployed camera and BYOK microphone paths pass real-device verification; pointer, touch, and typed controls remain the reliable baseline.

## Core path

1. In a ChatGPT desktop app’s built-in browser session that exposes Site Tools, ask **What is on this canvas?** ChatGPT should use `get_canvas_state` against the live room, not a detached transcript. Then ask **Create a note titled Judge feedback saying The spatial object model is clear.** The note and a receipt attributed to the authenticated room member should appear on the same canvas for every participant; the receipt identifies WebMCP as its source. CommandCanvas does not receive the surrounding ChatGPT credential.
2. Treat the preceding step as an explicit host verification, not an assumed capability. If the browser session does not expose Site Tools, the page reports that boundary. Use **Human command** or the visible create controls to continue testing, but do not count that fallback as ChatGPT Site Tools proof.
3. Click **Sketch** and draw a rough visual, or enable Hand input, switch the on-canvas mode to **Draw**, and trace it directly on the canvas with your index finger. For a concrete test, draw three bars labeled Q1, Q2, and Q3. Repeated lines remain one active sketch. Use **Finish sketch** when done.
4. Select the finished sketch and tell the surrounding ChatGPT conversation: **Make that usable as a bar chart: Q1 is 12, Q2 is 19, and Q3 is 31.** ChatGPT uses `get_canvas_state` and semantic object creation to place a linked bar chart beside the preserved source. The created object carries `sourceSketchId` provenance, and the mutation creates a receipt attributed to the authenticated room member with WebMCP source provenance. This path uses the explanation in the ChatGPT conversation; it does not send sketch pixels through WebMCP or claim that ChatGPT visually interpreted them. Use ChatGPT Voice for this step only if the exact host session has already demonstrated a real Site Tool invocation; current OpenAI guidance does not promise Voice-to-Site-Tools behavior. If the host does not expose Site Tools, continue with visible controls without presenting that fallback as ChatGPT proof.
5. Move, resize, or rotate the result. Pin, minimize, restore, trash, recover, undo, and redo all have visible non-gesture controls.
6. Turn on **Select many**, choose two objects, click **Group**, move the semantic frame, then click **Ungroup**.
7. In a verified Site Tools session, ask ChatGPT **Prepare the meeting packet.** Review the exact object snapshot and demo recipient, then click **Approve packet**. Ask ChatGPT **Email this to everyone.** ChatGPT may stage the request, but only the host can press **SEND**.
8. Press **SEND** only after reviewing the staged request. The no-signup judge preview always records **Preview only: not sent**, even when a standard-room Resend integration is configured. That result means no provider call was made and no email was sent.
9. Use **Reset demo** to remove the current temporary room and create a clean fixture room. Reset does not reset durable voice or model-use allowances.

The current structured-output surface supports a generic diagram, architecture diagram, flowchart, pie chart, bar chart, and line chart. The quarterly-signups example is a short judge path, not a restriction on meeting type or audience.

## Collaboration and meeting media

Click **Copy invite**, open the capability link in a second private or incognito browser window, and move the second participant’s cursor or create a note. Both windows should show actual Supabase Presence and the same durable revision.

Meeting media is optional. In both windows, press **Start camera + mic**. The filmstrip is limited to four present participants. Audio and video travel peer-to-peer; Supabase carries only bounded signaling on participant-bound private media topics. Direct STUN is the baseline. When a separate TURN service is enabled, authorized members receive short-lived relay credentials from the server. The controlled two-browser path is verified, but physical iPhone devices, arbitrary cross-network traversal, and configured TURN behavior are not yet accepted on this release. A restrictive network may therefore prevent media without affecting the canvas.

## Standard passwordless meeting path

The no-signup judge preview presents no signup form. Standard hosted meetings begin at
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
allowlist, and the explicit host **SEND** gate. The no-signup judge preview never calls
Resend. A copy-link, preview-only, submitted, failed, and delivered result each
mean different things and are reported separately.

## ChatGPT Site Tools versus optional in-page voice

**ChatGPT Site Tools**, where supported by the current ChatGPT host rollout, are the bounded WebMCP capabilities registered through `document.modelContext` on the same live page. They use the ChatGPT account already signed into the surrounding ChatGPT host. CommandCanvas never receives that ChatGPT credential. They include canvas read, compact semantic creation, bounded selected-note appends through `update_object_content`, spatial transformation, recoverable discard, organization, shared history, sketch transformation, packet preparation, and approved-send staging. In a supported host, ask **What is on this canvas?**, then **Create a note titled Judge feedback saying The spatial object model is clear.** The final send still requires the host’s explicit **SEND** click.

**Optional Live voice** is an implemented, experimental regular paid `gpt-realtime-2.1` session inside CommandCanvas. It requires the person's own OpenAI API credential: temporary for the current `/demo` tab, or explicitly saved by a verified non-anonymous `/meet` user. It has a narrower tool catalog for safe canvas creation, selected-object operations, local focus, grouping, rotation, undo, redo, recoverable trash, bounded thought capture, and sketch transformation. **Start a new thought** creates and selects one note card; completed user turns are appended as speech-to-text until **Finish thought**. An explicit spoken discard moves the selected object to recoverable trash and remains undoable; it never permanently deletes data. Live voice cannot manage rooms, approve packets, or send email. Microphone audio travels to OpenAI only while Live voice is on. Do not present it as exact-release physical-microphone proof until a deployed BYOK rehearsal passes. This supporting path is not a substitute for WebMCP and is not evidence that ChatGPT discovered the Site Tools catalog.

The ChatGPT desktop app's built-in browser has website cookies and session state
separate from Chrome. A person who is already signed into ChatGPT may still need
the six-digit CommandCanvas email OTP for a durable `/meet` room in that browser.
The `/demo` judge route remains no-signup.

A ChatGPT subscription does not supply or pay for OpenAI API calls made by embedded Live voice or direct sketch interpretation. In the no-signup `/demo` judge preview, those features use the key entered for the current tab. It is held only in memory, never written to the URL, `localStorage`, `sessionStorage`, Supabase, receipts, or application logs, and has no deployment-owner fallback. The same-origin authenticated server route sees it transiently while creating the requested provider call. Use a project-scoped key with an appropriate budget.

A verified non-anonymous `/meet` user may explicitly save, replace, or delete their own project-scoped key. CommandCanvas encrypts it through Supabase Vault. The raw saved value is never returned to the browser; the server resolves it only at the provider boundary. Saving is optional and does not introduce a deployment-owner fallback.

The separate CommandCanvas vision path can render a selected sketch to PNG and request a schema-validated image interpretation. That optional path uses the person's temporary or saved project-scoped OpenAI API key. It is not required for the WebMCP wow path and is not evidence of ChatGPT Site Tools invocation.

Native Chrome 153 discovery is tested separately from ChatGPT desktop app’s built-in browser invocation. If the host does not expose Site Tools, the status honestly reads **Site Tools unavailable** and all essential pointer and typed controls remain functional. Live voice also remains available when the feature is enabled and the person supplies a valid temporary or saved account credential. A verified Realtime voice path must not be treated as proof of ChatGPT Site Tools discovery.

For the September 2026 challenge verification, use GPT-5.6 Sol or Terra where
Site Tools are available. Availability remains subject to the ChatGPT account,
workspace policy, selected model, and rollout. Mobile and ordinary browsers can
use the responsive canvas, camera-based hand controls, pointer or touch input,
and optional user-key-funded CommandCanvas Live Voice. Those surfaces are not
currently official ChatGPT Site Tools proof.

## Hand input

Hand input is optional. Enable it from the system drawer, then close the drawer and work on the full canvas. The small preview is only a sensor and skeleton check; it is not the movement boundary. A comfortable central camera region maps across the complete canvas. CommandCanvas starts MediaPipe Hand Landmarker in a browser worker and uses a visibly labeled same-model in-page recovery path only if worker initialization or runtime fails. Choose **Draw** and make a deliberate index-finger point to draw repeated strokes directly on the main canvas; open your palm to lift the pen. Choose **Move**, then pinch one hand to grab and move, or pinch both hands over an object and spread to resize. Over blank canvas, drag an open palm to pan the local viewport or use two hands to zoom it around their midpoint. The overlay exposes target, open-hand, pinch, held-object, resizing, panning, and canvas-zoom states so accepted gestures are visible. Throw a held object through either red side edge to move it to recoverable trash, or downward into the blue dock to minimize it. These actions open no confirmation drawer; Undo restores the object.

Local processing is the default and keeps camera frames in the browser. Production also exposes **Use private GPU hand tracking** as a separate consent. Only while that option and Hand input are active may one bounded JPEG or WebP frame at a time go to the configured relay; it returns semantic landmarks and retains no raw frames. It never sends camera frames to ChatGPT, OpenAI, Supabase, or WebMCP. Disable the option to close the relay and return to local MediaPipe. The GPU service, model weights, and operations source are not distributed by this MIT application. Their exact AGPL image source is public at commit [`ee5c2afcfbfc8427b39e2f13e170785c87bce2e3`](https://github.com/romiteld/commandcanvas/tree/ee5c2afcfbfc8427b39e2f13e170785c87bce2e3) on the isolated `hand-relay-source` branch. Do not treat static CUDA measurements, fake media, browser events, or a visible state label as proof of current physical ergonomics. The exact release still needs a physical-camera rehearsal across local and relay modes. If that rehearsal does not succeed, use pointer or touch.

The detailed evidence and known unverified boundaries are maintained in `docs/verification-ledger.md`.
