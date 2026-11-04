import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebRTC({ socket, callId, isInitiator, onRemoteStream, onTranscript }) {
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const recognitionRef = useRef(null);
  const analyserRef = useRef(null);

  const [isMuted, setIsMuted] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micError, setMicError] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);

  // Initialize Speech Recognition if browser supports it
  const initSpeechRecognition = useCallback((speakerRole) => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.log('[STT] Web Speech API not supported in this browser; manual/audio pipeline available.');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const transcript = event.results[i][0].transcript.trim();
            if (transcript) {
              console.log(`[STT] (${speakerRole}):`, transcript);
              if (onTranscript) {
                onTranscript({ speaker: speakerRole, text: transcript });
              }
              if (socket && callId) {
                socket.emit('transcript_utterance', {
                  callId,
                  speaker: speakerRole,
                  text: transcript,
                  timestampMs: Date.now()
                });
              }
            }
          }
        }
      };

      rec.onerror = (err) => {
        console.warn('[STT] Recognition error:', err.error);
      };

      rec.onend = () => {
        // Automatically restart while call is active
        if (localStreamRef.current && recognitionRef.current) {
          try { rec.start(); } catch (e) {}
        }
      };

      recognitionRef.current = rec;
      rec.start();
      console.log(`[STT] Speech recognition started for ${speakerRole}`);
    } catch (e) {
      console.warn('[STT] Could not initialize speech recognition:', e.message);
    }
  }, [socket, callId, onTranscript]);

  // Setup Peer Connection
  const startCall = useCallback(async (speakerRole = 'caller') => {
    if (!socket || !callId) return;

    try {
      setMicError(null);
      // 1. Get user media (mic)
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        setMicActive(true);
      } catch (err) {
        console.warn('[WebRTC] Microphone permission denied or unavailable:', err.message);
        setMicError('Microphone unavailable. You can still use the simulated voice buttons.');
        // Create an empty silent audio stream so WebRTC connection can still complete
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const dst = ctx.createMediaStreamDestination();
        osc.connect(dst);
        osc.start();
        stream = dst.stream;
        localStreamRef.current = stream;
      }

      // Audio Analyser for visualizer
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const srcNode = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        srcNode.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const checkLevel = () => {
          if (!analyserRef.current) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
          const avg = sum / dataArray.length;
          setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
          requestAnimationFrame(checkLevel);
        };
        requestAnimationFrame(checkLevel);
      } catch (e) {}

      // 2. Setup RTCPeerConnection
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pcRef.current = pc;

      // Add local audio tracks
      stream.getTracks().forEach(track => pc.addTrack(track, stream));

      // Handle remote audio stream
      pc.ontrack = (event) => {
        console.log('[WebRTC] Received remote audio track!');
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
        }
        remoteAudioRef.current.srcObject = event.streams[0];
        if (onRemoteStream) onRemoteStream(event.streams[0]);
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('webrtc_ice_candidate', { callId, candidate: event.candidate });
        }
      };

      // 3. If initiator (caller), create and send offer
      if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.log('[WebRTC] Created and sent offer');
        socket.emit('webrtc_offer', { callId, sdp: offer });
      }

      // Start local speech recognition
      initSpeechRecognition(speakerRole);
    } catch (err) {
      console.error('[WebRTC] Setup error:', err);
    }
  }, [socket, callId, isInitiator, onRemoteStream, initSpeechRecognition]);

  // Socket signaling listeners
  useEffect(() => {
    if (!socket || !callId) return;

    const handleOffer = async ({ sdp }) => {
      console.log('[WebRTC] Received offer, creating answer');
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pcRef.current.createAnswer();
      await pcRef.current.setLocalDescription(answer);
      socket.emit('webrtc_answer', { callId, sdp: answer });
    };

    const handleAnswer = async ({ sdp }) => {
      console.log('[WebRTC] Received answer');
      if (!pcRef.current) return;
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
    };

    const handleIceCandidate = async ({ candidate }) => {
      if (!pcRef.current) return;
      try {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.warn('[WebRTC] Error adding ICE candidate:', e);
      }
    };

    socket.on('webrtc_offer', handleOffer);
    socket.on('webrtc_answer', handleAnswer);
    socket.on('webrtc_ice_candidate', handleIceCandidate);

    return () => {
      socket.off('webrtc_offer', handleOffer);
      socket.off('webrtc_answer', handleAnswer);
      socket.off('webrtc_ice_candidate', handleIceCandidate);
    };
  }, [socket, callId]);

  // Clean up on unmount or call end
  const cleanup = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    analyserRef.current = null;
    setMicActive(false);
    setAudioLevel(0);
  }, []);

  const toggleMute = () => {
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(t => {
        t.enabled = !t.enabled;
        setIsMuted(!t.enabled);
      });
    }
  };

  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  return {
    startCall,
    cleanup,
    toggleMute,
    isMuted,
    micActive,
    micError,
    audioLevel
  };
}

