# Orbitwin runbook

This runbook is for the local hackathon build. It is intentionally explicit
about what is real, what is simulated, and what is not configured.

## 1. Start from a clean shell

```powershell
cd C:\Users\Captain\Desktop\VecaWin
python -m pip install -r requirements.txt
ffmpeg -version
ffprobe -version
```

`ffmpeg` and `ffprobe` must be on `PATH`. The backend calls them directly to
probe, normalise and hash recordings.

## 2. Configure

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Minimum settings to review:

- `ORBITWIN_AUTH=1` — keep authentication on for shared machines.
- `ORBITWIN_DEMO_USER` / `ORBITWIN_DEMO_PASSWORD` — change before sharing.
- `MAX_UPLOAD_MB=50` and `MAX_DURATION_SECONDS=300` — adjust to your evidence
  policy.
- `WHISPER_MODEL=base`, `WHISPER_HINDI_MODEL=small` — CPU/latency trade-off.
- `AUDIO_EVENT_MODEL` and `EMOTION_MODEL` — local Hugging Face model IDs.
- `TELEPHONY_PROVIDER=none` — leave unset unless you implement and test a real
  provider adapter.
- `GEMINI_API_KEY` — optional, server-side only. Use a **fresh** key created for
  this demo. Do not reuse a key that appeared in chat, screenshots, logs or a
  browser. Revoke exposed keys in Google AI Studio.
- `GEMINI_MODEL=gemini-2.5-flash` — the live model. Check the current Google
  model/API availability before the demo.
- `LIVE_CHUNK_SECONDS=5`, `LIVE_MAX_SECONDS=300`,
  `LIVE_RATE_LIMIT_PER_MINUTE=12` — near-real-time defaults. The live cap is
  clamped to `MAX_DURATION_SECONDS` because the full recording goes through the
  normal upload endpoint.
- `LIVE_MAX_CHUNK_MB=8` — per-chunk size cap.

Do not commit `.env`, `data/orbitwin.db`, `data/uploads/`, or model caches.
Never put `GEMINI_API_KEY` in `static/app.js`, the HTML, a query string or a
browser local-storage value.

## 3. Start

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000/>.

Default local sign-in: `mehta` / `orbitwin-demo`.

For a local-only session without login:

```powershell
$env:ORBITWIN_AUTH="0"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Do not use `ORBITWIN_AUTH=0` on a shared machine.

## 4. First-run model downloads

The first analysis downloads:

- faster-whisper `base` and `small`
- `MIT/ast-finetuned-audioset-10-10-0.4593`
- `superb/wav2vec2-base-superb-er`

The UI shows `Model setup needed` until the cache is complete. Download once,
then run offline if the Hugging Face cache is available. Do not put a cloud API
key in the browser.

## 5. Demo and upload flow

1. **Add Recording** → choose the Hinglish demo → **Load & analyse**.
2. Wait for the progress chip. The CPU analysis of the 30-second, two-voice
   Hinglish demo took about 130 seconds on the tested Intel UHD 620 machine.
3. Review:
   - **Live Transcript** — original, English translation, speaker chip, vocal
     emotion chip and transcript sentiment chip. Click a segment to seek audio.
   - **Audio Analysis** — prosody metrics, vocal-emotion output, events and
     model names.
   - **Location** — spoken landmark, coordinates, accuracy, verification and
     manual investigator location form.
   - **Timeline** — transcript, findings, events and locations on one time axis.
4. Click a waveform/transcript segment, use play/pause, scrub, cycle `1x→2x`
   and mute.
5. **Save to Case**. The prepared demo case is `CASE-2026-0001`.
6. In **Investigations**, open the case, review each finding, add notes, and
   download **HTML report** or **JSON evidence**.
7. **Reports** lists cases and report links.
8. **Alerts** opens persisted rule-driven alerts. Acknowledge or dismiss after
   review; this action is recorded.
9. **Map** opens the full OpenStreetMap view with a real marker and accuracy
   circle. If there is no location, the map says so and shows no fake pin.

### Live microphone (optional)

Use this only with consent from everyone in the room. It is a browser
microphone capture, not a telephone intercept.

1. Ensure a fresh `GEMINI_API_KEY` is set in `.env` and restart uvicorn. Verify
   `/api/config/status` reports `live.configured: true` (sign in first) or open
   **Settings → Live transcription**.
2. Click **Go Live** in the header. Read the privacy warning, confirm consent,
   choose the language hint, and optionally link a case.
3. Click **Start listening**. The browser records mono 16 kHz WAV in 5-second
   segments. Each segment goes to the authenticated `/api/live/transcribe`
   endpoint; the server sends it to Gemini and returns provisional text.
4. Watch the provisional transcript. A Gemini error or quota message switches
   the session to local recording; the browser does not invent a transcript.
5. Click **Stop & analyse**. The full WAV is uploaded through the normal
   recording endpoint and queued for the local final analysis. The final local
   transcript replaces the provisional Gemini text. The map and findings appear
   after that analysis.
6. **Cancel** discards the live session without uploading. **Close** is blocked
   while recording and while an upload is in progress.

For a stage demo, run the live smoke test with the same microphone and network
before presenting. Open **Settings → Live transcription** and confirm it shows
`Gemini <model>` rather than `Not configured · local recording only`. Do not
print or paste the key itself. If the key is absent or quota is exhausted, use
the labelled demo or **Add Recording** instead and say so clearly.

### Map prewarm

The demo landmarks are cached in SQLite. Verify them and optionally fetch one
real OSM tile for Dadar and Marine Drive:

```powershell
python scripts/prewarm_map.py --no-network
python scripts/prewarm_map.py --check-tiles
```

The expected output is `cache: 19/19 landmarks` and HTTP 200 for both tiles.
The dashboard map shows a visible "Map tiles are slow or blocked" warning if
tile requests fail, while still showing real markers and coordinates. If the
network is unavailable, say that the base tiles are offline; do not claim the
map is live.

## 6. Evidence and data handling

Runtime paths:

```text
data/orbitwin.db          SQLite records, sessions, audit events
data/uploads/             original and normalised audio
data/demo/                synthetic demo WAVs and scenarios
data/reference_pack.json  editable reference pack
data/secret.key           local session/CSRF secret (created on first run)
```

The SHA-256 of the original upload is stored on the call record and included
in reports. The browser label says **SHA-256 recorded** — it does not claim a
chain-of-custody signature.

Live chunks are temporary: the server writes each chunk under `data/uploads/`,
converts it, calls Gemini and deletes the temporary directory after the request.
The full recording is uploaded on Stop and then follows the normal evidence
path (SHA-256, normalised WAV, local analysis). The provisional Gemini transcript
is displayed only; it is not saved as the call transcript. While live mode is
active, audio leaves the machine for Google Gemini. Do not use it without
consent or on a network where that transfer is not permitted.

To remove a call and its derived rows through the API:

```powershell
# Sign in in the browser, then use DevTools or the UI. There is no delete
# button in this build; the API is:
# DELETE /api/calls/{call_id} with X-CSRF-Token
```

The database uses cascading foreign keys. `storage.delete_call_files` removes
the generated original and normalised WAV files. Back up `data/` before any
manual database work.

## 7. Tests

```powershell
python -m pytest -q
python -m compileall -q app tests scripts
node --check static\app.js
python scripts/prewarm_map.py --no-network
```

Expected current status: `9 passed`. The test suite uses a temporary database and
upload directory and disables the background model worker. The Gemini adapter
tests use a fake HTTP client and never call Google. A real-key smoke test is
required after adding a fresh key; do not infer live success from the mocked
tests.

## 8. Troubleshooting

### `ffmpeg` / `ffprobe` not found

Install ffmpeg and ensure both binaries are on `PATH`, then restart the server.
The upload will be rejected with an audio-conversion error rather than being
silently accepted.

### `Model setup needed` / first analysis very slow

The model cache is incomplete or CPU inference is running. Watch the progress
chip. Do not reload the page during analysis; the job is persisted and the
queue will refresh. A 30-second Hinglish demo is expected to be slow on CPU.

### Login is rejected / too many attempts

The login throttle allows 8 failed attempts per client/username in 5 minutes.
Wait, or restart the local server to clear the in-memory throttle. Check the
credentials in `.env`; passwords are seeded only when the demo user does not
already exist.

### I changed the demo password but the old one still works

The demo user is seeded once into SQLite. Changing `.env` does not rotate an
existing user. Use a fresh database for a new demo, or update the user through a
controlled local admin step. Do not delete the database without backing it up.

### Map is grey or tiles do not load

Leaflet is vendored locally, but tiles come from `tile.openstreetmap.org`.
Check network access and run `python scripts/prewarm_map.py --check-tiles`.
Markers and coordinates still render if the tile host is unavailable, and the
map shows a visible tile-failure warning. For production, configure an
appropriate tile provider and review its usage policy.

### Live microphone says Gemini is not configured

`GEMINI_API_KEY` is missing from the server-side `.env`, or the server was not
restarted after adding it. The key is intentionally not read from the browser.
Record locally and analyse after Stop, or add a fresh key and restart.

### Live transcription returns HTTP 429 / quota errors

The Gemini quota or the local live rate limit was reached. Stop and analyse the
recording locally, reduce `LIVE_RATE_LIMIT_PER_MINUTE`, or use the labelled demo.
The UI must say that the transcript is unavailable; it must not show invented
text.

### Microphone permission is denied or no audio is captured

Use `http://127.0.0.1:8000` (a secure local origin), allow microphone access in
Chrome, and select the correct input device. If no samples are captured, the UI
asks you to allow access and does not upload an empty recording.

### I need live calls

This build does not implement live telephony. The `/api/telephony/incoming`
route returns an honest unavailable response. Do not represent the demo as a
live call. To add telephony, implement a provider-specific webhook/adapter,
authenticate it, verify signatures, record consent, and test with a real
provider sandbox.

### I need to reset the demo

Back up `data/` first. Then stop the server and remove the runtime database and
uploaded files if you intend a full reset:

```powershell
# Destructive: removes demo records and uploaded audio.
Remove-Item data\orbitwin.db
Remove-Item data\uploads\* -Recurse -Force
```

Restart the server. It recreates the schema and seeds the demo user. Do not run
this against real case data.

## 9. Production hardening checklist

- Change the demo password; add a real user/role model.
- Serve behind HTTPS and set the session cookie `secure=True`.
- Use OS/volume encryption for `data/`; the SQLite database is not encrypted.
- Add a self-hosted geocoder/tile provider with appropriate terms.
- Replace the sample reference pack with an authorised, versioned codebook.
- Add retention/deletion policy, backups, audit export and remote monitoring.
- Do not enable live telephony until signature verification, consent capture,
  provider failover and call-recording law are reviewed.
- Treat live microphone capture as sensitive. Add an explicit retention policy
  for provisional cloud audio/text, a data-processing agreement with Google,
  and a way to disable cloud mode on restricted networks.
- Revalidate ASR and emotion performance on the languages and channels you
  actually use. The Hindi/Hinglish vocal-emotion path is not validated.
