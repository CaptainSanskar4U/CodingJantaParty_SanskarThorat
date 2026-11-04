import React, { useEffect } from 'react';
import { Phone, PhoneOff, Radio, Smartphone, AlertCircle } from 'lucide-react';
import { useAudioTone } from '../../hooks/useAudioTone';

export function IncomingCallModal({ call, onAnswer, onReject }) {
  const { startRingtone, stopRingtone } = useAudioTone();

  useEffect(() => {
    startRingtone();
    return () => stopRingtone();
  }, [startRingtone, stopRingtone]);

  const handleAnswerClick = () => {
    stopRingtone();
    onAnswer(call.id);
  };

  const handleRejectClick = () => {
    stopRingtone();
    onReject(call.id);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-slate-900 border-2 border-indigo-500/50 rounded-3xl shadow-2xl p-6 sm:p-8 flex flex-col items-center relative overflow-hidden text-center">
        {/* Pulsing ring background glow */}
        <div className="absolute -top-12 -left-12 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />
        <div className="absolute -bottom-12 -right-12 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none animate-pulse" />

        {/* Ringing Animation Avatar */}
        <div className="relative my-4">
          <div className="w-24 h-24 rounded-full bg-emerald-600/20 border-2 border-emerald-500 flex items-center justify-center text-emerald-400 z-10 relative shadow-xl shadow-emerald-500/20">
            <Phone className="w-10 h-10 fill-current animate-bounce" />
          </div>
          {/* Animated Ripples */}
          <div className="absolute inset-0 rounded-full border-2 border-emerald-400/60 animate-ping pointer-events-none" />
          <div className="absolute -inset-3 rounded-full border border-emerald-500/40 animate-pulse pointer-events-none" />
        </div>

        {/* Call Info */}
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-800/60 text-emerald-300 text-xs font-semibold uppercase tracking-wider mb-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
          Incoming Phone Call
        </div>

        <h2 className="text-2xl font-bold text-white tracking-tight">
          {call?.callerName || 'Mobile Smartphone'}
        </h2>
        
        <p className="text-sm text-slate-400 mt-1">
          Dialed Extension: <strong className="text-emerald-400 font-mono text-base">{call?.extension || '966'}</strong>
        </p>

        <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-indigo-400" /> WebRTC live audio connection ready
        </p>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-4 w-full mt-8">
          {/* Reject Call */}
          <button
            type="button"
            onClick={handleRejectClick}
            className="flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-2xl bg-slate-800 hover:bg-rose-950/80 text-slate-300 hover:text-rose-300 border border-slate-700/80 hover:border-rose-800/80 transition-all font-semibold text-sm active:scale-95 shadow-md"
          >
            <PhoneOff className="w-4 h-4 text-rose-400" />
            <span>Reject</span>
          </button>

          {/* Answer Call */}
          <button
            type="button"
            onClick={handleAnswerClick}
            className="flex items-center justify-center gap-2.5 py-3.5 px-6 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm transition-all active:scale-95 shadow-xl shadow-emerald-600/30 border border-emerald-400/40"
          >
            <Phone className="w-4 h-4 fill-current" />
            <span>Answer Call</span>
          </button>
        </div>
      </div>
    </div>
  );
}

