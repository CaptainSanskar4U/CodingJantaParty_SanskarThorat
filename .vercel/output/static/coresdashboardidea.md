# MASTER EXECUTION PROMPT — ORBITWIN
## Transform the Existing Dashboard into a Fully Functional AI Investigation Platform

Act as a **senior full-stack engineer, AI engineer, systems architect, QA engineer, and hackathon demonstration specialist**. You are responsible for transforming my existing Orbitwin project into a genuinely working, end-to-end emergency-call intelligence platform.

I have already built the dashboard using the latest approved visual design. **Do not rebuild it from scratch. Preserve its existing design, layout, branding, and professional black-and-red aesthetic.** Your job is to make the existing product function reliably, integrate its systems, improve weak areas, and prepare it for a live hackathon demonstration.

My objective is to present a real working product—not a static UI, fake AI dashboard, collection of disconnected components, or scripted animation.

## 1. NON-NEGOTIABLE EXECUTION RULES

- Work directly within the existing codebase.
- Do not begin coding until you have inspected the project architecture and understood how its components connect.
- Do not replace working functionality simply because you prefer a different implementation.
- Do not rewrite the entire project or introduce unnecessary technologies.
- Do not stop after producing an audit, implementation plan, or list of recommendations. Continue into implementation and testing.
- Do not create buttons that merely animate, change labels, or display fabricated success messages.
- Do not hardcode AI outputs, emotion scores, location coordinates, confidence values, call statistics, or investigation findings and present them as live results.
- Use genuine processing and real API integrations wherever feasible.
- When a dependency, API credential, telephony integration, or external permission is unavailable, implement the best honest fallback, clearly label its limitations, and document the precise setup required.
- Never claim that a feature works, an integration is live, or a test passes unless you have actually verified it.

If a requested integration cannot be completed because external access, credentials, hardware, permissions, or services are unavailable, complete every independent part that can be implemented and clearly identify the remaining blocker.

## 2. PHASE ONE — AUDIT THE ENTIRE PROJECT

Before modifying files, inspect the complete repository.

Examine:

- Frontend framework, routes, pages, reusable components, state management, styling and existing UI interactions.
- Backend framework, API endpoints, database schema, authentication, file handling and background jobs.
- Existing AI model integrations, speech-processing services, environment variables and external APIs.
- Every button, form, filter, dropdown, tab, chart, audio control, navigation item, map control and case-management workflow.
- Existing error handling, loading states, empty states, responsive behaviour and security weaknesses.
- Dependencies, project scripts, automated tests, build configuration and deployment requirements.

Trace the path from user interaction through frontend state, API request, processing, persistence and final UI update.

Identify dead buttons, incomplete handlers, disconnected APIs, mock data, duplicated logic, broken routes, missing persistence and runtime errors.

Create a prioritised internal task checklist and then start fixing the issues. Do not wait for my approval after producing the audit.

## 3. PHASE TWO — MAKE THE FIVE CORE FEATURES FUNCTIONAL

### Feature 1: Intelligent Emergency Call Triage

Implement a functional call-management workflow.

Required behaviour:

- Display actual calls available to the application, with priority, status, duration and available metadata.
- Support call selection, queue filtering, prioritisation and case association.
- Process supported audio through the implemented speech and audio-analysis pipeline.
- Estimate vocal-emotion signals and urgency only when the configured analysis method can produce those outputs.
- Compare acoustic observations with transcript context and flag potentially significant discrepancies for human review.
- Update the relevant queue and incident details when real analysis results arrive.
- Record the source, timestamps, method and limitations of each prediction.

Where technically and legally supported, implement automatic answering after 10 seconds for eligible, authorised calls through a genuine telephony provider integration.

**Important:** A browser dashboard cannot automatically intercept ordinary telephone calls without a supporting telephony system. If real telephony credentials are unavailable, implement a working recorded-audio or authorised test-call workflow instead. Clearly label the call source and never pretend a simulated call is a live emergency.

End-call, hold, playback, mute and other controls must either invoke their real supported action or remain unavailable with a clear explanation.

### Feature 2: Covert Distress & Scam Decoder

Build contextual phrase analysis using a controlled, maintainable reference list and an actual processing pipeline.

It should:

- Identify phrases matching the configured distress-code reference data.
- Explain known scam terminology in simple language.
- Show the original phrase, surrounding transcript context, timestamp and reference source.
- Distinguish a recognised reference match from an AI-generated interpretation.
- Flag suspicious or ambiguous language for investigator review.
- Allow authorised users to review, confirm, dismiss or annotate a finding.

Do not invent code meanings or claim that a phrase proves coercion, kidnapping or criminal activity. Unknown phrases must remain unknown until supported by evidence.

### Feature 3: Location Intelligence & Interactive Map

Replace decorative map images and static mock maps with a **real interactive map implementation**.

Prefer Leaflet with a suitable OpenStreetMap tile provider if compatible with the existing stack. Reuse an existing map library if the project already has one.

Implement:

- Real map tiles and geographic navigation.
- Zoom, pan and location-marker interactions.
- Display of validated coordinates and sourced landmarks.
- Distinct markers or layers for location sources, spoken landmarks and evidence points.
- Popups containing source, timestamp, accuracy where available and verification status.
- Automatic map updates when relevant, valid location data changes.
- Proper loading, error and no-data states.

Show a marker only when actual or explicitly simulated geographic data is available.

Separate GPS-derived locations, caller-spoken landmarks, telecom-derived information and investigator-entered locations. Never present a spoken landmark as GPS confirmation, or a victim-device location as the suspect's location.

If geocoding or map services require configuration, implement the integration and document its setup. Use real map tiles in the demo where network access permits. A map failure must not crash the rest of the application.

### Feature 4: Background Audio Forensics

Implement genuine audio analysis rather than static lists of supposed detected sounds.

Depending on available libraries, models and audio quality, support analysis of events such as:

- Multiple voices or possible additional speakers.
- Traffic and transport sounds.
- Screaming or other supported vocal events.
- Typing and other supported environmental sounds.
- Significant silence or changes in the acoustic environment.

Requirements:

- Accept supported audio formats and validate uploads.
- Run the available audio-event or speaker-analysis model.
- Show event labels and timestamps grounded in actual model output.
- Link each event to the corresponding part of the recording for playback.
- Show uncertainty and distinguish detection from interpretation.
- Handle unsupported formats, processing failures and unavailable models gracefully.

Do not invent audio detections. If a requested sound category lacks a suitable model, expose only the categories the configured model can actually support and document the gap.

### Feature 5: Multilingual Emotion & Speech Intelligence

Prioritise Hindi, English and Hinglish, subject to the capabilities of the chosen speech-recognition provider.

Implement:

- Audio transcription using a genuine speech-recognition model or API.
- Timestamped transcript segments where supported.
- Original-language transcript preservation.
- Translation into English or another selected supported language.
- Language identification and language switching where the chosen model supports it.
- Speaker attribution when a genuine diarisation model is available.
- Vocal-emotion analysis using a suitable acoustic model, independently of transcript sentiment wherever feasible.
- Playback from a selected transcript timestamp.

Clearly distinguish acoustic emotion predictions from sentiment inferred from text. Do not infer guilt, deception or criminal intent from vocal patterns.

If supported languages or analysis categories are limited, display that limitation rather than quietly substituting unsupported results.

## 4. PHASE THREE — CREATE A COMPLETE INVESTIGATION WORKFLOW

Connect the five features into a coherent workflow.

A valid end-to-end sequence should be:

1. An authorised test call arrives, or an investigator uploads a supported recording.
2. The application validates the input and creates an incident or processing job.
3. Speech transcription and available audio analysis execute.
4. The application extracts and records supported findings.
5. The urgency estimate and call queue update where the available evidence supports it.
6. Distress phrases, background audio events and spoken landmarks appear with source timestamps.
7. The interactive map updates only when valid location information is available.
8. The investigator reviews findings, replays relevant segments and verifies or dismisses them.
9. The investigator creates or updates a case and attaches the relevant evidence.
10. A case report can be generated from persisted, traceable results.

The workflow must work without manually editing code or database records between normal steps.

Show meaningful loading and processing states. Use background jobs for expensive processing where appropriate, and provide progress or status updates through polling, server-sent events or WebSockets when supported by the existing architecture.

Avoid brittle timeout-based animations that pretend to represent actual analysis.

## 5. PHASE FOUR — CASE MANAGEMENT, ALERTS & PERSISTENCE

Implement functioning case-management features:

- Create, view, update and close cases.
- Associate calls, transcript segments, audio events and location observations with cases.
- Store investigation notes and review decisions.
- Display case status, priority, timestamps and available evidence.
- Generate a downloadable case report using persisted application data.
- Provide meaningful filters, sorting and search.
- Keep the interface consistent after refresh or navigation.

Use the project's existing database when viable. Add migrations or safe schema changes where required.

Use unique record identifiers, validation and appropriate transaction handling. Persist important state instead of relying on frontend-only arrays.

Alerts must arise from actual events or configured rules. Prevent repeated events from generating uncontrolled duplicate notifications. Allow investigators to inspect, acknowledge or dismiss alerts where appropriate.

## 6. PHASE FIVE — DASHBOARD, CHARTS & EVERY INTERACTION

Preserve my existing Orbitwin dashboard and make its interface fully functional.

Audit each visible interaction, including:

- Left navigation and page routing.
- Call queue selection, filtering and sorting.
- Call playback, seek, pause, volume and supported telephony controls.
- Transcript, audio-analysis, location and timeline tabs.
- Feature navigation on the right.
- Map markers, layers, zoom and location details.
- Emotion and urgency indicators.
- Background-audio events.
- Distress-code findings.
- Language selection and translation.
- Case creation, evidence review and report generation.
- Search, alerts, settings and user menus.

Every control must perform its intended action, navigate to a functioning view, or clearly indicate why it is unavailable.

Remove decorative elements that imply nonexistent functionality. Do not make all features look active when their integrations are disconnected.

Charts must use real data from the analysis pipeline or persisted records. Calculate values from the actual underlying data and represent missing information honestly. Do not manufacture accuracy percentages or performance metrics.

Use consistent status colours, accessible contrast, legible typography and restrained animation.

Improve empty states, error messages, processing indicators and responsive layouts without changing the approved visual identity.

## 7. PHASE SIX — REAL-TIME AI, API INTEGRATIONS & CREDENTIALS

Inspect available options before choosing or replacing providers.

Prioritise maintained libraries and genuine models for speech-to-text, audio-event classification, speaker diarisation and vocal-emotion analysis.

Do not add a paid API merely because it is convenient if a suitable existing dependency or free local option already works. Evaluate trade-offs involving accuracy, latency, resource requirements, language support and setup complexity.

For every integration:

- Implement the actual request or local inference path.
- Validate inputs, responses, status codes and timeouts.
- Handle rate limits, unavailable services and model failures.
- Keep secret keys on the server.
- Use environment variables and provide a safe `.env.example`.
- Never commit API keys or expose them in browser bundles, logs or reports.
- Record the provider, model or processing method when relevant.
- Document required accounts, credentials, configuration and costs.

Provide clear, user-visible setup instructions for anything that cannot run without credentials.

Do not silently substitute hardcoded JSON when an API call fails. An optional demo fallback may use labelled sample recordings and results, but the application must clearly identify them as simulated.

## 8. PHASE SEVEN — SECURITY, PRIVACY & EVIDENCE INTEGRITY

Treat emergency-call recordings and investigation information as sensitive data.

Implement appropriate protections for the project's scope:

- Server-side input validation and safe file handling.
- Access controls for sensitive case data and actions.
- Secure handling of credentials.
- Safe error messages without leaking secrets.
- Appropriate restrictions on uploaded file sizes and formats.
- Protection against path traversal, injection and unsafe rendering.
- Evidence source references and timestamps.
- Clear separation between observed data, model predictions, investigator conclusions and unknown information.
- Appropriate retention and deletion handling for recordings and cases.

Do not implement covert access to third-party devices, unauthorised microphone or camera activation, phone hacking, or fabricated device-tracking claims.

Use synthetic or consented recordings for demonstrations. Any real telephony integration must operate through an authorised, properly configured provider.

## 9. PHASE EIGHT — HACKATHON DEMONSTRATION MODE

Build a polished demonstration path using the same underlying processing pipeline as the real application.

It must be reliable enough to present live, without depending on a successful incoming phone call.

Provide an obvious way to load a prepared, consented test recording. Where appropriate, offer more than one scenario, such as:

- A distressed multilingual caller.
- A recording with a possible second speaker and environmental sounds.
- A call containing a known phrase from the configured distress-code reference data.

A prepared scenario may use previously generated, validated results only if the interface clearly labels them as recorded demonstration results. Prefer running the actual pipeline when the required model is available.

The demo should visibly demonstrate:

**Incoming recording → real processing → timestamped transcript → audio and emotion findings → location clues when available → human verification → saved case → downloadable report.**

Make the presentation compelling through genuine state changes, fast access to key evidence and a clear investigator workflow. Do not simulate live processing with fabricated timers, invented results or fake GPS updates.

Show where AI uncertainty remains and why the investigator must verify important findings.

## 10. PHASE NINE — AUTOMATED TESTING & MANUAL VERIFICATION

Implement tests appropriate to the project's existing tools.

At minimum, test:

- Application startup and production build.
- Main routes and navigation.
- Core API endpoints and request validation.
- Recording upload and invalid-file rejection.
- Analysis success and error handling.
- Transcript and analysis-result persistence.
- Case creation, updating and retrieval.
- Evidence association and report downloads.
- Map rendering with valid data and graceful handling of missing data.
- Queue filtering and relevant status changes.
- Environment-variable and missing-credential behaviour.

Where possible, run integration tests using controlled, labelled fixtures and mocked external services. Keep these tests separate from tests claiming to validate real model accuracy.

Run the test suite, linting and type checks supported by the repository. Fix the failures caused by your implementation, and investigate existing critical failures before claiming readiness.

If browser automation is available, exercise the critical workflow in a real browser.

Do not report a test as passed unless it actually ran successfully. If a test cannot run, explain the exact blocker and the command needed to execute it.

## 11. PHASE TEN — FINAL RELEASE PREPARATION

After implementation:

- Run the application using the project's documented startup commands.
- Verify that the frontend connects to the backend correctly.
- Verify persistence across page refreshes.
- Inspect browser console and server logs for critical errors.
- Confirm that external-service failures do not crash unrelated features.
- Ensure the project can be started from a fresh environment using the provided instructions.
- Add or update the README with setup, environment configuration, API integrations, tests and demo instructions.
- Remove unused placeholders and misleading live-status claims.
- Preserve the existing UI design and avoid unrelated refactoring.

Prepare a concise hackathon runbook with startup instructions, required credentials, the recommended demonstration recording, the exact click-by-click demo path, expected outputs and a backup demonstration procedure.

## 12. DEFINITION OF DONE

The project is complete only when:

1. The application starts using documented commands.
2. The principal dashboard interactions work.
3. The five core features are connected to real processing paths wherever their dependencies are available.
4. The map uses a genuine interactive mapping implementation, not an image pretending to be a live map.
5. Findings are grounded in model output or clearly labelled demonstration data.
6. Case management and report generation work with persisted data.
7. Errors, missing credentials and unavailable services are handled clearly.
8. Critical workflows have actually been tested.
9. The hackathon demo can be executed reliably from a clean startup.
10. Any remaining limitations are documented honestly.

## REQUIRED FINAL RESPONSE

When implementation and testing are finished, provide a factual completion report containing:

**A. What you inspected:** The actual architecture, frontend, backend, database and integrations found in the repository.

**B. What you implemented:** The files and components changed, the functionality added and how each of the five features works.

**C. Real integrations:** The models, APIs, map provider and services configured, including any setup still needed.

**D. Testing evidence:** The exact commands executed, test results, build status and critical workflows manually verified.

**E. Remaining blockers:** Features requiring credentials, external permissions, hardware, provider configuration or additional model support.

**F. Hackathon runbook:** Exact startup commands and a reliable end-to-end demonstration sequence.

**G. Honest readiness assessment:** Distinguish fully implemented and tested features from partially implemented, demo-only and unavailable features.

Begin by inspecting the repository, then execute the work in the smallest safe increments. Keep the project runnable, validate each stage, and continue until you have completed as much as the environment genuinely permits.

**The standard is simple: build what can be built, test what can be tested, document what cannot be completed, and never confuse a convincing interface with a working product.**