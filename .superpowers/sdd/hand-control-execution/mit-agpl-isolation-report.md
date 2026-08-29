# MIT application / AGPL relay isolation report

## Outcome

`DONE_WITH_RUNTIME_VERIFICATION_REQUIRED`

The CommandCanvas browser application and the optional native GPU hand relay
are now separate local repositories with separate license boundaries.

- Main MIT application commit:
  `57c9816a9515b211b74ec36b869bd9ee0dbb5ee3`
- Local AGPL relay root commit:
  `9f652a67dbe2c824ee68f7985ab13bb0af56ae6f`
- Relay repository:
  `/home/romiteld/Development/AI_ML/commandcanvas-hand-relay`

Both commits are authored by Daniel Romitelli without a coauthor. Neither
repository was pushed, deployed, or given a remote by this checkpoint.

## Test-driven boundary

The first contract run failed in the expected places before production was
changed:

```text
Test Files 3 failed (3)
Tests 10 failed | 11 passed (21)
```

Those failures proved the old AGPL root license, distributed model/service
paths, ONNX Runtime dependency, YOLO-first engine selection, notices, and
source copy were still present.

The converted application then passed:

```text
Focused MIT/engine/controller:
4 files, 55 tests passed

Gesture and release boundary:
22 files, 213 tests passed

Complete unit suite:
109 files, 1,122 tests passed

TypeScript: passed
ESLint: passed
MediaPipe worker build: passed
```

The optimized Next.js build was attempted after the worker build. Turbopack
stopped before application compilation because this shared worktree's
`node_modules` symlink points outside the project filesystem root. The build is
not claimed as passed.

## Main application inventory

Removed from the MIT repository:

- browser YOLO detector, unit test, and worker source;
- browser YOLO Playwright worker probe;
- same-origin 320 FP16 ONNX model and model directory documentation;
- generated YOLO worker and copied ONNX Runtime public assets;
- `onnxruntime-web` and its lockfile packages;
- native relay Python service, tests, Docker configuration, model manifests,
  dependency locks, and model documentation;
- relay Caddy operations, reversible-route harness, and relay-only Docker
  ignore file.

Retained in the MIT repository:

- MediaPipe Tasks Vision package and same-origin WASM runtime;
- generated MediaPipe Hand Landmarker worker;
- runtime retrieval of Google's published Hand Landmarker model only after
  Hand input is enabled;
- private-relay consent, session, token, protocol, route, browser transport,
  semantic-result validation, and failure-to-local contracts;
- pointer, touch, and stylus fallbacks.

Explicit filesystem and lockfile scans found no YOLO/ONNX-named artifact in the
application outside historical documentation and external-relay contract
metadata. `public` contains only the MediaPipe worker/WASM runtime plus existing
landing assets. The root manifest and lockfile identify MIT and do not list
`onnxruntime-web`.

## Relay repository inventory

The local `commandcanvas-hand-relay` repository preserves:

- GNU Affero General Public License v3 text and relay notices;
- native Python service, tests, container files, and locked dependencies;
- reversible Caddy route operations and their fake-Caddy behavioral harness;
- 320 rollback artifact:
  `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`;
- 640 candidate artifact:
  `f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e`.

Fresh relay verification passed:

```text
84 Python tests passed
Caddy install/byte-preservation/rollback/reload harness passed
```

The Caddy harness used temporary fixtures and reported that live configuration
was not changed.

## Verification boundary

No provider, public browser, physical camera, physical hand, GPU service,
router, DNS, Vercel deployment, or remote repository was exercised or mutated
by this checkpoint. Earlier browser YOLO and native CUDA measurements belong to
the superseded combined release and do not verify the current MIT/MediaPipe
candidate.

Before enabling the private relay in a public MIT release, publish the separate
relay repository and replace the source-link follow-up with an exact public
commit. Before claiming current hand quality, rerun the target browser camera
lifecycle and physical-hand matrix against the exact MediaPipe release.
