import React, { useState, useEffect } from 'react';
import { Phone, Delete, Wifi, Battery, Signal, ArrowLeft } from 'lucide-react';
import { Keypad } from './Keypad';
import { CallScreen } from './CallScreen';
import { useAudioTone } from '../../hooks/useAudioTone';
import { useWebRTC } from '../../hooks/useWebRTC';

export function MobileDialer({ socket, connected, onNavigateDashboard }) {
  const [extension, setExtension] = useState('');
  const [callState, setCallState] = useState('idle'); // idle, ringing, connected, ended
  const [activeCall, setActiveCall] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [currentTime, setCurrentTime] = useState('');

  const { playDtmf } = useAudioTone();

  // Clock in status bar
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    };
    updateTime();
    const interval = setInterval(updateTime, 10000);
    return () => clearInterval(interval);
  }, []);

  // WebRTC hook
  const { startCall, cleanup, toggleMute, isMuted, audioLevel } = useWebRTC({
    socket,
    callId: activeCall?.id,
    isInitiator: true,
    onTranscript: (t) => console.log('[Mobile STT]', t)
  });

  // Socket listeners for dialer lifecycle
  useEffect(() => {
    if (!socket) return;

    const handleCallRinging = ({ call }) => {
      setActiveCall(call);
      setCallState('ringing');
      setErrorMessage('');
    };

    const handleCallConnected = ({ call }) => {
      setActiveCall(call);
      setCallState('connected');
      startCall('caller');
    };

    const handleCallRejected = () => {
      setCallState('ended');
      cleanup();
      setTimeout(() => {
        setCallState('idle');
        setActiveCall(null);
      }, 2000);
    };

    const handleCallEnded = () => {
      setCallState('ended');
      cleanup();
      setTimeout(() => {
        setCallState('idle');
        setActiveCall(null);
      }, 2000);
    };

    const handleCallError = ({ message }) => {
      setErrorMessage(message);
      setCallState('idle');
      cleanup();
    };

    socket.on('call_ringing', handleCallRinging);
    socket.on('call_connected', handleCallConnected);
    socket.on('call_rejected', handleCallRejected);
    socket.on('call_ended', handleCallEnded);
    socket.on('call_cancelled', handleCallEnded);
    socket.on('call_error', handleCallError);

    return () => {
      socket.off('call_ringing', handleCallRinging);
      socket.off('call_connected', handleCallConnected);
      socket.off('call_rejected', handleCallRejected);
      socket.off('call_ended', handleCallEnded);
      socket.off('call_cancelled', handleCallEnded);
      socket.off('call_error', handleCallError);
    };
  }, [socket, startCall, cleanup]);

  const handleDigit = (digit) => {
    if (callState !== 'idle') return;
    playDtmf(digit);
    if (extension.length < 8) {
      setExtension(prev => prev + digit);
      setErrorMessage('');
    }
  };

  const handleBackspace = () => {
    setExtension(prev => prev.slice(0, -1));
    setErrorMessage('');
  };

  const handleInitiateCall = () => {
    if (!extension || extension.length < 2) {
      setErrorMessage('Please enter an extension (e.g. 966).');
      return;
    }
    setErrorMessage('');
    setCallState('ringing');
    socket.emit('dial_extension', {
      extension: extension.trim(),
      callerName: 'Mobile Smartphone'
    });
  };

  const handleEndCall = () => {
    if (activeCall) {
      socket.emit('end_call', { callId: activeCall.id, endedBy: 'caller' });
    } else {
      socket.emit('cancel_call', { callId: 'temp' });
    }
    cleanup();
    setCallState('ended');
    setTimeout(() => {
      setCallState('idle');
      setActiveCall(null);
    }, 1500);
  };

  const handleSimulatedSpeech = (text) => {
    if (activeCall && socket) {
      socket.emit('transcript_utterance', {
        callId: activeCall.id,
        speaker: 'caller',
        text,
        timestampMs: Date.now()
      });
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-3 sm:p-6 bg-slate-950 font-sans">
      {/* Top Helper Bar for Desktop Users */}
      <div className="w-full max-w-sm flex items-center justify-between mb-3 px-2">
        <button
          type="button"
          onClick={onNavigateDashboard}
          className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors py-1.5 px-3 rounded-lg bg-slate-900 border border-slate-800"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
        </button>
        <span className={`text-[11px] flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
          connected ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/40' : 'bg-rose-950/60 text-rose-400 border border-rose-800/40'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'}`} />
          {connected ? 'Local Wi-Fi Live' : 'Connecting...'}
        </span>
      </div>

      {/* Smartphone Device Frame */}
      <div className="w-full max-w-[360px] h-[720px] bg-slate-900 border-4 border-slate-800 rounded-[44px] shadow-2xl relative overflow-hidden flex flex-col justify-between">
        {/* Notch / Speaker bar */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-32 h-5 bg-black rounded-full z-20 flex items-center justify-center">
          <div className="w-12 h-1 bg-slate-800 rounded-full" />
        </div>

        {/* Status Bar */}
        <div className="pt-3 px-7 flex justify-between items-center text-xs text-slate-300 font-medium z-10 select-none">
          <span>{currentTime || '09:41'}</span>
          <div className="flex items-center gap-1.5">
            <Signal className="w-3.5 h-3.5" />
            <Wifi className="w-3.5 h-3.5" />
            <Battery className="w-4 h-4" />
          </div>
        </div>

        {/* Main Phone View */}
        {callState === 'idle' ? (
          <div className="flex flex-col flex-1 justify-between py-6 px-4">
            {/* Number Display */}
            <div className="flex flex-col items-center justify-center mt-6 min-h-[90px]">
              <div className="text-4xl font-semibold tracking-wider text-white h-12 flex items-center select-all">
                {extension || <span className="text-slate-600 font-light">Dial Extension</span>}
              </div>
              {errorMessage && (
                <p className="text-xs text-rose-400 font-medium mt-1 text-center px-4 animate-in fade-in">
                  {errorMessage}
                </p>
              )}
            </div>

            {/* Keypad */}
            <div className="my-auto">
              <Keypad onDigitPress={handleDigit} />
            </div>

            {/* Bottom Call Controls */}
            <div className="grid grid-cols-3 items-center max-w-[280px] mx-auto w-full mb-2">
              <div />
              {/* Green Call Button */}
              <button
                type="button"
                onClick={handleInitiateCall}
                className="w-18 h-18 sm:w-20 sm:h-20 rounded-full bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30 transition-all mx-auto border-2 border-emerald-400/30"
              >
                <Phone className="w-8 h-8 fill-current" />
              </button>
              {/* Backspace Button */}
              {extension && (
                <button
                  type="button"
                  onClick={handleBackspace}
                  className="w-12 h-12 rounded-full flex items-center justify-center text-slate-400 hover:text-white active:scale-90 transition-all mx-auto"
                >
                  <Delete className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>
        ) : (
          <CallScreen
            call={activeCall || { extension }}
            status={callState}
            onEndCall={handleEndCall}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            audioLevel={audioLevel}
            onSendSimulatedSpeech={handleSimulatedSpeech}
          />
        )}

        {/* Bottom Home Indicator Bar */}
        <div className="pb-2 flex justify-center">
          <div className="w-32 h-1 bg-slate-700/60 rounded-full" />
        </div>
      </div>
    </div>
  );
}

