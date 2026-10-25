"""Seed the Covert Pizza Distress Call (demo video.mp3) into Dhvani database."""
import json
import sqlite3
from pathlib import Path
from app import config, db, storage

def seed():
    # 1. Update scenarios.json
    scenarios_file = config.DEMO_DIR / "scenarios.json"
    scenarios = []
    if scenarios_file.exists():
        try:
            scenarios = json.loads(scenarios_file.read_text(encoding="utf-8")).get("scenarios", [])
        except Exception:
            pass

    pizza_scenario = {
        "id": "covert_pizza_distress",
        "title": "English · Covert pizza order distress call (demo video.mp3)",
        "description": "Caller contacts Police Control Room pretending to order a pepperoni pizza because an aggressor is in the room. The dispatcher detects the anomaly, verifies covert distress, extracts floor-level apartment location, and initiates priority response.",
        "file": "covert_pizza_distress.wav",
        "language_hint": "en",
        "duration_hint": 102.4,
        "consent_note": "Consented emergency call demonstration recording provided as demo video.mp3.",
        "is_simulated": True
    }

    scenarios = [s for s in scenarios if s.get("id") != "covert_pizza_distress"]
    scenarios.insert(0, pizza_scenario)
    scenarios_file.write_text(json.dumps({"scenarios": scenarios}, indent=2), encoding="utf-8")
    print("Updated scenarios.json with covert_pizza_distress")

    # 2. Waveform peaks
    upload_path = config.UPLOAD_DIR / "call_covert_pizza_distress.wav"
    peaks = storage.waveform_peaks(upload_path)

    # 3. Create Case CASE-2026-0002
    con = sqlite3.connect(config.DB_PATH)
    cur = con.cursor()

    case_id = "case_pizza_2026_0002"
    cur.execute("DELETE FROM cases WHERE id=? OR case_number='CASE-2026-0002'", (case_id,))
    cur.execute("""
        INSERT INTO cases (id, case_number, title, summary, status, priority, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        case_id,
        "CASE-2026-0002",
        "Covert Pizza Order Distress Call (Domestic Coercion & Emergency Dispatch)",
        "Emergency distress signal initiated via disguised food ordering protocol. Immediate presence of threatening subject preventing open disclosure. Unit dispatched to 3rd floor apartment near station.",
        "open",
        "high",
        "Inspector Mehta",
        db.now(),
        db.now()
    ))

    # 4. Create Call
    call_id = "call_covert_pizza_distress"
    cur.execute("DELETE FROM calls WHERE id=?", (call_id,))
    cur.execute("DELETE FROM segments WHERE call_id=?", (call_id,))
    cur.execute("DELETE FROM findings WHERE call_id=?", (call_id,))
    cur.execute("DELETE FROM locations WHERE call_id=?", (call_id,))
    cur.execute("DELETE FROM audio_events WHERE call_id=?", (call_id,))

    analysis_data = {
        "urgency_contributions": {
            "covert_distress_phrase": 45,
            "immediate_threat_context": 25,
            "vocal_stress_anomalies": 15,
            "location_confirmation": 10
        },
        "urgency_notes": [
            "Caller utilized recognized food-order cover protocol indicating inability to speak freely.",
            "Dispatcher verified danger using closed-question protocol and initiated immediate unit dispatch."
        ],
        "speaker_count": 2,
        "speaker_method": "k-means MFCC clustering (Caller / Dispatcher)"
    }

    cur.execute("""
        INSERT INTO calls (
            id, case_id, source_type, source_label, is_simulated,
            original_filename, stored_name, audio_name, sha256, mime,
            size_bytes, duration_s, sample_rate, status, priority,
            urgency_score, urgency_band, language, waveform_json, analysis_json, consent_note,
            created_at, processed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        call_id,
        case_id,
        "demo",
        "Covert pizza order distress call (demo video.mp3)",
        1,
        "demo video.mp3",
        "call_covert_pizza_distress_original.wav",
        "call_covert_pizza_distress.wav",
        "sha256_covert_pizza_distress_demo",
        "audio/wav",
        upload_path.stat().st_size,
        102.4,
        16000,
        "analyzed",
        "high",
        95,
        "high",
        "en",
        json.dumps(peaks),
        json.dumps(analysis_data),
        "Demo recording from demo video.mp3 · Covert distress intelligence demonstration.",
        db.now(),
        db.now()
    ))

    # 5. Insert Dialogue Segments
    dialogue = [
        ("Dispatcher", 8.85, 11.49, "Hello, this is Police Control Room. How can I assist you?", "neutral", 0.90, "Police Control Room operator greeting"),
        ("Caller", 17.45, 19.93, "I need... I need something...", "fear", 0.78, "Hesitant voice, high vocal stress"),
        ("Caller", 20.79, 24.49, "I need a pizza. A regular pepperoni pizza.", "fear", 0.85, "Covert distress code: disguised food order"),
        ("Dispatcher", 25.26, 27.74, "Ma'am, this is Police Control Room, wrong number.", "neutral", 0.92, "Standard operator clarification"),
        ("Caller", 28.30, 30.56, "Yes... I understand. I have two people here.", "fear", 0.88, "Covert signal indicating presence of others"),
        ("Caller", 34.57, 36.03, "Ma'am, you don't get it...", "fear", 0.92, "Urgent insistence, covert emergency signal"),
        ("Dispatcher", 36.65, 39.75, "This is Police Control Room. We don't deliver pizzas.", "neutral", 0.94, "Operator reiteration"),
        ("Caller", 40.05, 42.01, "I need the pizza... Please, I need it.", "fear", 0.95, "Repeated disguised distress plea"),
        ("Dispatcher", 54.04, 58.35, "Ma'am, are you okay? Are you in trouble? Are you able to speak freely?", "neutral", 0.96, "Triage recognition of covert domestic distress protocol"),
        ("Caller", 59.01, 62.54, "Yes... I cannot speak... I couldn't run.", "fear", 0.93, "Direct confirmation of danger and inability to speak"),
        ("Dispatcher", 70.06, 71.68, "Are you in trouble right now?", "neutral", 0.98, "Closed question protocol"),
        ("Caller", 72.04, 76.64, "Yes! My house is near your outlet... near the station.", "fear", 0.94, "Confirmation of active threat and initial landmark clue"),
        ("Caller", 77.39, 79.35, "There's a building, that's my apartment.", "fear", 0.92, "Specific structural reference"),
        ("Caller", 80.70, 83.78, "The floor... The third floor. Apartment 302.", "fear", 0.96, "Floor-level tactical location context"),
        ("Dispatcher", 87.88, 89.54, "We'll be sending help right away.", "neutral", 0.99, "Emergency dispatch confirmed"),
        ("Caller", 89.88, 93.93, "When will you be able to deliver it?", "fear", 0.89, "Maintains cover for listener in room"),
        ("Dispatcher", 94.29, 98.50, "Officers are 3 minutes away from your location. Keep the line open.", "neutral", 0.97, "Response ETA 3 mins"),
        ("Dispatcher", 99.46, 100.50, "Take care, officers are arriving.", "neutral", 0.98, "Dispatch wrap-up")
    ]

    for i, (spk, start_s, end_s, text, emotion, conf, sentiment) in enumerate(dialogue):
        seg_id = f"seg_pizza_{i+1:02d}"
        cur.execute("""
            INSERT INTO segments (
                id, call_id, idx, start_s, end_s, speaker, text, translation,
                language, sentiment, sentiment_score, vocal_emotion, vocal_confidence, method
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            seg_id, call_id, i, start_s, end_s, spk, text, text,
            "en", sentiment, 0.85, emotion, conf, "whisper-base"
        ))

    # 6. Insert Covert Findings
    findings_data = [
        ("fnd_pizza_01", "Covert Pizza Distress Code", "distress_phrase", 20.79, 24.49, "I need a pizza. A regular pepperoni pizza.", "Widely recognized covert distress protocol where victims of domestic violence or hostage situations pretend to order food because the aggressor is listening.", "operator_reference_pack", "NLP Pattern Match", 0.98, "confirmed"),
        ("fnd_pizza_02", "Inability to Speak Freely", "contextual_risk", 34.57, 36.03, "Ma'am, you don't get it...", "Caller insists on disguised communication, confirming coercion and presence of threatening third party.", "operator_reference_pack", "Prosodic & Semantic Analysis", 0.92, "confirmed"),
        ("fnd_pizza_03", "Covert Protocol Recognition", "operator_protocol", 54.04, 58.35, "Ma'am, are you okay? Are you in trouble?", "Dispatcher recognizes covert distress code and transitions to yes/no questioning to protect caller safety.", "triage_guide", "Rule Match", 0.95, "confirmed"),
        ("fnd_pizza_04", "Active Danger Confirmation", "distress_phrase", 59.01, 62.54, "Yes... I cannot speak... I couldn't run.", "Caller affirms active peril and severe restraint on movement/speech.", "operator_reference_pack", "Keyword & Emotion Analysis", 0.96, "confirmed"),
        ("fnd_pizza_05", "Apartment Landmark Reference", "location_clue", 77.39, 79.35, "There's a building, that's my apartment.", "Spoken physical landmark allowing precise geocoding near Dadar West corridor.", "geo_nlp", "NER Landmark Extractor", 0.94, "confirmed"),
        ("fnd_pizza_06", "Tactical Floor Context", "tactical_intel", 80.70, 83.78, "The third floor. Apartment 302.", "Tactical intelligence for responding units: elevated residential unit, floor 3.", "tactical_guide", "NER Context Extractor", 0.97, "confirmed"),
        ("fnd_pizza_07", "Maintained Cover Protocol", "contextual_risk", 89.88, 93.93, "When will you be able to deliver it?", "Caller sustains cover story until the line ends, indicating continuous proximity of abuser.", "threat_model", "Contextual Threat Evaluation", 0.95, "confirmed")
    ]

    for fid, title, ftype, start_s, end_s, quote, desc, stype, method, conf, status in findings_data:
        cur.execute("""
            INSERT INTO findings (
                id, call_id, case_id, type, subtype, title, description,
                start_s, end_s, quote, source_type, source_ref, method,
                confidence, status, reviewer_note, created_at, reviewed_by, reviewed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            fid, call_id, case_id, ftype, "covert_distress", title, desc,
            start_s, end_s, quote, stype, "REF-COVERT-DISTRESS-2026", method,
            conf, status, "Verified covert emergency signal protocol.", db.now(), "Inspector Mehta", db.now()
        ))

    # 7. Insert Location Observation
    cur.execute("""
        INSERT INTO locations (id, call_id, case_id, label, lat, lon, accuracy_m, source_type, source_detail, geocode_provider, verification_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        "loc_pizza_01",
        call_id,
        case_id,
        "Dadar West Residential Apartment (3rd Floor)",
        19.0192269,
        72.8428479,
        350.0,
        "spoken_landmark",
        "Spoken landmark: 'near your outlet, near the station, 3rd floor apartment'. Geocoded to Dadar West corridor.",
        "nominatim",
        "verified",
        db.now()
    ))

    # 8. Insert Audio Forensics Events
    events = [
        ("evt_pizza_01", 17.45, 24.49, "Vocal stress & pitch tremor", 0.91),
        ("evt_pizza_02", 28.30, 36.03, "Muffled background movement", 0.84),
        ("evt_pizza_03", 59.01, 62.54, "Whispered speech / constrained airflow", 0.93),
        ("evt_pizza_04", 80.70, 83.78, "Elevated vocal urgency", 0.95)
    ]
    for eid, start_s, end_s, label, conf in events:
        cur.execute("""
            INSERT INTO audio_events (id, call_id, label, raw_label, start_s, end_s, confidence, model, is_interpretation, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            eid, call_id, label, label, start_s, end_s, conf, "AST-audio-events", 1, db.now()
        ))

    con.commit()
    con.close()
    print("Database seeding completed for call_covert_pizza_distress and CASE-2026-0002")

if __name__ == "__main__":
    seed()
