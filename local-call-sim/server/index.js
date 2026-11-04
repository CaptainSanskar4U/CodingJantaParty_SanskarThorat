import express from 'express';
import http from 'http';
import https from 'https';
import { Server } from 'socket.io';
import cors from 'cors';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import * as db from './db.js';
import * as extManager from './extensionManager.js';
import * as callManager from './callManager.js';
import * as aiEngine from './aiEngine.js';
import { getOrCreateCertificates } from './certGenerator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HTTP_PORT = process.env.PORT || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3001;

function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIp();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend if built
const distPath = path.join(__dirname, '..', 'dist');
app.use(express.static(distPath));

// API Routes
app.get('/api/status', async (req, res) => {
  const ollama = await aiEngine.checkOllama();
  const stats = await db.getCallStats();
  res.json({
    status: 'ok',
    localIp,
    httpPort: HTTP_PORT,
    httpsPort: HTTPS_PORT,
    activeExtension: extManager.getActiveExtension(),
    activeCall: callManager.getActiveCall(),
    ollama,
    stats
  });
});

app.get('/api/extension', (req, res) => {
  res.json({ extension: extManager.getActiveExtension() });
});

app.post('/api/extension/regenerate', (req, res) => {
  const newExt = extManager.generateExtension();
  io.emit('extension_updated', { extension: newExt });
  res.json({ extension: newExt });
});

app.get('/api/calls/stats', async (req, res) => {
  const stats = await db.getCallStats();
  res.json(stats);
});

app.get('/api/calls/recent', async (req, res) => {
  const calls = await db.getRecentCalls(30);
  res.json(calls);
});

app.get('/api/calls/:id', async (req, res) => {
  const call = await db.getCall(req.params.id);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  const transcripts = await db.getTranscripts(req.params.id);
  const analysis = await db.getLatestAnalysis(req.params.id);
  res.json({ call, transcripts, analysis });
});

// Single page app fallback
app.get('*', (req, res) => {
  const indexHtml = path.join(distPath, 'index.html');
  res.sendFile(indexHtml, (err) => {
    if (err) {
      res.status(200).send(`
        <html>
          <body style="font-family:sans-serif;background:#0f172a;color:#f8fafc;padding:40px;text-align:center;">
            <h1>VoicePulse Backend Server Running</h1>
            <p>Vite development client is running at <a href="http://localhost:5173" style="color:#38bdf8;">http://localhost:5173</a> (Dashboard) or <a href="http://localhost:5173/dialer" style="color:#38bdf8;">http://localhost:5173/dialer</a> (Mobile Dialer).</p>
            <p>Mobile Wi-Fi access: <a href="https://${localIp}:${HTTPS_PORT}/dialer" style="color:#4ade80;">https://${localIp}:${HTTPS_PORT}/dialer</a></p>
          </body>
        </html>
      `);
    }
  });
});

// Setup HTTP & HTTPS Servers
const httpServer = http.createServer(app);
let httpsServer = null;

try {
  const certs = getOrCreateCertificates();
  httpsServer = https.createServer(certs, app);
} catch (e) {
  console.warn('[SSL] Could not create HTTPS server:', e.message);
}

// Socket.IO Server
const io = new Server({
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.attach(httpServer);
if (httpsServer) {
  io.attach(httpsServer);
}

// Socket.IO Connection & Signaling Logic
io.on('connection', (socket) => {
  // 1. Dashboard Operator connects
  socket.on('operator_register', async () => {
    socket.join('operators');
    const stats = await db.getCallStats();
    socket.emit('operator_ready', {
      extension: extManager.getActiveExtension(),
      activeCall: callManager.getActiveCall(),
      stats,
      localIp,
      httpsPort: HTTPS_PORT
    });
  });

  // 2. Mobile Dialer dials extension
  socket.on('dial_extension', async ({ extension, callerName = 'Mobile Device' }) => {
    const activeExt = extManager.getActiveExtension();
    if (!extManager.validateExtension(extension)) {
      socket.emit('call_error', {
        message: `Destination extension ${extension} is not available. Please dial extension ${activeExt}.`
      });
      return;
    }

    const callId = 'call-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const result = await callManager.initiateCall({
      callId,
      extension,
      callerName,
      callerSocketId: socket.id
    });

    if (result.error) {
      socket.emit('call_error', { message: result.error });
      return;
    }

    socket.join(callId);
    socket.emit('call_ringing', { call: result.call });
    io.to('operators').emit('incoming_call', { call: result.call });
  });

  // 3. Operator answers call
  socket.on('answer_call', async ({ callId }) => {
    const result = await callManager.answerCall({ callId, operatorSocketId: socket.id });
    if (result.error) {
      socket.emit('call_error', { message: result.error });
      return;
    }

    socket.join(callId);
    io.to(callId).emit('call_connected', { call: result.call });
    io.to('operators').emit('call_status_changed', { call: result.call });
    io.emit('stats_updated', await db.getCallStats());
  });

  // 4. Operator rejects call
  socket.on('reject_call', async ({ callId }) => {
    const result = await callManager.rejectCall({ callId });
    if (result.call) {
      io.to(callId).emit('call_rejected', { call: result.call });
      io.to('operators').emit('call_status_changed', { call: null });
      io.emit('stats_updated', await db.getCallStats());
    }
  });

  // 5. Caller cancels before answer
  socket.on('cancel_call', async ({ callId }) => {
    const result = await callManager.rejectCall({ callId });
    if (result.call) {
      io.to(callId).emit('call_cancelled', { call: result.call });
      io.to('operators').emit('call_cancelled', { call: result.call });
      io.emit('stats_updated', await db.getCallStats());
    }
  });

  // 6. End Call (either side)
  socket.on('end_call', async ({ callId, endedBy }) => {
    const result = await callManager.endCall({ callId, endedBy });
    if (result.call) {
      io.to(callId).emit('call_ended', { call: result.call });
      io.to('operators').emit('call_status_changed', { call: null });
      io.emit('stats_updated', await db.getCallStats());
    }
  });

  // 7. WebRTC Audio Signaling
  socket.on('webrtc_offer', ({ callId, sdp }) => {
    socket.to(callId).emit('webrtc_offer', { sdp, from: socket.id });
  });

  socket.on('webrtc_answer', ({ callId, sdp }) => {
    socket.to(callId).emit('webrtc_answer', { sdp, from: socket.id });
  });

  socket.on('webrtc_ice_candidate', ({ callId, candidate }) => {
    socket.to(callId).emit('webrtc_ice_candidate', { candidate, from: socket.id });
  });

  // 8. Real-time Transcript & AI Analysis Stream
  socket.on('transcript_utterance', async ({ callId, speaker, text, timestampMs }) => {
    if (!text || !text.trim()) return;
    const res = await callManager.recordTranscript({
      callId,
      speaker: speaker || 'caller',
      text: text.trim(),
      timestampMs: timestampMs || Date.now()
    });

    if (res) {
      // Send transcript entry and updated live AI analysis to operators
      io.to('operators').emit('transcript_received', { callId, entry: res.entry });
      io.to('operators').emit('live_ai_analysis_update', { callId, analysis: res.analysis });
    }
  });

  // 9. Disconnect cleanup
  socket.on('disconnect', async () => {
    const active = callManager.getActiveCall();
    if (active && (active.callerSocketId === socket.id || active.operatorSocketId === socket.id)) {
      const endedBy = active.callerSocketId === socket.id ? 'caller' : 'operator';
      const result = await callManager.endCall({ callId: active.id, endedBy });
      if (result.call) {
        io.to(active.id).emit('call_ended', { call: result.call, reason: 'Peer disconnected' });
        io.to('operators').emit('call_status_changed', { call: null });
        io.emit('stats_updated', await db.getCallStats());
      }
    }
  });
});

// Start Servers
await db.initDb();

httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
  console.log(`[HTTP] Server listening on http://0.0.0.0:${HTTP_PORT}`);
  console.log(`[HTTP] Local access: http://localhost:${HTTP_PORT}`);
  console.log(`[HTTP] Network Wi-Fi access: http://${localIp}:${HTTP_PORT}`);
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`[HTTPS] Secure server listening on https://0.0.0.0:${HTTPS_PORT}`);
    console.log(`[HTTPS] Mobile phone dialer access: https://${localIp}:${HTTPS_PORT}/dialer`);
  });
}

