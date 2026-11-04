import React from 'react';
import { Phone, RefreshCw, Smartphone, BarChart3, Radio, Shield, Globe } from 'lucide-react';

export function Topbar({
  extension,
  onRegenerateExtension,
  stats,
  localIp,
  httpsPort,
  onOpenMobileDialer,
  onOpenStatsModal
}) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30 px-4 sm:px-6 py-3.5 flex items-center justify-between">
      {/* Brand & Status */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-blue-500 flex items-center justify-center text-white shadow-lg shadow-indigo-600/20">
          <Phone className="w-5 h-5 fill-current" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-white tracking-tight">VoicePulse</h1>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-950 text-indigo-300 border border-indigo-800/60 uppercase tracking-wider">
              Local AI Telephony
            </span>
          </div>
          <p className="text-[11px] text-slate-400">Real-Time Phone Simulation & Forensic Analysis</p>
        </div>
      </div>

      {/* Center: Dynamic Extension Banner */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 shadow-inner">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Radio className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
            <span>Active Extension:</span>
          </div>
          <span className="font-mono text-lg font-bold text-emerald-400 tracking-wider">
            {extension || '---'}
          </span>
          <button
            type="button"
            onClick={onRegenerateExtension}
            title="Generate new random extension"
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-all active:scale-95 ml-1"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-3">
        {/* Local Wi-Fi Info */}
        <div className="hidden lg:flex items-center gap-2 text-xs text-slate-400 bg-slate-900/60 px-3 py-1.5 rounded-lg border border-slate-800/60">
          <Globe className="w-3.5 h-3.5 text-blue-400" />
          <span>Wi-Fi IP: <strong className="text-slate-200 font-mono">{localIp || '127.0.0.1'}</strong></span>
        </div>

        {/* Call Statistics Button */}
        <button
          type="button"
          onClick={onOpenStatsModal}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-300 bg-slate-900 hover:bg-slate-800 border border-slate-800 px-3 py-2 rounded-xl transition-all"
        >
          <BarChart3 className="w-4 h-4 text-indigo-400" />
          <span>Calls: <strong>{stats?.total || 0}</strong></span>
        </button>

        {/* Launch Mobile Dialer Button */}
        <button
          type="button"
          onClick={onOpenMobileDialer}
          className="flex items-center gap-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md shadow-indigo-600/20 px-3.5 py-2 rounded-xl transition-all active:scale-95"
        >
          <Smartphone className="w-4 h-4" />
          <span>Open Mobile Dialer</span>
        </button>
      </div>
    </header>
  );
}

