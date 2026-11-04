import * as db from './db.js';
import * as aiEngine from './aiEngine.js';

let activeCall = null;
let durationInterval = null;

export function getActiveCall() {
  return activeCall;
}

export async function initiateCall({ callId, extension, callerName = 'Mobile Device', callerSocketId }) {
  if (activeCall && ['ringing', 'connected'].includes(activeCall.status)) {
    return { error: 'Line busy: An active call is already in progress.', busy: true };
  }

  const callRecord = await db.createCall({ id: callId, extension, callerName });

  activeCall = {
    id: callId,
    extension,
    callerName,
    callerSocketId,
    operatorSocketId: null,
    status: 'ringing',
    startedAt: callRecord.started_at,
    answeredAt: null,
    endedAt: null,
    durationSec: 0,
    transcripts: [],
    analysis: null
  };

  return { call: activeCall };
}

export async function answerCall({ callId, operatorSocketId }) {
  if (!activeCall || activeCall.id !== callId) {
    return { error: 'Call not found or already ended.' };
  }

  activeCall.status = 'connected';
  activeCall.answeredAt = Date.now();
  activeCall.operatorSocketId = operatorSocketId;

  await db.updateCallStatus(callId, 'connected');

  // Start duration counter
  if (durationInterval) clearInterval(durationInterval);
  durationInterval = setInterval(() => {
    if (activeCall && activeCall.status === 'connected') {
      activeCall.durationSec = Math.max(0, Math.round((Date.now() - activeCall.answeredAt) / 1000));
    }
  }, 1000);

  // Generate initial analysis
  activeCall.analysis = await aiEngine.analyzeConversation([]);
  await db.saveAnalysis({ callId, analysis: activeCall.analysis });

  return { call: activeCall };
}

export async function rejectCall({ callId }) {
  if (!activeCall || activeCall.id !== callId) {
    return { error: 'Call not found.' };
  }

  activeCall.status = 'rejected';
  activeCall.endedAt = Date.now();
  if (durationInterval) clearInterval(durationInterval);

  await db.updateCallStatus(callId, 'rejected');
  const finishedCall = { ...activeCall };
  activeCall = null;

  return { call: finishedCall };
}

export async function endCall({ callId, endedBy = 'caller' }) {
  if (!activeCall || activeCall.id !== callId) {
    return { error: 'Call not found or already ended.' };
  }

  if (durationInterval) clearInterval(durationInterval);
  const now = Date.now();
  activeCall.status = 'completed';
  activeCall.endedAt = now;
  activeCall.durationSec = activeCall.answeredAt ? Math.max(0, Math.round((now - activeCall.answeredAt) / 1000)) : 0;

  await db.updateCallStatus(callId, 'completed');
  const finishedCall = { ...activeCall, endedBy };
  activeCall = null;

  return { call: finishedCall };
}

export async function recordTranscript({ callId, speaker, text, timestampMs = 0 }) {
  if (!activeCall || activeCall.id !== callId) {
    return null;
  }

  const entry = await db.addTranscript({ callId, speaker, text, timestampMs });
  activeCall.transcripts.push(entry);

  // Re-run real-time AI conversation analysis
  const analysis = await aiEngine.analyzeConversation(activeCall.transcripts);
  activeCall.analysis = analysis;
  await db.saveAnalysis({ callId, analysis });

  return { entry, analysis };
}

