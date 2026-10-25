"""Generate the labelled synthetic Hinglish demo call with edge-tts + ffmpeg.

This is intentionally a build-time utility, not part of the live pipeline.
The output is clearly marked synthetic in the UI and database.
"""
from __future__ import annotations

import asyncio
import json
import subprocess
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "data" / "demo"
TMP = DEMO / "tts"
DEMO.mkdir(parents=True, exist_ok=True)
TMP.mkdir(parents=True, exist_ok=True)

LINES = [
    # id, voice, text, start delay (seconds), volume
    ("caller_1", "hi-IN-SwaraNeural", "मुझे मदद चाहिए। मैं दादर स्टेशन के पास हूँ।", 0.4, 1.0),
    ("male_1", "hi-IN-MadhurNeural", "मैं CBI अफसर बोल रहा हूँ।", 4.8, 0.42),
    ("caller_2", "hi-IN-SwaraNeural", "वह कह रहा है कि मेरे नाम पर कस्टम्स पार्सल आया है और उसमें ड्रग्स हैं।", 7.7, 1.0),
    ("male_2", "hi-IN-MadhurNeural", "चुप रहो। कुछ मत बोलो। फोन मत करो।", 13.8, 0.40),
    ("caller_3", "hi-IN-SwaraNeural", "वह डिजिटल अरेस्ट की बात कर रहा है और पचास हज़ार रुपये माँग रहा है।", 17.3, 1.0),
    ("caller_4", "hi-IN-SwaraNeural", "कृपया बचाओ। मैं डर गई हूँ।", 24.2, 1.0),
]


def run(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


async def tts(text: str, voice: str, path: Path) -> None:
    communicate = edge_tts.Communicate(text, voice, rate="-8%")
    await communicate.save(str(path))


def duration(path: Path) -> float:
    result = run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)])
    return float(result.stdout.strip() or 0)


def main() -> None:
    for line_id, voice, text, _, _ in LINES:
        path = TMP / f"{line_id}.mp3"
        if not path.exists():
            asyncio.run(tts(text, voice, path))
        print(line_id, round(duration(path), 2))

    # 30 seconds of brown traffic-like noise + a distant two-tone horn.
    noise = TMP / "noise.wav"
    horn = TMP / "horn.wav"
    run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
        "anoisesrc=color=brown:amplitude=0.045:d=30",
        "-af", "lowpass=f=900,highpass=f=60,volume=0.7", str(noise),
    ])
    run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
        "sine=frequency=420:duration=1.1",
        "-af", "volume=0.10,afade=t=in:st=0:d=0.08,afade=t=out:st=0.9:d=0.2", str(horn),
    ])

    inputs = []
    filters = []
    for line_id, _, _, start, volume in LINES:
        inputs += ["-i", str(TMP / f"{line_id}.mp3")]
        filters.append(f"[{len(inputs)//2 - 1}:a]volume={volume},adelay={int(start*1000)}|{int(start*1000)}[v{line_id}]")
    base_index = len(inputs) // 2
    inputs += ["-i", str(noise), "-i", str(horn)]
    filters.append(f"[{base_index}:a]volume=1.0[nz]")
    filters.append(f"[{base_index+1}:a]adelay=9200|9200[hn]")
    mix_inputs = "".join(f"[v{line_id}]" for line_id, *_ in LINES) + "[nz][hn]"
    filters.append(f"{mix_inputs}amix=inputs={len(LINES)+2}:duration=longest:normalize=0,alimiter=limit=0.95[out]")

    output = DEMO / "hinglish_distress_scam.wav"
    result = run([
        "ffmpeg", "-y", "-v", "error", *inputs,
        "-filter_complex", ";".join(filters), "-map", "[out]",
        "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", str(output),
    ])
    if result.returncode != 0:
        raise SystemExit(result.stderr)
    print("wrote", output, round(duration(output), 2), "seconds")

    english_lines = [
        ("en_1", "Please help me. I am near Marine Drive in Mumbai."),
        ("en_2", "A man is following me and asking for money. I am scared."),
    ]
    for line_id, text in english_lines:
        path = TMP / f"{line_id}.mp3"
        if not path.exists():
            asyncio.run(tts(text, "en-IN-NeerjaNeural", path))
    en_inputs = []
    en_filters = []
    for index, (line_id, _) in enumerate(english_lines):
        en_inputs += ["-i", str(TMP / f"{line_id}.mp3")]
        start = 0.4 if index == 0 else 5.8
        en_filters.append(f"[{index}:a]volume=1.0,adelay={int(start*1000)}|{int(start*1000)}[e{index}]")
    en_inputs += ["-i", str(noise)]
    en_filters.append(f"[2:a]volume=0.6[enz]")
    en_filters.append("[e0][e1][enz]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95[out]")
    english_output = DEMO / "english_help_marine_drive.wav"
    result = run([
        "ffmpeg", "-y", "-v", "error", *en_inputs,
        "-filter_complex", ";".join(en_filters), "-map", "[out]",
        "-ac", "1", "-ar", "16000", "-acodec", "pcm_s16le", "-t", "14", str(english_output),
    ])
    if result.returncode != 0:
        raise SystemExit(result.stderr)
    print("wrote", english_output, round(duration(english_output), 2), "seconds")

    scenarios = {
        "scenarios": [
            {
                "id": "hinglish_distress_scam",
                "title": "Hinglish · distress + digital-arrest scam indicators",
                "description": "Synthetic caller reports fear near Dadar station, a customs parcel story, a digital-arrest claim and a payment demand. A second quieter voice is mixed in. Designed to exercise ASR, translation, speaker clustering, reference matching and landmark mapping.",
                "file": "hinglish_distress_scam.wav",
                "language_hint": "hi-en",
                "duration_hint": round(duration(output), 1),
                "consent_note": "Synthetic demonstration audio generated with edge-tts. No real person, call or emergency is represented.",
                "is_simulated": True,
            },
            {
                "id": "english_help_marine_drive",
                "title": "English · help request near Marine Drive",
                "description": "A short synthetic English call used to verify the English path without translation. It includes a spoken landmark and a request for help.",
                "file": "english_help_marine_drive.wav",
                "language_hint": "en",
                "duration_hint": round(duration(english_output), 1),
                "consent_note": "Synthetic demonstration audio generated with edge-tts. No real person, call or emergency is represented.",
                "is_simulated": True,
            },
        ]
    }
    (DEMO / "scenarios.json").write_text(json.dumps(scenarios, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
