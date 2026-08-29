FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

ARG PRIVATE_HAND_RELAY_MODEL_SOURCE=services/hand-relay/models/yolo26_hand_pose_640_fp16.onnx
ARG PRIVATE_HAND_RELAY_MODEL_FILENAME=yolo26_hand_pose_640_fp16.onnx
ARG PRIVATE_HAND_RELAY_MODEL_SHA256=f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e
ARG PRIVATE_HAND_RELAY_MODEL_BYTES=21547949

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    COMMANDCANVAS_REQUIRED_PROVIDER=CUDAExecutionProvider

RUN apt-get update \
    && apt-get install --yes --no-install-recommends ca-certificates python3 python3-pip zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system handrelay \
    && useradd --system --gid handrelay --home-dir /opt/hand-relay --shell /usr/sbin/nologin handrelay

WORKDIR /opt/hand-relay
COPY services/hand-relay/requirements.lock ./requirements.lock
RUN python3 -m pip install --no-cache-dir --requirement requirements.lock

COPY services/hand-relay/commandcanvas_hand_relay ./commandcanvas_hand_relay
COPY ${PRIVATE_HAND_RELAY_MODEL_SOURCE} /models/${PRIVATE_HAND_RELAY_MODEL_FILENAME}
RUN test "$(stat --format=%s /models/${PRIVATE_HAND_RELAY_MODEL_FILENAME})" = "${PRIVATE_HAND_RELAY_MODEL_BYTES}" \
    && printf '%s  %s\n' "${PRIVATE_HAND_RELAY_MODEL_SHA256}" "/models/${PRIVATE_HAND_RELAY_MODEL_FILENAME}" | sha256sum --check \
    && chown -R handrelay:handrelay /opt/hand-relay /models

USER handrelay
EXPOSE 8100

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD python3 -c "import json,sys,urllib.request; value=json.load(urllib.request.urlopen('http://127.0.0.1:8100/healthz', timeout=2)); sys.exit(0 if value.get('ok') and value.get('ready') else 1)"

CMD ["python3", "-m", "commandcanvas_hand_relay.main"]
