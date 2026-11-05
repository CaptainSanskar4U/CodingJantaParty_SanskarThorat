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
  var visualizerActive = false;

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
    } else if (msg.type === 'call_ended') {
      endCallUI('Call Ended');
    } else if (msg.type === 'call_error') {
      if (dialError) dialError.textContent = msg.message;
      endCallUI();
    } else if (msg.type === 'webrtc_answer') {
      if (pc && pc.signalingState !== 'closed') {
        pc.setRemoteDescription(new RTCSessionDescription(msg.sdp)).then(function () {
          console.log('[WebRTC Dialer] Remote description set');
        }).catch(console.warn);
      }
    } else if (msg.type === 'webrtc_ice_candidate') {
      if (pc && pc.signalingState !== 'closed' && msg.candidate) {
        pc.addIceCandidate(new RTCIceCandidate(msg.candidate)).catch(console.warn);
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

  // Quick Speech Phrase Buttons
  document.querySelectorAll('.phrase-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var phrase = chip.getAttribute('data-phrase');
      if (phrase && activeCall && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'transcript_utterance',
          call_id: activeCall.id,
          speaker: 'caller',
          text: phrase
        }));
        chip.style.borderColor = '#10b981';
        setTimeout(function () { chip.style.borderColor = ''; }, 600);
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
    try {
      if (recognition) {
        try { recognition.stop(); } catch (e) {}
      }
      recognition = new SpeechRec();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-IN';

      recognition.onresult = function (ev) {
        for (var i = ev.resultIndex; i < ev.results.length; ++i) {
          if (ev.results[i].isFinal) {
            var text = ev.results[i][0].transcript.trim();
            if (text && activeCall && ws && ws.readyState === WebSocket.OPEN) {
              console.log('[Phone Voice Transcribed]:', text);
              ws.send(JSON.stringify({
                type: 'transcript_utterance',
                call_id: activeCall.id,
                speaker: 'caller',
                text: text
              }));
            }
          }
        }
      };

      recognition.onerror = function (e) {
        console.warn('SpeechRecognition error:', e.error);
      };

      recognition.onend = function () {
        if (activeCall && !isMuted) {
          try { recognition.start(); } catch (e) {}
        }
      };

      recognition.start();
      console.log('[Dialer] Continuous speech recognition started');
    } catch (e) {
      console.warn('Failed to start speech recognition:', e);
    }
  }

  function stopSpeechRecognition() {
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
      recognition = null;
    }
  }

  // Visualizer for Caller Voice Waves
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
        if (!activeCall || !visualizerActive) return;
        analyser.getByteFrequencyData(dataArray);
        bars.forEach(function (bar, idx) {
          var val = dataArray[idx % dataArray.length] || 0;
          var h = Math.max(4, Math.min(26, (val / 255) * 30));
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
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          });
          localStream.getTracks().forEach(function (track) {
            pc.addTrack(track, localStream);
          });
          startVisualizer(localStream);
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
        audio.srcObject = ev.streams[0];
        audio.play().catch(function (e) {
          console.warn('Remote audio autoplay blocked:', e);
        });
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
