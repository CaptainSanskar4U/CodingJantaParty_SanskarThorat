import React, { useState, useEffect } from 'react';
import { PhoneOff, Mic, MicOff, Volume2, Grid, Sparkles, MessageSquare } from 'lucide-react';

export function CallScreen({
  call,
  status, // 'ringing', 'connected', 'ended'
  onEndCall,
  isMuted,
  onToggleMute,
  audioLevel = 0,
  onSendSimulatedSpeech
}) {
  const [duration, setDuration] = useState(0);
  const [showSimulatedMenu, setShowSimulatedMenu] = useState(false);

  useEffect(() => {
    let timer = null;
    if (status === 'connected') {
      timer = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => clearInterval(timer);
  }, [status]);

  const fmtTimer = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const samplePhrases = [
    { label: "Pizza Order (Disguised)", text: "Hello, I would like to order a large pepperoni pizza to apartment 302." },
    { label: "Duress Clue", text: "Please send the pizza fast, there are two people here and I cannot leave." },
    { label: "Help Request", text: "Can you hear me? I need emergency assistance right away." },
    { label: "General Support", text: "Hi, I have a question regarding my account and billing." }
  ];

  return (
    <div className="flex flex-col h-full justify-between items-center py-8 px-6 text-white select-none">
      {/* Top Header */}
      <div className="flex flex-col items-center mt-6">
        <div className="relative mb-4">
          <div className={`w-24 h-24 rounded-full flex items-center justify-center font-bold text-3xl shadow-xl transition-all ${
            status === 'connected' ? 'bg-indigo-600 text-white' : 'bg-slate-700 text-slate-300 animate-pulse'
          }`}>
            {call?.extension || 'Ext'}
          </div>
          {status === 'connected' && (
            <div
              className="absolute -inset-1.5 rounded-full border-2 border-indigo-400 opacity-75 animate-ping pointer-events-none"
              style={{ animationDuration: `${Math.max(0.6, 2 - (audioLevel / 50))}s` }}
            />
          )}
        </div>

        <h2 className="text-2xl font-bold tracking-tight">Extension {call?.extension || '966'}</h2>
        
        <p className="text-sm font-medium mt-1 text-slate-300">
          {status === 'ringing' && (
            <span className="flex items-center gap-1.5 text-amber-400 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span> Calling / Ringing...
            </span>
          )}
          {status === 'connected' && (
            <span className="font-mono text-emerald-400 font-semibold tracking-wider">
              {fmtTimer(duration)}
            </span>
          )}
          {status === 'ended' && (
            <span className="text-rose-400 font-medium">Call Ended</span>
          )}
        </p>

        {status === 'connected' && (
          <div className="mt-3 flex items-center gap-1">
            <span className="text-[11px] text-slate-400">Live WebRTC Audio</span>
            <div className="flex items-center gap-0.5 ml-2 h-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="w-1 bg-emerald-400 rounded-full transition-all duration-75"
                  style={{
                    height: `${Math.max(3, (audioLevel / 100) * 14 * (i % 2 === 0 ? 0.7 : 1))}px`
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick Speech Simulator Bar (Helpful for fast testing on mobile or silent rooms) */}
      <div className="w-full max-w-[320px] my-auto">
        <div className="flex justify-between items-center mb-2 px-1">
          <button
            type="button"
            onClick={() => setShowSimulatedMenu(!showSimulatedMenu)}
            className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors mx-auto py-1 px-3 rounded-full bg-indigo-950/60 border border-indigo-800/40"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{showSimulatedMenu ? 'Hide Quick Voice Prompts' : 'Quick Voice Prompts'}</span>
          </button>
        </div>

        {showSimulatedMenu && (
          <div className="grid grid-cols-1 gap-2 p-3 bg-slate-900/90 rounded-2xl border border-slate-800 backdrop-blur-md animate-in fade-in zoom-in-95">
            <p className="text-[11px] text-slate-400 text-center mb-1">Tap a statement to simulate caller speech:</p>
            {samplePhrases.map((phrase, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  onSendSimulatedSpeech(phrase.text);
                  setShowSimulatedMenu(false);
                }}
                className="text-left text-xs bg-slate-800/80 hover:bg-slate-700 p-2.5 rounded-xl border border-slate-700/50 flex items-start gap-2 active:scale-95 transition-all"
              >
                <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-slate-200">{phrase.label}</div>
                  <div className="text-[11px] text-slate-400 line-clamp-1">{phrase.text}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* In-Call Controls */}
      <div className="w-full max-w-[280px] flex flex-col gap-6">
        <div className="grid grid-cols-3 gap-4">
          {/* Mute */}
          <button
            type="button"
            onClick={onToggleMute}
            className={`w-16 h-16 rounded-full flex flex-col items-center justify-center transition-all mx-auto ${
              isMuted ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/25' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
            <span className="text-[10px] mt-1 font-medium">{isMuted ? 'Muted' : 'Mute'}</span>
          </button>

          {/* Keypad */}
          <button
            type="button"
            className="w-16 h-16 rounded-full bg-slate-800 text-slate-200 hover:bg-slate-700 flex flex-col items-center justify-center transition-all mx-auto"
          >
            <Grid className="w-6 h-6" />
            <span className="text-[10px] mt-1 font-medium">Keypad</span>
          </button>

          {/* Speaker */}
          <button
            type="button"
            className="w-16 h-16 rounded-full bg-slate-800 text-slate-200 hover:bg-slate-700 flex flex-col items-center justify-center transition-all mx-auto"
          >
            <Volume2 className="w-6 h-6" />
            <span className="text-[10px] mt-1 font-medium">Speaker</span>
          </button>
        </div>

        {/* End Call Button */}
        <div className="flex justify-center mt-2">
          <button
            type="button"
            onClick={onEndCall}
            className="w-20 h-20 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white flex items-center justify-center shadow-xl shadow-rose-600/30 transition-all border-2 border-rose-400/20"
          >
            <PhoneOff className="w-8 h-8" />
          </button>
        </div>
      </div>
    </div>
  );
}

