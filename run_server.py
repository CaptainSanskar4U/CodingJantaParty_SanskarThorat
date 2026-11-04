"""Dhvani Dual Server: HTTP (8000) + HTTPS (8443).

Allows:
- http://localhost:8000/console -> Standard browser access with 0 SSL friction
- https://<local-ip>:8443/dialer -> Secure mobile context for real phone microphone
Both share the exact same in-memory telephony WebSocket hub and SQLite database.
"""
from __future__ import annotations

import logging
import threading
import time
import uvicorn

from app.main import app
from app.ssl_cert import ensure_ssl_certificates, get_local_ip

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("dhvani_server")


def start_https_server():
    try:
        cert_path, key_path = ensure_ssl_certificates()
        config = uvicorn.Config(
            app=app,
            host="0.0.0.0",
            port=8443,
            ssl_keyfile=str(key_path),
            ssl_certfile=str(cert_path),
            log_level="warning",
        )
        server = uvicorn.Server(config)
        logger.info(f"HTTPS Phone Server active on https://{get_local_ip()}:8443/dialer")
        server.run()
    except Exception as e:
        logger.error(f"Failed to start HTTPS server on port 8443: {e}")


def main():
    # 1. Start HTTPS on port 8443 in background thread
    https_thread = threading.Thread(target=start_https_server, daemon=True, name="DhvaniHTTPS")
    https_thread.start()
    time.sleep(0.5)

    # 2. Run standard HTTP on port 8000 in main thread
    logger.info(f"HTTP Console Server active on http://localhost:8000/console")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
    )


if __name__ == "__main__":
    main()

