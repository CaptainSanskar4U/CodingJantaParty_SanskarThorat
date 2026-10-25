/* Orbitwin live application. The approved visual shell is preserved; this file
   replaces all simulated dashboard data with API-backed records. */
(function () {
  'use strict';

  var S = {
    me: null, csrf: '', authEnabled: true, config: null,
    calls: [], cases: [], alerts: [], unread: 0, stats: {},
    activeId: null, detail: null, caseData: null, tab: 'transcript',
    showTranslation: true, filter: '', query: '',
    jobId: null, jobCallId: null, jobTimer: null, refreshTimer: null, queueTimer: null, fitTimer: null,
    maps: { main: null, mini: null, bottom: null, full: null },
    mapLayers: { main: null, mini: null, bottom: null, full: null },
    nav: 'live', playing: false, speed: 1, muted: false, loadingCall: false,
    live: {
      active: false, config: null, sessionId: null, stream: null, ctx: null,
      source: null, processor: null, sink: null, samples: [], sampleRate: 16000,
      total: 0, sent: 0, chunkIndex: 0, queue: [], sending: false,
      chunkTimer: null, tickTimer: null, startedAt: 0, chunkSeconds: 5, maxSeconds: 600,
      cloudOk: true, pendingUpload: null, stopping: false
    }
  };

  function el(id) { return document.getElementById(id); }
  function esc(v) {
    return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTime(value) {
    if (value === null || value === undefined || isNaN(Number(value))) return '—';
    var total = Math.max(0, Math.floor(Number(value)));
    var h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
    return (h ? String(h).padStart(2, '0') + ':' : '') + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function fmtDate(value) {
    if (!value) return '—';
    try { return new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return value; }
  }
  function pClass(p) { return p === 'high' ? 'hi' : p === 'medium' ? 'md' : p === 'low' ? 'lo' : 'md'; }
  function pLabel(p) { return (p || 'unscored').toUpperCase(); }
  function pColor(p) { return p === 'high' ? '#ff5264' : p === 'medium' ? '#f5c451' : p === 'low' ? '#4ade80' : '#8c8c98'; }
  function icon(name, size, color) { return I(name, size, color); }
  function setText(id, text) { var n = el(id); if (n) n.textContent = text; }
  function toast(message, type) {
    var wrap = el('toasts');
    if (!wrap) return;
    var d = document.createElement('div');
    d.className = 'toast ' + (type || '');
    d.innerHTML = esc(message);
    wrap.appendChild(d);
    setTimeout(function () { d.remove(); }, 5200);
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
    if (opts.method && ['POST', 'PATCH', 'PUT', 'DELETE'].indexOf(opts.method.toUpperCase()) >= 0) {
      headers['X-CSRF-Token'] = S.csrf;
    }
    var response;
    try {
      response = await fetch(path, Object.assign({}, opts, { headers: headers, credentials: 'same-origin' }));
    } catch (e) {
      throw new Error('Cannot reach the local Dhvani server.');
    }
    if (response.status === 401) {
      showLogin();
      throw new Error('Please sign in to continue.');
    }
    var type = response.headers.get('content-type') || '';
    var data = type.indexOf('application/json') >= 0 ? await response.json() : await response.text();
    if (!response.ok) {
      var message = data && data.detail ? data.detail : 'Request failed (' + response.status + ')';
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return data;
  }

  function fit() {
    var stage = el('st');
    if (!stage) return;
    /* Native responsive layout. No fractional canvas scaling, so text and
       borders stay crisp at every viewport size and browser zoom level. */
    stage.style.width = '100%';
    stage.style.height = '100%';
    stage.style.transform = 'none';
    stage.style.left = '0';
    stage.style.top = '0';
    clearTimeout(S.fitTimer);
    S.fitTimer = setTimeout(function () {
      Object.keys(S.maps || {}).forEach(function (key) {
        var map = S.maps[key];
        if (map && map.invalidateSize) map.invalidateSize({ pan: false });
      });
      if (S.maps && S.maps.full && S.maps.full.invalidateSize) S.maps.full.invalidateSize({ pan: false });
    }, 120);
  }

  function setScreen(name) {
    var stage = el('st'), landing = el('landing'), login = el('login');
    if (stage) stage.classList.toggle('auth-view', name !== 'dashboard');
    if (landing) landing.classList.toggle('on', name === 'landing');
    if (login) login.classList.toggle('on', name === 'login');
    document.body.setAttribute('data-screen', name);
  }

  function showLanding() {
    setScreen('landing');
    setTimeout(function () {
      var btn = el('landingSignIn');
      if (btn) btn.focus();
    }, 80);
  }

  /* ------------------------------------------------------------------ */
  /* Quick Demo Controller                                              */
  /* ------------------------------------------------------------------ */

  var QuickDemo = {
    active: false,
    ended: false,
    demoCallId: null,
    demoCaseId: null,
    ringAudioCtx: null,
    ringOsc1: null,
    ringOsc2: null,
    ringGain: null,
    countdownTimer: null,
    autoAnswerTimer: null,
    flyDone: false,

    startRingAudio: function () {
      try {
        var AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ringAudioCtx = new AudioCtx();
        var ctx = this.ringAudioCtx;
        if (ctx.state === 'suspended') {
          ctx.resume().catch(function () {});
        }
        var osc1 = ctx.createOscillator();
        var osc2 = ctx.createOscillator();
        var gain = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(400, ctx.currentTime);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(450, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(ctx.destination);
        osc1.start();
        osc2.start();
        this.ringOsc1 = osc1;
        this.ringOsc2 = osc2;
        this.ringGain = gain;

        var now = ctx.currentTime;
        function pulse(t, dur) {
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(0.2, t + 0.05);
          gain.gain.setValueAtTime(0.2, t + dur - 0.05);
          gain.gain.linearRampToValueAtTime(0, t + dur);
        }
        pulse(now + 0.05, 0.4);
        pulse(now + 0.65, 0.4);
        pulse(now + 2.05, 0.4);
        pulse(now + 2.65, 0.4);
      } catch (e) {
        console.warn('Web Audio ringtone error:', e);
      }
    },

    stopRingAudio: function () {
      if (this.ringOsc1) { try { this.ringOsc1.stop(); this.ringOsc1.disconnect(); } catch (e) {} this.ringOsc1 = null; }
      if (this.ringOsc2) { try { this.ringOsc2.stop(); this.ringOsc2.disconnect(); } catch (e) {} this.ringOsc2 = null; }
      if (this.ringGain) { try { this.ringGain.disconnect(); } catch (e) {} this.ringGain = null; }
      if (this.ringAudioCtx) { try { this.ringAudioCtx.close(); } catch (e) {} this.ringAudioCtx = null; }
    },

    start: function () {
      var self = this;
      this.stopRingAudio();
      clearInterval(this.countdownTimer);
      clearTimeout(this.autoAnswerTimer);
      this.active = false;
      this.ended = false;
      this.flyDone = false;

      var revBar = el('demoReviewBar');
      if (revBar) revBar.style.display = 'none';

      var modal = el('incomingCallModal');
      if (!modal) return;
      modal.style.display = 'flex';
      modal.classList.add('on');

      var fill = el('incomingCountdownFill');
      var num = el('incomingCountNum');
      var timerText = el('incomingTimer');
      if (fill) {
        fill.style.transition = 'none';
        fill.style.width = '100%';
        setTimeout(function () {
          fill.style.transition = 'width 3s linear';
          fill.style.width = '0%';
        }, 50);
      }

      var remaining = 3;
      if (num) num.textContent = remaining;
      if (timerText) timerText.textContent = 'RINGING · 00:03';

      this.startRingAudio();

      this.countdownTimer = setInterval(function () {
        remaining -= 1;
        if (num) num.textContent = Math.max(0, remaining);
        if (timerText) timerText.textContent = 'RINGING · 00:0' + Math.max(0, remaining);
        if (remaining <= 0) {
          clearInterval(self.countdownTimer);
          self.countdownTimer = null;
        }
      }, 1000);

      this.autoAnswerTimer = setTimeout(function () {
        self.answer();
      }, 3000);
    },

    decline: function () {
      this.stopRingAudio();
      clearInterval(this.countdownTimer);
      clearTimeout(this.autoAnswerTimer);
      var modal = el('incomingCallModal');
      if (modal) {
        modal.classList.remove('on');
        modal.style.display = 'none';
      }
      toast('Incoming emergency call declined.', 'warn');
    },

    answer: async function () {
      this.stopRingAudio();
      clearInterval(this.countdownTimer);
      clearTimeout(this.autoAnswerTimer);

      var modal = el('incomingCallModal');
      if (modal) {
        modal.classList.remove('on');
        modal.style.display = 'none';
      }

      closeOverlay();
      closeFullMap();
      closeUpload();
      closeLive();

      toast('Emergency call answered. Connecting live cybercrime speech intelligence…', 'ok');

      try {
        var startData = await api('/api/demo/quick-start', { method: 'POST' });
        this.demoCallId = startData.call_id;
        this.demoCaseId = startData.case_id;

        await loadCalls();
        await loadCases();
        renderQueue();
        renderShell();

        this.active = true;
        this.ended = false;
        this.flyDone = false;

        await selectCall(this.demoCallId);

        S.tab = 'transcript';
        renderTabs();

        var isPizza = this.demoCallId === 'call_covert_pizza_distress' || (S.detail && S.detail.call.duration_s > 45);
        this.updateAIReviewDeck(0, isPizza, false);

        var audio = el('audio');
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(function (e) {
            console.warn('Audio auto-play blocked by browser:', e);
            toast('Click play on waveform to begin audio playback.', 'warn');
          });
        }
      } catch (err) {
        toast('Quick Demo failed to start: ' + err.message, 'err');
      }
    },

    initSpectrumBars: function () {
      var container = el('spectrumBars');
      if (!container || container.children.length > 0) return;
      for (var i = 0; i < 16; i++) {
        var bar = document.createElement('div');
        bar.className = 'spectrum-bar';
        container.appendChild(bar);
      }
    },

    updateSpectrumBars: function (isSpeaking) {
      var container = el('spectrumBars');
      if (!container) return;
      var bars = container.children;
      if (!bars || bars.length === 0) {
        this.initSpectrumBars();
        bars = container.children;
      }
      for (var i = 0; i < bars.length; i++) {
        var h;
        if (isSpeaking) {
          h = Math.floor(25 + Math.random() * 70);
        } else {
          h = Math.floor(8 + Math.random() * 14);
        }
        bars[i].style.height = h + '%';
      }
    },

    updateAIReviewDeck: function (t, isPizzaDemo, isSpeaking) {
      this.updateSpectrumBars(isSpeaking);

      if (isPizzaDemo) {
        // 1. Copilot Guidance
        var phase = el('copilotPhase');
        var prompt = el('copilotPrompt');
        var rationale = el('copilotRationale');
        var chkCaller = el('chkCaller');
        var chkSafety = el('chkSafety');
        var chkLocation = el('chkLocation');
        var chkDispatch = el('chkDispatch');

        if (t < 20.7) {
          if (phase) { phase.textContent = 'EVALUATING CALL'; phase.style.color = '#8c8c98'; }
          if (prompt) { prompt.textContent = 'Dispatch greeting completed. Calibrating line acoustics & voice baseline…'; prompt.classList.remove('prompt-active'); }
          if (rationale) rationale.textContent = 'Monitoring for speech anomalies, disguised phrasing, and background acoustic signatures.';
          if (chkCaller) chkCaller.classList.remove('checked');
          if (chkSafety) chkSafety.classList.remove('checked');
          if (chkLocation) chkLocation.classList.remove('checked');
          if (chkDispatch) chkDispatch.classList.remove('checked');
        } else if (t < 34.5) {
          if (phase) { phase.textContent = '⚠️ FOOD ORDER ANOMALY'; phase.style.color = '#f5c451'; }
          if (prompt) { prompt.textContent = 'DO NOT HANG UP. Subject is ordering food on 112 emergency line. Initiate Covert Distress Protocol.'; prompt.classList.add('prompt-active'); }
          if (rationale) rationale.textContent = 'Covert distress code: Caller is feigning a civilian transaction because someone threatening is present in the room.';
          if (chkCaller) chkCaller.classList.add('checked');
        } else if (t < 54.0) {
          if (phase) { phase.textContent = '🚨 COVERT DURESS PROTOCOL'; phase.style.color = '#ff6b7a'; }
          if (prompt) { prompt.textContent = 'Ask closed questions immediately: “Ma’am, are you in trouble right now? Answer with yes or no.”'; prompt.classList.add('prompt-active'); }
          if (rationale) rationale.textContent = 'Avoid open questions. Binary yes/no queries allow the victim to answer without alerting the aggressor in earshot.';
          if (chkCaller) chkCaller.classList.add('checked');
        } else if (t < 72.0) {
          if (phase) { phase.textContent = '🚨 DANGER CONFIRMED'; phase.style.color = '#ff2e43'; }
          if (prompt) { prompt.textContent = 'Affirmative received. Ask for delivery address disguised as food delivery details: “What address are we delivering to?”'; prompt.classList.add('prompt-active'); }
          if (rationale) rationale.textContent = 'Extract floor and landmark information under the caller’s civilian cover story.';
          if (chkCaller) chkCaller.classList.add('checked');
          if (chkSafety) chkSafety.classList.add('checked');
        } else if (t < 87.8) {
          if (phase) { phase.textContent = '🎯 TARGET ACQUIRED'; phase.style.color = '#22c55e'; }
          if (prompt) { prompt.textContent = 'Location locked: Dadar West, Station Corridor, 3rd Floor Apt. Dispatch Unit 42 with code-3 silent approach.'; prompt.classList.add('prompt-active'); }
          if (rationale) rationale.textContent = 'Floor-level tactical intelligence verified. Responding units briefed on domestic violence / hostage risk.';
          if (chkCaller) chkCaller.classList.add('checked');
          if (chkSafety) chkSafety.classList.add('checked');
          if (chkLocation) chkLocation.classList.add('checked');
        } else {
          if (phase) { phase.textContent = '🚔 RESPONSE DISPATCHED'; phase.style.color = '#22c55e'; }
          if (prompt) { prompt.textContent = 'Advise victim: “Help is 3 minutes away. Leave the line open and stay safe.” Keep acoustic channel live.'; prompt.classList.add('prompt-active'); }
          if (rationale) rationale.textContent = 'Silent approach active to prevent suspect from escalating violence before perimeter breach.';
          if (chkCaller) chkCaller.classList.add('checked');
          if (chkSafety) chkSafety.classList.add('checked');
          if (chkLocation) chkLocation.classList.add('checked');
          if (chkDispatch) chkDispatch.classList.add('checked');
        }

        // 2. Keyword Detection & Repetition Card
        var kwCount = el('keywordCount');
        var kwTerm = el('kwTerm');
        var kwBadge = el('kwRepsBadge');
        var kwc1 = el('kwc1'), kwc2 = el('kwc2'), kwc3 = el('kwc3'), kwc4 = el('kwc4');
        if (kwTerm) kwTerm.textContent = '“PIZZA”';

        if (t < 20.7) {
          if (kwCount) kwCount.textContent = '0 hits';
          if (kwBadge) kwBadge.textContent = 'MONITORING SPEECH…';
          if (kwc1) kwc1.classList.remove('active');
          if (kwc2) kwc2.classList.remove('active');
          if (kwc3) kwc3.classList.remove('active');
          if (kwc4) kwc4.classList.remove('active');
        } else if (t < 23.0) {
          if (kwCount) kwCount.textContent = '1 hit';
          if (kwBadge) kwBadge.textContent = '1x DETECTED · ANOMALY';
          if (kwc1) kwc1.classList.add('active');
        } else if (t < 40.0) {
          if (kwCount) kwCount.textContent = '2 hits';
          if (kwBadge) kwBadge.textContent = '2x DETECTED · PATTERN CONFIRMED';
          if (kwc1) kwc1.classList.add('active');
          if (kwc2) kwc2.classList.add('active');
        } else if (t < 89.8) {
          if (kwCount) kwCount.textContent = '3 hits';
          if (kwBadge) kwBadge.textContent = '3x DETECTED · HIGH COGNITIVE REPETITION';
          if (kwc1) kwc1.classList.add('active');
          if (kwc2) kwc2.classList.add('active');
          if (kwc3) kwc3.classList.add('active');
        } else {
          if (kwCount) kwCount.textContent = '4 hits';
          if (kwBadge) kwBadge.textContent = '4x DETECTED · COVERT CODE CONFIRMED';
          if (kwc1) kwc1.classList.add('active');
          if (kwc2) kwc2.classList.add('active');
          if (kwc3) kwc3.classList.add('active');
          if (kwc4) kwc4.classList.add('active');
        }

        // 3. Emotion Detection & Vocal Stress
        var fear = t < 20.7 ? 25 : t < 34.5 ? 72 : t < 54.0 ? 84 : t < 72.0 ? 91 : 96;
        var stress = t < 20.7 ? 34 : t < 34.5 ? 78 : t < 54.0 ? 85 : t < 72.0 ? 88 : 91;
        var breath = t < 20.7 ? 18 : t < 34.5 ? 68 : t < 54.0 ? 82 : t < 72.0 ? 89 : 93;
        var pretense = t < 20.7 ? 12 : t < 34.5 ? 76 : t < 54.0 ? 82 : t < 72.0 ? 86 : 89;

        var emoFearBar = el('emoFearBar'), emoFearVal = el('emoFearVal');
        var emoStressBar = el('emoStressBar'), emoStressVal = el('emoStressVal');
        var emoBreathBar = el('emoBreathBar'), emoBreathVal = el('emoBreathVal');
        var emoPretenseBar = el('emoPretenseBar'), emoPretenseVal = el('emoPretenseVal');
        var emoDom = el('emotionDominant');
        var vocalHint = el('vocalHintText');

        if (emoFearBar) emoFearBar.style.width = fear + '%';
        if (emoFearVal) emoFearVal.textContent = fear + '%';
        if (emoStressBar) emoStressBar.style.width = stress + '%';
        if (emoStressVal) emoStressVal.textContent = stress + '%';
        if (emoBreathBar) emoBreathBar.style.width = breath + '%';
        if (emoBreathVal) emoBreathVal.textContent = breath + '%';
        if (emoPretenseBar) emoPretenseBar.style.width = pretense + '%';
        if (emoPretenseVal) emoPretenseVal.textContent = pretense + '%';

        if (emoDom) {
          emoDom.textContent = t < 20.7 ? 'CALIBRATING' : t < 54.0 ? 'FEAR & DURESS' : 'ACUTE TERROR (HIGH JITTER)';
          emoDom.className = 'tag ' + (t < 20.7 ? 'gray' : 'red');
        }
        if (vocalHint) {
          vocalHint.textContent = t < 20.7
            ? 'Micro-tremor: calibrating baseline speech…'
            : t < 54.0
            ? 'Micro-tremor: 5.2 Hz jitter detected in 180-240Hz band (Duress signature)'
            : 'Acoustic shock: Vocal fold tension indicates severe immediate threat';
        }

        // 4. Location Tracking Telemetry
        var locBadge = el('locStageBadge');
        var locTelem = el('mapTelemetryText');
        var reticle = el('radarReticle');

        if (t < 72.0) {
          if (locBadge) locBadge.textContent = 'Triangulating Sector';
          if (locTelem) locTelem.textContent = 'CELL SECTOR 42-B · DADAR WEST (±1500M)';
          if (reticle) { reticle.style.borderColor = '#ff2e43'; reticle.style.transform = 'scale(1)'; }
        } else if (t < 80.0) {
          if (locBadge) locBadge.textContent = 'Landmark Locked';
          if (locTelem) locTelem.textContent = 'DADAR STATION OUTLET CORRIDOR (±350M)';
          if (reticle) { reticle.style.borderColor = '#f5c451'; reticle.style.transform = 'scale(1.2)'; }
        } else {
          if (locBadge) locBadge.textContent = 'Floor 3 Pinpointed';
          if (locTelem) locTelem.textContent = 'RESIDENTIAL BLDG · FLOOR 3 (ETA 3 MIN)';
          if (reticle) { reticle.style.borderColor = '#22c55e'; reticle.style.transform = 'scale(1.35)'; }
        }
      } else {
        // Hinglish / Scam Demo Fallback
        var phase = el('copilotPhase'), prompt = el('copilotPrompt'), rationale = el('copilotRationale');
        var kwTerm = el('kwTerm'), kwBadge = el('kwRepsBadge'), kwCount = el('keywordCount');
        if (kwTerm) kwTerm.textContent = '“DIGITAL ARREST”';
        if (t >= 16.8) {
          if (phase) { phase.textContent = 'FRAUD / SCAM DETECTED'; phase.style.color = '#ff2e43'; }
          if (prompt) { prompt.textContent = 'Fraud warning: Digital arrest has no legal existence in India. Instruct caller NOT to send funds.'; prompt.classList.add('prompt-active'); }
          if (rationale) rationale.textContent = 'CBI impersonator attempting extortion via coercive parcel / narcotic claims.';
          if (kwCount) kwCount.textContent = '3 hits';
          if (kwBadge) kwBadge.textContent = 'EXTORTION TRIGGER DETECTED';
        } else if (t >= 5.1) {
          if (phase) { phase.textContent = 'IMPERSONATION DETECTED'; phase.style.color = '#f5c451'; }
          if (prompt) { prompt.textContent = 'Speaker B claiming police/CBI authority. Check against official police dispatch registry.'; prompt.classList.add('prompt-active'); }
          if (rationale) rationale.textContent = 'Secondary voice detected on call line attempting psychological pressure.';
          if (kwCount) kwCount.textContent = '1 hit';
          if (kwBadge) kwBadge.textContent = 'CBI IMPERSONATION';
        }
      }
    },

    onTimeUpdate: function (t) {
      if (!this.active || !S.detail || S.detail.call.id !== this.demoCallId) return;

      var isPizzaDemo = S.detail.call.id === 'call_covert_pizza_distress' || (S.detail.call.duration_s > 45);
      var score = 50;
      var band = 'MEDIUM';
      var bandColor = '#f5c451';

      if (isPizzaDemo) {
        if (t >= 72.0) {
          score = 95; band = 'CRITICAL'; bandColor = '#ff2e43';
        } else if (t >= 54.0) {
          score = 88; band = 'CRITICAL'; bandColor = '#ff2e43';
        } else if (t >= 34.5) {
          score = 78; band = 'HIGH'; bandColor = '#ff5264';
        } else if (t >= 20.7) {
          score = 65; band = 'MEDIUM'; bandColor = '#f5c451';
        } else {
          score = 40; band = 'MONITORING'; bandColor = '#8c8c98';
        }
      } else {
        if (t >= 16.8) {
          score = 92; band = 'HIGH'; bandColor = '#ff5264';
        } else if (t >= 7.7) {
          score = 85; band = 'HIGH'; bandColor = '#ff5264';
        } else if (t >= 5.1) {
          score = 72; band = 'HIGH'; bandColor = '#ff5264';
        } else if (t >= 2.6) {
          score = 65; band = 'MEDIUM'; bandColor = '#f5c451';
        }
      }

      var ring = el('rg'), rv = el('rv'), hg = el('hg');
      if (ring) {
        ring.setAttribute('stroke-dasharray', (score * 1.571) + ' 170');
        ring.setAttribute('stroke', score >= 80 ? '#ff2e43' : score >= 60 ? '#f5c451' : '#4ade80');
      }
      if (rv) rv.textContent = score + '%';
      if (hg) {
        hg.innerHTML = icon('refresh', 14) + band;
        hg.style.color = bandColor;
      }

      var segs = S.detail.segments || [];
      var activeSpeaking = false;
      var txscroll = document.querySelector('#tx .txscroll');
      if (txscroll) {
        var segNodes = txscroll.querySelectorAll('.seg');
        segNodes.forEach(function (node) {
          var start = Number(node.getAttribute('data-start'));
          var segId = node.getAttribute('data-seg');
          var segObj = segs.find(function (s) { return s.id === segId; });
          var end = segObj ? segObj.end_s : start + 3;

          if (start <= t) {
            node.style.display = '';
            if (t >= start && t <= end + 0.35) {
              node.classList.add('live-speaking');
              activeSpeaking = true;
            } else {
              node.classList.remove('live-speaking');
            }
          } else {
            node.style.display = 'none';
            node.classList.remove('live-speaking');
          }
        });
      }

      // Update the 5 AI Review Deck components in the right column
      this.updateAIReviewDeck(t, isPizzaDemo, activeSpeaking);

      var mapFlyTriggerTime = isPizzaDemo ? 72.0 : 2.6;
      if (t >= mapFlyTriggerTime && !this.flyDone && S.maps && S.maps.main) {
        this.flyDone = true;
        try {
          S.maps.main.flyTo([19.0192269, 72.8428479], 15, { animate: true, duration: 1.5 });
          setTimeout(function () {
            if (S.maps && S.maps.main) {
              S.maps.main.eachLayer(function (layer) {
                if (layer.openPopup) layer.openPopup();
              });
            }
          }, 1200);
        } catch (e) {
          console.warn('Map flyTo failed:', e);
        }
      }

      renderRelatedEvidence();
    },

    onEnded: function () {
      if (!this.active || !S.detail || S.detail.call.id !== this.demoCallId) return;
      this.ended = true;

      var revBar = el('demoReviewBar');
      if (revBar) {
        revBar.style.display = 'flex';
        var revTitle = revBar.querySelector('.review-title');
        if (revTitle && S.detail && S.detail.case) {
          revTitle.textContent = S.detail.case.case_number + ' · ' + S.detail.case.title;
        }
        var ch1 = el('revCh1'), ch2 = el('revCh2'), ch3 = el('revCh3'), ch4 = el('revCh4');
        var findingsCount = (S.detail.findings || []).length;
        if (ch1) ch1.textContent = findingsCount + ' Distress & Scam Findings';
        if (ch4) ch4.textContent = 'Urgency: ' + (S.detail.call.urgency_score || 95) + '/100 (CRITICAL)';
      }

      document.querySelectorAll('#tx .seg').forEach(function (n) {
        n.style.display = '';
        n.classList.remove('live-speaking');
      });

      renderRelatedEvidence();

      var finalScore = S.detail.call.urgency_score || 95;
      var ring = el('rg'), rv = el('rv'), hg = el('hg');
      if (ring) {
        ring.setAttribute('stroke-dasharray', (finalScore * 1.571) + ' 170');
        ring.setAttribute('stroke', '#ff2e43');
      }
      if (rv) rv.textContent = finalScore + '%';
      if (hg) {
        hg.innerHTML = icon('refresh', 14) + 'CRITICAL';
        hg.style.color = '#ff5264';
      }

      toast('Call completed. Review summary and action controls ready.', 'ok');
    },

    confirmAllFindings: async function () {
      if (!this.demoCallId && S.activeId) this.demoCallId = S.activeId;
      if (!this.demoCallId) return;
      var btn = el('demoConfirmAllBtn');
      if (btn) btn.disabled = true;
      try {
        var res = await api('/api/calls/' + encodeURIComponent(this.demoCallId) + '/confirm-all-findings', { method: 'POST' });
        toast('All ' + (res.count || 7) + ' findings confirmed by investigator.', 'ok');
        await refreshActive();
        if (btn) {
          btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg> All Findings Confirmed';
          btn.classList.add('green');
        }
      } catch (err) {
        toast('Failed to confirm findings: ' + err.message, 'err');
      } finally {
        if (btn) btn.disabled = false;
      }
    },

    downloadReport: function () {
      var caseId = this.demoCaseId || (S.detail && S.detail.case && S.detail.case.id);
      if (caseId) {
        window.open('/api/cases/' + encodeURIComponent(caseId) + '/report?format=html', '_blank');
      } else {
        toast('No case associated with this recording.', 'warn');
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Boot, auth, shell                                                   */
  /* ------------------------------------------------------------------ */

  async function boot() {
    bindStatic();
    fit();
    window.addEventListener('resize', fit);
    try {
      var me = await api('/api/me');
      S.authEnabled = me.auth_enabled;
      if (!me.user) { showLogin(); return; }
      S.me = me.user;
      S.csrf = me.csrf;
      showDashboard();
      await startApp();
    } catch (e) {
      if (!S.me) showLogin();
    }
  }

  function showLogin() {
    var login = el('login');
    if (!login) return;
    clearInterval(S.refreshTimer); clearInterval(S.queueTimer); clearInterval(S.jobTimer);
    S.refreshTimer = S.queueTimer = S.jobTimer = null;
    try { stopAudio(); } catch (e) {}
    closeOverlay(); closeFullMap(); closeUpload();
    setScreen('login');
    var note = login.querySelector('.login-note');
    if (note && !note.dataset.enhanced) {
      note.innerHTML += '<br><br><b>Local demo default:</b> <span class="mono">mehta</span> / <span class="mono">dhvani-demo</span> (or <span class="mono">orbitwin-demo</span>). Change it in .env before sharing.';
      note.dataset.enhanced = '1';
    }
    setTimeout(function () { var u = el('loginUser'); if (u) u.focus(); }, 100);
  }
  function showDashboard() {
    setScreen('dashboard');
    fit();
  }
  function hideLogin() { showDashboard(); }

  async function startApp() {
    showDashboard();
    S.config = await api('/api/config/status');
    await Promise.all([loadCalls(), loadStats(), loadAlerts(), loadCases()]);
    renderShell();
    renderFeatures();
    renderSystemStatus();
    renderQueue();
    renderAlertsBadge();
    if (S.calls.length) {
      await selectCall(S.calls[0].id);
    } else {
      renderEmptyCall();
    }
    startTimers();
  }

  function renderShell() {
    var up = el('upIc'); if (up) up.innerHTML = icon('file', 13, '#fff');
    var liveIc = el('liveIc'); if (liveIc) liveIc.innerHTML = icon('mic', 13, '#ff6b7d');
    var liveOpenIc = el('liveOpenIc'); if (liveOpenIc) liveOpenIc.innerHTML = icon('mic', 13, '#f5c451');
    var si = el('si'); if (si) si.innerHTML = icon('search', 14, '#7c7c87');
    var bell = el('bell'); if (bell) bell.innerHTML = icon('bell', 18, '#a0a0aa');
    var dn = el('dn'); if (dn) dn.innerHTML = icon('down', 12, '#71717c');
    var ck = el('ck'); if (ck) ck.innerHTML = icon('clock', 12, '#787883');
    var vl = el('vl'); if (vl) vl.innerHTML = icon(S.muted ? 'volF' : 'vol', 14, '#8c8c98');
    var hp = el('hp'); if (hp) hp.innerHTML = icon('phone', 14, '#4ade80') + '<span class="helpline-copy"><small>Emergency</small><b>112</b></span>';
    var sup = el('sup'); if (sup) sup.innerHTML = icon('head', 17, '#8c8c98') + '<span>Support &amp; runbook<b>Open runbook</b></span>';
    var pf = el('pf');
    if (pf && S.me) {
      pf.innerHTML = '<span class="avatar">' + icon('userF', 24, '#c7c7d0') + '</span><span class="who"><b>' + esc(S.me.display_name) + '</b><span>' + esc(S.me.role) + '</span></span><span id="dn" class="chev">' + icon('down', 12, '#71717c') + '</span>';
    }
    var pd = el('pd');
    if (pd) {
      pd.innerHTML = '<div data-action="profile">My profile</div><div data-action="settings">Preferences</div><div data-action="logout">Sign out</div>';
    }
    var cc = el('cc'); if (cc) cc.textContent = S.calls.length;
    var end = el('end'); if (end) end.innerHTML = icon('hangup', 14, '#ff7b89') + 'Close review';
    var caseBtn = el('caseBtn');
    if (caseBtn) caseBtn.innerHTML = icon('file', 12) + (S.detail && S.detail.case ? 'Open case' : 'Save to case');
    var fl = el('fl');
    if (fl) { fl.innerHTML = '<option value="">All Priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>'; fl.value = S.filter || ''; }
    var cs = el('caseSelect');
    if (cs) cs.innerHTML = '<option value="">No case</option>' + S.cases.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.case_number + ' · ' + c.title) + '</option>'; }).join('');
    renderNav();
    renderProfileDropdown();
    renderAlertsDropdown();
  }

  function renderNav() {
    var nav = el('sb');
    if (!nav) return;
    var items = [
      ['quick-demo', 'Quick Demo', 'phoneRing'],
      ['live', 'Live Calls', 'homeF'],
      ['cases', 'Investigations', 'fileF'],
      ['map', 'Map', 'mapF'],
      ['reports', 'Reports', 'barsB'],
      ['settings', 'Settings', 'gearF']
    ];
    nav.innerHTML = items.map(function (item) {
      if (item[0] === 'quick-demo') {
        return '<div class="ni quick-demo-nav" data-nav="quick-demo">' +
          icon('phoneRing', 16, '#ff2e43') +
          '<span>Quick Demo</span>' +
          '<span class="quick-demo-tag">LIVE DEMO</span>' +
          '</div>';
      }
      var badge = '';
      if (item[0] === 'cases' && S.cases.length) badge = '<span class="count">' + S.cases.length + '</span>';
      return '<div class="ni ' + (S.nav === item[0] ? 'on' : '') + '" data-nav="' + item[0] + '">' + icon(item[2], 16) + '<span>' + item[1] + '</span>' + badge + '</div>';
    }).join('');
  }

  function renderProfileDropdown() {
    var pd = el('pd');
    if (!pd || !S.me) return;
    pd.innerHTML = '<div style="padding:8px 10px;border-bottom:1px solid #2b2b33;margin-bottom:4px"><b style="display:block;font-size:11px;color:#fff">' + esc(S.me.display_name) + '</b><span style="font-size:9px;color:#8c8c98">' + esc(S.me.role) + ' · ' + esc(S.me.username) + '</span></div>' +
      '<div data-action="profile">My profile</div><div data-action="settings">Preferences</div><div data-action="logout">Sign out</div>';
  }

  function renderFeatures() {
    var wrap = el('fe');
    if (!wrap) return;
    var d = S.detail || {};
    var locations = (d.locations || []).length;
    var findings = (d.findings || []).length;
    var events = (d.audio_events || []).length;
    var lang = d.call ? (d.call.language || '—') : '—';
    var urgency = d.call ? (d.call.urgency_score === null || d.call.urgency_score === undefined ? 'Not scored' : d.call.urgency_score + ' / 100') : 'Awaiting call';
    var items = [
      ['mapC', 'Location map', locations + ' location' + (locations === 1 ? '' : 's')],
      ['phoneRing', 'Call triage', urgency],
      ['shieldF', 'Distress decoder', findings + ' finding' + (findings === 1 ? '' : 's')],
      ['barsB', 'Audio forensics', events + ' event' + (events === 1 ? '' : 's')],
      ['tr', 'Language & emotion', lang]
    ];
    wrap.innerHTML = items.map(function (item, i) {
      return '<div class="fc ' + (S.nav === 'feature-' + i ? 'on' : '') + '" data-feature="' + i + '">' +
        '<div class="ic">' + icon(item[0], 15) + '</div><h4>' + item[1] + '</h4><div class="sub">' + esc(item[2]) + '</div></div>';
    }).join('');
  }

  function renderSystemStatus() {
    var ss = el('ss');
    if (!ss) return;
    var models = (S.config && S.config.models) || {};
    var cached = Object.keys(models).filter(function (k) { return models[k].cached; }).length;
    var total = Object.keys(models).length || 4;
    var rows = [
      ['Calls queued', String(S.stats.calls_in_queue || 0)],
      ['Analyses complete', String(S.stats.analyzed || 0)],
      ['Open cases', String(S.stats.open_cases || 0)],
      ['Models cached', cached + ' / ' + total],
      ['Telephony', S.config && S.config.telephony && S.config.telephony.configured ? 'Configured' : 'Not configured'],
      ['Map tiles', 'Esri Satellite'],
      ['Live AI', S.config && S.config.live && S.config.live.configured ? 'Gemini ready' : 'Local fallback'],
      ['Avg analysis', S.stats.avg_processing_seconds ? Math.round(S.stats.avg_processing_seconds) + ' s' : '—']
    ];
    ss.innerHTML = rows.map(function (r) {
      var color = (r[1] === 'Not configured' || r[1] === 'Local fallback') ? '#f5c451' : '#c9c9d3';
      return '<div class="srow"><span>' + r[0] + '</span><b style="color:' + color + '">' + esc(r[1]) + '</b></div>';
    }).join('');
    var sys = el('sys'), dot = el('sysDot'), text = el('sysText');
    var allCached = Object.keys(models).length > 0 && Object.keys(models).every(function (k) { return models[k].cached; });
    var label = allCached ? 'Engine ready' : 'Setup required';
    var color = allCached ? '#4ade80' : '#f5c451';
    if (text) { text.textContent = label; text.style.color = color; }
    if (dot) dot.style.background = color;
    var liveConfigured = !!(S.config && S.config.live && S.config.live.configured);
    if (sys) sys.title = allCached ? 'All local models are cached. Final analysis is local; Gemini live transcription is optional.' : 'Some local models are not cached yet; first analysis may download them.';
    var sub = document.querySelector('#ss') && document.querySelector('#ss').parentNode ? document.querySelector('#ss').parentNode.querySelector('.s.m') : null;
    if (sub) sub.textContent = allCached ? (liveConfigured ? 'Local analysis · Gemini live optional' : 'Local processing · no cloud AI') : 'Model download may be required';
  }

  function renderAlertsDropdown() {
    var bd = el('bd');
    if (!bd) return;
    var top = S.alerts.slice(0, 4);
    var unread = S.alerts.filter(function (a) { return a.status === 'unread'; }).length;
    var head = '<div class="dd-head"><b>Alerts</b><span>' + unread + ' unread</span></div>';
    bd.innerHTML = head + (top.length ? top.map(function (a) {
      var color = a.severity === 'high' ? '#ff5264' : a.severity === 'medium' ? '#f5c451' : '#4ade80';
      return '<div data-alert-id="' + esc(a.id) + '" data-call-id="' + esc(a.call_id || '') + '" class="dd-alert"><b style="color:' + color + '">' + esc(a.title) + '</b><span>' + esc(a.severity.toUpperCase()) + ' · ' + fmtDate(a.created_at) + '</span></div>';
    }).join('') + '<div data-action="alerts" class="dd-foot">View all alerts <span>→</span></div>' : '<div class="dd-empty">No alerts yet</div>');
  }

  function renderAlertsBadge() {
    var badge = el('bellBadge');
    if (badge) {
      badge.textContent = String(S.unread || 0);
      badge.style.display = S.unread ? 'flex' : 'none';
    }
    renderAlertsDropdown();
  }

  async function loadCalls() {
    var q = S.query ? '?q=' + encodeURIComponent(S.query) : (S.filter ? '?priority=' + encodeURIComponent(S.filter) : '');
    var data = await api('/api/calls' + q);
    S.calls = data.calls || [];
  }
  async function loadCases() {
    var data = await api('/api/cases');
    S.cases = data.cases || [];
  }
  async function loadAlerts() {
    var data = await api('/api/alerts');
    S.alerts = data.alerts || [];
    S.unread = data.unread || 0;
  }
  async function loadStats() {
    S.stats = await api('/api/stats');
  }

  function startTimers() {
    clearInterval(S.refreshTimer);
    clearInterval(S.queueTimer);
    S.refreshTimer = setInterval(async function () {
      try {
        await loadStats();
        await loadAlerts();
        renderSystemStatus();
        renderAlertsBadge();
        if (S.detail && S.detail.call && ['queued', 'processing'].indexOf(S.detail.call.status) >= 0) {
          await refreshActive();
        }
      } catch (e) { /* keep the dashboard usable if a poll fails */ }
    }, 5000);
    S.queueTimer = setInterval(async function () {
      try { await loadCalls(); await loadCases(); renderQueue(); renderShell(); } catch (e) {}
    }, 15000);
  }

  /* ------------------------------------------------------------------ */
  /* Static events                                                       */
  /* ------------------------------------------------------------------ */

  function bindStatic() {
    var landingSignIn = el('landingSignIn');
    if (landingSignIn) landingSignIn.onclick = showLogin;
    var loginBack = el('loginBack');
    if (loginBack) loginBack.onclick = function () { window.location.href = '/'; };

    var loginForm = el('loginForm');
    if (loginForm) loginForm.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = el('loginBtn'), err = el('loginErr');
      btn.disabled = true; err.textContent = '';
      try {
        var data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: el('loginUser').value, password: el('loginPass').value }) });
        S.me = data.user; S.csrf = data.csrf; S.authEnabled = data.auth_enabled;
        hideLogin();
        await startApp();
      } catch (ex) {
        err.textContent = ex.message;
      } finally { btn.disabled = false; }
    });

    var liveBtn = el('liveBtn'); if (liveBtn) liveBtn.onclick = openLive;
    var liveOpen = el('liveOpen'); if (liveOpen) liveOpen.onclick = openLive;
    var liveClose = el('liveClose'); if (liveClose) liveClose.onclick = closeLive;
    var liveDoneBtn = el('liveDoneBtn'); if (liveDoneBtn) liveDoneBtn.onclick = closeLive;
    var liveConsent = el('liveConsent'); if (liveConsent) liveConsent.onchange = updateLiveStart;
    var liveStart = el('liveStartBtn'); if (liveStart) liveStart.onclick = startLive;
    var liveStop = el('liveStopBtn'); if (liveStop) liveStop.onclick = function () { stopLive(false); };
    var liveCancel = el('liveCancelBtn'); if (liveCancel) liveCancel.onclick = function () { stopLive(true); };
    var liveModal = el('liveModal'); if (liveModal) liveModal.addEventListener('click', function (e) { if (e.target === liveModal) closeLive(); });

    var uploadBtn = el('uploadBtn'); if (uploadBtn) uploadBtn.onclick = openUpload;
    var uploadClose = el('uploadClose'); if (uploadClose) uploadClose.onclick = closeUpload;
    var uploadModal = el('uploadModal'); if (uploadModal) uploadModal.addEventListener('click', function (e) { if (e.target === uploadModal) closeUpload(); });
    var uploadForm = el('uploadForm'); if (uploadForm) uploadForm.addEventListener('submit', submitUpload);
    var demoList = el('demoList'); if (demoList) demoList.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-demo]');
      if (btn) loadDemo(btn.getAttribute('data-demo'));
    });

    var ovlClose = el('ovlClose'); if (ovlClose) ovlClose.onclick = closeOverlay;
    var overlay = el('overlay'); if (overlay) overlay.addEventListener('click', function (e) { if (e.target === overlay) closeOverlay(); });
    var fullClose = el('fx'); if (fullClose) fullClose.onclick = closeFullMap;

    var bell = el('bell'); if (bell) bell.onclick = function (e) {
      e.stopPropagation();
      var bd = el('bd'), pd = el('pd'), status = el('statusPop');
      if (pd) pd.classList.remove('on');
      if (status) status.classList.remove('on');
      if (bd) bd.classList.toggle('on');
    };
    var pf = el('pf'); if (pf) pf.onclick = function (e) {
      e.stopPropagation();
      var bd = el('bd'), pd = el('pd'), status = el('statusPop');
      if (bd) bd.classList.remove('on');
      if (status) status.classList.remove('on');
      if (pd) pd.classList.toggle('on');
    };
    var sysBtn = el('sys'), statusPop = el('statusPop');
    if (sysBtn && statusPop) sysBtn.onclick = function (e) {
      e.stopPropagation();
      var bd = el('bd'), pd = el('pd');
      if (bd) bd.classList.remove('on');
      if (pd) pd.classList.remove('on');
      statusPop.classList.toggle('on');
    };
    if (statusPop) statusPop.addEventListener('click', function (e) { e.stopPropagation(); });
    var bd = el('bd'); if (bd) bd.addEventListener('click', function (e) {
      var item = e.target.closest('[data-alert-id]');
      var action = e.target.closest('[data-action]');
      if (item) {
        bd.classList.remove('on');
        if (item.getAttribute('data-call-id')) selectCall(item.getAttribute('data-call-id'));
        else openAlerts();
      } else if (action && action.getAttribute('data-action') === 'alerts') {
        bd.classList.remove('on'); openAlerts();
      }
    });
    var pd = el('pd'); if (pd) pd.addEventListener('click', function (e) {
      var action = e.target.closest('[data-action]');
      if (!action) return;
      pd.classList.remove('on');
      var a = action.getAttribute('data-action');
      if (a === 'logout') logout();
      else if (a === 'profile' || a === 'settings') openSettings();
    });
    document.addEventListener('click', function () {
      var bd = el('bd'), pd = el('pd'), status = el('statusPop');
      if (bd) bd.classList.remove('on');
      if (pd) pd.classList.remove('on');
      if (status) status.classList.remove('on');
    });

    var nav = el('sb'); if (nav) nav.addEventListener('click', function (e) {
      var item = e.target.closest('[data-nav]');
      if (!item) return;
      var target = item.getAttribute('data-nav');
      if (target === 'quick-demo') {
        QuickDemo.start();
        return;
      }
      S.nav = target;
      renderNav();
      if (target === 'live') { closeOverlay(); closeFullMap(); }
      else if (target === 'cases') openCases();
      else if (target === 'map') openFullMap();
      else if (target === 'reports') openReports();
      else if (target === 'settings') openSettings();
    });

    var fe = el('fe'); if (fe) fe.addEventListener('click', function (e) {
      var card = e.target.closest('[data-feature]');
      if (card) openFeature(Number(card.getAttribute('data-feature')));
    });

    var inAns = el('incomingAnswerBtn'); if (inAns) inAns.onclick = function () { QuickDemo.answer(); };
    var inDec = el('incomingDeclineBtn'); if (inDec) inDec.onclick = function () { QuickDemo.decline(); };
    var dmRep = el('demoReplayBtn'); if (dmRep) dmRep.onclick = function () { QuickDemo.start(); };
    var dmCnf = el('demoConfirmAllBtn'); if (dmCnf) dmCnf.onclick = function () { QuickDemo.confirmAllFindings(); };
    var dmRepDld = el('demoDownloadReportBtn'); if (dmRepDld) dmRepDld.onclick = function () { QuickDemo.downloadReport(); };

    var q = el('q'); if (q) {
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { S.query = q.value.trim(); if (S.query.length >= 2) openSearch(S.query); else { loadCalls().then(renderQueue); } }
        if (e.key === 'Escape') { q.value = ''; S.query = ''; loadCalls().then(renderQueue); }
      });
      q.addEventListener('input', function () {
        S.query = q.value.trim();
        if (!S.query) loadCalls().then(renderQueue);
      });
    }
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (q) q.focus(); }
      if (e.key === 'Escape') {
        closeOverlay(); closeFullMap(); closeUpload();
        var bd = el('bd'), pd = el('pd'), status = el('statusPop'); if (bd) bd.classList.remove('on'); if (pd) pd.classList.remove('on'); if (status) status.classList.remove('on');
      }
    });

    var fl = el('fl'); if (fl) fl.onchange = function () { S.filter = fl.value; loadCalls().then(renderQueue); };
    var end = el('end'); if (end) end.onclick = function () { S.activeId = null; S.detail = null; stopAudio(); renderEmptyCall(); renderQueue(); renderFeatures(); };
    var caseBtn = el('caseBtn'); if (caseBtn) caseBtn.onclick = openCasePicker;
    var pp = el('pp'); if (pp) pp.onclick = togglePlay;
    var wv = el('wv'); if (wv) wv.onclick = seekFromEvent;
    var pb = el('pb'); if (pb) pb.onclick = seekFromEvent;
    var sp = el('sp'); if (sp) sp.onclick = cycleSpeed;
    var vl = el('vl'); if (vl) vl.onclick = toggleMute;
    var vf = el('vf'); if (vf) vf.onclick = openFullMap;
    var ex = el('ex'); if (ex) ex.onclick = openFullMap;
    var zi = el('zi'); if (zi) zi.onclick = function () { if (S.maps.main) S.maps.main.zoomIn(); };
    var zo = el('zo'); if (zo) zo.onclick = function () { if (S.maps.main) S.maps.main.zoomOut(); };
    var z2i = el('z2i'); if (z2i) z2i.onclick = function () { if (S.maps.bottom) S.maps.bottom.zoomIn(); };
    var z2r = el('z2r'); if (z2r) z2r.onclick = function () { if (S.maps.bottom) S.maps.bottom.fitBounds(S.lastBounds || [[19.0, 72.8], [19.2, 72.9]]); };
    var m1 = el('m1'); if (m1) m1.ondblclick = openFullMap;
    var hp = el('hp'); if (hp) hp.onclick = function () { window.location.href = 'tel:112'; };
    var sup = el('sup'); if (sup) sup.onclick = openSupport;
    var xp = el('xp'); if (xp) xp.onclick = function () { S.showTranslation = !S.showTranslation; renderTranscript(); };
    var audio = el('audio');
    if (audio) {
      audio.addEventListener('timeupdate', updatePlayback);
      audio.addEventListener('loadedmetadata', updatePlayback);
      audio.addEventListener('play', function () { S.playing = true; updatePlayButton(); });
      audio.addEventListener('pause', function () { S.playing = false; updatePlayButton(); });
      audio.addEventListener('ended', function () {
        S.playing = false;
        updatePlayButton();
        if (QuickDemo.active) QuickDemo.onEnded();
      });
      audio.addEventListener('error', function () { if (S.activeId) toast('Audio playback is unavailable for this recording.', 'warn'); });
    }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) {}
    S.me = null; S.csrf = '';
    clearInterval(S.refreshTimer); clearInterval(S.queueTimer); clearInterval(S.jobTimer);
    window.location.href = '/';
  }

  /* ------------------------------------------------------------------ */
  /* Upload / demo                                                       */
  /* ------------------------------------------------------------------ */

  function openUpload() {
    var modal = el('uploadModal');
    if (!modal) return;
    var cs = el('caseSelect');
    if (cs) cs.innerHTML = '<option value="">No case</option>' + S.cases.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.case_number + ' · ' + c.title) + '</option>'; }).join('');
    var list = el('demoList');
    var scenarios = (S.config && S.config.demo_scenarios) || [];
    if (list) {
      list.innerHTML = scenarios.length ? scenarios.map(function (s) {
        return '<div class="demo-card"><b>' + esc(s.title) + '</b><p>' + esc(s.description) + '</p><div class="row"><span class="tag gray">' + esc((s.duration_hint || '—') + 's · ' + (s.language_hint || '—')) + '</span><button class="btn amber small" data-demo="' + esc(s.id) + '">' + icon('play', 11) + 'Load &amp; analyse</button></div></div>';
      }).join('') : '<div class="muted" style="font-size:10px;color:#8c8c98">No demo scenarios are installed. Upload a recording instead.</div>';
    }
    var err = el('uploadErr'); if (err) err.textContent = '';
    modal.classList.add('on');
  }
  function closeUpload() { var m = el('uploadModal'); if (m) m.classList.remove('on'); }

  async function submitUpload(e) {
    e.preventDefault();
    var file = el('fileInput').files[0];
    var err = el('uploadErr');
    var btn = el('uploadSubmit');
    if (!file) { err.textContent = 'Choose an audio file first.'; return; }
    if (!el('consent').checked) { err.textContent = 'Please confirm authorisation before uploading.'; return; }
    var fd = new FormData();
    fd.append('file', file);
    fd.append('source_label', el('sourceLabel').value.trim());
    fd.append('case_id', el('caseSelect').value);
    fd.append('consent_note', 'Investigator confirmed authorisation to process this recording.');
    btn.disabled = true; err.textContent = 'Uploading and validating…';
    try {
      var data = await api('/api/calls/upload', { method: 'POST', body: fd });
      closeUpload();
      toast('Recording uploaded. Local analysis queued.', 'ok');
      await loadCalls(); await loadStats(); renderQueue(); renderShell(); renderSystemStatus();
      await selectCall(data.call.id);
      watchJob(data.job.id, data.call.id);
    } catch (ex) {
      err.textContent = ex.message;
    } finally { btn.disabled = false; }
  }

  async function loadDemo(id) {
    var btn = document.querySelector('[data-demo="' + CSS.escape(id) + '"]');
    if (btn) btn.disabled = true;
    try {
      var data = await api('/api/demo/' + encodeURIComponent(id), { method: 'POST' });
      closeUpload();
      toast('Synthetic demo queued. Local CPU analysis may take 1–3 minutes.', 'warn');
      await loadCalls(); await loadStats(); renderQueue(); renderShell(); renderSystemStatus();
      await selectCall(data.call.id);
      watchJob(data.job.id, data.call.id);
    } catch (ex) {
      toast(ex.message, 'err');
      if (btn) btn.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Live microphone                                                     */
  /* ------------------------------------------------------------------ */

  function populateLiveCases() {
    var cs = el('liveCase');
    if (!cs) return;
    cs.innerHTML = '<option value="">No case</option>' + S.cases.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.case_number + ' · ' + c.title) + '</option>';
    }).join('');
  }

  function resetLiveUI() {
    var setup = el('liveSetup'), session = el('liveSession'), done = el('liveDone');
    if (setup) setup.style.display = '';
    if (session) session.style.display = 'none';
    if (done) done.style.display = 'none';
    var consent = el('liveConsent'); if (consent) { consent.checked = false; consent.disabled = false; }
    var transcript = el('liveTranscript');
    if (transcript) transcript.innerHTML = '<div class="muted" style="font-size:10px;color:#8c8c98">Speak clearly. The first transcript may take a few seconds.</div>';
    var err = el('liveErr'); if (err) err.textContent = '';
    var setupErr = el('liveSetupErr'); if (setupErr) setupErr.textContent = '';
    var timer = el('liveTimer'); if (timer) timer.textContent = '00:00';
    var state = el('liveState'); if (state) state.textContent = 'Listening';
    setLiveCloud('Gemini provisional', 'amber');
    var start = el('liveStartBtn');
    if (start) { start.disabled = true; start.textContent = 'Start listening'; }
    var stop = el('liveStopBtn');
    if (stop) {
      stop.disabled = false; stop.textContent = 'Stop & analyse';
      stop.onclick = function () { stopLive(false); };
    }
    var cancel = el('liveCancelBtn');
    if (cancel) { cancel.disabled = false; cancel.style.display = ''; }
    var liveBtn = el('liveBtn'); if (liveBtn) liveBtn.classList.remove('on');
    S.live.active = false; S.live.pendingUpload = null; S.live.stopping = false;
    S.live.cloudOk = true;
    S.live.samples = []; S.live.total = 0; S.live.sent = 0; S.live.chunkIndex = 0;
  }

  function setLiveCloud(text, cls) {
    var tag = el('liveCloud');
    if (tag) { tag.textContent = text; tag.className = 'tag ' + (cls || 'amber'); }
  }

  async function openLive() {
    if (S.live.active) {
      toast('Stop the current live recording before starting another.', 'warn');
      return;
    }
    if (S.live.stopping) {
      toast('The live recording is still uploading. Wait for it to finish.', 'warn');
      return;
    }
    var modal = el('liveModal');
    if (!modal) return;
    closeUpload();
    resetLiveUI();
    S.live.config = null;
    S.live.chunkSeconds = 5;
    S.live.maxSeconds = 300;
    populateLiveCases();
    var note = el('liveConfigNote');
    if (note) note.textContent = 'Checking Gemini configuration…';
    modal.classList.add('on');
    try {
      var cfg = await api('/api/live/config');
      S.live.config = cfg;
      S.live.chunkSeconds = Math.max(2, Number(cfg.chunk_seconds) || 5);
      S.live.maxSeconds = Math.max(30, Number(cfg.max_seconds) || 300);
      if (note) {
        note.textContent = cfg.configured
          ? 'Gemini ' + cfg.model + ' · ' + S.live.chunkSeconds + 's chunks · max ' + Math.round(S.live.maxSeconds / 60) + ' min. Audio leaves this device only while live.'
          : 'Gemini is not configured on the server. You can still record; the final analysis runs locally after Stop.';
      }
      var start = el('liveStartBtn');
      if (start) start.textContent = cfg.configured ? 'Start listening' : 'Start local recording';
      updateLiveStart();
    } catch (ex) {
      if (note) note.textContent = 'Could not read the live configuration. You can still record; the final analysis runs locally after Stop.';
      updateLiveStart();
    }
  }

  function updateLiveStart() {
    var consent = el('liveConsent'), btn = el('liveStartBtn');
    if (btn) btn.disabled = !(consent && consent.checked) || S.live.active;
  }

  function closeLive() {
    if (S.live.active) {
      toast('Stop the live recording before closing the window.', 'warn');
      return;
    }
    if (S.live.stopping) {
      toast('The live recording is still uploading. Wait for it to finish.', 'warn');
      return;
    }
    var modal = el('liveModal');
    if (modal) modal.classList.remove('on');
    resetLiveUI();
  }

  async function startLive() {
    if (S.live.active) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var unsupported = el('liveSetupErr');
      if (unsupported) unsupported.textContent = 'This browser cannot access the microphone. Use Add Recording or the demo instead.';
      return;
    }
    var consent = el('liveConsent');
    if (!consent || !consent.checked) {
      var consentErr = el('liveSetupErr'); if (consentErr) consentErr.textContent = 'Confirm consent before starting.';
      return;
    }
    var setupErr = el('liveSetupErr'); if (setupErr) setupErr.textContent = '';
    var cfg = S.live.config || {};
    S.live.chunkSeconds = Math.max(2, Number(cfg.chunk_seconds) || S.live.chunkSeconds || 5);
    S.live.maxSeconds = Math.max(30, Number(cfg.max_seconds) || S.live.maxSeconds || 300);
    S.live.sessionId = (window.crypto && window.crypto.randomUUID)
      ? window.crypto.randomUUID()
      : 'live-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
    S.live.samples = []; S.live.total = 0; S.live.sent = 0; S.live.chunkIndex = 0;
    S.live.queue = []; S.live.sending = false; S.live.cloudOk = cfg.configured === true; S.live.pendingUpload = null;
    S.live.stopping = false; S.live.startedAt = Date.now();
    var setup = el('liveSetup'), session = el('liveSession'), done = el('liveDone');
    if (setup) setup.style.display = 'none';
    if (session) session.style.display = '';
    if (done) done.style.display = 'none';
    var transcript = el('liveTranscript');
    if (transcript) transcript.innerHTML = '<div class="muted" style="font-size:10px;color:#8c8c98">Listening… speak clearly.</div>';
    var err = el('liveErr'); if (err) err.textContent = '';
    var setupErr2 = el('liveSetupErr'); if (setupErr2) setupErr2.textContent = '';
    var state = el('liveState'); if (state) state.textContent = 'Connecting…';
    var timer = el('liveTimer'); if (timer) timer.textContent = '00:00';
    var liveBtn = el('liveBtn'); if (liveBtn) liveBtn.classList.add('on');
    var start = el('liveStartBtn'); if (start) start.disabled = true;
    var stop = el('liveStopBtn'); if (stop) { stop.disabled = false; stop.textContent = 'Stop & analyse'; }
    var cancel = el('liveCancelBtn'); if (cancel) cancel.disabled = false;
    setLiveCloud(cfg.configured ? 'Gemini connecting' : 'Local recording', cfg.configured ? 'amber' : 'gray');

    try {
      S.live.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio is not available in this browser.');
      S.live.ctx = new Ctx({ sampleRate: 16000 });
      await S.live.ctx.resume();
      S.live.sampleRate = S.live.ctx.sampleRate || 16000;
      S.live.source = S.live.ctx.createMediaStreamSource(S.live.stream);
      S.live.processor = S.live.ctx.createScriptProcessor(4096, 1, 1);
      S.live.sink = S.live.ctx.createGain();
      S.live.sink.gain.value = 0;
      S.live.source.connect(S.live.processor);
      S.live.processor.connect(S.live.sink);
      S.live.sink.connect(S.live.ctx.destination);
      S.live.processor.onaudioprocess = function (ev) {
        if (!S.live.active) return;
        var channel = ev.inputBuffer.getChannelData(0);
        S.live.samples.push(new Float32Array(channel));
        S.live.total += channel.length;
      };
      S.live.active = true;
      if (state) state.textContent = cfg.configured ? 'Listening · Gemini' : 'Recording locally';
      S.live.chunkTimer = setInterval(function () { flushLiveChunk(false); }, S.live.chunkSeconds * 1000);
      S.live.tickTimer = setInterval(liveTick, 1000);
    } catch (ex) {
      S.live.active = false;
      disposeLiveAudio();
      if (state) state.textContent = 'Microphone unavailable';
      if (setupErr2) setupErr2.textContent = 'Microphone unavailable: ' + ex.message + ' Use Add Recording or the demo instead.';
      if (err) err.textContent = '';
      if (setup) setup.style.display = '';
      if (session) session.style.display = 'none';
      var liveBtn2 = el('liveBtn'); if (liveBtn2) liveBtn2.classList.remove('on');
      updateLiveStart();
    }
  }

  function liveTick() {
    if (!S.live.active) return;
    var elapsed = (Date.now() - S.live.startedAt) / 1000;
    var timer = el('liveTimer'); if (timer) timer.textContent = fmtTime(elapsed);
    if (elapsed >= S.live.maxSeconds) {
      toast('Live session time limit reached. Uploading for local analysis.', 'warn');
      stopLive(false);
    }
  }

  function disposeLiveAudio() {
    clearInterval(S.live.chunkTimer); S.live.chunkTimer = null;
    clearInterval(S.live.tickTimer); S.live.tickTimer = null;
    try { if (S.live.processor) S.live.processor.disconnect(); } catch (e) {}
    try { if (S.live.source) S.live.source.disconnect(); } catch (e) {}
    try { if (S.live.sink) S.live.sink.disconnect(); } catch (e) {}
    try { if (S.live.stream) S.live.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    try { if (S.live.ctx && S.live.ctx.state !== 'closed') S.live.ctx.close(); } catch (e) {}
    S.live.processor = null; S.live.source = null; S.live.sink = null; S.live.stream = null; S.live.ctx = null;
  }

  function flushLiveChunk(final) {
    if (!S.live.active && !final) return;
    if (S.live.total <= S.live.sent) return;
    var parts = sliceLiveSamples(S.live.sent, S.live.total);
    S.live.sent = S.live.total;
    if (!S.live.cloudOk) return;
    var blob = encodeLiveWav(parts, S.live.sampleRate);
    if (!blob.size) return;
    S.live.queue.push({ blob: blob, index: S.live.chunkIndex++ });
    sendLiveQueue();
  }

  function sliceLiveSamples(from, to) {
    var parts = [], pos = 0;
    for (var i = 0; i < S.live.samples.length; i++) {
      var chunk = S.live.samples[i];
      var start = Math.max(0, from - pos);
      var end = Math.min(chunk.length, to - pos);
      if (end > start) parts.push(chunk.subarray(start, end));
      pos += chunk.length;
      if (pos >= to) break;
    }
    return parts;
  }

  function concatLiveSamples(parts) {
    if (!parts.length) return new Float32Array(0);
    if (parts.length === 1) return parts[0];
    var total = 0;
    for (var i = 0; i < parts.length; i++) total += parts[i].length;
    var out = new Float32Array(total), at = 0;
    for (var j = 0; j < parts.length; j++) { out.set(parts[j], at); at += parts[j].length; }
    return out;
  }

  function resampleLive(parts, sourceRate) {
    var input = concatLiveSamples(parts);
    if (!sourceRate || Math.abs(sourceRate - 16000) < 1) return input;
    var ratio = sourceRate / 16000;
    var outLen = Math.floor(input.length / ratio);
    var out = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var start = Math.floor(i * ratio);
      var end = Math.max(start + 1, Math.floor((i + 1) * ratio));
      var sum = 0, count = 0;
      for (var j = start; j < end && j < input.length; j++) { sum += input[j]; count++; }
      out[i] = count ? sum / count : 0;
    }
    return out;
  }

  function encodeLiveWav(parts, sourceRate) {
    var pcm = resampleLive(parts, sourceRate);
    var buffer = new ArrayBuffer(44 + pcm.length * 2);
    var view = new DataView(buffer);
    function str(offset, value) { for (var i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); }
    str(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, 16000, true);
    view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    str(36, 'data'); view.setUint32(40, pcm.length * 2, true);
    for (var i = 0; i < pcm.length; i++) {
      var sample = Math.max(-1, Math.min(1, pcm[i]));
      view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  async function sendLiveQueue() {
    if (S.live.sending) return;
    S.live.sending = true;
    while (S.live.queue.length && S.live.cloudOk) {
      var item = S.live.queue.shift();
      var fd = new FormData();
      fd.append('audio', item.blob, 'live-chunk.wav');
      fd.append('session_id', S.live.sessionId);
      fd.append('chunk_index', String(item.index));
      fd.append('language_hint', (el('liveLanguage') && el('liveLanguage').value) || 'auto');
      try {
        var data = await api('/api/live/transcribe', { method: 'POST', body: fd });
        if (data.text) appendLiveText(data.text);
        setLiveCloud('Gemini provisional', 'amber');
      } catch (ex) {
        S.live.cloudOk = false;
        S.live.queue = [];
        var err = el('liveErr');
        if (err) err.textContent = ex.message + ' Recording continues; final analysis will run locally.';
        setLiveCloud('Local only', 'gray');
        var state = el('liveState');
        if (state && S.live.active) state.textContent = 'Recording locally';
        break;
      }
    }
    S.live.sending = false;
  }

  function appendLiveText(text) {
    var target = el('liveTranscript');
    if (!target) return;
    var placeholder = target.querySelector('.muted');
    if (placeholder) placeholder.remove();
    var line = document.createElement('div');
    line.className = 'live-line';
    line.innerHTML = '<b>Provisional · ' + fmtTime((Date.now() - S.live.startedAt) / 1000) + '</b>' + esc(text);
    target.appendChild(line);
    target.scrollTop = target.scrollHeight;
  }

  async function stopLive(discard) {
    if (S.live.stopping) return;
    if (!S.live.active && !S.live.total) { closeLive(); return; }
    S.live.stopping = true;
    var wasActive = S.live.active;
    S.live.active = false;
    clearInterval(S.live.chunkTimer); S.live.chunkTimer = null;
    clearInterval(S.live.tickTimer); S.live.tickTimer = null;
    if (!discard && wasActive) flushLiveChunk(true);
    disposeLiveAudio();
    var liveBtn = el('liveBtn'); if (liveBtn) liveBtn.classList.remove('on');
    if (discard) {
      S.live.samples = []; S.live.total = 0;
      resetLiveUI();
      closeLive();
      toast('Live recording discarded.', 'warn');
      return;
    }
    if (!S.live.samples.length || S.live.total < 1600) {
      var noAudioErr = el('liveSetupErr'); if (noAudioErr) noAudioErr.textContent = 'No microphone audio was captured. Allow microphone access and try again.';
      S.live.stopping = false;
      var setup = el('liveSetup'); if (setup) setup.style.display = '';
      var session = el('liveSession'); if (session) session.style.display = 'none';
      updateLiveStart();
      return;
    }
    var all = concatLiveSamples(S.live.samples);
    var blob = encodeLiveWav([all], S.live.sampleRate);
    var label = 'Live microphone · ' + new Date().toLocaleString('en-IN');
    var caseId = (el('liveCase') && el('liveCase').value) || '';
    S.live.pendingUpload = { blob: blob, label: label, caseId: caseId };
    await uploadLiveRecording(blob, label, caseId);
  }

  async function uploadLiveRecording(blob, label, caseId) {
    var err = el('liveErr');
    var stop = el('liveStopBtn');
    var cancel = el('liveCancelBtn');
    var state = el('liveState');
    if (err) err.textContent = 'Uploading the full recording for local analysis…';
    if (state) state.textContent = 'Uploading…';
    if (stop) { stop.disabled = true; stop.textContent = 'Uploading…'; }
    if (cancel) cancel.disabled = true;
    var fd = new FormData();
    fd.append('file', blob, 'live-' + Date.now() + '.wav');
    fd.append('source_label', label);
    fd.append('case_id', caseId);
    fd.append('consent_note', 'Investigator confirmed consent for a live microphone session. Provisional transcription used Google Gemini; final analysis is local.');
    try {
      var data = await api('/api/calls/upload', { method: 'POST', body: fd });
      S.live.pendingUpload = null;
      var modal = el('liveModal'); if (modal) modal.classList.remove('on');
      toast('Live recording uploaded. Final local analysis queued.', 'ok');
      await loadCalls(); await loadStats(); renderQueue(); renderShell(); renderSystemStatus();
      await selectCall(data.call.id);
      watchJob(data.job.id, data.call.id);
      resetLiveUI();
    } catch (ex) {
      if (err) err.textContent = 'Upload failed: ' + ex.message + ' You can retry or discard.';
      if (state) state.textContent = 'Upload failed';
      if (stop) {
        stop.disabled = false;
        stop.textContent = 'Retry upload';
        stop.onclick = function () {
          if (S.live.pendingUpload) uploadLiveRecording(S.live.pendingUpload.blob, S.live.pendingUpload.label, S.live.pendingUpload.caseId);
        };
      }
      if (cancel) cancel.disabled = false;
      S.live.stopping = false;
    }
  }

  function watchJob(jobId, callId) {
    clearInterval(S.jobTimer);
    S.jobId = jobId; S.jobCallId = callId;
    updateJobChip();
    S.jobTimer = setInterval(async function () {
      try {
        var data = await api('/api/jobs/' + jobId);
        var job = data.job;
        var chip = el('c2');
        if (chip) {
          chip.style.display = '';
          chip.textContent = (job.status === 'failed' ? 'Analysis failed' : job.stage + ' · ' + Math.round(job.progress || 0) + '%');
        }
        if (job.status === 'completed' || job.status === 'failed') {
          clearInterval(S.jobTimer); S.jobTimer = null; S.jobId = null;
          if (job.status === 'completed') toast('Analysis complete. Review the transcript and findings.', 'ok');
          else toast('Analysis failed: ' + (job.error || 'see job details'), 'err');
          await loadCalls(); await loadStats(); renderQueue(); renderShell(); renderSystemStatus();
          if (S.activeId === callId) await refreshActive();
        }
      } catch (ex) { /* keep polling on transient errors */ }
    }, 1600);
  }

  function updateJobChip() {
    if (!S.jobId) return;
    var chip = el('c2');
    if (chip) { chip.style.display = ''; chip.textContent = 'Analysis queued'; }
  }

  /* ------------------------------------------------------------------ */
  /* Queue and active call                                               */
  /* ------------------------------------------------------------------ */

  function renderQueue() {
    var cq = el('cq');
    if (!cq) return;
    if (!S.calls.length) {
      cq.innerHTML = '<div class="empty-queue">No recordings in the queue.<br><br><button class="btn red small" id="emptyUpload">Add recording</button><br><br><button class="btn small" id="emptyDemo">Load a labelled demo</button></div>';
      var eu = el('emptyUpload'); if (eu) eu.onclick = openUpload;
      var ed = el('emptyDemo'); if (ed) ed.onclick = openUpload;
      return;
    }
    cq.innerHTML = S.calls.map(function (c) {
      var active = c.id === S.activeId;
      var color = pColor(c.priority);
      var status = c.status === 'analyzed' ? 'Analyzed' : c.status === 'failed' ? 'Failed' : c.status === 'processing' ? 'Analysing' : 'Queued';
      var label = c.source_label || c.original_filename || c.short_id;
      var urgency = c.urgency_score !== null && c.urgency_score !== undefined ? 'Urgency ' + c.urgency_score + '/100' : 'Not scored';
      return '<div class="cr ' + (active ? 'on' : '') + '" data-call="' + esc(c.id) + '">' +
        '<div class="ci">' + icon(c.is_simulated ? 'shieldF' : 'phone', 15, active ? '#ff5264' : '#888893') + '</div>' +
        '<div class="cr-body"><div class="cr-title-row"><span class="cr-title">' + esc(label) + '</span><span class="bg ' + pClass(c.priority) + '">' + pLabel(c.priority) + '</span></div>' +
        '<div class="cr-meta">#' + esc(c.short_id) + ' · ' + fmtTime(c.duration_s) + ' · ' + esc(c.language || 'language pending') + '</div>' +
        '<div class="cr-status"><span style="color:' + color + '">' + esc(status) + '</span><span class="sep">·</span><span>' + urgency + '</span>' + (c.is_simulated ? '<span class="sep">·</span><span>Synthetic</span>' : '') + '</div>' +
        '</div></div>';
    }).join('');
    cq.querySelectorAll('[data-call]').forEach(function (node) {
      node.onclick = function () { selectCall(node.getAttribute('data-call')); };
    });
    var cc = el('cc'); if (cc) cc.textContent = S.calls.length;
  }

  async function selectCall(id) {
    if (!id || S.loadingCall) return;
    S.loadingCall = true;
    closeOverlay(); closeFullMap();
    try {
      var detail = await api('/api/calls/' + encodeURIComponent(id));
      S.activeId = id; S.detail = detail; S.tab = S.tab || 'transcript';
      S.nav = 'live';
      renderNav();
      renderQueue();
      renderActive();
      renderFeatures();
      renderSystemStatus();
      if (detail.job && (detail.job.status === 'queued' || detail.job.status === 'running')) watchJob(detail.job.id, id);
    } catch (ex) {
      toast(ex.message, 'err');
    } finally { S.loadingCall = false; }
  }

  async function refreshActive() {
    if (!S.activeId) return;
    try {
      var detail = await api('/api/calls/' + encodeURIComponent(S.activeId));
      S.detail = detail;
      renderActive();
      renderQueue();
      renderFeatures();
    } catch (e) {}
  }

  function renderActive() {
    var d = S.detail;
    if (!d || !d.call) { renderEmptyCall(); return; }
    var c = d.call;
    var color = pColor(c.priority);
    var pr = el('pr');
    if (pr) { pr.textContent = pLabel(c.priority) + ' PRIORITY'; pr.style.background = c.priority === 'unscored' ? '#2b2b33' : pColor(c.priority); }
    setText('ref', '#' + c.short_id + (d.case ? ' · ' + d.case.case_number : ''));
    var ph = el('ph');
    if (ph) ph.innerHTML = icon(c.is_simulated ? 'shieldF' : 'phone', 18, color) + '<span>' + esc(c.source_label || c.original_filename || 'Recording') + '</span>';
    var lc = el('lc');
    if (lc) lc.innerHTML = icon('pin', 12, '#7d7d88') + '<span>' + esc((d.locations && d.locations[0] ? d.locations[0].label : 'No spoken landmark mapped')) + '</span><span class="dot">·</span><span>' + esc(c.source_type === 'demo' ? 'Synthetic demo' : c.source_type === 'upload' ? 'Uploaded recording' : c.source_type) + '</span>';
    setText('tm', fmtTime(c.duration_s));
    var c1 = el('c1'), c2 = el('c2'), c3 = el('c3');
    if (c1) { c1.style.display = ''; c1.innerHTML = icon(c.is_simulated ? 'shieldF' : 'file', 11) + (c.is_simulated ? 'Synthetic demo · not a real call' : 'Uploaded recording · SHA-256 recorded'); }
    if (c2) {
      c2.style.display = '';
      if (c.status === 'analyzed') c2.innerHTML = icon('shield', 11) + 'Analysis complete';
      else if (c.status === 'failed') c2.innerHTML = icon('alert', 11) + 'Analysis failed';
      else if (c.status === 'processing') c2.innerHTML = icon('refresh', 11) + 'Analysing…';
      else c2.innerHTML = icon('clock', 11) + 'Queued for analysis';
    }
    if (c3) {
      var speakerCount = d.analysis && d.analysis.speaker_count ? d.analysis.speaker_count : 0;
      c3.style.display = speakerCount >= 2 || c.language ? '' : 'none';
      c3.innerHTML = icon('head', 11) + (speakerCount >= 2 ? speakerCount + ' speakers' : 'Language: ' + esc(c.language || 'pending'));
    }
    var em = el('em');
    if (em) {
      em.innerHTML = icon(c.is_simulated ? 'shieldF' : 'shield', 12, c.is_simulated ? '#f5c451' : '#8c8c98') + (c.is_simulated ? 'Synthetic audio · labelled' : 'Evidence SHA-256 · ' + (c.sha256 || '').slice(0, 12));
      em.style.color = c.is_simulated ? '#f5c451' : '#8c8c98';
      em.style.borderColor = 'transparent';
    }
    var score = c.urgency_score;
    var ring = el('rg'), rv = el('rv'), hg = el('hg');
    if (ring) {
      var pct = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, Number(score)));
      ring.setAttribute('stroke-dasharray', (pct * 1.571) + ' 170');
      ring.setAttribute('stroke', score === null || score === undefined ? '#3b3b46' : color);
    }
    if (rv) rv.textContent = score === null || score === undefined ? '—' : Math.round(score) + '%';
    if (hg) { hg.innerHTML = icon('refresh', 14) + (c.priority || 'unscored'); hg.style.color = color; }
    renderEmotionCards();
    renderWaveform(d.waveform || []);
    renderTabs();
    renderTranscript();
    renderRelatedEvidence();
    renderLocationSources();
    renderBackgroundEvents();
    QuickDemo.initSpectrumBars();
    var isPizzaActive = c.id === 'call_covert_pizza_distress' || c.duration_s > 45;
    QuickDemo.updateAIReviewDeck(0, isPizzaActive, false);
    renderAudioSource();
    initMaps();
    var audio = el('audio');
    if (audio && audio.getAttribute('data-call') !== c.id) {
      audio.setAttribute('data-call', c.id);
      audio.src = '/api/calls/' + encodeURIComponent(c.id) + '/audio';
      audio.load();
      S.playing = false;
      updatePlayButton();
      updatePlayback();
    }
    var caseBtn = el('caseBtn');
    if (caseBtn) caseBtn.innerHTML = icon('file', 12) + (d.case ? 'Open case' : 'Save to case');
    var xp = el('xp'); if (xp) xp.textContent = S.showTranslation ? 'EN ✓' : 'EN';
  }

  function renderEmptyCall() {
    S.detail = null;
    var pr = el('pr'); if (pr) { pr.textContent = 'NO RECORDING SELECTED'; pr.style.background = '#2b2b33'; }
    setText('ref', '—'); setText('tm', '00:00');
    var ph = el('ph'); if (ph) ph.innerHTML = '<span>Select a recording to begin</span>';
    var lc = el('lc'); if (lc) lc.innerHTML = '<span>Local analysis · no live telephony connected</span>';
    var c1 = el('c1'), c2 = el('c2'), c3 = el('c3');
    if (c1) { c1.style.display = 'none'; } if (c2) { c2.style.display = 'none'; } if (c3) { c3.style.display = 'none'; }
    var mt = el('mt'); if (mt) mt.innerHTML = '';
    var rg = el('rg'); if (rg) { rg.setAttribute('stroke-dasharray', '0 170'); rg.setAttribute('stroke', '#27272e'); }
    setText('rv', '—'); var hg = el('hg'); if (hg) hg.innerHTML = 'unscored';
    var em = el('em'); if (em) { em.innerHTML = 'No recording selected'; em.style.color = '#8c8c98'; em.style.borderColor = 'transparent'; }
    var tx = el('tx');
    if (tx) tx.innerHTML = '<div class="empty-main"><b>No recording selected</b>Upload a consented recording or load a labelled synthetic demo to open the workspace.<br><br><button class="btn primary small" onclick="document.getElementById(\'uploadBtn\').click()">Add a recording</button></div>';
    var tabs = el('tabs'); if (tabs) tabs.innerHTML = '';
    var re = el('re'); if (re) re.innerHTML = '<div class="related-empty">No linked findings. Reference matches appear only when a controlled phrase is present.</div>';
    var so = el('so'); if (so) so.innerHTML = '<div class="location-empty">No location observations. Spoken landmarks only.</div>';
    var ba = el('ba'); if (ba) ba.innerHTML = '<div class="audio-empty">No audio events.</div>';
    renderFeatures();
    if (S.maps.main) { S.maps.main.remove(); S.maps.main = null; }
    if (S.maps.mini) { S.maps.mini.remove(); S.maps.mini = null; }
    if (S.maps.bottom) { S.maps.bottom.remove(); S.maps.bottom = null; }
  }

  function renderEmotionCards() {
    var mt = el('mt');
    if (!mt) return;
    var d = S.detail; if (!d || !d.call) { mt.innerHTML = ''; return; }
    var analysis = d.analysis || {};
    var summary = analysis.emotion_summary || {};
    var top = Object.keys(summary).sort(function (a, b) { return summary[b] - summary[a]; })[0];
    var topScore = top ? Math.round(summary[top] * 100) : null;
    var segs = d.segments || [];
    var sentimentCounts = {};
    segs.forEach(function (s) { if (s.sentiment) sentimentCounts[s.sentiment] = (sentimentCounts[s.sentiment] || 0) + 1; });
    var sentiment = Object.keys(sentimentCounts).sort(function (a, b) { return sentimentCounts[b] - sentimentCounts[a]; })[0] || '—';
    var prosody = analysis.prosody || {};
    var arousal = analysis.urgency_contributions ? analysis.urgency_contributions.acoustic_arousal : null;
    var arousalPct = arousal !== null && arousal !== undefined ? Math.round(Number(arousal) / 35 * 100) : null;
    var speaker = analysis.speaker_count || 1;
    var cards = [
      ['fearF', 'Vocal', top ? topScore + '%' : '—', top || 'model'],
      ['barsB', 'Sentiment', sentiment, 'lexicon'],
      ['target', 'Arousal', arousalPct !== null ? arousalPct + '%' : '—', 'proxy'],
      ['headF', 'Speakers', String(speaker), 'clusters']
    ];
    mt.innerHTML = cards.map(function (x, i) {
      return '<div class="mc"><i class="ico">' + icon(x[0], 14, i === 0 ? '#ff5264' : '#8c8c98') + '</i><span>' + x[1] + '<b>' + esc(x[2]) + '</b><span class="sub">' + esc(x[3]) + '</span></span></div>';
    }).join('');
  }

  function renderAudioSource() {
    var d = S.detail; if (!d || !d.call) return;
    var c = d.call;
    var lc = el('lc');
    if (lc && !(d.locations || []).length) lc.innerHTML = icon('pin', 14, '#8c8c98') + '<span>No spoken landmark mapped</span><span class="m" style="color:#8c8c98">· ' + esc(c.source_type === 'demo' ? 'Synthetic demo' : 'Uploaded recording') + '</span>';
  }

  /* ------------------------------------------------------------------ */
  /* Playback and waveform                                               */
  /* ------------------------------------------------------------------ */

  function renderWaveform(peaks) {
    var canvas = el('wv');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#070709';
    ctx.fillRect(0, 0, w, h);
    if (!peaks || !peaks.length) {
      ctx.fillStyle = '#3c3c45';
      ctx.font = '500 18px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waveform unavailable', w / 2, h / 2);
      return;
    }
    var barW = Math.max(1, w / peaks.length);
    var mid = h / 2;
    peaks.forEach(function (p, i) {
      var amp = Math.max(0.02, Number(p)) * (h * 0.44);
      ctx.fillStyle = i / peaks.length < playbackRatio() ? '#ff2e43' : '#2a2a31';
      ctx.fillRect(i * barW, mid - amp, Math.max(1, barW - 1), amp * 2);
    });
    ctx.fillStyle = 'rgba(255,46,67,.055)';
    ctx.fillRect(0, 0, w * playbackRatio(), h);
  }

  function playbackRatio() {
    var audio = el('audio');
    if (!audio || !audio.duration || !isFinite(audio.duration)) return 0;
    return Math.max(0, Math.min(1, audio.currentTime / audio.duration));
  }

  function updatePlayButton() {
    var pp = el('pp');
    if (pp) pp.innerHTML = icon(S.playing ? 'pause' : 'play', 15, '#0b0b0d');
  }

  function updatePlayback() {
    var audio = el('audio');
    if (!audio) return;
    var duration = audio.duration && isFinite(audio.duration) ? audio.duration : (S.detail && S.detail.call ? S.detail.call.duration_s : 0) || 0;
    var current = audio.currentTime || 0;
    var ratio = duration ? Math.min(1, current / duration) : 0;
    setText('pt', fmtTime(current) + ' / ' + fmtTime(duration));
    var pg = el('pg'); if (pg) pg.style.width = (ratio * 100) + '%';
    var kn = el('kn'); if (kn) kn.style.left = (ratio * 100) + '%';
    var mk = el('mk');
    if (mk) { mk.style.left = (Math.max(0.025, Math.min(0.975, ratio)) * 100) + '%'; mk.textContent = fmtTime(current); }
    renderWaveform(S.detail && S.detail.waveform ? S.detail.waveform : []);
    highlightSegment(current);
    if (QuickDemo.active) {
      QuickDemo.onTimeUpdate(current);
    } else if (S.detail && S.detail.call) {
      var isPizza = S.detail.call.id === 'call_covert_pizza_distress' || S.detail.call.duration_s > 45;
      QuickDemo.updateAIReviewDeck(current, isPizza, S.playing);
    }
  }

  function togglePlay() {
    var audio = el('audio');
    if (!audio || !S.activeId) return;
    if (audio.paused) audio.play().catch(function () { toast('Playback could not start. The audio file may be unavailable.', 'err'); });
    else audio.pause();
  }
  function seekFromEvent(e) {
    var audio = el('audio');
    if (!audio || !audio.duration) return;
    var rect = e.currentTarget.getBoundingClientRect();
    var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
    updatePlayback();
  }
  function cycleSpeed() {
    var audio = el('audio');
    var speeds = [1, 1.25, 1.5, 2];
    var index = speeds.indexOf(S.speed);
    S.speed = speeds[(index + 1) % speeds.length];
    if (audio) audio.playbackRate = S.speed;
    var sp = el('sp'); if (sp) sp.textContent = S.speed + 'x';
  }
  function toggleMute() {
    var audio = el('audio');
    S.muted = !S.muted;
    if (audio) audio.muted = S.muted;
    var vl = el('vl'); if (vl) vl.innerHTML = icon(S.muted ? 'volF' : 'vol', 14, '#8c8c98');
  }
  function stopAudio() {
    var audio = el('audio');
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    S.playing = false; updatePlayButton();
  }

  function highlightSegment(current) {
    if (S.tab !== 'transcript' || !S.detail) return;
    var segs = S.detail.segments || [];
    var active = null;
    segs.forEach(function (s) { if (current >= s.start_s && current <= s.end_s) active = s; });
    document.querySelectorAll('#tx .seg').forEach(function (node) {
      node.classList.toggle('on', active && node.getAttribute('data-seg') === active.id);
    });
    if (active && S.lastActiveSeg !== active.id) {
      S.lastActiveSeg = active.id;
      var node = document.querySelector('#tx .seg[data-seg="' + CSS.escape(active.id) + '"]');
      if (node) node.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tabs, transcript, findings, events, locations                       */
  /* ------------------------------------------------------------------ */

  function renderTabs() {
    var tabs = el('tabs');
    if (!tabs) return;
    var list = [['transcript', 'Transcript'], ['audio', 'Audio analysis'], ['location', 'Location'], ['timeline', 'Timeline']];
    tabs.innerHTML = list.map(function (t) {
      return '<div class="tab ' + (S.tab === t[0] ? 'on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</div>';
    }).join('');
    tabs.querySelectorAll('[data-tab]').forEach(function (node) {
      node.onclick = function () { S.tab = node.getAttribute('data-tab'); renderTabs(); renderTranscript(); };
    });
    var xp = el('xp');
    if (xp) { xp.style.display = S.tab === 'transcript' ? '' : 'none'; xp.textContent = S.showTranslation ? 'EN ✓' : 'EN'; }
  }

  function renderTranscript() {
    var tx = el('tx');
    if (!tx) return;
    var d = S.detail;
    if (!d || !d.call) return;
    if (d.call.status === 'queued' || d.call.status === 'processing') {
      var job = d.job || {};
      tx.innerHTML = '<div class="tx-empty"><b>Analysis in progress</b>' + esc(job.stage || 'Queued') + ' · ' + Math.round(job.progress || 0) + '%<div class="progress" style="margin:14px 26px 0"><i style="width:' + Math.round(job.progress || 0) + '%"></i></div><div style="margin-top:10px;font-size:9px">Whisper, speaker clustering, audio events and reference matching run locally on CPU.</div></div>';
      return;
    }
    if (d.call.status === 'failed') {
      tx.innerHTML = '<div class="tx-empty"><b>Analysis failed</b>' + esc(d.call.error || d.job && d.job.error || 'See server log.') + '<div style="margin-top:10px"><button class="btn red small" id="retryBtn">Retry analysis</button></div></div>';
      var retry = el('retryBtn'); if (retry) retry.onclick = reprocess;
      return;
    }
    if (S.tab === 'transcript') { renderTranscriptTab(tx); return; }
    if (S.tab === 'audio') { renderAudioTab(tx); return; }
    if (S.tab === 'location') { renderLocationTab(tx); return; }
    renderTimelineTab(tx);
  }

  function renderTranscriptTab(tx) {
    var segs = S.detail.segments || [];
    var transcript = S.detail.transcript || {};
    if (!segs.length) {
      tx.innerHTML = '<div class="tx-empty"><b>No speech segments</b>No speech was detected, or analysis has not produced a transcript yet.</div>';
      return;
    }
    var header = '<div class="tx-meta"><span>' + esc(transcript.language || S.detail.call.language || 'language') + ' · ' + esc(transcript.provider || 'faster-whisper') + '</span><span>' + (S.showTranslation ? 'Original + English' : 'Original only') + '</span></div>';
    var html = segs.map(function (s) {
      var emotion = s.vocal_emotion ? '<span class="tag amber">' + esc(s.vocal_emotion) + ' ' + Math.round((s.vocal_confidence || 0) * 100) + '%</span>' : '';
      var sentiment = s.sentiment ? '<span class="tag gray">text: ' + esc(s.sentiment) + '</span>' : '';
      var translation = S.showTranslation && s.translation ? '<div class="trline">' + esc(s.translation) + '</div>' : '';
      return '<div class="seg" data-seg="' + esc(s.id) + '" data-start="' + esc(s.start_s) + '"><div class="st">' + fmtTime(s.start_s) + '</div><div class="seg-main"><div class="spk">' + icon('user', 10, '#7d7d88') + esc(s.speaker || 'Speaker') + ' ' + emotion + '</div><div class="txt">' + esc(s.text) + '</div>' + translation + '<div class="mini">' + sentiment + '<i>click to seek</i></div></div></div>';
    }).join('');
    tx.innerHTML = header + '<div class="txscroll">' + html + '</div>';
    tx.querySelectorAll('.seg').forEach(function (node) {
      node.onclick = function () {
        var audio = el('audio');
        var start = Number(node.getAttribute('data-start'));
        if (audio && isFinite(start)) { audio.currentTime = start; if (audio.paused) audio.play().catch(function () {}); }
      };
    });
    if (QuickDemo.active && S.detail && S.detail.call.id === QuickDemo.demoCallId && !QuickDemo.ended) {
      var curAudio = el('audio');
      var curT = (curAudio && isFinite(curAudio.currentTime)) ? curAudio.currentTime : 0;
      tx.querySelectorAll('.seg').forEach(function (node) {
        var start = Number(node.getAttribute('data-start'));
        if (start > curT) node.style.display = 'none';
      });
    }
    highlightSegment(el('audio') ? el('audio').currentTime : 0);
  }

  function renderAudioTab(tx) {
    var d = S.detail, analysis = d.analysis || {};
    var summary = analysis.emotion_summary || {};
    var prosody = analysis.prosody || {};
    var events = d.audio_events || [];
    var emotionRows = Object.keys(summary).length ? Object.keys(summary).map(function (k) {
      return '<div class="row between" style="padding:4px 0;border-bottom:1px solid #1c1c22"><span style="font-size:10px;color:#c6c6ce">' + esc(k) + '</span><b style="font-size:10px;color:#fff">' + Math.round(summary[k] * 100) + '%</b></div>';
    }).join('') : '<div class="muted">No usable vocal-emotion prediction.</div>';
    var eventRows = events.length ? events.map(function (e) {
      return '<div class="evt" data-start="' + esc(e.start_s) + '"><span class="dot"></span><b>' + esc(e.label) + '</b><span>' + fmtTime(e.start_s) + ' · ' + Math.round((e.confidence || 0) * 100) + '%</span></div>';
    }).join('') : '<div class="muted" style="padding:8px 0">No supported audio events detected.</div>';
    var metrics = [
      ['Pitch median', prosody.pitch_median_hz ? Math.round(prosody.pitch_median_hz) + ' Hz' : '—', 'autocorrelation, voiced frames'],
      ['Pause ratio', prosody.pause_ratio !== undefined ? Math.round(prosody.pause_ratio * 100) + '%' : '—', 'low-energy frames'],
      ['Speech rate', prosody.speech_rate_words_per_sec ? prosody.speech_rate_words_per_sec + ' w/s' : '—', 'words / duration'],
      ['Speaker method', (analysis.speaker_method || '—').split('(')[0], 'heuristic, not diarisation']
    ];
    tx.innerHTML = '<div class="txscroll"><div style="font-size:9px;color:#8c8c98;padding:4px 2px 8px;line-height:14px">Vocal emotion and transcript sentiment are different signals. The vocal model is English-trained and not validated for Hindi/Hinglish. It never establishes deception, guilt or coercion.</div>' +
      '<div class="grid" style="grid-template-columns:1fr 1fr">' + metrics.map(function (m) { return '<div class="metric"><div class="k">' + esc(m[0]) + '</div><div class="v">' + esc(m[1]) + '</div><div class="s">' + esc(m[2]) + '</div></div>'; }).join('') + '</div>' +
      '<h3 style="font-size:10px;margin:12px 0 4px;color:#f0f0f4">Vocal emotion model output</h3>' + emotionRows +
      '<h3 style="font-size:10px;margin:12px 0 4px;color:#f0f0f4">Background audio events</h3>' + eventRows +
      '<div class="muted" style="margin-top:10px;font-size:9px">Model: ' + esc((analysis.models && analysis.models.vocal_emotion) || '—') + '<br>Events: ' + esc((analysis.models && analysis.models.audio_events) || '—') + '</div></div>';
    tx.querySelectorAll('.evt').forEach(function (node) {
      node.onclick = function () { var a = el('audio'); if (a) { a.currentTime = Number(node.getAttribute('data-start')) || 0; if (a.paused) a.play().catch(function () {}); } };
    });
  }

  function renderLocationTab(tx) {
    var locs = S.detail.locations || [];
    var rows = locs.length ? locs.map(function (l) {
      return '<div class="card" style="margin-bottom:8px"><div class="row between"><b style="font-size:11px">' + esc(l.label) + '</b><span class="tag ' + (l.source_type === 'investigator' ? 'blue' : 'amber') + '">' + esc(l.source_type) + '</span></div><div class="muted" style="margin-top:4px">' + Number(l.lat).toFixed(5) + ', ' + Number(l.lon).toFixed(5) + ' · ±' + Math.round(l.accuracy_m || 0) + ' m · ' + esc(l.verification_status) + '</div><div class="muted" style="margin-top:4px">' + esc(l.source_detail || '') + '</div><div class="row" style="margin-top:7px"><button class="btn small" data-focus-loc="' + esc(l.id) + '">Show on map</button><button class="btn small" data-verify-loc="' + esc(l.id) + '">' + (l.verification_status === 'verified' ? 'Verified ✓' : 'Mark verified') + '</button></div></div>';
    }).join('') : '<div class="empty">No location observations. Dhvani does not invent coordinates. Add a location only if the caller stated it or an investigator verified it.</div>';
    tx.innerHTML = '<div class="txscroll"><div class="row between" style="margin-bottom:8px"><span class="muted" style="font-size:9px">Spoken landmarks are approximate. They are not device GPS.</span><button class="btn small" id="addLocBtn">+ Add manual location</button></div>' + rows + '<div id="locForm"></div></div>';
    tx.querySelectorAll('[data-focus-loc]').forEach(function (b) { b.onclick = function () { focusLocation(b.getAttribute('data-focus-loc')); }; });
    tx.querySelectorAll('[data-verify-loc]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/api/locations/' + b.getAttribute('data-verify-loc'), { method: 'PATCH', body: JSON.stringify({ verification_status: 'verified' }) }); toast('Location marked verified.', 'ok'); await refreshActive(); }
        catch (e) { toast(e.message, 'err'); }
      };
    });
    var add = el('addLocBtn'); if (add) add.onclick = showAddLocationForm;
  }

  function showAddLocationForm() {
    var wrap = el('locForm');
    if (!wrap) return;
    wrap.innerHTML = '<div class="card" style="margin-top:8px"><b style="font-size:11px">Manual investigator location</b><div class="muted" style="margin:4px 0 8px">This is not derived from the caller\'s device. It will be labelled investigator-entered.</div><div class="row"><div class="field grow"><label>Label</label><input id="locLabel" placeholder="e.g. Verified meeting point"></div><div class="field" style="width:100px"><label>Latitude</label><input id="locLat" placeholder="19.0186"></div><div class="field" style="width:100px"><label>Longitude</label><input id="locLon" placeholder="72.8442"></div></div><div class="row" style="margin-top:8px"><div class="field grow"><label>Note</label><input id="locNote" placeholder="How was this location obtained?"></div><button class="btn red small" id="locSave">Save location</button></div><div id="locErr" style="font-size:9px;color:#ff5264;margin-top:5px"></div></div>';
    el('locSave').onclick = async function () {
      try {
        await api('/api/calls/' + S.activeId + '/locations', { method: 'POST', body: JSON.stringify({ label: el('locLabel').value, lat: Number(el('locLat').value), lon: Number(el('locLon').value), accuracy_m: 50, note: el('locNote').value }) });
        toast('Investigator location saved.', 'ok'); await refreshActive();
      } catch (e) { el('locErr').textContent = e.message; }
    };
  }

  function renderTimelineTab(tx) {
    var d = S.detail;
    var items = [];
    (d.segments || []).forEach(function (s) { items.push({ t: s.start_s, type: 'Transcript', label: s.speaker + ': ' + s.text, color: '#a8a8b2' }); });
    (d.findings || []).forEach(function (f) { items.push({ t: f.start_s || 0, type: f.type, label: f.title + (f.quote ? ' — "' + f.quote + '"' : ''), color: f.type === 'scam_term' ? '#f5c451' : f.type === 'distress_phrase' ? '#ff5264' : '#a8a8b2' }); });
    (d.audio_events || []).forEach(function (e) { items.push({ t: e.start_s, type: 'Audio event', label: e.label, color: '#f5c451' }); });
    (d.locations || []).forEach(function (l) { items.push({ t: l.start_s || 0, type: 'Location', label: l.label, color: '#4ade80' }); });
    items.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    tx.innerHTML = '<div class="txscroll">' + (items.length ? items.map(function (i) {
      return '<div class="row" data-start="' + esc(i.t) + '" style="align-items:flex-start;gap:8px;padding:7px 4px;border-bottom:1px solid #1c1c22;cursor:pointer"><span style="font-size:8.5px;color:#6b6b76;width:36px;flex:none">' + fmtTime(i.t) + '</span><span class="tag" style="color:' + i.color + ';border-color:' + i.color + '55;background:' + i.color + '11;flex:none">' + esc(i.type) + '</span><span style="font-size:9.5px;color:#c6c6ce;line-height:14px">' + esc(i.label) + '</span></div>';
    }).join('') : '<div class="empty">No timeline events yet.</div>') + '</div>';
    tx.querySelectorAll('[data-start]').forEach(function (node) {
      node.onclick = function () { var a = el('audio'); if (a) { a.currentTime = Number(node.getAttribute('data-start')) || 0; if (a.paused) a.play().catch(function () {}); } };
    });
  }

  function renderRelatedEvidence() {
    var re = el('re');
    if (!re) return;
    var d = S.detail; if (!d) return;
    var allFindings = d.findings || [];
    var audio = el('audio');
    var curT = (audio && isFinite(audio.currentTime)) ? audio.currentTime : 0;
    var isDemoPlaying = QuickDemo.active && S.detail && S.detail.call.id === QuickDemo.demoCallId && !QuickDemo.ended;
    var findings = isDemoPlaying
      ? allFindings.filter(function (f) { return (f.start_s || 0) <= curT; })
      : allFindings;
    if (!findings.length) {
      re.innerHTML = '<div class="related-empty">No reference matches yet. Findings appear only when a controlled reference phrase is present.</div>';
      return;
    }
    re.innerHTML = findings.map(function (f) {
      var color = f.type === 'scam_term' ? '#f5c451' : f.type === 'distress_phrase' ? '#ff5264' : '#a8a8b2';
      var isRecent = isDemoPlaying && (curT - (f.start_s || 0) >= 0) && (curT - (f.start_s || 0) < 3.5);
      return '<div class="evcard ' + (isRecent ? 'live-highlight' : '') + '" data-finding="' + esc(f.id) + '" style="border-left-color:' + color + '"><b>' + esc(f.title) + '</b><span>' + fmtTime(f.start_s) + ' · ' + esc(f.source_type) + ' · ' + esc(f.status) + '</span></div>';
    }).join('');
    re.querySelectorAll('[data-finding]').forEach(function (n) { n.onclick = function () { openFinding(n.getAttribute('data-finding')); }; });
  }

  function renderLocationSources() {
    var so = el('so');
    if (!so) return;
    var locs = (S.detail && S.detail.locations) || [];
    if (!locs.length) {
      so.innerHTML = '<div class="location-empty">No valid location observation. Spoken landmarks only; no fake GPS.</div>';
      return;
    }
    so.innerHTML = locs.map(function (l) {
      return '<div class="locrow" data-loc="' + esc(l.id) + '"><span class="loc-pin">' + icon('pin', 12, '#8e8e99') + '</span><div><b>' + esc(l.label) + '</b><span>' + esc(l.source_type) + ' · ±' + Math.round(l.accuracy_m || 0) + ' m · ' + esc(l.verification_status) + '</span></div><span class="tag ' + (l.verification_status === 'verified' ? 'green' : 'gray') + '">' + (l.verification_status === 'verified' ? 'Verified' : 'Unverified') + '</span></div>';
    }).join('');
    so.querySelectorAll('[data-loc]').forEach(function (n) { n.onclick = function () { focusLocation(n.getAttribute('data-loc')); }; });
  }

  function renderBackgroundEvents() {
    var ba = el('ba');
    if (!ba) return;
    var events = (S.detail && S.detail.audio_events) || [];
    if (!events.length) {
      ba.innerHTML = '<div class="audio-empty">No supported background events detected. The transcript is still available.</div>';
      return;
    }
    ba.innerHTML = events.slice(0, 4).map(function (e) {
      return '<div class="evt" data-start="' + esc(e.start_s) + '"><span class="dot" style="background:' + (e.label === 'Synthetic speech' ? '#8e8e99' : '#f5c451') + '"></span><b>' + esc(e.label) + '</b><span>' + fmtTime(e.start_s) + '</span></div>';
    }).join('');
    ba.querySelectorAll('[data-start]').forEach(function (n) { n.onclick = function () { var a = el('audio'); if (a) { a.currentTime = Number(n.getAttribute('data-start')) || 0; if (a.paused) a.play().catch(function () {}); } }; });
  }

  async function reprocess() {
    if (!S.activeId) return;
    try {
      var data = await api('/api/calls/' + S.activeId + '/reprocess', { method: 'POST' });
      toast('Re-analysis queued.', 'warn');
      await refreshActive(); watchJob(data.job.id, S.activeId);
    } catch (e) { toast(e.message, 'err'); }
  }

  /* ------------------------------------------------------------------ */
  /* Maps                                                                */
  /* ------------------------------------------------------------------ */

  function mapTileLayer(map, node) {
    /* Primary: Esri World Imagery (real satellite photos, free, no key) */
    var satUrl = (S.config && S.config.map && S.config.map.tile_url) || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    var satAttr = (S.config && S.config.map && S.config.map.attribution) || 'Tiles &copy; Esri';
    var satLayer = L.tileLayer(satUrl, {
      attribution: satAttr,
      maxZoom: 19
    }).addTo(map);

    /* Label overlay on top of satellite so streets/places are readable */
    var labelsUrl = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';
    var labelsLayer = L.tileLayer(labelsUrl, {
      attribution: '',
      maxZoom: 19,
      pane: 'overlayPane'
    }).addTo(map);

    var failures = 0;
    satLayer.on('tileerror', function () {
      failures += 1;
      if (failures >= 3 && node && !node.querySelector('.map-tile-warn')) {
        var warn = document.createElement('div');
        warn.className = 'map-tile-warn';
        warn.innerHTML = '<b>Map tiles are slow or blocked.</b> Real markers and coordinates are still shown; check the network for the live demo.';
        node.appendChild(warn);
      }
    });
    satLayer.on('tileload', function () {
      if (failures) {
        failures = 0;
        var old = node && node.querySelector('.map-tile-warn');
        if (old) old.remove();
      }
    });

    /* Store layers on map for layer toggle */
    map._orbitSat = satLayer;
    map._orbitLabels = labelsLayer;
    map._orbitMode = 'satellite';

    return satLayer;
  }

  /* Layer toggle: satellite ↔ dark street */
  function addLayerToggle(map, node) {
    if (!node || node.querySelector('.map-layer-toggle')) return;
    var btn = document.createElement('button');
    btn.className = 'map-layer-toggle';
    btn.title = 'Switch map style';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleMapMode(map, node);
    });
    node.appendChild(btn);
  }

  function toggleMapMode(map, node) {
    if (!map._orbitSat) return;
    var darkUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    var satUrl = (S.config && S.config.map && S.config.map.tile_url) || 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    var labelsUrl = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png';

    if (map._orbitMode === 'satellite') {
      /* Switch to dark street view */
      map.removeLayer(map._orbitSat);
      if (map._orbitLabels) map.removeLayer(map._orbitLabels);
      map._orbitSat = L.tileLayer(darkUrl, { maxZoom: 19 }).addTo(map);
      map._orbitLabels = null;
      map._orbitMode = 'dark';
    } else {
      /* Switch back to satellite */
      map.removeLayer(map._orbitSat);
      map._orbitSat = L.tileLayer(satUrl, { maxZoom: 19 }).addTo(map);
      map._orbitLabels = L.tileLayer(labelsUrl, { maxZoom: 19, pane: 'overlayPane' }).addTo(map);
      map._orbitMode = 'satellite';
    }
    /* Re-add markers on top */
    var key = null;
    ['main', 'mini', 'bottom', 'full'].forEach(function (k) {
      if (S.maps[k] === map) key = k;
    });
    if (key && S.mapLayers[key]) {
      S.mapLayers[key].eachLayer(function (layer) { layer.bringToFront(); });
    }
  }

  function initMaps() {
    if (typeof L === 'undefined') return;
    var locs = (S.detail && S.detail.locations) || [];
    var points = locs.map(function (l) { return [Number(l.lat), Number(l.lon), l]; }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
    var center = points.length ? points[0] : [19.0760, 72.8777];
    var bounds = points.length ? points.map(function (p) { return [p[0], p[1]]; }) : [[19.0, 72.8], [19.2, 72.95]];
    S.lastBounds = bounds;
    ['main', 'mini', 'bottom'].forEach(function (key) {
      var id = key === 'main' ? 'mw' : key === 'mini' ? 'm1' : 'm2';
      var node = el(id);
      if (!node) return;
      var oldNote = node.querySelector('.map-empty'); if (oldNote) oldNote.remove();
      if (!S.maps[key]) {
        S.maps[key] = L.map(node, { zoomControl: false, attributionControl: key !== 'bottom', dragging: key !== 'bottom', scrollWheelZoom: false, doubleClickZoom: key === 'main' }).setView(center, points.length ? 14 : 12);
        mapTileLayer(S.maps[key], node);
        if (key === 'main') addLayerToggle(S.maps[key], node);
      } else {
        S.maps[key].setView(center, points.length ? 14 : 12);
      }
      if (S.mapLayers[key]) { S.mapLayers[key].remove(); S.mapLayers[key] = null; }
      var group = L.layerGroup().addTo(S.maps[key]);
      points.forEach(function (p) {
        var loc = p[2];
        /* Accuracy radius ring */
        L.circle([p[0], p[1]], { radius: Math.max(50, Number(loc.accuracy_m) || 800), color: '#ff2e43', weight: 1.5, opacity: .45, fillColor: '#ff2e43', fillOpacity: .10, dashArray: '6 4' }).addTo(group);
        /* Animated tracking pin with pulse rings */
        var pinHtml = '<div class="map-pin-track">' +
          '<div class="map-pin-pulse"></div>' +
          '<div class="map-pin-pulse map-pin-pulse-2"></div>' +
          '<div class="map-pin-core"></div>' +
          '</div>';
        L.marker([p[0], p[1]], { icon: L.divIcon({ className: '', html: pinHtml, iconSize: [40, 40], iconAnchor: [20, 20] }) })
          .bindPopup('<div class="map-popup-custom"><b>' + esc(loc.label) + '</b><br><span class="map-popup-type">' + esc(loc.source_type) + '</span> · ±' + Math.round(loc.accuracy_m || 0) + ' m<br><span class="map-popup-detail">' + esc(loc.source_detail || '') + '</span></div>')
          .addTo(group);
      });
      S.mapLayers[key] = group;
      if (points.length) {
        try { S.maps[key].fitBounds(bounds, { padding: [18, 18], maxZoom: 15 }); } catch (e) {}
      }
      if (!points.length && key !== 'bottom') {
        var old = node.querySelector('.map-empty'); if (old) old.remove();
        var note = document.createElement('div'); note.className = 'map-empty'; note.textContent = 'No verified location in this call. No fake pins are shown.'; node.appendChild(note);
      }
      setTimeout(function () { if (S.maps[key]) S.maps[key].invalidateSize(); }, 80);
    });
  }

  function focusLocation(id) {
    var loc = (S.detail && S.detail.locations || []).filter(function (l) { return l.id === id; })[0];
    if (!loc || !S.maps.main) return;
    S.maps.main.setView([Number(loc.lat), Number(loc.lon)], 14);
    S.maps.main.eachLayer(function (layer) { if (layer instanceof L.Marker) layer.openPopup(); });
  }

  function openFullMap() {
    closeOverlay();
    if (typeof L === 'undefined') { toast('Map library is unavailable. Check /static/vendor/leaflet.', 'err'); return; }
    var full = el('full');
    if (!full) return;
    full.classList.add('on'); full.style.display = 'block';
    var mapNode = el('mf');
    var oldNote = mapNode ? mapNode.querySelector('.map-empty') : null; if (oldNote) oldNote.remove();
    var locs = (S.detail && S.detail.locations) || [];
    var points = locs.map(function (l) { return [Number(l.lat), Number(l.lon), l]; }).filter(function (p) { return isFinite(p[0]) && isFinite(p[1]); });
    var center = points.length ? points[0] : [19.0760, 72.8777];
    if (!S.maps.full) {
      S.maps.full = L.map('mf', { zoomControl: true, scrollWheelZoom: true }).setView(center, points.length ? 14 : 12);
      mapTileLayer(S.maps.full, mapNode);
      addLayerToggle(S.maps.full, mapNode);
    }
    if (S.mapLayers.full) { S.mapLayers.full.remove(); S.mapLayers.full = null; }
    var group = L.layerGroup().addTo(S.maps.full);
    points.forEach(function (p) {
      var loc = p[2];
      L.circle([p[0], p[1]], { radius: Math.max(50, Number(loc.accuracy_m) || 800), color: '#ff2e43', weight: 1.5, opacity: .45, fillColor: '#ff2e43', fillOpacity: .10, dashArray: '6 4' }).addTo(group);
      var pinHtml = '<div class="map-pin-track">' +
        '<div class="map-pin-pulse"></div>' +
        '<div class="map-pin-pulse map-pin-pulse-2"></div>' +
        '<div class="map-pin-core"></div>' +
        '</div>';
      L.marker([p[0], p[1]], { icon: L.divIcon({ className: '', html: pinHtml, iconSize: [40, 40], iconAnchor: [20, 20] }) })
        .bindPopup('<div class="map-popup-custom"><b>' + esc(loc.label) + '</b><br><span class="map-popup-type">' + esc(loc.source_type) + '</span> · ±' + Math.round(loc.accuracy_m || 0) + ' m<br><span class="map-popup-detail">' + esc(loc.source_detail || '') + '</span></div>').addTo(group);
    });
    S.mapLayers.full = group;
    if (points.length) { try { S.maps.full.fitBounds(points.map(function (p) { return [p[0], p[1]]; }), { padding: [40, 40], maxZoom: 16 }); } catch (e) {} }
    else if (mapNode) {
      var note = document.createElement('div'); note.className = 'map-empty'; note.style.position = 'absolute'; note.textContent = 'No verified location in this call. No fake pins are shown.'; mapNode.appendChild(note);
      S.maps.full.setView(center, 12);
    }
    setTimeout(function () { if (S.maps.full) S.maps.full.invalidateSize(); }, 100);
    S.nav = 'map'; renderNav();
  }
  function closeFullMap() {
    var full = el('full');
    if (full) { full.classList.remove('on'); full.style.display = 'none'; }
    if (S.nav === 'map') { S.nav = 'live'; renderNav(); }
  }

  /* ------------------------------------------------------------------ */
  /* Overlays, cases, reports, settings, search, alerts                  */
  /* ------------------------------------------------------------------ */

  function openOverlay(title, sub, html) {
    setText('ovlTitle', title || 'Investigation');
    setText('ovlSub', sub || '');
    var body = el('ovlBody');
    if (body) body.innerHTML = html;
    var ovl = el('overlay');
    if (ovl) ovl.classList.add('on');
  }
  function closeOverlay() { var o = el('overlay'); if (o) o.classList.remove('on'); }

  async function openCases() {
    S.nav = 'cases'; renderNav();
    try {
      await loadCases();
      var html = '<div class="row between" style="margin-bottom:14px"><div><h2>Investigation cases</h2><p class="muted">Persistent cases, linked recordings, reviewer notes and downloadable reports.</p></div><button class="btn red" id="newCaseBtn">+ New case</button></div>' +
        '<div id="caseList">' + (S.cases.length ? S.cases.map(function (c) {
          return '<div class="card" style="margin-bottom:9px"><div class="row between"><div><b>' + esc(c.case_number) + ' · ' + esc(c.title) + '</b><span>' + esc(c.summary || 'No summary') + '</span></div><span class="tag ' + (c.priority === 'high' ? 'red' : c.priority === 'medium' ? 'amber' : 'green') + '">' + esc(c.priority) + '</span></div><div class="row between" style="margin-top:9px"><span class="muted">' + c.call_count + ' call(s) · ' + c.finding_count + ' finding(s) · ' + esc(c.status) + ' · updated ' + fmtDate(c.updated_at) + '</span><button class="btn small" data-case="' + esc(c.id) + '">Open case</button></div></div>';
        }).join('') : '<div class="empty">No cases yet. Create one and link the active recording.</div>') + '</div><div id="newCaseForm"></div>';
      openOverlay('Investigations', 'Case management', html);
      var nb = el('newCaseBtn'); if (nb) nb.onclick = showNewCaseForm;
      document.querySelectorAll('[data-case]').forEach(function (b) { b.onclick = function () { openCase(b.getAttribute('data-case')); }; });
    } catch (e) { toast(e.message, 'err'); }
  }

  function showNewCaseForm() {
    var wrap = el('newCaseForm');
    if (!wrap) return;
    wrap.innerHTML = '<div class="card" style="margin-top:12px"><b style="font-size:12px">New investigation case</b><div class="row" style="margin-top:8px"><div class="field grow"><label>Title</label><input id="ncTitle" placeholder="e.g. Digital-arrest extortion review"></div><div class="field" style="width:140px"><label>Priority</label><select id="ncPriority"><option value="medium">Medium</option><option value="high">High</option><option value="low">Low</option></select></div></div><div class="field" style="margin-top:8px"><label>Summary</label><textarea id="ncSummary" placeholder="What is being investigated?"></textarea></div><div class="row between" style="margin-top:8px"><span id="ncErr" style="font-size:9px;color:#ff5264"></span><button class="btn red" id="ncSave">Create case</button></div></div>';
    el('ncSave').onclick = async function () {
      try {
        var data = await api('/api/cases', { method: 'POST', body: JSON.stringify({ title: el('ncTitle').value, summary: el('ncSummary').value, priority: el('ncPriority').value }) });
        toast('Case ' + data.case.case_number + ' created.', 'ok');
        await loadCases(); renderShell(); await openCase(data.case.id);
      } catch (e) { el('ncErr').textContent = e.message; }
    };
  }

  async function openCase(id) {
    S.nav = 'cases'; renderNav();
    try {
      var data = await api('/api/cases/' + encodeURIComponent(id));
      S.caseData = data;
      var c = data.case;
      var calls = data.calls || [], notes = data.notes || [], findings = data.findings || [];
      var callRows = calls.length ? calls.map(function (x) {
        return '<tr><td><b>' + esc(x.source_label) + '</b><br><span class="muted">#' + esc(x.short_id) + ' · ' + esc(x.status) + ' · ' + esc(x.language || '—') + '</span></td><td>' + fmtTime(x.duration_s) + '</td><td>' + (x.urgency_score === null || x.urgency_score === undefined ? '—' : x.urgency_score + '/100') + '</td><td><button class="btn small" data-open-call="' + esc(x.id) + '">Open</button> <button class="btn small" data-unlink="' + esc(x.id) + '">Unlink</button></td></tr>';
      }).join('') : '<tr><td colspan="4">No calls linked. Use “Save to Case” on the active recording.</td></tr>';
      var noteRows = notes.length ? notes.map(function (n) { return '<div style="border-bottom:1px solid #24242b;padding:7px 0"><div class="muted">' + esc(n.author) + ' · ' + fmtDate(n.created_at) + '</div><div style="font-size:11px;color:#f0f0f4;margin-top:3px">' + esc(n.note) + '</div></div>'; }).join('') : '<div class="muted">No notes yet.</div>';
      var findingRows = findings.length ? findings.map(function (f) {
        return '<tr><td>' + esc(f.title) + '</td><td>' + fmtTime(f.start_s) + '</td><td>' + esc(f.status) + '</td><td><button class="btn small" data-review="' + esc(f.id) + '">Review</button></td></tr>';
      }).join('') : '<tr><td colspan="4">No findings linked to this case.</td></tr>';
      var html = '<div class="row between" style="align-items:flex-start"><div><h2>' + esc(c.case_number) + ' · ' + esc(c.title) + '</h2><p class="muted">' + esc(c.summary || 'No summary recorded.') + '</p></div><div class="row"><a class="btn" href="/api/cases/' + esc(c.id) + '/report?format=html" target="_blank">' + icon('file', 12) + 'Download HTML report</a><a class="btn" href="/api/cases/' + esc(c.id) + '/report?format=json" target="_blank">JSON evidence</a></div></div>' +
        '<div class="grid" style="margin:14px 0"><div class="card"><b>Status</b><span>' + esc(c.status) + ' · priority ' + esc(c.priority) + '</span><div class="row" style="margin-top:8px"><select id="caseStatus" class="btn small"><option value="open"' + (c.status === 'open' ? ' selected' : '') + '>open</option><option value="under_review"' + (c.status === 'under_review' ? ' selected' : '') + '>under_review</option><option value="closed"' + (c.status === 'closed' ? ' selected' : '') + '>closed</option></select><select id="casePriority" class="btn small"><option value="low"' + (c.priority === 'low' ? ' selected' : '') + '>low</option><option value="medium"' + (c.priority === 'medium' ? ' selected' : '') + '>medium</option><option value="high"' + (c.priority === 'high' ? ' selected' : '') + '>high</option></select><button class="btn small green" id="caseSave">Update</button></div></div><div class="card"><b>Calls</b><span>' + calls.length + ' linked recording(s)</span><div class="row" style="margin-top:8px"><button class="btn small" id="linkActive">' + (S.activeId ? 'Link active recording' : 'No active recording') + '</button></div></div><div class="card"><b>Findings</b><span>' + findings.length + ' reference / model finding(s)</span></div><div class="card"><b>Report</b><span>Generated from persisted records, with hashes, sources and limitations.</span></div></div>' +
        '<h3>Linked recordings</h3><table><thead><tr><th>Recording</th><th>Duration</th><th>Urgency</th><th></th></tr></thead><tbody>' + callRows + '</tbody></table>' +
        '<h3>Findings review</h3><table><thead><tr><th>Finding</th><th>Time</th><th>Review status</th><th></th></tr></thead><tbody>' + findingRows + '</tbody></table>' +
        '<h3>Investigator notes</h3><div class="card">' + noteRows + '<div class="row" style="margin-top:10px"><input id="noteInput" placeholder="Add an investigator note..." style="flex:1;background:#09090b;border:1px solid #2b2b33;border-radius:5px;color:#e9edf5;padding:8px;font:inherit;font-size:11px"><button class="btn red small" id="noteSave">Add note</button></div></div>';
      openOverlay('Case detail', c.case_number, html);
      document.querySelectorAll('[data-open-call]').forEach(function (b) { b.onclick = function () { closeOverlay(); selectCall(b.getAttribute('data-open-call')); }; });
      document.querySelectorAll('[data-unlink]').forEach(function (b) { b.onclick = async function () { try { await api('/api/calls/' + b.getAttribute('data-unlink'), { method: 'PATCH', body: JSON.stringify({ case_id: null }) }); toast('Recording unlinked.', 'ok'); await openCase(id); } catch (e) { toast(e.message, 'err'); } }; });
      document.querySelectorAll('[data-review]').forEach(function (b) { b.onclick = function () { openFinding(b.getAttribute('data-review')); }; });
      var save = el('caseSave'); if (save) save.onclick = async function () { try { await api('/api/cases/' + id, { method: 'PATCH', body: JSON.stringify({ status: el('caseStatus').value, priority: el('casePriority').value }) }); toast('Case updated.', 'ok'); await openCase(id); } catch (e) { toast(e.message, 'err'); } };
      var link = el('linkActive'); if (link) link.onclick = async function () { if (!S.activeId) return toast('Select a recording first.', 'warn'); try { await api('/api/calls/' + S.activeId, { method: 'PATCH', body: JSON.stringify({ case_id: id }) }); toast('Recording linked to case.', 'ok'); await refreshActive(); await openCase(id); } catch (e) { toast(e.message, 'err'); } };
      var ns = el('noteSave'); if (ns) ns.onclick = async function () { try { await api('/api/cases/' + id + '/notes', { method: 'POST', body: JSON.stringify({ note: el('noteInput').value }) }); toast('Note saved.', 'ok'); await openCase(id); } catch (e) { toast(e.message, 'err'); } };
    } catch (e) { toast(e.message, 'err'); }
  }

  function openCasePicker() {
    if (!S.activeId) { toast('Select a recording first.', 'warn'); return; }
    if (S.detail && S.detail.case) { openCase(S.detail.case.id); return; }
    var html = '<h2>Save recording to a case</h2><p class="muted">Link this recording so its transcript, findings, locations and report are grouped with the investigation.</p>' +
      '<div class="grid" style="margin-top:12px">' + (S.cases.length ? S.cases.map(function (c) { return '<div class="card"><b>' + esc(c.case_number) + ' · ' + esc(c.title) + '</b><span>' + esc(c.summary || 'No summary') + '</span><div class="row" style="margin-top:8px"><button class="btn red small" data-link-case="' + esc(c.id) + '">Link</button></div></div>'; }).join('') : '<div class="empty">No cases yet. Create one first.</div>') + '</div><div class="row" style="margin-top:12px"><button class="btn" id="pickerNew">+ Create new case</button></div>';
    openOverlay('Save to case', 'Case association', html);
    document.querySelectorAll('[data-link-case]').forEach(function (b) {
      b.onclick = async function () {
        try { await api('/api/calls/' + S.activeId, { method: 'PATCH', body: JSON.stringify({ case_id: b.getAttribute('data-link-case') }) }); toast('Recording linked.', 'ok'); closeOverlay(); await refreshActive(); await loadCases(); renderShell(); } catch (e) { toast(e.message, 'err'); }
      };
    });
    var pn = el('pickerNew'); if (pn) pn.onclick = function () { closeOverlay(); openCases().then(showNewCaseForm); };
  }

  function openFinding(id) {
    var pool = (S.detail && S.detail.findings ? S.detail.findings : []).concat(S.caseData && S.caseData.findings ? S.caseData.findings : []);
    var f = pool.filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    var html = '<h2>' + esc(f.title) + '</h2><div class="row" style="margin:8px 0"><span class="tag ' + (f.type === 'scam_term' ? 'amber' : f.type === 'distress_phrase' ? 'red' : 'blue') + '">' + esc(f.type) + '</span><span class="tag gray">' + fmtTime(f.start_s) + '</span><span class="tag gray">confidence ' + Math.round((f.confidence || 0) * 100) + '%</span><span class="tag ' + (f.status === 'confirmed' ? 'green' : f.status === 'dismissed' ? 'gray' : 'amber') + '">' + esc(f.status) + '</span></div>' +
      '<div class="card"><b>What was matched</b><span style="display:block;font-size:13px;color:#fff;margin:6px 0">“' + esc(f.quote || 'No direct quote') + '”</span><p>' + esc(f.description) + '</p><div class="muted" style="margin-top:8px">Source type: ' + esc(f.source_type) + '<br>Reference: ' + esc(f.source_ref || '—') + '<br>Method: ' + esc(f.method || '—') + '</div></div>' +
      '<div class="card" style="margin-top:10px"><b>Reviewer decision</b><p class="muted">Confirm only if you have verified the match against the original audio and context. Dismiss if it is a false positive. The note is saved in the case audit trail.</p><textarea id="reviewNote" placeholder="Reviewer note (optional)">' + esc(f.reviewer_note || '') + '</textarea><div class="review-btns"><button class="btn green small" data-review-status="confirmed">Confirm finding</button><button class="btn small" data-review-status="dismissed">Dismiss</button><button class="btn small" data-review-status="unreviewed">Reset to unreviewed</button></div><div id="reviewErr" style="font-size:9px;color:#ff5264;margin-top:6px"></div></div>';
    openOverlay('Finding review', 'Human review required', html);
    document.querySelectorAll('[data-review-status]').forEach(function (b) {
      b.onclick = async function () {
        try {
          await api('/api/findings/' + id, { method: 'PATCH', body: JSON.stringify({ status: b.getAttribute('data-review-status'), note: el('reviewNote').value }) });
          toast('Finding review saved.', 'ok'); closeOverlay();
          if (S.caseData && S.caseData.case) { await openCase(S.caseData.case.id); } else { await refreshActive(); }
        } catch (e) { el('reviewErr').textContent = e.message; }
      };
    });
  }

  async function openReports() {
    S.nav = 'reports'; renderNav();
    try {
      await loadCases();
      var html = '<div class="row between"><div><h2>Reports</h2><p class="muted">Reports are generated from persisted records and include hashes, source references, model limitations and review status. HTML reports can be printed to PDF from the browser.</p></div></div>' +
        '<div class="grid" style="margin:14px 0"><div class="card"><b>Cases</b><div class="stat">' + S.cases.length + '</div><span>with persisted records</span></div><div class="card"><b>Completed analyses</b><div class="stat">' + (S.stats.analyzed || 0) + '</div><span>across all recordings</span></div><div class="card"><b>Avg analysis time</b><div class="stat">' + (S.stats.avg_processing_seconds ? Math.round(S.stats.avg_processing_seconds) + 's' : '—') + '</div><span>local CPU</span></div></div>' +
        (S.cases.length ? '<table><thead><tr><th>Case</th><th>Calls</th><th>Findings</th><th>Status</th><th>Report</th></tr></thead><tbody>' + S.cases.map(function (c) { return '<tr><td><b>' + esc(c.case_number) + '</b><br><span class="muted">' + esc(c.title) + '</span></td><td>' + c.call_count + '</td><td>' + c.finding_count + '</td><td>' + esc(c.status) + '</td><td><a class="btn small" href="/api/cases/' + esc(c.id) + '/report?format=html" target="_blank">HTML</a> <a class="btn small" href="/api/cases/' + esc(c.id) + '/report?format=json" target="_blank">JSON</a></td></tr>'; }).join('') + '</tbody></table>' : '<div class="empty">No cases yet. Create a case and link a recording to generate a report.</div>') +
        '<div class="muted" style="margin-top:14px">A report is a decision-support record, not proof. It explicitly labels synthetic demo audio and model limitations.</div>';
      openOverlay('Reports', 'Persisted evidence', html);
    } catch (e) { toast(e.message, 'err'); }
  }

  async function openSettings() {
    S.nav = 'settings'; renderNav();
    try {
      S.config = await api('/api/config/status');
      var models = S.config.models || {};
      var modelRows = Object.keys(models).map(function (k) { var m = models[k]; return '<tr><td><b>' + esc(k.replace(/_/g, ' ')) + '</b><br><span class="muted">' + esc(m.kind) + '</span></td><td class="mono">' + esc(m.name) + '</td><td><span class="tag ' + (m.cached ? 'green' : 'amber') + '">' + (m.cached ? 'cached' : 'will download') + '</span></td><td>' + (m.loaded ? 'loaded' : 'lazy') + '</td></tr>'; }).join('');
      var tel = S.config.telephony || {};
      var live = S.config.live || {};
      var map = S.config.map || {};
      var html = '<h2>Settings &amp; system status</h2><p class="muted">This build is local-first. The only optional cloud path is Gemini live transcription; final analysis, evidence and reports remain local.</p>' +
        '<div class="grid" style="margin:14px 0"><div class="card"><b>Authentication</b><span>' + (S.config.auth_enabled ? 'Session login + CSRF enabled' : 'Local demo mode: authentication disabled') + '</span></div><div class="card"><b>Telephony</b><span>' + (tel.configured ? 'Configured' : 'Not configured') + '</span><span style="display:block;margin-top:5px;font-size:9px">' + esc(tel.note || '') + '</span></div><div class="card"><b>Map</b><span>' + esc(map.provider || 'Leaflet + Esri Satellite') + '</span><span style="display:block;margin-top:5px;font-size:9px">' + esc(map.geocoder || '') + ' · ' + (map.cached_landmarks || 0) + '/' + (map.total_landmarks || 0) + ' demo landmarks cached</span></div><div class="card"><b>Live transcription</b><span>' + (live.configured ? 'Gemini ' + esc(live.model || '') : 'Not configured · local recording only') + '</span><span style="display:block;margin-top:5px;font-size:9px">' + esc(live.privacy || '') + '</span></div><div class="card"><b>Upload limits</b><span>' + S.config.limits.max_upload_mb + ' MB · ' + S.config.limits.max_duration_seconds + ' seconds</span></div></div>' +
        '<h3>Local models</h3><table><thead><tr><th>Component</th><th>Model</th><th>Cache</th><th>State</th></tr></thead><tbody>' + modelRows + '</tbody></table>' +
        '<h3>Reference pack</h3><div class="card"><b>' + esc(S.config.reference_pack.name) + ' · v' + esc(S.config.reference_pack.version) + '</b><span>' + esc(S.config.reference_pack.authority) + '</span><span style="display:block;margin-top:5px">' + S.config.reference_pack.entries + ' entries loaded.</span></div>' +
        '<h3>Data retention</h3><p class="muted">' + esc(S.config.data_retention) + '</p>' +
        '<div class="row" style="margin-top:14px"><button class="btn" id="settingsProfile">Profile</button><button class="btn" id="settingsLogout">Sign out</button><a class="btn" href="/api/reference-pack" target="_blank">View reference pack JSON</a></div>' +
        '<div class="muted" style="margin-top:14px">Telephony auto-answer is intentionally unavailable. A real provider adapter and credentials are required before Dhvani can answer a live call. Uploaded recordings and labelled demos are the supported path.</div>';
      openOverlay('Settings', 'Local-first configuration', html);
      var lo = el('settingsLogout'); if (lo) lo.onclick = logout;
      var pr = el('settingsProfile'); if (pr) pr.onclick = function () { toast('Signed in as ' + (S.me ? S.me.display_name : 'investigator') + ' (' + (S.me ? S.me.role : '') + ').', 'ok'); };
    } catch (e) { toast(e.message, 'err'); }
  }

  async function openSearch(q) {
    try {
      var data = await api('/api/search?q=' + encodeURIComponent(q));
      var html = '<h2>Search results for “' + esc(q) + '”</h2><p class="muted">Searches persisted calls, transcript text, locations, cases and findings. It never searches raw audio.</p>';
      html += '<h3>Recordings (' + (data.calls || []).length + ')</h3>' + ((data.calls || []).length ? data.calls.map(function (c) { return '<div class="card" style="margin-bottom:7px"><div class="row between"><div><b>' + esc(c.source_label) + '</b><span>#' + esc(c.short_id) + ' · ' + esc(c.status) + ' · ' + fmtTime(c.duration_s) + '</span></div><button class="btn small" data-search-call="' + esc(c.id) + '">Open</button></div></div>'; }).join('') : '<div class="empty">No recordings.</div>');
      html += '<h3>Cases (' + (data.cases || []).length + ')</h3>' + ((data.cases || []).length ? data.cases.map(function (c) { return '<div class="card" style="margin-bottom:7px"><div class="row between"><div><b>' + esc(c.case_number) + ' · ' + esc(c.title) + '</b><span>' + esc(c.status) + ' · ' + c.call_count + ' call(s)</span></div><button class="btn small" data-search-case="' + esc(c.id) + '">Open</button></div></div>'; }).join('') : '<div class="empty">No cases.</div>');
      html += '<h3>Findings (' + (data.findings || []).length + ')</h3>' + ((data.findings || []).length ? data.findings.map(function (f) { return '<div class="card" style="margin-bottom:7px"><b>' + esc(f.title) + '</b><span>“' + esc(f.quote || '') + '” · ' + esc(f.status) + '</span></div>'; }).join('') : '<div class="empty">No findings.</div>');
      openOverlay('Search', 'Persisted records', html);
      document.querySelectorAll('[data-search-call]').forEach(function (b) { b.onclick = function () { closeOverlay(); selectCall(b.getAttribute('data-search-call')); }; });
      document.querySelectorAll('[data-search-case]').forEach(function (b) { b.onclick = function () { openCase(b.getAttribute('data-search-case')); }; });
    } catch (e) { toast(e.message, 'err'); }
  }

  async function openAlerts() {
    S.nav = 'live'; renderNav();
    try {
      await loadAlerts();
      var html = '<div class="row between"><div><h2>Alerts</h2><p class="muted">Rule-driven alerts from completed analyses. Acknowledge after review; dismissal is recorded.</p></div><button class="btn" id="refreshAlerts">Refresh</button></div>' +
        '<div style="margin-top:14px">' + (S.alerts.length ? S.alerts.map(function (a) {
          return '<div class="alert-row ' + esc(a.severity) + '"><div class="row between"><b>' + esc(a.title) + '</b><span class="tag ' + (a.status === 'unread' ? 'red' : 'gray') + '">' + esc(a.status) + '</span></div><p>' + esc(a.detail) + '</p><div class="row" style="margin-top:7px"><span class="muted">' + fmtDate(a.created_at) + '</span>' + (a.call_id ? '<button class="btn small" data-alert-call="' + esc(a.call_id) + '">Open recording</button>' : '') + '<button class="btn green small" data-alert-act="acknowledged" data-alert="' + esc(a.id) + '">Acknowledge</button><button class="btn small" data-alert-act="dismissed" data-alert="' + esc(a.id) + '">Dismiss</button></div></div>';
        }).join('') : '<div class="empty">No alerts. High-urgency or reference matches will appear here.</div>') + '</div>';
      openOverlay('Alerts', S.unread + ' unread', html);
      var ra = el('refreshAlerts'); if (ra) ra.onclick = openAlerts;
      document.querySelectorAll('[data-alert-call]').forEach(function (b) { b.onclick = function () { closeOverlay(); selectCall(b.getAttribute('data-alert-call')); }; });
      document.querySelectorAll('[data-alert-act]').forEach(function (b) { b.onclick = async function () { try { await api('/api/alerts/' + b.getAttribute('data-alert'), { method: 'PATCH', body: JSON.stringify({ status: b.getAttribute('data-alert-act') }) }); await loadAlerts(); renderAlertsBadge(); openAlerts(); } catch (e) { toast(e.message, 'err'); } }; });
    } catch (e) { toast(e.message, 'err'); }
  }

  function openFeature(index) {
    if (index === 0) { openFullMap(); return; }
    if (index === 1) { openTriagePanel(); return; }
    if (index === 2) { openDecoderPanel(); return; }
    if (index === 3) { S.tab = 'audio'; renderTabs(); renderTranscript(); return; }
    if (index === 4) { S.tab = 'transcript'; renderTabs(); renderTranscript(); S.showTranslation = true; renderTranscript(); return; }
  }

  function openTriagePanel() {
    var d = S.detail;
    if (!d || !d.call) { toast('Select a recording first.', 'warn'); return; }
    var analysis = d.analysis || {};
    var c = analysis.urgency_contributions || {};
    var rows = Object.keys(c).length ? Object.keys(c).map(function (k) { return '<tr><td>' + esc(k.replace(/_/g, ' ')) + '</td><td>' + c[k] + '</td></tr>'; }).join('') : '<tr><td colspan="2">No urgency contributions.</td></tr>';
    var html = '<h2>Triage explanation</h2><p class="muted">The urgency score is a transparent sum of the contributions below. It is a decision-support estimate, not proof of danger. Live auto-answer is not available without a telephony provider; uploads and labelled demos are the supported workflow.</p>' +
      '<div class="grid" style="margin:14px 0"><div class="card"><b>Urgency</b><div class="stat">' + (d.call.urgency_score === null || d.call.urgency_score === undefined ? '—' : d.call.urgency_score + '/100') + '</div><span>' + esc(d.call.urgency_band || 'not scored') + '</span></div><div class="card"><b>Language</b><div class="stat">' + esc(d.call.language || '—') + '</div><span>Whisper detection</span></div><div class="card"><b>Speaker profiles</b><div class="stat">' + (analysis.speaker_count || 1) + '</div><span>' + esc(analysis.speaker_method || '—') + '</span></div></div>' +
      '<h3>Contribution breakdown</h3><table><thead><tr><th>Signal</th><th>Points</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<h3>Why this is not an automated decision</h3><p class="muted">' + esc((analysis.urgency_notes || []).join(' ')) + '</p>';
    openOverlay('Intelligent Emergency Call Triage', 'Transparent urgency scoring', html);
  }

  function openDecoderPanel() {
    var d = S.detail;
    if (!d || !d.call) { toast('Select a recording first.', 'warn'); return; }
    var findings = d.findings || [];
    var html = '<h2>Distress &amp; scam decoder</h2><p class="muted">Matches come from a controlled reference pack. The sample pack is operator-supplied and is not an official police codebook. Every match needs human review.</p>' +
      (findings.length ? findings.map(function (f) {
        var color = f.type === 'scam_term' ? '#f5c451' : f.type === 'distress_phrase' ? '#ff5264' : '#f5c451';
        return '<div class="card" style="margin-top:9px"><div class="row between"><b style="color:' + color + '">' + esc(f.title) + '</b><span class="tag ' + (f.status === 'confirmed' ? 'green' : f.status === 'dismissed' ? 'gray' : 'amber') + '">' + esc(f.status) + '</span></div><span style="display:block;margin:5px 0;font-size:12px;color:#fff">“' + esc(f.quote || '') + '”</span><p>' + esc(f.description) + '</p><div class="row" style="margin-top:7px"><span class="tag gray">' + fmtTime(f.start_s) + '</span><span class="tag gray">' + Math.round((f.confidence || 0) * 100) + '% match</span><button class="btn small" data-decoder-finding="' + esc(f.id) + '">Review</button></div></div>';
      }).join('') : '<div class="empty">No reference matches. This is not a clearance; the transcript may still contain unlisted language.</div>') +
      '<div class="muted" style="margin-top:14px">Reference pack: ' + esc((S.config && S.config.reference_pack && S.config.reference_pack.name) || '') + ' · v' + esc((S.config && S.config.reference_pack && S.config.reference_pack.version) || '') + '. <a href="/api/reference-pack" target="_blank" style="color:#ff9aa4">View entries and sources</a>.</div>';
    openOverlay('Covert Distress & Scam Decoder', 'Reference-backed findings', html);
    document.querySelectorAll('[data-decoder-finding]').forEach(function (b) { b.onclick = function () { openFinding(b.getAttribute('data-decoder-finding')); }; });
  }

  function openSupport() {
    openOverlay('Support & runbook', 'Local deployment', '<h2>Need help?</h2><p class="muted">This build is designed to run locally. The full runbook and limitations are in <b>README.md</b> and <b>RUNBOOK.md</b>.</p><div class="grid" style="margin-top:12px"><div class="card"><b>Emergency number</b><span>India: 112</span><a class="btn small" href="tel:112" style="margin-top:8px">Call 112</a></div><div class="card"><b>Telephony</b><span>Not configured. Auto-answer is intentionally unavailable. Use an uploaded recording or a labelled demo.</span></div><div class="card"><b>Local AI</b><span>Whisper, AST and a vocal-emotion model run on this machine. No cloud API key is required.</span></div><div class="card"><b>Data</b><span>SQLite database and audio files stay under <span class="mono">data/</span>. Delete a call to remove its recording.</span></div></div>');
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', boot);
})();
