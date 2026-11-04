import React, { useState } from 'react';
import { Smartphone, Wifi, Copy, Check, ExternalLink, QrCode } from 'lucide-react';

export function MobileConnectCard({ localIp, httpsPort, extension, onOpenDialerTab }) {
  const [copied, setCopied] = useState(false);
  const mobileUrl = `https://${localIp || 'localhost'}:${httpsPort || 3001}/dialer`;
  const httpUrl = `http://localhost:5173/dialer`;

  const handleCopy = () => {
    navigator.clipboard.writeText(mobileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-gradient-to-r from-indigo-950/40 via-slate-900 to-slate-900 border border-indigo-900/40 rounded-2xl p-4 sm:p-5 shadow-lg flex flex-col lg:flex-row items-center justify-between gap-4">
      {/* Left Info */}
      <div className="flex items-start gap-3.5">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
          <Smartphone className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white tracking-tight">Connect Smartphone over Local Wi-Fi</h3>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-800/40">
              Zero Cloud / Local Only
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1 max-w-xl leading-relaxed">
            Open the link on your mobile phone on the same Wi-Fi network, enter extension <strong className="text-emerald-400 font-mono text-sm">{extension}</strong>, and press Call. Or click the button to simulate a call directly in another tab!
          </p>
        </div>
      </div>

      {/* Right Action Buttons */}
      <div className="flex items-center gap-2.5 w-full lg:w-auto shrink-0 justify-end">
        {/* Copy Wi-Fi Link */}
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all active:scale-95 shadow-sm"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-indigo-400" />}
          <span>{copied ? 'Copied Link!' : 'Copy Wi-Fi URL'}</span>
        </button>

        {/* Open In New Tab (Same Machine Mode 2) */}
        <button
          type="button"
          onClick={onOpenDialerTab}
          className="flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/25 transition-all active:scale-95"
        >
          <ExternalLink className="w-4 h-4" />
          <span>Launch Phone in Tab</span>
        </button>
      </div>
    </div>
  );
}

