# Orbitwin — final completion report

**Date:** 25 October 2026  
**Build:** local-first emergency-call intelligence demo  
**Working directory:** `C:\Users\Captain\Desktop\VecaWin`

## 1. Outcome

The static Orbitwin dashboard is now a working, API-backed review application.
A user can sign in, upload a consented recording or load a labelled synthetic
demo, watch local analysis progress, inspect the transcript and translation,
speakers, vocal-emotion note, audio events, real OpenStreetMap location,
findings and urgency breakdown, then link the recording to a persistent case,
review findings, add notes, acknowledge alerts, search, and download an HTML or
JSON report.

The approved black-and-red Orbitwin identity has been rebuilt as a responsive,
full-screen blackglass console: matte black and graphite surfaces, a single
signal-red accent, Inter/JetBrains Mono typography, and a native three-zone CSS
grid. The old fixed 1536×1024 stage and fractional transform scaling were
removed, so text, borders and maps stay crisp at every desktop size. The old
inline mock data/random live updates and decorative SVG maps were removed from
the live path. Vecna remains the public landing page at `/`; `/console` shows the
login screen until a session exists.

## 2. Architecture

```text
Browser
  Orbitwin_Emergency_Response_Intelligence.html   dashboard shell + login/modals
  static/orbitwin.css                            responsive blackglass design system
  static/app.js                                  API dashboard + live mic capture
  static/vendor/leaflet/                         vendored Leaflet 1.9.4
        |
        | same-origin fetch + session cookie + CSRF
        v
FastAPI app/main.py
  auth.py       bcrypt users, sessions, CSRF, login throttle
  storage.py    upload validation, ffmpeg, SHA-256, waveform peaks
  gemini.py     optional server-side Gemini live transcription adapter
  jobs.py       single background analysis worker
  pipeline.py   ASR, translation, speakers, emotion, events, findings, urgency
  models.py     lazy local model registry
  phrases.py    reference pack matching + bilingual sentiment
  geo.py        gazetteer + Nominatim cache + landmark extraction
  reports.py    HTML and JSON reports
        |
        v
SQLite data/orbitwin.db + private audio data/uploads/
```

All final analysis, evidence association, mapping and reporting are local. The
only optional cloud path is live transcription: `static/app.js` captures 5-second
WAV chunks and calls the authenticated `/api/live/transcribe` route; FastAPI's
`gemini.py` sends each chunk to Google with the server-side key. The browser
never receives model credentials. If Gemini is unavailable, the browser keeps
recording and uploads the full WAV for the normal local pipeline. The analysis
worker is local and single-concurrency by design for a CPU demo.

## 3. Implementation details

### Ingestion and evidence handling

- Upload accepts WAV/MP3/M4A/AAC/OGG/OPUS/FLAC/WebM/MP4 only.
- Validates extension, MIME prefix, 50 MB size limit and 300-second duration.
- Probes with `ffprobe`, normalises with ffmpeg to mono 16 kHz PCM WAV.
- Generates server-side IDs, never trusts the uploaded filename for storage.
- Computes SHA-256 of the original file and persists it on the call record.
- Extracts 640 waveform peaks for the real audio scrubber.
- Uploaded audio is served with HTTP Range support through an authenticated
  endpoint.

### Local AI

- faster-whisper `base` for language detection and English transcription.
- faster-whisper `small` for Hindi/Hinglish transcription.
- faster-whisper `small` for Hindi→English translation (the earlier `base`
  translation confused “डर गई” with “depression”; switching to `small` improved
  the final line to “I am scared”).
- `superb/wav2vec2-base-superb-er` for top-label vocal emotion and confidence.
- Prosodic features: pitch median (autocorrelation over voiced frames), pause
  ratio and speech rate.
- `MIT/ast-finetuned-audioset-10-10-0.4593` for AudioSet event predictions over
  10-second windows, plus signal-based silence/low-audio detection.
- Speaker attribution uses MFCC features and k-means with automatic speaker-count
  selection. It is labelled as heuristic clustering, not overlap-aware
  diarisation.

### Findings, urgency and review

- Controlled phrase matching against `data/reference_pack.json` (10 labelled
  entries, editable). Original transcript matches are preferred. If a phrase is
  only found in the machine translation, the finding is marked
  `controlled_reference_match_on_translation`, down-weighted and explicitly
  flagged for verification.
- Findings are deduplicated by reference entry and overlapping time.
- Urgency is a transparent sum of contributions: acoustic arousal, distress
  phrases, scam terms, contextual language, multiple speakers, risk audio event,
  transcript/acoustic discrepancy and co-occurring indicators. The breakdown is
  visible in the UI; it is not a hidden model score.
- Finding review stores `confirmed`, `dismissed` or `unreviewed`, reviewer note
  and review metadata. Review actions are human decisions.
- Cases, notes, status/priority updates and audit events are persisted.

### Map and location

- Leaflet 1.9.4 is vendored locally; tiles are real OpenStreetMap tiles.
- Spoken landmark extraction uses the local gazetteer and Nominatim geocoding.
  Nominatim results are cached in SQLite. The local gazetteer is the fallback.
- Locations are labelled `spoken_landmark`, `investigator` or similar, with
  accuracy and verification status. There are no decorative/fake pins.
- The full-map view and the three dashboard map views are real interactive maps.
- Tile failures are visible: after repeated tile errors the map shows "Map tiles
  are slow or blocked" while keeping the real marker/coordinate layer. The warning
  clears when tiles recover.
- `python scripts/prewarm_map.py --no-network` reports **19/19** demo landmarks
  cached. `--check-tiles` fetched real OSM tiles for Dadar and Marine Drive:
  Dadar HTTP 200 (~37 KB, z/x/y=13/5753/3655); Marine Drive HTTP 200 (~15 KB,
  z/x/y=13/5752/3656). Bodies vary as the map data updates.

### Live microphone mode

- The header **Go Live** button opens a consent-first live microphone window.
- The browser records mono WAV via Web Audio, resamples to 16 kHz, sends complete
  5-second chunks to `/api/live/transcribe`, and displays the returned text as
  **provisional**. A full local WAV is retained in browser memory for Stop.
- The server route requires the normal session + CSRF, checks content type, size,
  session ID and duration, writes only a temporary chunk, normalises it with
  ffmpeg, and calls Gemini with the key in the `x-goog-api-key` header. The key is
  never in the URL, browser code or API response.
- Provider errors are mapped to short, redacted messages. A missing key, quota
  error, network failure or model rejection switches the UI to local recording;
  it does not fabricate a transcript.
- On Stop, the full WAV goes through the existing upload route, which computes
  SHA-256, stores the normalized recording, queues the local pipeline and then
  produces the final transcript, findings, urgency and map. The provisional text
  is not persisted as evidence.
- The live session is capped at the normal 5-minute recording limit and a
  per-user/per-session request limit. The default is one 5-second chunk every
  five seconds (12 requests/minute). A **Cancel** action discards without upload.
- The pasted Gemini key from development is treated as exposed. No key was written
  to the repository; the real-key smoke test remains pending a rotated key.

### UI workflow

- Login overlay; queue; priority filter; search; notifications; profile menu.
- Active-call header with source, priority, case link, duration and status.
- Real waveform, play/pause, seek, speed and mute.
- Tabs: Live Transcript, Audio Analysis, Location, Timeline.
- Language-aware original + English display toggle.
- Related findings cards open a review overlay.
- Cases overlay: create case, link active recording, update status/priority,
  add notes, review findings, download reports.
- Reports overlay and download links.
- Alerts overlay with acknowledge/dismiss.
- Settings/status overlay showing local models, cache state, map cache coverage,
  live Gemini status, telephony unavailability, limits, reference pack and
  retention note.
- Go Live microphone window with explicit consent, language hint, optional case,
  live timer, provisional transcript, local-fallback warning, Stop & analyse and
  Cancel.
- Labelled demo loader with two synthetic scenarios.
- Responsive native CSS layout: compact sidebar, call queue, active-call and
  transcript workspace, and a Signals/Location/Audio rail. No fixed-canvas
  transform scaling. Desktop breakpoints keep the workspace full-screen, cap it
  at 2200 px on very wide displays, and hide duplicate call chips or lower-value
  panels on narrower/shorter screens.
- Dark grayscale OpenStreetMap tiles, red pins and accuracy circles, visible OSM
  attribution, and a real interactive full-map view.

## 4. Integrations

| Integration | Status | Evidence |
| --- | --- | --- |
| faster-whisper | Real, local | Hinglish and English demos produced persisted transcripts/translations. |
| Gemini live transcription | Implemented, optional cloud | Server-side adapter + authenticated 5-second chunk route. Mocked endpoint and request-shape tests pass; browser fake-microphone/mock-provider test produced provisional text. A real-key smoke test is pending a rotated key. |
| AST AudioSet | Real, local | Hinglish demo produced `Synthetic speech` 0.092, `Crowd / conversation` 0.072, `Silence / low audio` 0.800. |
| wav2vec2 emotion | Real, local | Hinglish demo produced `Anger` 0.444 and `Neutral` 0.357 aggregated predictions. |
| Leaflet + OpenStreetMap | Real | Real tiles and markers visible in dashboard/full map; 19/19 demo landmarks cached; OSM tile HTTP 200 verified. |
| Map failure state | Real UI state | Blocked tile requests produced the visible tile-failure warning while markers remained. |
| Nominatim | Real with cache/fallback | Dadar Station and Marine Drive geocoded successfully. |
| ffmpeg/ffprobe | Real | Upload conversion, duration probe and waveform generation exercised. |
| edge-tts | Build-time only | Two synthetic demo WAVs and `scenarios.json`. |
| Telephony | Not configured | `/api/telephony/incoming` returns an honest unavailable response; no live call is claimed. |

## 5. Demo results (real local runs)

### Hinglish distress / digital-arrest demo

- Synthetic audio: 30.0 s, 16 kHz mono, two voices, background noise/horn.
- Detected language: `hi` (Hindi/Hinglish), probability 1.0.
- Speaker profiles: 2 (MFCC acoustic clustering, heuristic).
- Urgency: **70.9 / 100, high**.
- Contributions: acoustic arousal 10.9, distress phrases 20, scam terms 12,
  contextual language 8, multiple speakers 10, co-occurring indicators 10.
- Findings (8): request for help; possible additional speaker (model finding);
  claimed police/CBI verification; customs/courier parcel scam; potentially
  controlling language; digital arrest; urgent payment/transfer demand; second
  request for help.
- Location: Dadar Station, Mumbai, 19.0192269, 72.8428479, ±1000 m,
  `spoken_landmark`, unverified.
- Audio events: synthetic speech, crowd/conversation, silence/low audio.
- First full analysis (before the translation model change) took 126 seconds on
  CPU. A reprocess using the Hindi `small` model for translation completed in
  80 seconds (started 2026-10-24T16:09:00Z, finished 2026-10-24T16:10:20Z).
- Final translation ends “Save the money. I am scared.” It still contains
  machine errors (for example “custom sparsal” for “customs parcel”); the
  original transcript is the primary evidence and translation matches are
  flagged for verification. The earlier `base` translation had incorrectly
  rendered “डर गई” as “depression”; the `small` translation corrected it to
  “I am scared.”

### English help demo

- Synthetic audio: 14.0 s.
- Detected language: `en`.
- Speaker profiles: 2 (heuristic).
- Urgency: **38.0 / 100, low**.
- Findings (2): request for help; possible additional speaker.
- Location: Marine Drive, Mumbai, 18.9557281, 72.8127131, ±1000 m,
  `spoken_landmark`, unverified.
- Audio events: synthetic speech, silence/low audio.
- Analysis job: 28 seconds, completed 2026-10-24T15:58:18Z.

The demo is explicitly synthetic. The UI labels it “Synthetic demo · not a real
call”; the queue, image caption and report carry the same label. It is not
presented as a real emergency.

## 6. Test evidence

### Automated tests (executed)

```text
python -m pytest -q
.........                                                                [100%]
9 passed
```

Coverage:

- `/api/health`, unauthenticated `/api/me`, anonymous API rejection.
- Login success/failure, logout, session invalidation.
- Missing/wrong CSRF token rejection.
- Case create/update/notes/search.
- Search of persisted transcript text and spoken-location labels/details, in
  addition to cases and findings.
- HTML and JSON report content; protected report access after logout.
- Upload extension/content/size validation.
- Valid WAV ingestion, waveform peaks and HTTP Range audio serving.
- Login throttle after eight failed attempts.
- Live config, missing-key refusal and unauthenticated live route rejection.
- Mocked live transcription through the authenticated endpoint (real ffmpeg
  normalisation of a generated WAV, CSRF refusal, no key leakage).
- Gemini request shape, `x-goog-api-key` header, audio payload, response
  cleaning and redacted 401 errors.

The tests use a temporary SQLite database and temporary uploads; the background
model worker is disabled so the suite is fast and deterministic. No test uses a
real Gemini key or calls Google.

### Static/syntax checks (executed)

```text
python -m compileall -q app tests scripts     # pass
node --check static\app.js                    # pass
python scripts/prewarm_map.py --no-network    # 19/19 landmarks cached
python scripts/prewarm_map.py --no-network --check-tiles  # both demo tiles HTTP 200
```

### Browser E2E (executed with installed Chrome/Chromium, Playwright 1.61)

Verified in headless Chrome, including the final responsive-console regression:

- login screen → sign in → live queue
- Hinglish call selection, priority/urgency display
- Live Transcript / Audio Analysis / Location / Timeline tab switches
- triage overlay; no map bleed after stacking-context fix
- Investigations → case list → case detail
- full-screen map
- global search
- alerts overlay
- settings/status overlay with live status and map cache count
- upload/demo modal with two scenarios
- persisted search regression: `Dadar` returned 1 recording and 1 case;
  `CASE-2026-0001` returned the prepared case; `मदद` returned 1 recording
- responsive layout at 1440×900, 1536×1024, 1920×1080 and 2560×1440 with no page
  overflow; the wide layout is capped at 2200 px rather than stretched edge to edge
- the full map loaded 28 real OSM tiles; dashboard map layers loaded real tiles
- alerts dropdown rendered four alert rows with an unread count
- case detail rendered the report downloads, linked recording, eight findings and
  investigator notes
- logout returned to the Vecna landing page at `/`
- zero page errors and zero console errors in the final regression run
- Go Live: consent gate, fake microphone start, live timer, microphone-local
  fallback message, Cancel without upload
- Go Live with microphone permission denied: visible setup error, setup screen
  restored, no empty upload attempted
- Go Live with a mocked Gemini config/provider: 3-second chunk produced a
  provisional transcript line in the UI; stop/cancel left no console errors
- Go Live stop → intercepted upload contained a valid 16 kHz mono PCM WAV
  (ffprobe: 1.54 s, 16,000 Hz, 1 channel)
- real OSM tiles + marker in all three dashboard maps (main/mini/bottom) and the
  full map; zero map tile errors
- blocked OSM tile requests produced the visible tile-failure warning while the
  marker remained
- zero page errors and zero console errors in the normal live/map run

Screenshots from the final regression are in
`C:\Users\Captain\AppData\Local\Temp\opencode\orbitwin_final_login.png`,
`orbitwin_final_1440.png`, `orbitwin_final_1536.png`,
`orbitwin_final_1920.png` and `orbitwin_final_2560.png`. The earlier live/map
screenshots remain under the same temp directory.

## 7. Security controls

- API-wide authentication middleware for all `/api/*` endpoints except login,
  health and the explicit `/api/me` session probe.
- bcrypt password hashing; server-side sessions; HttpOnly, SameSite=Lax cookies.
- Per-session CSRF token required on every mutating API.
- Failed-login throttle: 8 failures per client/username per 5 minutes.
- Upload validation: extension, MIME, size, duration, ffprobe/ffmpeg, generated
  names, SHA-256.
- Live chunks require the same session and CSRF token; content type, size,
  duration, session ID and chunk limits are validated. Temporary chunks are
  deleted after each request.
- The Gemini key exists only in the server process. It is not in static files,
  API responses, URLs or audit details. Provider errors are redacted.
- Live sessions are rate-limited per user and capped per session; the UI has an
  explicit consent gate and a visible cloud-transfer notice.
- HTML report output is escaped; SQL uses parameter binding.
- CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`.
- Reports and audio require authentication; report output is escaped.
- Audit records for login, upload, case changes, notes, reviews, locations,
  alerts and deletion requests.

Caveats: the SQLite database and audio are not encrypted at rest; the local demo
cookie has `secure=False` because it runs over HTTP; there is no MFA, multi-tenant
role model, remote audit sink or secure-erasure guarantee. See the runbook.

## 8. Blockers and honest limitations

1. **No live telephony.** No provider credentials or adapter. Upload, labelled
   demos and consented browser microphone capture are supported; auto-answer for
   a real phone call is not. The live microphone is not a phone intercept.
2. **No official distress/scam codebook.** The reference pack is a clearly
   labelled editable sample, not an authorised agency codebook.
3. **No validated Hindi/Hinglish vocal-emotion model.** The emotion model is
   English-trained. Predictions are shown as model output, not deception or
   guilt detection.
4. **Heuristic speaker attribution.** MFCC clustering does not handle overlapping
   speech or verify identities.
5. **CPU latency.** Hinglish 30 s demo took about two minutes; the UI shows
   progress and does not freeze. First run may download models.
6. **Machine translation can be wrong.** The original transcript is primary;
   translation matches are flagged. The final Hinglish line is improved but
   translation is not certified.
7. **Geocoding limits.** Nominatim/OSM are public services with usage policies;
   a production deployment needs a suitable provider or self-hosted service.
8. **Data-at-rest.** No encryption or secure deletion in this build.
9. **Demo data is synthetic.** The prepared records are for demonstration and
   testing, not real incidents.
10. **Live Gemini is not yet smoke-tested with a fresh key.** The key pasted
    during development is exposed and must not be used. The server-side code,
    mocked endpoint, request shape and browser fake-microphone path are tested;
    add a fresh key to `.env`, restart, and run one real consenting short segment
    before claiming live Gemini success. Network/quota failures correctly fall
    back to local recording.
11. **Live audio leaves the machine while active.** This is disclosed in the UI
    and docs. It needs a data-processing decision and consent before any
    operational use.

## 9. Runbook summary

Full details are in `README.md` and `RUNBOOK.md`.

```powershell
cd C:\Users\Captain\Desktop\VecaWin
python -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open <http://127.0.0.1:8000/>. Default local demo login:
`mehta` / `orbitwin-demo` (change in `.env` before sharing).

Demo: **Add Recording** → Hinglish demo → **Load & analyse**. On CPU allow
1–3 minutes. Then review, **Save to Case**, open **Investigations**, review
findings, add a note, and download the HTML/JSON report.

Live option: add a **fresh** `GEMINI_API_KEY` to server-side `.env`, restart,
click **Go Live**, confirm consent, start, speak, then **Stop & analyse**. The
provisional Gemini text is replaced by the local final transcript. Confirm
**Settings → Live transcription** says Gemini is configured before the demo.

Test: `python -m pytest -q`; map warm check:
`python scripts/prewarm_map.py --no-network --check-tiles`.

Reset (destructive; only for synthetic demo data): stop the server, remove
`data/orbitwin.db` and `data/uploads/*`, restart. Never do this to real evidence.

## 10. Readiness

**Demo-ready now:** the end-to-end upload/demo → local analysis → transcript,
translation, speakers, emotion note, events, map, findings, urgency → case,
review, notes, alerts, search and report path works and has been exercised in a
real browser. The map is prewarmed (19/19 landmarks, verified OSM tiles).

**Live-demo-ready with one external dependency:** the microphone path is
implemented and browser-tested with fake audio/mock Gemini. Before presenting it
as live Gemini, add a fresh server-side key, restart, and run one real consenting
smoke segment. The exposed development key is not acceptable. If the key or quota
fails, the UI explicitly falls back to local recording and does not claim a
transcript.

**Not production-ready:** live telephony, an authorised codebook, encrypted
evidence storage, validated Hindi emotion, stronger diarisation, multi-user
roles/MFA, a production geocoder/tile agreement, a live Gemini data-processing
agreement/quota plan, a retention/backup policy and independent accuracy
evaluation are still required. The UI and reports state these limits rather than
hiding them.
