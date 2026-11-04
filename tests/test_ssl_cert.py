import tempfile
from pathlib import Path
from app import ssl_cert


def test_ssl_certificate_generation():
    with tempfile.TemporaryDirectory() as tmpdir:
        cert_path, key_path = ssl_cert.ensure_ssl_certificates(ssl_dir=tmpdir)
        assert cert_path.exists()
        assert key_path.exists()
        assert cert_path.stat().st_size > 500
        assert key_path.stat().st_size > 500
        assert "BEGIN CERTIFICATE" in cert_path.read_text(encoding="utf-8")
        assert "BEGIN RSA PRIVATE KEY" in key_path.read_text(encoding="utf-8")

