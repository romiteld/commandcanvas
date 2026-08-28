from __future__ import annotations

import uvicorn

from .app import create_app
from .config import load_settings


settings = load_settings()
app = create_app(settings=settings)


def main() -> None:
    uvicorn.run(
        app,
        host=settings.bind_host,
        port=settings.bind_port,
        access_log=False,
        log_level="info",
        ws_max_size=settings.max_frame_bytes,
        ws_per_message_deflate=False,
    )


if __name__ == "__main__":
    main()
