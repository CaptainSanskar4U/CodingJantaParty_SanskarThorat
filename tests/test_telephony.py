"""Tests for integrated local telephony simulation, extension manager, and WebSocket signaling."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import telephony, db


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_extension_generation_and_validation():
    ext = telephony.get_active_extension()
    assert len(ext) >= 3
    assert telephony.validate_extension(ext) is True
    assert telephony.validate_extension("999999") is False

    new_ext = telephony.generate_extension()
    assert len(new_ext) >= 3
    assert telephony.validate_extension(new_ext) is True


def test_telephony_rest_endpoints(client: TestClient):
    res = client.get("/api/telephony/extension")
    assert res.status_code == 200
    data = res.json()
    assert "extension" in data
    assert "dialer_url" in data

    res2 = client.post("/api/telephony/regenerate")
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["extension"]) >= 3


def test_dialer_view_serves_html(client: TestClient):
    res = client.get("/dialer")
    assert res.status_code == 200
    assert "text/html" in res.headers["content-type"]
    assert "Mobile Telephone Dialer" in res.text


def test_operator_websocket_lifecycle(client: TestClient):
    with client.websocket_connect("/ws/telephony") as op_ws:
        op_ws.send_json({"type": "operator_register"})
        ready = op_ws.receive_json()
        assert ready["type"] == "operator_ready"
        assert "extension" in ready

        # Simulate call and answer
        call = telephony.start_call(ready["extension"], "Test Caller")
        call_id = call["id"]

        op_ws.send_json({"type": "answer_call", "call_id": call_id})
        ans = op_ws.receive_json()
        assert ans["type"] == "call_answered"
        assert ans["call"]["status"] == "connected"

        # End call
        op_ws.send_json({"type": "end_call", "call_id": call_id, "ended_by": "operator"})
        end_msg = op_ws.receive_json()
        assert end_msg["type"] == "call_ended"

        saved_call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
        assert saved_call is not None
        assert saved_call["status"] == "analyzed"


def test_dialer_websocket_lifecycle(client: TestClient):
    ext = telephony.get_active_extension()
    with client.websocket_connect("/ws/telephony") as dialer_ws:
        dialer_ws.send_json({"type": "dialer_register", "dialer_id": "test_dialer_1"})
        ready = dialer_ws.receive_json()
        assert ready["type"] == "dialer_ready"

        # Dial active extension
        dialer_ws.send_json({
            "type": "dial_extension",
            "extension": ext,
            "caller_name": "Unit Test Smartphone"
        })
        ring = dialer_ws.receive_json()
        assert ring["type"] == "call_ringing"
        call_id = ring["call"]["id"]

        # Send speech utterance
        dialer_ws.send_json({
            "type": "transcript_utterance",
            "call_id": call_id,
            "speaker": "caller",
            "text": "Hello, I need a pepperoni pizza right now."
        })

        # End call
        dialer_ws.send_json({"type": "end_call", "call_id": call_id, "ended_by": "caller"})

        # Check call in database
        saved_call = db.query_one("SELECT * FROM calls WHERE id=?", (call_id,))
        assert saved_call is not None
