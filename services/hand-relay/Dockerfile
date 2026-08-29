FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04 AS relay-base

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
    && useradd --system --gid handrelay --home-dir /opt/hand-relay --shell /usr/sbin/nologin handrelay \
    && install --directory --owner=handrelay --group=handrelay /models

WORKDIR /opt/hand-relay
COPY services/hand-relay/requirements.lock ./requirements.lock
RUN python3 -m pip install --no-cache-dir --requirement requirements.lock

COPY services/hand-relay/commandcanvas_hand_relay ./commandcanvas_hand_relay
RUN chown -R handrelay:handrelay /opt/hand-relay

USER handrelay
EXPOSE 8100

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD python3 -c "import json,sys,urllib.request; value=json.load(urllib.request.urlopen('http://127.0.0.1:8100/healthz', timeout=2)); sys.exit(0 if value.get('ok') and value.get('ready') else 1)"

CMD ["python3", "-m", "commandcanvas_hand_relay.main"]

FROM relay-base AS relay-yolo

USER root
ARG PRIVATE_HAND_RELAY_MODEL_SOURCE=services/hand-relay/models/yolo26_hand_pose_640_fp16.onnx
ARG PRIVATE_HAND_RELAY_MODEL_FILENAME=yolo26_hand_pose_640_fp16.onnx
ARG PRIVATE_HAND_RELAY_MODEL_SHA256=f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e
ARG PRIVATE_HAND_RELAY_MODEL_BYTES=21547949
COPY ${PRIVATE_HAND_RELAY_MODEL_SOURCE} /models/${PRIVATE_HAND_RELAY_MODEL_FILENAME}
RUN test "$(stat --format=%s /models/${PRIVATE_HAND_RELAY_MODEL_FILENAME})" = "${PRIVATE_HAND_RELAY_MODEL_BYTES}" \
    && printf '%s  %s\n' "${PRIVATE_HAND_RELAY_MODEL_SHA256}" "/models/${PRIVATE_HAND_RELAY_MODEL_FILENAME}" | sha256sum --check \
    && chown handrelay:handrelay /models/${PRIVATE_HAND_RELAY_MODEL_FILENAME}
USER handrelay

FROM relay-base AS relay-hybrid-rtmpose

USER root
ARG PRIVATE_HAND_RELAY_RTMDET_MODEL_SOURCE=services/hand-relay/models/rtmdet_nano_8xb32-300e_hand-267f9c8f.onnx
ARG PRIVATE_HAND_RELAY_RTMDET_MODEL_FILENAME=rtmdet_nano_8xb32-300e_hand-267f9c8f.onnx
ARG PRIVATE_HAND_RELAY_RTMDET_MODEL_SHA256=568d3ea97a5b142488366b67e036b6a5cb0a1fef9087a710cb8e66b6979fbac2
ARG PRIVATE_HAND_RELAY_RTMDET_MODEL_BYTES=4010667
ARG PRIVATE_HAND_RELAY_RTMPOSE_MODEL_SOURCE=services/hand-relay/models/rtmpose-m-distill-256x256.onnx
ARG PRIVATE_HAND_RELAY_RTMPOSE_MODEL_FILENAME=rtmpose-m-distill-256x256.onnx
ARG PRIVATE_HAND_RELAY_RTMPOSE_MODEL_SHA256=6d50664e566fffee41a090c98f75e893b50846a753b802dbf5e2072a8dfd7784
ARG PRIVATE_HAND_RELAY_RTMPOSE_MODEL_BYTES=55118513
COPY ${PRIVATE_HAND_RELAY_RTMDET_MODEL_SOURCE} /models/${PRIVATE_HAND_RELAY_RTMDET_MODEL_FILENAME}
COPY ${PRIVATE_HAND_RELAY_RTMPOSE_MODEL_SOURCE} /models/${PRIVATE_HAND_RELAY_RTMPOSE_MODEL_FILENAME}
RUN test "$(stat --format=%s /models/${PRIVATE_HAND_RELAY_RTMDET_MODEL_FILENAME})" = "${PRIVATE_HAND_RELAY_RTMDET_MODEL_BYTES}" \
    && printf '%s  %s\n' "${PRIVATE_HAND_RELAY_RTMDET_MODEL_SHA256}" "/models/${PRIVATE_HAND_RELAY_RTMDET_MODEL_FILENAME}" | sha256sum --check \
    && test "$(stat --format=%s /models/${PRIVATE_HAND_RELAY_RTMPOSE_MODEL_FILENAME})" = "${PRIVATE_HAND_RELAY_RTMPOSE_MODEL_BYTES}" \
    && printf '%s  %s\n' "${PRIVATE_HAND_RELAY_RTMPOSE_MODEL_SHA256}" "/models/${PRIVATE_HAND_RELAY_RTMPOSE_MODEL_FILENAME}" | sha256sum --check \
    && chown handrelay:handrelay \
      /models/${PRIVATE_HAND_RELAY_RTMDET_MODEL_FILENAME} \
      /models/${PRIVATE_HAND_RELAY_RTMPOSE_MODEL_FILENAME}
USER handrelay

# A plain Docker build remains the established YOLO production image.
FROM relay-yolo AS relay-default
