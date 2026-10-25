"""Reference-backed phrase detection and transparent text sentiment.

No generative model invents meanings. A finding is either an exact/controlled
reference match or a clearly labelled contextual observation.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .config import DATA_DIR

PACK_PATH = DATA_DIR / "reference_pack.json"
_PACK_CACHE: dict | None = None


def load_pack() -> dict:
    global _PACK_CACHE
    if _PACK_CACHE is None:
        _PACK_CACHE = json.loads(PACK_PATH.read_text(encoding="utf-8"))
    return _PACK_CACHE


def _norm(value: str) -> str:
    value = (value or "").lower()
    value = re.sub(r"[^\w\u0900-\u097F]+", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def _find_alias(text: str, alias: str) -> tuple[int, int] | None:
    normalized = _norm(text)
    target = _norm(alias)
    if not target:
        return None
    # Latin aliases need word boundaries; Devanagari phrases use direct search.
    if re.fullmatch(r"[\w ]+", target, flags=re.UNICODE) and not re.search(r"[\u0900-\u097F]", target):
        match = re.search(r"(?<!\w)" + re.escape(target) + r"(?!\w)", normalized, flags=re.UNICODE)
    else:
        match = re.search(re.escape(target), normalized, flags=re.UNICODE)
    if not match:
        return None
    # Map normalized offsets back approximately by searching the original text
    # case-insensitively for the alias, then for its first word.
    lowered = text.lower()
    alias_lower = alias.lower().strip()
    pos = lowered.find(alias_lower)
    if pos < 0:
        first = alias_lower.split()[0] if alias_lower.split() else alias_lower
        pos = lowered.find(first)
    if pos < 0:
        return None
    return pos, min(len(text), pos + len(alias_lower))


def match_phrases(segments: list[dict]) -> list[dict]:
    pack = load_pack()
    findings: list[dict] = []
    for segment in segments:
        text = segment.get("text") or ""
        translation = segment.get("translation") or ""
        if not text.strip() and not translation.strip():
            continue
        for entry in pack.get("entries", []):
            matched_alias = None
            span = None
            source_text = text
            matched_in_translation = False
            for alias in entry.get("aliases", []):
                found = _find_alias(text, alias)
                if found:
                    matched_alias = alias
                    span = found
                    source_text = text
                    break
            if not matched_alias and translation.strip():
                for alias in entry.get("aliases", []):
                    found = _find_alias(translation, alias)
                    if found:
                        matched_alias = alias
                        span = found
                        source_text = translation
                        matched_in_translation = True
                        break
            if not matched_alias or not span:
                continue
            start, end = span
            quote = source_text[start:end].strip() or matched_alias
            confidence = float(entry.get("confidence", 0.9))
            if matched_in_translation:
                confidence = round(confidence * 0.9, 3)
            description = entry["description"]
            if matched_in_translation:
                description += " This match was found in the machine translation, not the original transcript; verify against the audio before relying on it."
            findings.append({
                "type": entry["type"],
                "subtype": entry.get("subtype"),
                "title": entry["title"],
                "description": description,
                "start_s": segment.get("start_s"),
                "end_s": segment.get("end_s"),
                "quote": quote,
                "source_type": ("glossary_translation" if matched_in_translation else ("reference_pack" if entry["type"] != "scam_term" else "glossary")),
                "source_ref": entry.get("source_ref"),
                "method": "controlled_reference_match_on_translation" if matched_in_translation else "controlled_reference_match",
                "confidence": confidence,
                "reference_id": entry.get("id"),
                "matched_in_translation": matched_in_translation,
            })
    # Deduplicate the same reference entry when its occurrences overlap in time.
    deduped: list[dict] = []
    for item in sorted(findings, key=lambda x: (float(x.get("start_s") or 0), -float(x.get("confidence") or 0))):
        duplicate = False
        for existing in deduped:
            if existing.get("reference_id") != item.get("reference_id"):
                continue
            a0 = float(existing.get("start_s") or 0)
            a1 = float(existing.get("end_s") or a0)
            b0 = float(item.get("start_s") or 0)
            b1 = float(item.get("end_s") or b0)
            if min(a1, b1) - max(a0, b0) > -1.5:
                duplicate = True
                if item.get("confidence", 0) > existing.get("confidence", 0):
                    deduped[deduped.index(existing)] = item
                break
        if not duplicate:
            deduped.append(item)
    return deduped


NEGATIVE = {
    "help", "please", "fear", "scared", "afraid", "danger", "emergency", "threat",
    "threaten", "blackmail", "kidnap", "bachao", "madad", "darr", "dar", "pareshan",
    "tension", "khatra", "rona", "ro", "mushkil", "problem", "urgent", "jaldi",
    "abhi", "paisa", "paise", "hazaar", "hazar", "lakh", "rupees", "otp", "fraud",
    "scam", "police", "cbi", "customs", "arrest", "drugs", "illegal", "chup",
}
POSITIVE = {
    "calm", "fine", "okay", "ok", "thank", "thanks", "shukriya", "theek", "thik",
    "happy", "safe", "good", "helpful", "resolved", "peace",
}
URGENT = {"now", "immediately", "urgent", "jaldi", "abhi", "please", "emergency", "bachao"}


def sentiment(text: str) -> tuple[str, float]:
    words = re.findall(r"[\w\u0900-\u097F]+", (text or "").lower(), flags=re.UNICODE)
    if not words:
        return "neutral", 0.0
    neg = sum(1 for w in words if w in NEGATIVE)
    pos = sum(1 for w in words if w in POSITIVE)
    urg = sum(1 for w in words if w in URGENT)
    score = (pos - neg) / max(4, len(words) ** 0.55)
    score = max(-1.0, min(1.0, score))
    if urg >= 2 or neg >= 2:
        label = "distress/negative"
    elif score < -0.12:
        label = "negative"
    elif score > 0.12:
        label = "positive"
    else:
        label = "neutral"
    return label, round(score, 3)
