import { useRef, useEffect } from 'react';

// Standard DTMF Frequencies (Hz)
const DTMF_FREQS = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
};

export function useAudioTone() {
  const ctxRef = useRef(null);
  const ringIntervalRef = useRef(null);

  const getAudioContext = () => {
    if (!ctxRef.current) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        ctxRef.current = new AudioCtx();
      }
    }
    if (ctxRef.current && ctxRef.current.state === 'suspended') {
      ctxRef.current.resume();
    }
    return ctxRef.current;
  };

  // Play realistic DTMF phone touch tone
  const playDtmf = (digit, durationMs = 120) => {
    const ctx = getAudioContext();
    if (!ctx || !DTMF_FREQS[digit]) return;

    try {
      const [low, high] = DTMF_FREQS[digit];
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.frequency.setValueAtTime(low, now);
      osc2.frequency.setValueAtTime(high, now);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + durationMs / 1000);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + durationMs / 1000);
      osc2.stop(now + durationMs / 1000);
    } catch (e) {
      // AudioContext policy
    }
  };

  // Play Dashboard Ringtone (Electronic warble ring)
  const startRingtone = () => {
    stopRingtone();
    const ctx = getAudioContext();
    if (!ctx) return;

    const playBurst = () => {
      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        // Warble between 850Hz and 440Hz
        osc.frequency.setValueAtTime(850, now);
        osc.frequency.setValueAtTime(440, now + 0.1);
        osc.frequency.setValueAtTime(850, now + 0.2);
        osc.frequency.setValueAtTime(440, now + 0.3);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.6);
      } catch (e) {}
    };

    playBurst();
    ringIntervalRef.current = setInterval(playBurst, 2000);
  };

  const stopRingtone = () => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopRingtone();
  }, []);

  return { playDtmf, startRingtone, stopRingtone };
}

