"""Tests for call waiting: secondary incoming calls while primary call is active."""
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app import telephony, db


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def test_telephony_multi_call_tracking():
    # Clean state
    telephony._ACTIVE_CALLS.clear()
    assert telephony.has_connected_call() is False

    ext = telephony.get_active_extension()
    call1 = telephony.start_call(ext, "Caller 1")
    assert call1["status"] == "ringing"
    assert telephony.has_connected_call() is False

    telephony.answer_call(call1["id"])
    assert telephony.has_connected_call() is True

    # Start Call 2
    call2 = telephony.start_call(ext, "Caller 2")
    assert telephony.has_connected_call() is True
    assert len(telephony.get_active_calls()) == 2

    # Transfer Call 2
    transferred = telephony.transfer_call(call2["id"], "Secondary Dispatch Desk / Officer Patel")
    assert transferred is not None
    assert transferred["status"] == "transferred"
    assert transferred["transferred_to"] == "Secondary Dispatch Desk / Officer Patel"

    # Call 1 is still connected
    assert telephony.has_connected_call() is True

    # End Call 1
    telephony.end_call(call1["id"])
    assert telephony.has_connected_call() is False


def test_call_waiting_websocket_flow(client: TestClient):
    telephony._ACTIVE_CALLS.clear()
    ext = telephony.get_active_extension()

    with client.websocket_connect("/ws/telephony") as op_ws:
        op_ws.send_json({"type": "operator_register"})
        ready = op_ws.receive_json()
        assert ready["type"] == "operator_ready"

        with client.websocket_connect("/ws/telephony") as dialer1_ws:
            dialer1_ws.send_json({"type": "dialer_register", "dialer_id": "phone_1"})
            dialer1_ws.receive_json()  # dialer_ready

            # Phone 1 calls
            dialer1_ws.send_json({
                "type": "dial_extension",
                "extension": ext,
                "caller_name": "Primary Emergency Caller"
            })
            ring1 = dialer1_ws.receive_json()
            assert ring1["type"] == "call_ringing"
            call1_id = ring1["call"]["id"]

            incoming1 = op_ws.receive_json()
            assert incoming1["type"] == "incoming_call"
            assert incoming1["is_call_waiting"] is False

            # Operator answers Phone 1
            op_ws.send_json({"type": "answer_call", "call_id": call1_id})
            op_ans = op_ws.receive_json()
            assert op_ans["type"] == "call_answered"
            dialer1_conn = dialer1_ws.receive_json()
            assert dialer1_conn["type"] == "call_connected"

            # While Phone 1 is connected, Phone 2 calls!
            with client.websocket_connect("/ws/telephony") as dialer2_ws:
                dialer2_ws.send_json({"type": "dialer_register", "dialer_id": "phone_2"})
                dialer2_ws.receive_json()

                dialer2_ws.send_json({
                    "type": "dial_extension",
                    "extension": ext,
                    "caller_name": "Secondary Incoming Caller"
                })
                ring2 = dialer2_ws.receive_json()
                assert ring2["type"] == "call_ringing"
                assert ring2["is_call_waiting"] is True
                call2_id = ring2["call"]["id"]

                # Operator receives incoming_call with is_call_waiting = True
                cw_msg = op_ws.receive_json()
                assert cw_msg["type"] == "incoming_call"
                assert cw_msg["is_call_waiting"] is True
                assert cw_msg["call"]["id"] == call2_id

                # Operator transfers Call 2 to Secondary Dispatch
                op_ws.send_json({
                    "type": "transfer_call",
                    "call_id": call2_id,
                    "destination": "Secondary Dispatch Desk / Officer Patel"
                })

                op_trf = op_ws.receive_json()
                assert op_trf["type"] == "call_transferred"
                assert op_trf["destination"] == "Secondary Dispatch Desk / Officer Patel"

                d2_trf = dialer2_ws.receive_json()
                assert d2_trf["type"] == "call_transferred"

            # Primary call 1 is still ongoing
            assert telephony.has_connected_call() is True

            # End Call 1
            op_ws.send_json({"type": "end_call", "call_id": call1_id})
            op_end = op_ws.receive_json()
            assert op_end["type"] == "call_ended"

