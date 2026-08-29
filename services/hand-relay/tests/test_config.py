from __future__ import annotations

import base64

import pytest

from commandcanvas_hand_relay.config import SettingsError, load_settings


def environment(**overrides: str) -> dict[str, str]:
    values = {
        "PRIVATE_HAND_RELAY_SIGNING_KEY": base64.urlsafe_b64encode(bytes(range(32)))
        .rstrip(b"=")
        .decode("ascii"),
        "PRIVATE_HAND_RELAY_ALLOWED_ORIGINS": (
            "https://commandcanvas.vercel.app,http://localhost:3000"
        ),
        "PRIVATE_HAND_RELAY_MODEL_PATH": "/models/hand.onnx",
    }
    values.update(overrides)
    return values


def test_parses_exact_origins_and_an_unpadded_32_byte_key() -> None:
    settings = load_settings(environment())

    assert settings.allowed_origins == frozenset(
        {"https://commandcanvas.vercel.app", "http://localhost:3000"}
    )
    assert settings.signing_key == bytes(range(32))
    assert settings.bind_host == "127.0.0.1"
    assert settings.bind_port == 8100
    assert settings.gpu_mem_limit_bytes == 805_306_368
    assert settings.handshake_timeout_seconds == 5
    assert settings.frame_idle_timeout_seconds == 5
    assert settings.authenticated_session_timeout_seconds == 1_800
    assert settings.inference_timeout_seconds == 2
    assert settings.max_handshakes == 8
    assert settings.model_variant == "yolo26_hand_pose_640_fp16"
    assert settings.model_manifest.input_shape == (1, 3, 640, 640)


def test_rejects_an_unknown_or_mislabeled_model_variant() -> None:
    with pytest.raises(SettingsError, match="model variant"):
        load_settings(
            environment(PRIVATE_HAND_RELAY_MODEL_VARIANT="yolo26_latest")
        )


@pytest.mark.parametrize(
    "origins",
    [
        "*",
        "https://commandcanvas.vercel.app/",
        "https://commandcanvas.vercel.app/demo",
        "https://*.vercel.app",
        "http://commandcanvas.vercel.app",
        "https://user:pass@commandcanvas.vercel.app",
    ],
)
def test_rejects_wildcards_paths_credentials_and_insecure_remote_origins(
    origins: str,
) -> None:
    with pytest.raises(SettingsError, match="origin"):
        load_settings(environment(PRIVATE_HAND_RELAY_ALLOWED_ORIGINS=origins))


def test_rejects_missing_or_malformed_secrets() -> None:
    with pytest.raises(SettingsError, match="signing key"):
        load_settings(environment(PRIVATE_HAND_RELAY_SIGNING_KEY="short"))
    with pytest.raises(SettingsError, match="allowlist"):
        load_settings(environment(PRIVATE_HAND_RELAY_ALLOWED_ORIGINS=""))


def test_bounds_the_configurable_cuda_memory_arena() -> None:
    settings = load_settings(
        environment(PRIVATE_HAND_RELAY_GPU_MEM_LIMIT_BYTES="536870912")
    )
    assert settings.gpu_mem_limit_bytes == 536_870_912

    with pytest.raises(SettingsError, match="outside"):
        load_settings(environment(PRIVATE_HAND_RELAY_GPU_MEM_LIMIT_BYTES="268435455"))
    with pytest.raises(SettingsError, match="outside"):
        load_settings(environment(PRIVATE_HAND_RELAY_GPU_MEM_LIMIT_BYTES="2147483649"))


def test_bounds_websocket_handshake_and_frame_idle_timeouts() -> None:
    settings = load_settings(
        environment(
            PRIVATE_HAND_RELAY_HANDSHAKE_TIMEOUT_SECONDS="3",
            PRIVATE_HAND_RELAY_FRAME_IDLE_TIMEOUT_SECONDS="7",
            PRIVATE_HAND_RELAY_INFERENCE_TIMEOUT_SECONDS="4",
            PRIVATE_HAND_RELAY_MAX_HANDSHAKES="12",
        )
    )
    assert settings.handshake_timeout_seconds == 3
    assert settings.frame_idle_timeout_seconds == 7
    assert settings.inference_timeout_seconds == 4
    assert settings.max_handshakes == 12

    with pytest.raises(SettingsError, match="outside"):
        load_settings(environment(PRIVATE_HAND_RELAY_HANDSHAKE_TIMEOUT_SECONDS="0"))
    with pytest.raises(SettingsError, match="outside"):
        load_settings(environment(PRIVATE_HAND_RELAY_FRAME_IDLE_TIMEOUT_SECONDS="31"))
    with pytest.raises(SettingsError, match="outside"):
        load_settings(environment(PRIVATE_HAND_RELAY_INFERENCE_TIMEOUT_SECONDS="0"))
    with pytest.raises(SettingsError, match="outside"):
        load_settings(environment(PRIVATE_HAND_RELAY_MAX_HANDSHAKES="33"))


def test_bounds_authenticated_session_lifetime_independently_of_handshake_ttl() -> None:
    settings = load_settings(
        environment(PRIVATE_HAND_RELAY_AUTHENTICATED_SESSION_TIMEOUT_SECONDS="3600")
    )

    assert settings.authenticated_session_timeout_seconds == 3_600

    with pytest.raises(SettingsError, match="outside"):
        load_settings(
            environment(PRIVATE_HAND_RELAY_AUTHENTICATED_SESSION_TIMEOUT_SECONDS="59")
        )
    with pytest.raises(SettingsError, match="outside"):
        load_settings(
            environment(
                PRIVATE_HAND_RELAY_AUTHENTICATED_SESSION_TIMEOUT_SECONDS="7201"
            )
        )
