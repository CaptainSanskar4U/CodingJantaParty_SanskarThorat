import React, { useState, useEffect } from 'react';
import { PhoneOff, Mic, MicOff, Volume2, Clock, Radio, Sparkles, MessageSquare } from 'lucide-react';

export function ActiveCallControls({
  call,
  onEndCall,
  isMuted,
  onToggleMute,
  audioLevel = 0,
  onOperatorSpeak
}) {
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      if (call?.answeredAt) {
        setDuration(Math.max(0, Math.round((Date.now() - call.answeredAt) / 1000)));
      } else {
        setDuration(prev => prev + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [call]);

  const fmtTimer = (s) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const operatorPhrases = [
    "Police Control Room, what is your emergency?",
    "Ma'am, is someone preventing you from speaking freely?",
    "Can you answer yes or no safely?",
    "What is your apartment and floor number?",
    "Officers are 3 minutes away from your location. Stay on the line."
  ];

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col md:flex-row items-center justify-between gap-4">
      {/* Left: Caller info & Timer */}
      <div className="flex items-center gap-4 w-full md:w-auto">
        <div className="w-12 h-12 rounded-2xl bg-emerald-950/80 border border-emerald-800/60 flex items-center justify-center text-emerald-400 relative shrink-0">
          <Radio className="w-6 h-6 animate-pulse" />
          <span className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full border-2 border-slate-900 animate-ping" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base font-bold text-white">{call?.callerName || 'Mobile Caller'}</h3>
            <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/40">
              Ext {call?.extension || '966'}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
            <span className="flex items-center gap-1 font-mono font-semibold text-emerald-300">
              <Clock className="w-3.5 h-3.5 text-emerald-400" /> {fmtTimer(duration)}
            </span>
            <span>•</span>
            <span className="text-slate-400">WebRTC Live Audio</span>
          </div>
        </div>
      </div>

      {/* Center: Live Audio Waveform Bars */}
      <div className="flex items-center gap-1 h-8 px-4 py-1.5 rounded-xl bg-slate-950/60 border border-slate-800 w-full md:w-auto justify-center">
        <span className="text-[11px] font-medium text-slate-500 mr-2">Audio</span>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
          <div
            key={i}
            className="w-1 bg-gradient-to-t from-emerald-500 to-indigo-400 rounded-full transition-all duration-75"
            style={{
              height: `${Math.max(4, (audioLevel / 100) * 26 * (i % 3 === 0 ? 0.9 : i % 2 === 0 ? 0.7 : 1))}px`
            }}
          />
        ))}
      </div>

      {/* Right Controls: Quick Operator Prompts, Mute & End Call */}
      <div className="flex items-center gap-3 w-full md:w-auto justify-end">
        {/* Quick Operator Voice Responses */}
        <div className="relative group">
          <button
            type="button"
            className="text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 px-3 py-2 rounded-xl border border-slate-700 flex items-center gap-1.5 transition-all"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>Operator Prompts</span>
          </button>
          
          {/* Dropdown Menu */}
          <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl p-2 hidden group-hover:block hover:block z-30">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
              Transmit Operator Voice
            </p>
            {operatorPhrases.map((phrase, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onOperatorSpeak(phrase)}
                className="w-full text-left text-xs text-slate-300 hover:text-white hover:bg-slate-800 p-2 rounded-lg transition-colors flex items-start gap-2"
              >
                <MessageSquare className="w-3.5 h-3.5 text-indigo-400 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{phrase}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Mute Toggle */}
        <button
          type="button"
          onClick={onToggleMute}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${
            isMuted ? 'bg-amber-500 text-white shadow-md shadow-amber-500/25' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
          }`}
        >
          {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          <span>{isMuted ? 'Muted' : 'Mute'}</span>
        </button>

        {/* End Call Button */}
        <button
          type="button"
          onClick={onEndCall}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 active:scale-95 text-white shadow-lg shadow-rose-600/25 transition-all"
        >
          <PhoneOff className="w-4 h-4" />
          <span>End Call</span>
        </button>
      </div>
    </div>
  );
}

