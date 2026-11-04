"""Local SSL Certificate generator using cryptography.

Generates self-signed TLS certificates for local LAN and localhost so mobile browsers
(Chrome on Android, Safari on iOS) enable microphone access (getUserMedia) and SpeechRecognition.
"""
from __future__ import annotations

import datetime
import ipaddress
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def get_local_ip() -> str:
    """Detect primary local Wi-Fi / LAN IPv4 address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def ensure_ssl_certificates(ssl_dir: Path | str | None = None) -> tuple[Path, Path]:
    """Ensure cert.pem and key.pem exist with valid SANs for localhost and local IP."""
    if ssl_dir is None:
        from . import config
        target_dir = config.DATA_DIR / "ssl"
    else:
        target_dir = Path(ssl_dir)

    target_dir.mkdir(parents=True, exist_ok=True)
    cert_path = target_dir / "cert.pem"
    key_path = target_dir / "key.pem"

    if cert_path.exists() and key_path.exists():
        return cert_path, key_path

    # Generate RSA private key
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    local_ip = get_local_ip()
    ip_sans = [ipaddress.IPv4Address("127.0.0.1")]
    try:
        if local_ip != "127.0.0.1":
            ip_sans.append(ipaddress.IPv4Address(local_ip))
    except Exception:
        pass

    dns_sans = [
        x509.DNSName("localhost"),
        x509.DNSName(socket.gethostname()),
    ]

    alt_names = dns_sans + [x509.IPAddress(ip) for ip in ip_sans]

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Dhvani Emergency Response Intelligence"),
        x509.NameAttribute(NameOID.COMMON_NAME, local_ip),
    ])

    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=365 * 2))
        .add_extension(
            x509.SubjectAlternativeName(alt_names),
            critical=False,
        )
        .add_extension(
            x509.BasicConstraints(ca=False, path_length=None),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )

    with open(key_path, "wb") as f:
        f.write(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )

    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    return cert_path, key_path


if __name__ == "__main__":
    c, k = ensure_ssl_certificates()
    print(f"Generated certificates:\nCert: {c}\nKey:  {k}")

