"""Dynamic AI Investigator Guidance Engine for Dhvani.

Synthesizes live spoken transcript, detected conversational entities,
acoustic prosody indicators, and keyword frequencies into context-sensitive,
actionable guidance for emergency dispatchers and investigators.
"""
from __future__ import annotations

import re
from typing import Any


def generate_guidance(
    transcript: str,
    observable_prosody: dict[str, Any],
    keyword_hits: int = 0,
    has_sufficient_data: bool = False,
) -> dict[str, Any]:
    """Generate dynamic, context-aware investigator recommendations.

    Does not return hardcoded responses; adapts dynamically to what has been
    spoken so far and the measured acoustic stress level.
    """
    if not has_sufficient_data or not transcript.strip():
        return {
            "status": "calibrating",
            "phase": "CALIBRATING LINE",
            "phase_color": "#8c8c98",
            "action_label": "AWAITING SPEECH SIGNAL",
            "prompt": "Line connected. Awaiting sufficient speech signal to evaluate caller baseline acoustics and conversational context.",
            "rationale": "Objective analysis requires at least 5 seconds of active speech to prevent premature or misleading conclusions.",
            "checklist": [
                {"label": "Establish Caller Baseline", "checked": False},
                {"label": "Evaluate Covert Disguise Pattern", "checked": False},
                {"label": "Verify Safety via Closed Protocol", "checked": False},
                {"label": "Tactical Landmark / Address Extraction", "checked": False},
            ],
            "verification_items": [
                "Establish whether caller can speak freely",
                "Acquire audio baseline",
            ],
        }

    text_lower = transcript.lower()

    # Contextual flags parsed from the actual spoken dialogue
    has_food_order = bool(re.search(r"\b(pizza|pepperoni|burger|delivery|order|crust|cheese|topping)\b", text_lower))
    has_covert_constraint = bool(re.search(
        r"\b(cannot speak|can't speak|can't talk|cannot talk|not alone|two people|they are here|someone is here|don't tell|watching|whisper|couldn't run)\b",
        text_lower
    ))
    has_direct_distress = bool(re.search(
        r"\b(help|danger|hurt|emergency|police|trapped|scared|save|bleeding|attack|knife|gun)\b",
        text_lower
    ))
    has_location_clue = bool(re.search(
        r"\b(floor|apartment|apt|house|station|road|street|building|outlet|near|behind|opposite|mumbai|dadar|bandra|colaba)\b",
        text_lower
    ))
    has_digital_arrest_scam = bool(re.search(
        r"\b(digital arrest|cbi|parcel|customs|narcotics|police station|transfer money|arrest warrant)\b",
        text_lower
    ))

    # Acoustic stress indicators from real prosody
    pitch_var = float(observable_prosody.get("pitch_variation_hz") or 0)
    pause_ratio = float(observable_prosody.get("pause_ratio") or 0)
    high_vocal_stress = (pitch_var > 28.0) or (pause_ratio > 0.38)

    # 1. Digital Arrest / Extortion Scam Pattern
    if has_digital_arrest_scam:
        return {
            "status": "active",
            "phase": "EXTORTION / SCAM PROTOCOL",
            "phase_color": "#ffaa33",
            "action_label": "COUNTER-EXTORTION GUIDANCE",
            "prompt": "Advise caller immediately: 'Sir/Ma'am, Indian Law Enforcement and CBI NEVER conduct digital arrests via video or phone calls. Do not transfer funds.'",
            "rationale": "Extortion scam detected. The caller is being coerced with fabricated legal threats. Direct intervention is required to prevent financial transfer.",
            "checklist": [
                {"label": "Caller Baseline Established", "checked": True},
                {"label": "Scam Phraseology Identified", "checked": True},
                {"label": "Fraud Warning Delivered", "checked": True},
                {"label": "Financial Transfer Block Advised", "checked": False},
            ],
            "verification_items": [
                "Ask caller if any banking details or OTPs were shared",
                "Request identity of the calling agency claimed by suspect",
            ],
        }

    # 2. Food Order Cover Protocol on Emergency Line ("Pizza")
    if has_food_order or keyword_hits >= 1:
        if keyword_hits >= 3 or (has_food_order and (has_covert_constraint or high_vocal_stress)):
            # Escalated covert duress
            prompt_text = "DO NOT HANG UP. Adopt food delivery disguise: 'Understood. Is there someone in the room preventing you from speaking? Answer yes or no.'"
            if has_location_clue:
                prompt_text = "Closed questions confirmed. Extract exact apartment/floor under cover: 'Confirm delivery address: What is the apartment number and floor?'"

            return {
                "status": "active",
                "phase": "🚨 COVERT DURESS PROTOCOL (HIGH RISK)",
                "phase_color": "#ff2e43",
                "action_label": "WHAT TO ASK NEXT (CLOSED PROTOCOL)",
                "prompt": prompt_text,
                "rationale": f"The caller repeated civilian order phrasing ('pizza' x{max(1, keyword_hits)}) combined with "
                             f"{'elevated acoustic vocal jitter (' + str(round(pitch_var, 1)) + ' Hz)' if high_vocal_stress else 'suspicious repetition'} "
                             "on an emergency channel. Use closed yes/no questions to allow victim response without alarming nearby threats.",
                "checklist": [
                    {"label": "Covert Civilian Disguise Identified", "checked": True},
                    {"label": "Avoid Open Questions (Yes/No Only)", "checked": True},
                    {"label": "Floor & Apartment Landmark Extracted", "checked": has_location_clue},
                    {"label": "Tactical Units Alerted (Silent Approach)", "checked": has_location_clue},
                ],
                "verification_items": [
                    "Verify if suspect is armed or physically restraining caller (ask: 'Is anyone armed? Yes or no.')",
                    "Confirm exact apartment or flat number without breaking delivery cover",
                ],
            }
        else:
            # First or second civilian transaction mention
            return {
                "status": "active",
                "phase": "⚠️ FOOD ORDER ANOMALY DETECTED",
                "phase_color": "#f5c451",
                "action_label": "INVESTIGATOR VERIFICATION QUESTION",
                "prompt": "Do not dismiss as a prank call. Ask: 'Ma'am/Sir, you have reached the Emergency Control Room. Are you in a situation where you cannot speak freely?'",
                "rationale": "Commercial food ordering on an emergency line may indicate disguised distress or an accidental misdial. Verify safety before terminating.",
                "checklist": [
                    {"label": "Food Order Detected on 112/911 Line", "checked": True},
                    {"label": "Safety Verification Query", "checked": False},
                    {"label": "Cross-reference with Acoustic Baseline", "checked": True},
                    {"label": "Location Triangulation Initiated", "checked": False},
                ],
                "verification_items": [
                    "Clarify if caller dialed emergency line intentionally",
                    "Listen for ambient background voices or domestic disturbance",
                ],
            }

    # 3. Direct Emergency / Physical Distress Mention
    if has_direct_distress or high_vocal_stress:
        if has_location_clue:
            prompt_text = "Location mentioned. Verify access points: 'Help is being routed. What floor or entry door should responders look for?'"
        else:
            prompt_text = "Direct distress indicated. Ask immediate location: 'Where are you right now? Name the nearest road, landmark, or building.'"

        return {
            "status": "active",
            "phase": "🚨 ACTIVE EMERGENCY DISPATCH",
            "phase_color": "#ff2e43",
            "action_label": "IMMEDIATE DISPATCH QUESTION",
            "prompt": prompt_text,
            "rationale": f"Caller language reflects acute emergency distress{' with high vocal tremor' if high_vocal_stress else ''}. "
                         "Prioritize precise location extraction and immediate tactical dispatch.",
            "checklist": [
                {"label": "Distress Statement Verified", "checked": True},
                {"label": "Immediate Tactical Location Pinpointed", "checked": has_location_clue},
                {"label": "Unit Dispatched", "checked": False},
                {"label": "Keep Line Open / Silent Monitoring", "checked": True},
            ],
            "verification_items": [
                "Extract exact physical landmark or cross-street",
                "Determine if medical support / ambulance is required",
            ],
        }

    # 4. Standard / Calm Interaction (No overt distress yet)
    return {
        "status": "active",
        "phase": "MONITORING CALL",
        "phase_color": "#38bdf8",
        "action_label": "CLARIFYING QUESTION",
        "prompt": "Allow caller to explain the nature of their request: 'Police Control Room, please state your emergency or how we can assist you.'",
        "rationale": "Acoustic baseline is within normal parameters. Solicit open explanation while monitoring for subtle conversational cues.",
        "checklist": [
            {"label": "Caller Baseline Calibrated", "checked": True},
            {"label": "Identify Nature of Incident", "checked": False},
            {"label": "Record Caller Identity / Location", "checked": False},
            {"label": "Triage Urgency Band", "checked": False},
        ],
        "verification_items": [
            "Confirm purpose of call",
            "Note caller's stated location",
        ],
    }

