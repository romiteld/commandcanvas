# Private relay build inputs

The true-640 ONNX file is intentionally not committed in this directory.
Normal tests do not download it. Follow the pinned download, byte-count, and
SHA-256 procedure in [`../README.md`](../README.md) before building
`commandcanvas-hand-relay:yolo26-640-fp16`.

The Docker build copies the staged bytes into the image and verifies them. A
missing or different artifact makes the build fail. Runtime startup repeats the
manifest, tensor, CUDA-provider, and finite-warmup checks. No model is mounted
from the host after the image is built.
