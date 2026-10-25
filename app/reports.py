"""Case report generation from persisted, traceable records."""
from __future__ import annotations

import html
import json

from . import db


def build_case_data(case_id: str) -> dict | None:
    case = db.query_one("SELECT * FROM cases WHERE id=?", (case_id,))
    if not case:
        return None
    calls = db.query("SELECT * FROM calls WHERE case_id=? ORDER BY created_at", (case_id,))
    for call in calls:
        call["transcript"] = db.query_one("SELECT * FROM transcripts WHERE call_id=?", (call["id"],))
        call["segments"] = db.query("SELECT * FROM segments WHERE call_id=? ORDER BY idx", (call["id"],))
        call["findings"] = db.query("SELECT * FROM findings WHERE call_id=? ORDER BY start_s", (call["id"],))
        call["locations"] = db.query("SELECT * FROM locations WHERE call_id=? ORDER BY created_at", (call["id"],))
        call["audio_events"] = db.query("SELECT * FROM audio_events WHERE call_id=? ORDER BY start_s", (call["id"],))
        call["analysis"] = json.loads(call["analysis_json"]) if call.get("analysis_json") else {}
    return {"case": case, "calls": calls, "generated_at": db.now()}


def _fmt_time(value) -> str:
    if value is None:
        return "—"
    seconds = float(value)
    return f"{int(seconds // 60):02d}:{int(seconds % 60):02d}"


def _e(value) -> str:
    return html.escape("" if value is None else str(value))


def render_report_html(data: dict, investigator: str) -> str:
    case = data["case"]
    calls_html = []
    for call in data["calls"]:
        analysis = call.get("analysis") or {}
        urgency = call.get("urgency_score")
        findings = call.get("findings") or []
        events = call.get("audio_events") or []
        locations = call.get("locations") or []
        segments = call.get("segments") or []
        findings_html = "".join(
            f"<tr><td>{_e(f.get('type'))}</td><td>{_e(f.get('title'))}</td><td>{_fmt_time(f.get('start_s'))}</td>"
            f"<td>{_e(f.get('quote') or '—')}</td><td>{_e(f.get('source_type'))}</td>"
            f"<td>{_e(f.get('status'))}</td><td>{_e(f.get('source_ref'))}</td></tr>"
            for f in findings
        ) or "<tr><td colspan='7'>No findings recorded.</td></tr>"
        events_html = "".join(
            f"<tr><td>{_e(e.get('label'))}</td><td>{_fmt_time(e.get('start_s'))}–{_fmt_time(e.get('end_s'))}</td>"
            f"<td>{_e(round(float(e.get('confidence') or 0) * 100, 1))}%</td><td>{_e(e.get('model'))}</td></tr>"
            for e in events
        ) or "<tr><td colspan='4'>No audio events recorded.</td></tr>"
        locations_html = "".join(
            f"<tr><td>{_e(l.get('label'))}</td><td>{_e(l.get('lat'))}, {_e(l.get('lon'))}</td>"
            f"<td>{_e(l.get('source_type'))}</td><td>±{_e(l.get('accuracy_m'))} m</td>"
            f"<td>{_e(l.get('verification_status'))}</td><td>{_e(l.get('source_detail'))}</td></tr>"
            for l in locations
        ) or "<tr><td colspan='6'>No valid location observations.</td></tr>"
        transcript_html = "".join(
            f"<tr><td>{_fmt_time(s.get('start_s'))}</td><td>{_e(s.get('speaker'))}</td>"
            f"<td>{_e(s.get('text'))}</td><td>{_e(s.get('translation') or '')}</td>"
            f"<td>{_e(s.get('vocal_emotion') or '—')}</td></tr>"
            for s in segments
        ) or "<tr><td colspan='5'>No transcript segments.</td></tr>"
        limitations = analysis.get("limitations") or []
        contributions = analysis.get("urgency_contributions") or {}
        contrib_html = "".join(
            f"<li>{_e(k.replace('_', ' ').title())}: {_e(v)}</li>" for k, v in contributions.items()
        ) or "<li>No urgency contributions available.</li>"
        calls_html.append(f"""
        <section class="call">
          <h2>Call {_e(call['id'][:8])} · {_e(call.get('source_label'))}</h2>
          <div class="meta">
            <span>Status: <b>{_e(call.get('status'))}</b></span>
            <span>Source: <b>{_e(call.get('source_type'))}</b></span>
            <span>Language: <b>{_e(call.get('language'))}</b></span>
            <span>Duration: <b>{_fmt_time(call.get('duration_s'))}</b></span>
            <span>Urgency: <b>{_e(urgency if urgency is not None else 'not scored')} / 100 · {_e(call.get('urgency_band'))}</b></span>
          </div>
          <p class="hash">SHA-256: <code>{_e(call.get('sha256'))}</code> · consent: {_e(call.get('consent_note') or 'not recorded')}</p>
          <h3>Urgency contribution breakdown</h3><ul>{contrib_html}</ul>
          <h3>Transcript (original and machine translation)</h3>
          <table><thead><tr><th>Time</th><th>Speaker</th><th>Original</th><th>English</th><th>Vocal emotion</th></tr></thead><tbody>{transcript_html}</tbody></table>
          <h3>Findings and review status</h3>
          <table><thead><tr><th>Type</th><th>Title</th><th>Time</th><th>Quote</th><th>Source type</th><th>Review</th><th>Reference</th></tr></thead><tbody>{findings_html}</tbody></table>
          <h3>Background audio events</h3>
          <table><thead><tr><th>Event</th><th>Time</th><th>Confidence</th><th>Model</th></tr></thead><tbody>{events_html}</tbody></table>
          <h3>Location observations</h3>
          <table><thead><tr><th>Label</th><th>Coordinates</th><th>Source</th><th>Accuracy</th><th>Verification</th><th>Source detail</th></tr></thead><tbody>{locations_html}</tbody></table>
          <h3>Limitations</h3><ul>{''.join(f'<li>{_e(x)}</li>' for x in limitations) or '<li>See model metadata.</li>'}</ul>
        </section>
        """)
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Dhvani case report — {_e(case['case_number'])}</title>
<style>
body{{background:#f6f3ed;color:#1d2329;font-family:Segoe UI,Arial,sans-serif;margin:0;padding:32px}}
.wrap{{max-width:1100px;margin:auto;background:#fff;padding:36px;border:1px solid #d8d2c7}}
h1{{font-size:26px;margin:0 0 4px}} h2{{font-size:19px;margin-top:30px;border-bottom:2px solid #b5121b;padding-bottom:6px}}
h3{{font-size:14px;margin:20px 0 6px}} .sub{{color:#59636d;font-size:13px}} .meta{{display:flex;gap:18px;flex-wrap:wrap;font-size:12px;margin:12px 0}}
.call{{border-top:1px solid #ddd;padding-top:10px;margin-top:24px}} .hash{{font-size:11px;color:#59636d;word-break:break-all}}
table{{border-collapse:collapse;width:100%;font-size:11px;margin:8px 0 16px}} th,td{{border:1px solid #ddd;padding:5px 7px;text-align:left;vertical-align:top}}
th{{background:#f0ece4}} code{{font-size:10px}} .notice{{background:#fff5e6;border-left:4px solid #c47b00;padding:12px;font-size:12px;margin:18px 0}}
footer{{margin-top:30px;border-top:1px solid #ddd;padding-top:12px;font-size:11px;color:#59636d}}
@media print{{body{{padding:0;background:#fff}}.wrap{{border:0}}}}
</style></head><body><div class="wrap">
<div class="sub">DHVANI · EMERGENCY RESPONSE INTELLIGENCE</div>
<h1>Investigation case report</h1>
<div class="sub">{_e(case['case_number'])} · {_e(case['title'])} · generated {_e(data['generated_at'])} by {_e(investigator)}</div>
<div class="notice"><b>Decision-support only.</b> Model outputs are not proof of deception, guilt, coercion, kidnapping or criminal conduct. Every finding must be verified by an authorised investigator against the original recording and independent sources. Locations derived from spoken landmarks are approximate.</div>
<div class="meta"><span>Status: <b>{_e(case['status'])}</b></span><span>Priority: <b>{_e(case['priority'])}</b></span><span>Created: {_e(case['created_at'])}</span><span>Calls: {len(data['calls'])}</span></div>
<h3>Case summary</h3><p>{_e(case.get('summary') or 'No summary recorded.')}</p>
{''.join(calls_html) or '<p>No calls are linked to this case.</p>'}
<footer>Generated from persisted Dhvani records. Source references and model limitations are included. Report hash and evidence hashes are available in the JSON evidence bundle.</footer>
</div></body></html>"""


def render_report_json(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, default=str)
