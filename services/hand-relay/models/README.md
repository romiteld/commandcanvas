# Tracked private-relay model artifact

This directory contains the exact true-640 ONNX artifact tracked as part of
the relay's AGPL corresponding source. Normal tests do not download, replace,
or regenerate it. Verify its pinned byte count and SHA-256 using
[`../README.md`](../README.md) before building
`commandcanvas-hand-relay:yolo26-640-fp16`.

The Docker build copies the tracked bytes into the immutable image and verifies
them. A missing or different artifact makes the build fail. Runtime startup
repeats the manifest, tensor, CUDA-provider, and finite-warmup checks. No model
is mounted from the host after the image is built.
