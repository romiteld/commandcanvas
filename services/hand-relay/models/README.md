# Private-relay model artifacts

This directory contains the exact true-640 ONNX artifact tracked as part of
the relay's AGPL corresponding source. Normal tests do not download, replace,
or regenerate it. Verify its pinned byte count and SHA-256 using
[`../README.md`](../README.md) before building
`commandcanvas-hand-relay:yolo26-640-fp16`.

The Docker build copies the tracked bytes into the immutable image and verifies
them. A missing or different artifact makes the build fail. Runtime startup
repeats the manifest, tensor, CUDA-provider, and finite-warmup checks. No model
is mounted from the host after the image is built.

The directory also contains `hybrid-models.lock.json`, which pins the optional
RTMDet-nano detector and RTMPose-m refiner. Their ONNX bytes are intentionally
not tracked. The only accepted local filenames are:

- `rtmdet_nano_8xb32-300e_hand-267f9c8f.onnx`
- `rtmpose-m-distill-256x256.onnx`

From the repository root, validate the lock or existing local files without
network access:

```bash
python3 services/hand-relay/scripts/acquire_hybrid_models.py check-lock
python3 services/hand-relay/scripts/acquire_hybrid_models.py verify
```

Only the explicit `acquire` command opens the two locked source URLs. It stages
and verifies all sources and outputs before replacing either local file:

```bash
python3 services/hand-relay/scripts/acquire_hybrid_models.py acquire
```

The `hybrid-rtmpose` Compose profile copies those local files into its image and
repeats both output byte-count and SHA-256 gates during the build. A normal
Compose invocation and a plain Docker build retain the established YOLO
default. No model is fetched during CI, image build, or container startup.
