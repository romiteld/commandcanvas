# Third-Party Notices

CommandCanvas Hand Relay includes native CUDA inference dependencies and two
pinned YOLO hand-pose model artifacts. Exact model provenance and byte hashes
are recorded in [SOURCE.md](SOURCE.md).

## Native CUDA relay runtime

The exact runtime dependency set is pinned in
`services/hand-relay/requirements.lock`.

| Package | Version | License | Upstream source |
| --- | --- | --- | --- |
| `onnxruntime-gpu` | `1.23.2` | MIT | <https://github.com/microsoft/onnxruntime> |
| `FastAPI` | `0.115.6` | MIT | <https://github.com/fastapi/fastapi> |
| `Starlette` | `0.41.3` | BSD-3-Clause | <https://github.com/encode/starlette> |
| `Uvicorn` | `0.34.0` | BSD-3-Clause | <https://github.com/encode/uvicorn> |
| `websockets` | `13.1` | BSD-3-Clause | <https://github.com/python-websockets/websockets> |
| `NumPy` | `2.2.6` | BSD-3-Clause | <https://github.com/numpy/numpy> |
| `Pillow` | `11.3.0` | HPND | <https://github.com/python-pillow/Pillow> |
| `Pydantic` | `2.10.6` | MIT | <https://github.com/pydantic/pydantic> |
| `nvidia-ml-py` | `13.580.82` | BSD-3-Clause | <https://github.com/gpuopenanalytics/pynvml> |

The relay requires ONNX Runtime's `CUDAExecutionProvider` and refuses CPU
fallback. It receives at most one bounded JPEG or WebP frame at a time after
explicit application consent, performs in-memory decode and inference, does not
retain raw frames, and returns semantic hand landmarks. Reverse proxy,
firewall, container runtime, and host logging remain separate trust boundaries.

## YOLO26 Hand Pose models

- Repository: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection>
- Revision: `2abb91a7030e1aa5231ec900ccb2c07ab3f03460`
- Base implementation: <https://github.com/ultralytics/ultralytics>
- Ultralytics licensing guidance: <https://www.ultralytics.com/license>
- Ultralytics AGPL text: <https://www.ultralytics.com/legal/agpl-3-0-software-license>
- Relay release path: AGPL-3.0-only

The pinned repository contains no separate repository-level license file. Its
model card says its training code is MIT and its Ultralytics YOLO26 base model
is AGPL-3.0 or available under an Enterprise License. This repository does not
apply the training-code MIT label to the trained checkpoint or ONNX exports.
The full AGPL license is in [LICENSE](LICENSE); exact artifact provenance,
hashes, and source paths are in [SOURCE.md](SOURCE.md).
