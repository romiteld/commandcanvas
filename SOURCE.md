# Source and license boundary

The CommandCanvas web application is released under the MIT License. Its
canonical application source repository is:

<https://github.com/romiteld/commandcanvas>

A deployed release should link to the exact application commit or tag that
produced it. Private credentials and deployment data are not part of the
repository; `.env.example` documents configuration names without publishing
secret values.

## Browser hand tracking

The application distributes its TypeScript orchestration and a generated
MediaPipe Tasks Vision worker. It does not distribute a YOLO model, YOLO
detector or worker, ONNX Runtime Web, a CUDA service, or GPU deployment
operations.

The MediaPipe Hand Landmarker model is retrieved from Google's published model
URL only after the user enables hand input. The request downloads a model; it
does not upload a camera frame. While this local browser engine is selected,
camera frames remain inside the browser.

The relevant application source is:

- `lib/gesture/mediapipe-hand-detector.ts`
- `lib/gesture/hand-landmarker.worker.ts`
- `lib/gesture/hand-tracking-worker-core.ts`
- `lib/gesture/hand-tracking-controller.ts`
- `lib/gesture/spatial-vision-engine.ts`
- `lib/gesture/spatial-gesture.ts`
- `scripts/build-hand-worker.mjs`

Third-party package and runtime-model notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Optional private GPU relay

The optional private GPU relay is not distributed in this repository. The MIT
application retains only its consent-gated protocol, session, token, route,
and browser transport contracts:

- `lib/gesture/private-hand-relay-contract.ts`
- `lib/gesture/private-hand-relay-client.ts`
- `lib/gesture/private-hand-relay-worker.ts`
- `lib/gesture/private-hand-relay-route.ts`
- `lib/gesture/private-hand-relay-server.ts`

That external service is a distinct deployment and source distribution. Its
model, native inference service, container definitions, and edge operations do
not enter the application package or browser bundle.

### Source-link follow-up

The relay repository has been isolated locally as `commandcanvas-hand-relay`
but is intentionally not published by this checkpoint. Before promoting a
release that offers the external relay, publish that repository and replace
this follow-up with the exact public relay source commit. Until that link
exists, public documentation must describe relay source publication as pending
rather than claiming a remote repository is available.
