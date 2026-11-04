import test from 'node:test';
import assert from 'node:assert/strict';

import * as db from '../server/db.js';
import * as extManager from '../server/extensionManager.js';
import * as aiEngine from '../server/aiEngine.js';
import * as callManager from '../server/callManager.js';

test('Database initialization and Call CRUD', async () => {
  await db.initDb();
  
  const callId = 'test-call-' + Date.now();
  const call = await db.createCall({ id: callId, extension: '966', callerName: 'Tester' });
  assert.equal(call.id, callId);
  assert.equal(call.status, 'ringing');

  const connected = await db.updateCallStatus(callId, 'connected');
  assert.equal(connected.status, 'connected');
  assert.ok(connected.answered_at > 0);

  const completed = await db.updateCallStatus(callId, 'completed');
  assert.equal(completed.status, 'completed');
  assert.ok(completed.ended_at >= completed.answered_at);

  const stats = await db.getCallStats();
  assert.ok(stats.total >= 1);
});

test('Extension generation and validation', () => {
  const ext = extManager.getActiveExtension();
  assert.ok(ext.length >= 3);
  assert.equal(extManager.validateExtension(ext), true);
  assert.equal(extManager.validateExtension('wrong-99999'), false);

  const newExt = extManager.generateExtension();
  assert.ok(newExt.length >= 3);
  assert.equal(extManager.validateExtension(newExt), true);
});

test('Real-time AI Conversation Analysis (Local NLP Fallback)', async () => {
  // Test empty transcript
  const emptyAnalysis = await aiEngine.analyzeConversation([]);
  assert.equal(emptyAnalysis.urgency, 'LOW');
  assert.equal(emptyAnalysis.sentiment, 'Neutral');

  // Test covert pizza scenario
  const pizzaEntries = [
    { speaker: 'operator', text: 'Police Control Room, how may I direct your call?' },
    { speaker: 'caller', text: 'Yes, I would like to order a large pepperoni pizza to apartment 302.' },
    { speaker: 'operator', text: 'Maam, this is the emergency line.' },
    { speaker: 'caller', text: 'I understand, please send the pizza fast, there are two people here.' }
  ];

  const pizzaAnalysis = await aiEngine.analyzeConversation(pizzaEntries);
  assert.equal(pizzaAnalysis.urgency, 'CRITICAL');
  assert.equal(pizzaAnalysis.sentiment, 'Distressed');
  assert.ok(pizzaAnalysis.intent.includes('Covert Duress') || pizzaAnalysis.intent.includes('Disguised'));
  assert.ok(pizzaAnalysis.keywords.includes('pizza'));
  assert.ok(pizzaAnalysis.recommendations.some(r => r.includes('closed') || r.includes('Yes/No') || r.includes('HANG UP')));
});

test('Call Manager Lifecycle State Machine', async () => {
  const callId = 'test-lifecycle-' + Date.now();
  const initRes = await callManager.initiateCall({
    callId,
    extension: '966',
    callerName: 'Test Mobile',
    callerSocketId: 'sock-caller-1'
  });
  assert.ok(initRes.call);
  assert.equal(initRes.call.status, 'ringing');

  const answerRes = await callManager.answerCall({ callId, operatorSocketId: 'sock-op-1' });
  assert.ok(answerRes.call);
  assert.equal(answerRes.call.status, 'connected');

  const transcriptRes = await callManager.recordTranscript({
    callId,
    speaker: 'caller',
    text: 'Hello I need assistance with my service.',
    timestampMs: 1500
  });
  assert.ok(transcriptRes.entry);
  assert.ok(transcriptRes.analysis);
  assert.equal(transcriptRes.entry.text, 'Hello I need assistance with my service.');

  const endRes = await callManager.endCall({ callId, endedBy: 'operator' });
  assert.equal(endRes.call.status, 'completed');
  assert.equal(callManager.getActiveCall(), null);
});

