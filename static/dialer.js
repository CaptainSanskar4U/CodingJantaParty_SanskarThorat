(function () {
  'use strict';

  // DTMF Frequencies (Hz)
  var DTMF = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477],
    '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477],
    '*': [941, 1209], '0': [941, 1336], '#': [941, 1477]
  };

  var audioCtx = null;
  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    return audioCtx;
  }

  function playTone(digit) {
    if (!DTMF[digit]) return;
    try {
      var ctx = getAudioContext();
      var now = ctx.currentTime;
      var osc1 = ctx.createOscillator();
      var osc2 = ctx.createOscillator();
      var gain = ctx.createGain();

      osc1.frequency.value = DTMF[digit][0];
      osc2.frequency.value = DTMF[digit][1];
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc1.connect(gain); osc2.connect(gain);
      gain.connect(ctx.destination);
      osc1.start(now); osc2.start(now);
      osc1.stop(now + 0.12); osc2.stop(now + 0.12);
    } catch (e) {}
  }

  // State
  var dialedExt = '';
  var activeCall = null;
  var callTimer = null;
  var callDuration = 0;
  var pc = null;
  var localStream = null;
  var isMuted = false;
  var ws = null;
  var dialerId = 'dialer_' + Math.random().toString(36).slice(2, 9);
  var recognition = null;
  var recognitionLang = 'hi-IN';
  var speechRestartTimer = null;
  var recognitionErrorCount = 0;
  var visualizerActive = false;
  var lastLevelSentMs = 0;
  var pendingIce = [];
  // Server-side live ASR: the phone uploads its real mic audio so the control room always
  // gets transcripts + translation even if phone voice recognition or WebRTC hiccups.
  var callAudioRecorder = null;
  var callAudioChunks = [];
  var asrSendTimer = null;
  var asrSendBusy = false;
  var asrSaveQueued = false;
  var lastRecognitionResultAt = 0;
  var recognitionSilentFlag = false;
  var srWatchdogTimer = null;

  // DOM
  var dialScreen = document.getElementById('dialScreen');
  var incallScreen = document.getElementById('incallScreen');
  var dialNumber = document.getElementById('dialNumber');
  var dialError = document.getElementById('dialError');
  var btnCall = document.getElementById('btnCall');
  var btnBackspace = document.getElementById('btnBackspace');
  var incallAvatar = document.getElementById('incallAvatar');
  var incallTitle = document.getElementById('incallTitle');
  var incallStatus = document.getElementById('incallStatus');
  var btnMute = document.getElementById('btnMute');
  var btnSpeaker = document.getElementById('btnSpeaker');
  var isSpeakerMuted = false;
  var btnHangup = document.getElementById('btnHangup');
  var statusBarTime = document.getElementById('statusBarTime');
  var micStatus = document.getElementById('micStatus');
  var micStatusText = document.getElementById('micStatusText');
  var audioWaveBars = document.getElementById('audioWaveBars');
  var remoteAudioEl = document.getElementById('remoteAudio');

  function updateClock() {
    var d = new Date();
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    if (statusBarTime) statusBarTime.textContent = h + ':' + m;
  }
  updateClock();
  setInterval(updateClock, 10000);

  // Keypad clicks
  document.querySelectorAll('.key-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var key = btn.getAttribute('data-key');
      playTone(key);
      if (dialedExt.length < 8) {
        dialedExt += key;
        renderDialed();
      }
    });
  });

  if (btnBackspace) {
    btnBackspace.addEventListener('click', function () {
      dialedExt = dialedExt.slice(0, -1);
      renderDialed();
    });
  }

  function renderDialed() {
    if (dialError) dialError.textContent = '';
    if (dialedExt) {
      dialNumber.textContent = dialedExt;
      dialNumber.style.color = '#fff';
    } else {
      dialNumber.innerHTML = '<span style="color:#4a4d60; font-weight:400">Dial Ext</span>';
    }
  }

  // WebSocket Connection
  function initWebSocket() {
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var wsUrl = proto + '//' + window.location.host + '/ws/telephony';
    ws = new WebSocket(wsUrl);

    ws.onopen = function () {
      console.log('[Dialer WS] Connected');
      ws.send(JSON.stringify({ type: 'dialer_register', dialer_id: dialerId }));
    };

    ws.onmessage = function (ev) {
      try {
        var msg = JSON.parse(ev.data);
        handleServerMessage(msg);
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = function () {
      console.warn('[Dialer WS] Disconnected. Reconnecting in 2s...');
      setTimeout(initWebSocket, 2000);
    };
  }

  function handleServerMessage(msg) {
    console.log('[Dialer Received]:', msg.type, msg);
    if (msg.type === 'call_ringing') {
      activeCall = msg.call;
      showIncall(msg.call.extension, 'Calling…');
    } else if (msg.type === 'call_connected') {
      activeCall = msg.call;
      showConnected();
      setupWebRTC(true);
      startSpeechRecognition();
    } else if (msg.type === 'call_transferred') {
      if (incallStatus) {
        incallStatus.textContent = 'Transferred · Hold for Secondary Desk';
        incallStatus.classList.remove('connected');
      }
      if (micStatusText) micStatusText.textContent = 'Connecting to Secondary Dispatch...';
      setTimeout(function () {
        endCallUI('Transferred to Officer Patel');
      }, 3500);
    } else if (msg.type === 'call_rejected') {
      endCallUI('Call Declined by Operator');
    } else if (msg.type === 'operator_speech') {
      if (micStatusText) {
        var opText = (msg.translation && msg.translation.translated_text) || msg.text || '';
        micStatusText.textContent = 'Control Room: "' + opText.slice(0, 36) + '…"';
        micStatusText.style.color = '#38bdf8';
        try { if (navigator.vibrate) navigator.vibrate([30, 50, 30]); } catch (e) {}
        setTimeout(function () {
          if (micStatusText) micStatusText.style.color = '';
        }, 4000);
      }
    } else if (msg.type === 'call_ended') {
      endCallUI('Call Ended');
    } else if (msg.type === 'call_error') {
      if (dialError) dialError.textContent = msg.message;
      endCallUI();
    } else if (msg.type === 'webrtc_answer') {
      if (pc && pc.signalingState !== 'closed') {
        pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).then(function () {
          console.log('[WebRTC Dialer] Remote description set');
          // Flush buffered candidates that arrived before the remote description
          var pending = pendingIce.slice();
          pendingIce = [];
          pending.forEach(function (cand) {
            try { pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
          });
        }).catch(console.warn);
      }
    } else if (msg.type === 'webrtc_ice_candidate') {
      if (msg.candidate && pc && pc.signalingState !== 'closed') {
        if (pc.remoteDescription) {
          try { pc.addIceCandidate(new RTCIceCandidate(msg.candidate)); } catch (e) {}
        } else {
          pendingIce.push(msg.candidate);
        }
      }
    }
  }

  // Call Button Click
  if (btnCall) {
    btnCall.addEventListener('click', function () {
      // Unlock audio context on user gesture
      getAudioContext();
      if (remoteAudioEl) {
        remoteAudioEl.play().catch(function () {});
      }

      if (!dialedExt) {
        if (dialError) dialError.textContent = 'Enter an extension (e.g. 966)';
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        if (dialError) dialError.textContent = 'Connecting to telephony server…';
        return;
      }
      ws.send(JSON.stringify({
        type: 'dial_extension',
        extension: dialedExt.trim(),
        caller_name: 'Mobile Smartphone',
        dialer_id: dialerId
      }));
    });
  }

  function showIncall(ext, statusText) {
    dialScreen.style.display = 'none';
    incallScreen.style.display = 'flex';
    incallAvatar.textContent = ext;
    incallAvatar.classList.add('calling');
    incallTitle.textContent = 'Extension ' + ext;
    incallStatus.textContent = statusText || 'Calling…';
    incallStatus.classList.remove('connected');
    if (audioWaveBars) audioWaveBars.style.display = 'none';
    if (micStatusText) micStatusText.textContent = 'Connecting Audio…';
  }

  function showConnected() {
    incallStatus.textContent = '00:00';
    incallStatus.classList.add('connected');
    incallAvatar.classList.remove('calling');
    if (audioWaveBars) audioWaveBars.style.display = 'flex';
    if (micStatusText) micStatusText.textContent = '2-Way Audio Live';
    callDuration = 0;
    clearInterval(callTimer);
    callTimer = setInterval(function () {
      callDuration++;
      var m = String(Math.floor(callDuration / 60)).padStart(2, '0');
      var s = String(callDuration % 60).padStart(2, '0');
      incallStatus.textContent = m + ':' + s;
    }, 1000);
  }

  function endCallUI(statusNotice) {
    clearInterval(callTimer);
    stopSpeechRecognition();
    if (statusNotice && incallStatus) {
      incallStatus.textContent = statusNotice;
      incallStatus.classList.remove('connected');
    }
    if (audioWaveBars) audioWaveBars.style.display = 'none';
    if (micStatusText) micStatusText.textContent = 'Call Ended';
    closeWebRTC();
    setTimeout(function () {
      dialScreen.style.display = 'flex';
      incallScreen.style.display = 'none';
      activeCall = null;
      renderDialed();
    }, 1600);
  }

  if (btnHangup) {
    btnHangup.addEventListener('click', function () {
      if (activeCall && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'end_call',
          call_id: activeCall.id,
          ended_by: 'caller'
        }));
      }
      endCallUI('Call Ended');
    });
  }

  if (btnMute) {
    btnMute.addEventListener('click', function () {
      isMuted = !isMuted;
      btnMute.classList.toggle('active', isMuted);
      if (localStream) {
        localStream.getAudioTracks().forEach(function (t) { t.enabled = !isMuted; });
      }
      if (isMuted) {
        if (micStatusText) micStatusText.textContent = 'Muted';
        stopSpeechRecognition();
      } else {
        if (micStatusText) micStatusText.textContent = '2-Way Audio Live';
        startSpeechRecognition();
      }
    });
  }

  if (btnSpeaker) {
    btnSpeaker.addEventListener('click', function () {
      isSpeakerMuted = !isSpeakerMuted;
      btnSpeaker.classList.toggle('active', isSpeakerMuted);
      btnSpeaker.textContent = isSpeakerMuted ? '🔇' : '🔊';
      if (remoteAudioEl) remoteAudioEl.muted = isSpeakerMuted;
      var a = document.getElementById('remoteAudio');
      if (a) a.muted = isSpeakerMuted;
      if (micStatusText) {
        micStatusText.textContent = isSpeakerMuted ? 'Speaker Muted (Silent)' : 'Speaker Active';
        setTimeout(function () {
          if (micStatusText && activeCall) micStatusText.textContent = '2-Way Audio Live';
        }, 1500);
      }
    });
  }

  // Quick Speech Phrase Buttons
  document.querySelectorAll('.phrase-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var phrase = chip.getAttribute('data-phrase');
      if (phrase && activeCall && ws && ws.readyState === WebSocket.OPEN) {
        try { if (navigator.vibrate) navigator.vibrate(40); } catch (e) {}
        ws.send(JSON.stringify({
          type: 'transcript_utterance',
          call_id: activeCall.id,
          speaker: 'caller',
          text: phrase
        }));
        chip.style.borderColor = '#10b981';
        chip.style.transform = 'scale(0.97)';
        if (micStatusText) micStatusText.textContent = 'Transmitted: "' + phrase.slice(0, 24) + '…"';
        setTimeout(function () {
          chip.style.borderColor = '';
          chip.style.transform = '';
          if (micStatusText && micStatusText.textContent.indexOf('Transmitted') !== -1) {
            micStatusText.textContent = '2-Way Audio Live';
          }
        }, 800);
      } else if (!activeCall) {
        if (dialError) dialError.textContent = 'Connect call first to transmit speech';
      }
    });
  });

  // Continuous Native Speech Recognition on Phone
  function startSpeechRecognition() {
    var SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn('SpeechRecognition API not available in this browser');
      return;
    }
    stopSpeechRestartTimer();
    try {
      if (recognition) {
        try { recognition.onend = null; recognition.stop(); } catch (e) {}
        recognition = null;
      }
      recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = recognitionLang;

      recognition.onresult = function (ev) {
        recognitionErrorCount = 0;
        lastRecognitionResultAt = Date.now();
        if (recognitionSilentFlag) {
          // Speech resumed after the "not hearing" hint - restore normal status
          recognitionSilentFlag = false;
          if (micStatusText) micStatusText.textContent = '2-Way Audio Live';
        }
        var interimText = '';
        for (var i = ev.resultIndex; i < ev.results.length; ++i) {
          var chunk = ev.results[i][0].transcript.trim();
          if (ev.results[i].isFinal) {
            var text = chunk.replace(/\s+/g, ' ');
            if (text && activeCall && ws && ws.readyState === WebSocket.OPEN) {
              console.log('[Phone Voice Transcribed] (' + recognitionLang + '):', text);
              ws.send(JSON.stringify({
                type: 'transcript_utterance',
                call_id: activeCall.id,
                speaker: 'caller',
                text: text,
                lang: recognitionLang
              }));
            }
          } else {
            interimText = (interimText + ' ' + chunk).trim();
          }
        }
        if (interimText && activeCall && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'transcript_utterance',
            call_id: activeCall.id,
            speaker: 'caller',
            text: interimText.slice(-160),
            lang: recognitionLang,
            interim: true
          }));
        }
      };

      recognition.onerror = function (e) {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          console.warn('[Dialer] Speech recognition permission blocked. Mic audio continues, no transcript.');
          if (micStatusText) micStatusText.textContent = 'Voice transcript blocked · audio still live';
          stopSpeechRecognition();
        } else if (e.error === 'not-found') {
          console.warn('[Dialer] Speech recognition language not supported on this device:', recognitionLang);
          if (micStatusText) micStatusText.textContent = 'Language not supported · try another';
          stopSpeechRecognition();
        } else if (e.error === 'audio-capture') {
          console.warn('[Dialer] Speech recognition cannot capture mic (busy). Retrying…');
          if (micStatusText && activeCall) micStatusText.textContent = 'Mic busy · audio live';
        } else {
          recognitionErrorCount++;
          if (recognitionErrorCount > 6 && recognition) {
            console.warn('[Dialer] Speech recognition failing repeatedly - stopping auto-restart.');
            stopSpeechRecognition();
          }
        }
      };

      recognition.onend = function () {
        if (activeCall && !isMuted && recognition) {
          speechRestartTimer = setTimeout(function () {
            if (activeCall && !isMuted && ws && ws.readyState === WebSocket.OPEN && recognition) {
              try { recognition.start(); } catch (e) {}
            }
          }, 350);
        }
      };

      recognition.start();
      console.log('[Dialer] Continuous speech recognition started (' + recognitionLang + ')');
      clearInterval(srWatchdogTimer);
      lastRecognitionResultAt = Date.now();
      recognitionSilentFlag = false;
      srWatchdogTimer = setInterval(function () {
        if (!activeCall || isMuted || !recognition) {
          clearInterval(srWatchdogTimer);
          srWatchdogTimer = null;
          return;
        }
        if (Date.now() - lastRecognitionResultAt > 8000 && !recognitionSilentFlag) {
          recognitionSilentFlag = true;
          if (micStatusText) micStatusText.textContent = '🎙 Not catching speech · server transcript active';
          console.warn('[Dialer] No speech results for 8s while recognition is running');
        }
      }, 2000);
    } catch (e) {
      console.warn('Failed to start speech recognition:', e);
    }
  }

  function stopSpeechRestartTimer() {
    if (speechRestartTimer) {
      clearTimeout(speechRestartTimer);
      speechRestartTimer = null;
    }
  }

  function stopSpeechRecognition() {
    stopSpeechRestartTimer();
    clearInterval(srWatchdogTimer);
    srWatchdogTimer = null;
    recognitionSilentFlag = false;
    if (recognition) {
      try { recognition.onend = null; recognition.stop(); } catch (e) {}
      recognition = null;
    }
  }

  function setRecognitionLanguage(lang, label) {
    recognitionLang = lang || 'hi-IN';
    console.log('[Dialer] Speech recognition language set to', recognitionLang);
    if (micStatusText) {
      micStatusText.textContent = 'Listening in ' + (label || recognitionLang);
      setTimeout(function () {
        if (micStatusText && activeCall && micStatusText.textContent.indexOf('Listening in') !== -1) {
          micStatusText.textContent = '2-Way Audio Live';
        }
      }, 1200);
    }
    if (activeCall && !isMuted) startSpeechRecognition();
  }

  var callLangSelect = document.getElementById('callLanguageSelect');
  if (callLangSelect) {
    var defaultLang = callLangSelect.value || 'hi-IN';
    recognitionLang = defaultLang;
    callLangSelect.addEventListener('change', function () {
      var opt = callLangSelect.options[callLangSelect.selectedIndex];
      setRecognitionLanguage(callLangSelect.value, opt ? opt.text.split('·')[0].trim() : callLangSelect.value);
    });
  }

  // ------------------------------------------------------------------
  // Server-ASR mic recorder: records the caller's mic, uploads cumulative
  // audio every ~10 s (server transcribes only the new tail), and saves
  // the recording at call end as a fallback when console WebRTC fails.
  // ------------------------------------------------------------------
  function startCallMicRecorder() {
    if (!window.MediaRecorder || !localStream || callAudioRecorder) return;
    try {
      callAudioChunks = [];
      var mime = '';
      if (typeof MediaRecorder.isTypeSupported === 'function') {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mime = 'audio/webm;codecs=opus';
        else if (MediaRecorder.isTypeSupported('audio/webm')) mime = 'audio/webm';
      }
      callAudioRecorder = new MediaRecorder(localStream, mime ? { mimeType: mime } : {});
      callAudioRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) callAudioChunks.push(e.data);
      };
      callAudioRecorder.start(250);
      console.log('[Server-ASR] Mic recorder started on phone');
      // Steady ~10 s upload cadence; first upload comes sooner so short calls still transcript
      clearTimeout(asrSendTimer);
      asrSendTimer = setInterval(sendMicChunkForASR, 10000);
      setTimeout(sendMicChunkForASR, 6000);
    } catch (err) {
      console.warn('[Server-ASR] Mic recorder unavailable:', err);
    }
  }

  function sendMicChunkForASR() {
    if (asrSendBusy || !activeCall || !callAudioChunks.length || !callAudioRecorder) return;
    if (callAudioRecorder.state !== 'recording') return;
    asrSendBusy = true;
    var callId = activeCall.id;
    var blob = null;
    try {
      blob = new Blob(callAudioChunks, { type: callAudioRecorder.mimeType || 'audio/webm' });
    } catch (e) { asrSendBusy = false; return; }
    if (!blob || blob.size < 4000) { asrSendBusy = false; return; }

    var fd = new FormData();
    fd.append('call_id', callId);
    fd.append('audio', blob, callId + '.webm');
    fetch('/api/telephony/live_transcribe', { method: 'POST', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data && data.ok && data.text) {
          console.log('[Server-ASR] Server heard:', data.text);
          if (micStatusText) {
            micStatusText.textContent = 'Server heard: "' + data.text.slice(0, 26) + (data.text.length > 26 ? '…' : '') + '"';
            setTimeout(function () {
              if (micStatusText && micStatusText.textContent.indexOf('Server heard') !== -1) {
                micStatusText.textContent = '2-Way Audio Live';
              }
            }, 1600);
          }
        } else if (data && data.ok === false) {
          console.warn('[Server-ASR] Chunk failed:', data.error);
        }
      })
      .catch(function (e) { console.warn('[Server-ASR] Upload error:', e); })
      .finally(function () { asrSendBusy = false; });
  }

  function stopCallMicRecorder() {
    clearTimeout(asrSendTimer);
    asrSendTimer = null;
    if (!callAudioRecorder) return;

    var recorder = callAudioRecorder;
    callAudioRecorder = null;

    if (asrSaveQueued) return; // a save upload is already in flight
    var flushSave = function (finalBlob) {
      asrSaveQueued = true;
      var callId = activeCall ? activeCall.id : null;
      if (!callId || !finalBlob || finalBlob.size < 4000) {
        callAudioChunks = [];
        asrSaveQueued = false;
        return;
      }
      var fd2 = new FormData();
      fd2.append('call_id', callId);
      fd2.append('audio', finalBlob, callId + '_phone.webm');
      fd2.append('skip_if_saved', '1'); // console recording wins when it already saved
      fetch('/api/telephony/save_recording', { method: 'POST', body: fd2 })
        .then(function () {
          console.log('[Server-ASR] Phone-side call recording backed up to server');
        })
        .catch(function (e) { console.warn('[Server-ASR] Recording backup failed:', e); })
        .finally(function () {
          callAudioChunks = [];
          asrSaveQueued = false;
        });
    };

    var buildBlob = function () {
      try {
        return new Blob(callAudioChunks, { type: recorder.mimeType || 'audio/webm' });
      } catch (e) {
        return null;
      }
    };

    if (recorder.state && recorder.state !== 'inactive') {
      recorder.onstop = function () {
        flushSave(buildBlob());
      };
      recorder.stop(); // final ondataavailable fires into callAudioChunks before onstop
    } else {
      flushSave(buildBlob());
    }
  }

  // Visualizer for Caller Voice Waves (+ live mic-level telemetry to the console)
  function startVisualizer(stream) {
    if (visualizerActive) return;
    try {
      var ctx = getAudioContext();
      var source = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      var dataArray = new Uint8Array(analyser.frequencyBinCount);
      var bars = document.querySelectorAll('#audioWaveBars span');
      visualizerActive = true;

      function renderFrame() {
        if (!visualizerActive) return;
        analyser.getByteFrequencyData(dataArray);
        var sum = 0, peak = 0;
        for (var j = 0; j < dataArray.length; j++) {
          sum += dataArray[j];
          if (dataArray[j] > peak) peak = dataArray[j];
        }
        var avg = dataArray.length ? sum / dataArray.length : 0;
        // Smoothed 0..1 voice level streamed to the control-room console (throttled to ~5/s)
        var level = Math.min(1, (avg / 255) * 1.9 + (peak / 255) * 0.2);
        var now = Date.now();
        if (now - lastLevelSentMs > 180) {
          lastLevelSentMs = now;
          if (activeCall && ws && ws.readyState === WebSocket.OPEN && !isMuted) {
            ws.send(JSON.stringify({
              type: 'audio_level',
              call_id: activeCall.id,
              level: Math.round(level * 100) / 100,
              ts: now
            }));
          }
        }
        bars.forEach(function (bar, idx) {
          var val = dataArray[idx % dataArray.length] || 0;
          var h = Math.max(4, Math.min(26, (val / 255) * 34));
          if (val < 8) h = 5 + Math.abs(Math.sin(now / 420 + idx * 0.9)) * 3; // subtle idle motion
          bar.style.height = h + 'px';
        });
        requestAnimationFrame(renderFrame);
      }
      renderFrame();
    } catch (e) {
      console.warn('Visualizer error:', e);
    }
  }

  // WebRTC Audio
  async function setupWebRTC(isCaller) {
    try {
      pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      // Request Phone Microphone
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: { ideal: true },
              noiseSuppression: { ideal: true },
              autoGainControl: { ideal: true },
              googEchoCancellation: true,
              googAutoGainControl: true,
              googNoiseSuppression: true,
              googHighpassFilter: true
            },
            video: false
          });
          localStream.getTracks().forEach(function (track) {
            pc.addTrack(track, localStream);
          });
          startVisualizer(localStream);
          startCallMicRecorder();
          if (micStatusText) micStatusText.textContent = 'Phone Mic Active';
        } catch (err) {
          console.warn('Microphone permission denied or unavailable:', err.message);
          if (micStatusText) micStatusText.textContent = 'Mic Inactive (Tap prompts)';
        }
      } else {
        console.warn('navigator.mediaDevices.getUserMedia not available (Check HTTPS)');
        if (micStatusText) micStatusText.textContent = 'Use HTTPS for Mic';
      }

      pc.onicecandidate = function (ev) {
        if (ev.candidate && ws && ws.readyState === WebSocket.OPEN && activeCall) {
          ws.send(JSON.stringify({
            type: 'webrtc_ice_candidate',
            call_id: activeCall.id,
            candidate: ev.candidate,
            dialer_id: dialerId
          }));
        }
      };

      pc.ontrack = function (ev) {
        console.log('[WebRTC Dialer] Received remote operator audio stream');
        var audio = remoteAudioEl || document.getElementById('remoteAudio');
        if (!audio) {
          audio = new Audio();
          audio.id = 'remoteAudio';
          audio.autoplay = true;
          audio.playsInline = true;
          document.body.appendChild(audio);
        }
        audio.volume = 0.70;
        audio.muted = isSpeakerMuted;
        audio.srcObject = ev.streams[0];
        audio.play().catch(function (e) {
          console.warn('Remote audio autoplay blocked:', e);
        });

        // Acoustic Safety Feedback Limiter via DynamicsCompressorNode
        try {
          var ctx = getAudioContext();
          var srcNode = ctx.createMediaStreamSource(ev.streams[0]);
          var comp = ctx.createDynamicsCompressor();
          comp.threshold.setValueAtTime(-18, ctx.currentTime);
          comp.knee.setValueAtTime(8, ctx.currentTime);
          comp.ratio.setValueAtTime(20, ctx.currentTime);
          comp.attack.setValueAtTime(0.003, ctx.currentTime);
          comp.release.setValueAtTime(0.25, ctx.currentTime);
          srcNode.connect(comp);
          comp.connect(ctx.destination);
        } catch (e) {}
      };

      if (isCaller) {
        var offer = await pc.createOffer({ offerToReceiveAudio: true });
        await pc.setLocalDescription(offer);
        if (ws && ws.readyState === WebSocket.OPEN && activeCall) {
          ws.send(JSON.stringify({
            type: 'webrtc_offer',
            call_id: activeCall.id,
            sdp: offer,
            dialer_id: dialerId
          }));
        }
      }
    } catch (e) {
      console.warn('WebRTC error:', e);
    }
  }

  function closeWebRTC() {
    visualizerActive = false;
    lastLevelSentMs = 0;
    pendingIce = [];
    stopCallMicRecorder(); // stop the phone mic recorder + flush its call recording
    if (localStream) {
      localStream.getTracks().forEach(function (t) { t.stop(); });
      localStream = null;
    }
    if (pc) {
      try { pc.close(); } catch (e) {}
      pc = null;
    }
    if (remoteAudioEl) {
      remoteAudioEl.srcObject = null;
    }
  }

  initWebSocket();
})();
