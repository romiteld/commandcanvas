FROM nvidia/cuda:12.8.1-cudnn-runtime-ubuntu22.04

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
COPY requirements.lock ./requirements.lock
RUN python3 -m pip install --no-cache-dir --requirement requirements.lock

COPY commandcanvas_hand_relay ./commandcanvas_hand_relay
RUN chown -R handrelay:handrelay /opt/hand-relay

USER handrelay
EXPOSE 8100

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD python3 -c "import json,sys,urllib.request; value=json.load(urllib.request.urlopen('http://127.0.0.1:8100/healthz', timeout=2)); sys.exit(0 if value.get('ok') and value.get('ready') else 1)"

CMD ["python3", "-m", "commandcanvas_hand_relay.main"]
