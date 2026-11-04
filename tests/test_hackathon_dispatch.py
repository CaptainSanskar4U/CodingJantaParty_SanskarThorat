import pytest
from fastapi.testclient import TestClient
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_telephony_dossier_route(client: TestClient):
    res = client.get("/api/telephony/dossier")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    text = res.text
    assert "COURT-ADMISSIBLE INCIDENT DOSSIER" in text
    assert "Dadar West, Mumbai" in text
    assert "pizza" in text.lower()
    assert "SHA-256" in text


def test_telephony_extension_with_scheme(client: TestClient):
    res = client.get("/api/telephony/extension")
    assert res.status_code == 200
    data = res.json()
    assert "dialer_url" in data
    assert "extension" in data
    assert "local_ip" in data
