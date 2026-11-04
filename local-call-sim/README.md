# 📞 VoicePulse: Real-Time Local Phone Call Simulator & AI Dashboard

A complete, realistic, end-to-end phone call simulation platform with a live operator contact-center dashboard and local AI conversation analysis.

**100% Local & Offline**: Built without third-party telephony services (no Twilio, Exotel, or Vonage), no cloud databases, and zero external paid AI APIs.

---

## 🌟 Key Features

1. **Dynamic Extension Generator**:
   - Automatically generates a 3-digit short extension (e.g. `966`, `007`, `123`).
   - Displayed prominently with a one-click **Regenerate** button.
   - Synchronized across the local network via Socket.IO.

2. **Mobile Smartphone Dialer (`/dialer`)**:
   - Realistic smartphone phone app interface with glassmorphism aesthetic.
   - Interactive 0–9, \*, # keypad with synthesized DTMF touch audio tones.
   - Status bar (carrier, Wi-Fi, battery, clock).
   - In-call controls: Call timer, Mute/Unmute, and End Call button.

3. **Dashboard Incoming Call Alerts**:
   - Immediate incoming call notification on the operator dashboard.
   - Displays caller identity and dialed extension.
   - Synthesized electronic telephone ringtone.
   - Distinct **Answer** (green) and **Reject** (red) controls.

4. **Live Two-Way WebRTC Audio Stream**:
   - Establishes genuine peer-to-peer audio communication between mobile browser and dashboard.
   - Visual audio frequency waveform animation in real time.
   - Full microphone permission handling and mute controls.

5. **Real-Time Speech Transcription & Speaker Separation**:
   - Distinguishes **Caller** vs **Operator** utterances with distinct speech bubbles.
   - Automatic scrolling and precise timestamps.
   - Native Web Speech API integration with manual/quick speech transmission fallback.

6. **Incrementally Updating Local AI Analysis**:
   - **Customer Intent**: e.g., Covert Emergency Distress, Technical Outage, Billing Resolution.
   - **Sentiment Analysis**: Neutral, Positive, Anxious, Distressed, Frustrated.
   - **Urgency Level**: LOW, MEDIUM, HIGH, CRITICAL with alert glow.
   - **Keyword Extraction**: Live hashtag chips for key terms.
   - **Conversation Topics & Questions**: Detected customer concerns and questions.
   - **AI-Generated Actionable Recommendations**: Immediate guidance for operators.
   - **Live Brief Summary**: 1–2 sentence rolling executive summary.
   - **Ollama Integration + Offline Heuristic Fallback**: Directly queries local Ollama (`http://127.0.0.1:11434`) if running; seamlessly runs its local NLP engine with zero errors if Ollama is offline.

7. **Call Center Statistics & SQLite History**:
   - Tracks Total, Active, Completed, and Missed calls with average duration.
   - Persistent SQLite database storing full call logs, transcripts, and AI analysis snapshots.

---

## 🚀 How to Run

### Prerequisites
- Node.js v18+ (tested on Node v24)
- (Optional) [Ollama](https://ollama.com/) for deep LLM analysis (`ollama run llama3.2`)

### 1. Start the Server
```bash
cd local-call-sim
node server/index.js
```
The server will start two listeners:
- **HTTP**: `http://localhost:3000` (for same-machine dashboard & dialer)
- **HTTPS**: `https://<YOUR-WIFI-IP>:3001` (with auto-generated local SSL for mobile microphone access)

---

## 📱 How to Use

### Mode 1: Mobile-to-Dashboard (Over Local Wi-Fi)
1. Ensure your smartphone is connected to the **same Wi-Fi network** as your computer.
2. On your computer, open `http://localhost:3000` to see the **Operator Dashboard**.
3. Note the active extension (e.g. `966`) and the Wi-Fi URL displayed in the dashboard header banner (e.g. `https://192.168.29.9:3001/dialer`).
4. On your mobile phone browser, open that URL (`https://<YOUR-WIFI-IP>:3001/dialer`).
   *(Accept the local self-signed certificate warning once on your phone).*
5. Dial the extension on your smartphone keypad and press the green **Call** button.
6. The dashboard will immediately ring with an incoming call alert. Click **Answer Call** to talk live!

### Mode 2: Same-Computer Demo (Tab-to-Tab)
1. Open `http://localhost:3000/` in Tab 1 (Dashboard).
2. Click **"Launch Phone in Tab"** or open `http://localhost:3000/dialer` in Tab 2 (Mobile Dialer).
3. Dial the extension displayed on Tab 1 and click Call.
4. Answer the call in Tab 1 to experience the live two-way communication, transcript streaming, and real-time AI updates!

---

## 🧪 Running Automated Tests
```bash
cd local-call-sim
npm test
```
Runs the 4 integration test suites verifying SQLite storage, dynamic extension generation, AI conversation analysis fallback, and call lifecycle state machine.

