"""Tests for multi-dimensional live emergency analyzer."""
import pytest
from app import live_analyzer


def test_pizza_keyword_progression():
    # 0 hits
    r0 = live_analyzer.analyze_utterance("Hello, I need someone here right now.", call_duration_s=2.0)
    assert r0["keywords"]["target"] == "Find the Victim's Hint"
    assert r0["keywords"]["count"] == 0

    # 1 hit
    r1 = live_analyzer.analyze_utterance("I'd like to order a pepperoni pizza please.", call_duration_s=5.0)
    assert r1["keywords"]["target"] == "Find the Victim's Hint"
    assert r1["keywords"]["count"] == 1
    assert r1["intent"] == "COVERT_CIVILIAN_TRANSACTION"

    # 2 hits
    r2 = live_analyzer.analyze_utterance("Can I get a pizza? Medium pizza delivery.", call_duration_s=8.0)
    assert r2["keywords"]["target"] == "Find the Victim's Hint"
    assert r2["keywords"]["count"] == 2

    # 3 hits -> Pizza Detected
    r3 = live_analyzer.analyze_utterance("Pizza please. Large pizza with extra cheese. Yes, pizza delivery to Dadar.", call_duration_s=12.0)
    assert r3["keywords"]["target"] == "Pizza Detected"
    assert r3["keywords"]["count"] == 3
    assert r3["urgency_band"] == "HIGH"
    assert r3["location"]["badge"] == "Landmark Verified · Priority Target"
    assert "Dadar West" in r3["location"]["label"]


def test_violent_threat_intent():
    res = live_analyzer.analyze_utterance("He has a knife and a gun! Please hurry up!", call_duration_s=4.0)
    assert res["intent"] == "VIOLENT_THREAT_IN_PROGRESS"
    assert res["urgency_score"] >= 75
    assert res["urgency_band"] == "HIGH"


def test_digital_arrest_extortion():
    res = live_analyzer.analyze_utterance("Someone claiming to be CBI says I am under digital arrest and must transfer money.", call_duration_s=6.0)
    assert res["intent"] == "EXTORTION_DIGITAL_ARREST"
    assert res["urgency_band"] in ("HIGH", "MEDIUM")

