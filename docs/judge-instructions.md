# Judge instructions

## Current public preview

Hosted collaboration is currently paused. For portfolio review, open
[the interactive preview](https://commandcanvas.vercel.app/local) without an
account or API key. Create and move a note, draw, undo, and inspect Activity.
The starting sketch and linked diagram are prepared examples. Changes remain
in the current tab; reload to restore the starting workspace.

[Watch the recorded demonstration](https://youtu.be/s5h2cr2Qpfw) for the broader
project. The instructions below document the earlier hosted judge flow; they
are retained for future hosted-service restoration and are not current public
access instructions. See [the access status](paused-access.md).

## Start here

[Open the temporary no-signup judge preview](https://commandcanvas.vercel.app/demo), review the
short boundary notice, and choose **Enter no-signup preview**.

The judge encounters no signup form, login form, password, third-party account,
API key prompt, or configuration before entering. CommandCanvas creates a
bounded temporary Supabase identity and room only after that click. The canvas,
typed commands, pointer and touch controls, collaboration, receipts, and
deterministic demonstration fixtures need no OpenAI key.

The temporary preview cannot send production email and never receives the
deployment owner's OpenAI credential.

## Fastest product path

1. Create a note from **Create** and drag it to a new position.
2. Resize, minimize, restore, and recoverably discard it. Use **Undo** to return
   it to the exact prior state.
3. Choose **Draw**, add several separate strokes, and finish the sketch. The
   strokes remain one object rather than opening multiple cards or panels.
4. Select the sketch and choose **Make usable**. Without a visitor-owned API
   key, the live provider path refuses honestly and exposes **Prepared
   fallback**; choose that explicitly labeled deterministic result. The rough
   sketch remains visible beside the structured object.
5. Open **Activity**. Human, collaborator, voice, and WebMCP mutations use the
   same revisioned receipt format.
6. Choose **Reset demo** to restore the deterministic starting room.

Every essential step above has a visible pointer, touch, keyboard, or typed
command path. Camera and provider access are enhancements, not entry gates.

## WebMCP challenge path

Use the same production URL inside a ChatGPT built-in browser session that
currently exposes Site Tools. The surrounding ChatGPT account and the temporary
CommandCanvas room identity are separate. CommandCanvas cannot read the
surrounding ChatGPT credential.

Ask these exact prompts:

1. **What is on this canvas?**
2. **Create a note titled Site Tool proof saying ChatGPT changed the live
   canvas.**

A successful challenge-path test has three visible results:

- ChatGPT invokes `get_canvas_state`, then `create_object`.
- The uniquely named note appears on the live canvas.
- Activity shows the committed revision with `webmcp` as its source.

Do not count the typed **Human command** control or in-page **Live voice** as
Site Tools proof. If the host does not expose Site Tools, CommandCanvas reports
that boundary and the rest of the workspace remains usable.

For a second semantic action, select a rough sketch and ask:

**Create a bar chart beside the selected sketch: Q1 is 12, Q2 is 19, and Q3 is
31. Preserve the original sketch.**

This no-key Site Tools prompt supplies the chart semantics explicitly. It does
not claim that WebMCP sent camera frames or sketch pixels to ChatGPT. Direct
image interpretation is a separate, opt-in provider path described below.

## Hand-control path

1. Open **System**, enable **Hand input**, and allow camera access.
2. During calibration, keep the whole open hand visible, then follow the
   fingertip and pinch prompts. The small camera picture is sensor feedback,
   not the movement boundary; the usable canvas is the output surface.
3. Choose **Draw**. The index fingertip is the brush. An open palm lifts the pen,
   and later lines remain in the same sketch until **Finish sketch**.
4. Choose **Move**. Point until an object shows `TARGET`, pinch until it shows
   `HELD`, move it, and open the pinch to release.
5. Pinch with two hands over a selected object and spread or contract to resize.
   Use the same motion over blank canvas to zoom around the two-hand midpoint.
6. Move a held object through a red side edge to arm recoverable trash, or into
   the blue lower zone to minimize. Release only after the intended state is
   visible. **Undo** restores a trashed object.

Local MediaPipe processing is the default and keeps frames in the browser. The
optional private GPU mode requires separate consent and sends at most one
bounded newest-only frame to the configured relay, which returns semantic hand
landmarks. Neither path sends continuous camera footage to ChatGPT, OpenAI,
Supabase, or WebMCP.

Physical accuracy depends on camera placement, lighting, occlusion, and the
device. The final production hand flow remains a named-device acceptance check;
pointer and touch remain the reliable fallback if that check does not pass.

## Optional Live voice and visual interpretation

**Live voice** is an in-page `gpt-realtime-2.1` control surface. It is separate
from ChatGPT Site Tools and uses the visitor's own OpenAI API project key. In
`/demo`, the temporary key remains only in the current tab's memory and is
cleared from the page after connection. A verified `/meet` user may explicitly
save an encrypted account-owned key and later select its fingerprint. Raw saved
keys are never returned to the browser.

Try: **Bring in our project board.** A successful provider path shows the
transcript, an actual `create_board` action, one board, and one voice receipt.
The current release has passed that complete chain using controlled browser
audio. A physical microphone rehearsal is a separate device check.

Direct visual interpretation renders the selected sketch to PNG, sends that
still image plus the user's instruction to the configured vision model,
validates the structured response, and creates a new object beside the
preserved sketch. That real provider chain has passed on production under a
controlled browser test. It also uses the visitor's temporary or saved project
key. A clearly labeled deterministic demo result is not presented as a live
provider result.

A ChatGPT Plus or Pro subscription does not pay for API calls initiated by the
page. ChatGPT-host Site Tools use the already authenticated ChatGPT host; in-page
Live voice and direct visual interpretation use ordinary OpenAI API billing.

## Collaboration and meeting media

Choose **Copy invite**, open the capability link in a second private browser,
and move that participant's cursor or create a note. Both browsers should show
Presence, the same object revision, and a receipt identifying the participant.

Meeting video is optional and limited to four present participants. In both
windows choose **Start camera**. Audio and video are peer-to-peer;
Supabase carries bounded private signaling rather than media. The two-browser
media path is verified with controlled browser media. Physical phones,
arbitrary cross-network traversal, and configured TURN behavior remain separate
acceptance checks and are not required for canvas collaboration.

## Packet and email boundary

Ask a supported Site Tools host to **Prepare the meeting packet**, or use the
visible packet control. Review the exact snapshot and recipients, then let the
host approve that version. An agent may stage **Email this to everyone**, but
only the human host can press the final **SEND** button.

In `/demo`, the result is always **Preview only: not sent**. That means no
provider call was made. A durable `/meet` room can use server-side Resend only
when OTP, sender, recipient policy, and delivery configuration are present. A
submitted provider request is not called delivered; webhook states are reported
separately.

## Durable room path

[Open the passwordless meeting path](https://commandcanvas.vercel.app/meet) to
test a persistent room. It uses a six-digit Supabase email OTP, display-name
profile, exact-email invitation, and no password. This path is not required to
enter the no-signup judge demo. Real OTP, invitation, and packet delivery are
external service checks and should be counted only when the named production
run and its provider status are recorded.

## Evidence boundary

Verified independently on the deployed application:

- Responsive workspace checks at nine viewports from 320 x 568 to 1440 x 900.
- Two independent browser clients sharing Presence, cursors, one durable
  mutation, and its receipt.
- Native Chrome 153 Site Tools discovery, lifecycle cleanup, and cancellation.
- An actual OpenAI Realtime function call and canonical canvas mutation under
  controlled browser audio.
- An actual OpenAI sketch-image interpretation and structured object creation.

Still dependent on the final host, physical device, or external service:

- A ChatGPT-built-in-browser Site Tool invocation.
- Live physical-hand ergonomics and a physical-microphone session.
- Physical phone video, arbitrary cross-network TURN traversal, and private GPU
  relay ergonomics.
- Real OTP, invitation, and packet delivery.

These layers are intentionally not interchangeable. A green source test is not
presented as a browser result, native Chrome discovery is not presented as a
ChatGPT-host invocation, and provider acceptance is not presented as email
delivery. Exact commits, deployments, actions, and receipts are recorded in the
[verification ledger](verification-ledger.md).
