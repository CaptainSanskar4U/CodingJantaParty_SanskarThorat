import React, { useState, useEffect } from 'react';
import { X, BarChart3, PhoneCall, PhoneOff, CheckCircle2, Clock, PhoneForwarded } from 'lucide-react';

export function CallStatsModal({ isOpen, onClose }) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;

    const fetchStats = async () => {
      try {
        setLoading(true);
        const [statsRes, historyRes] = await Promise.all([
          fetch('/api/calls/stats'),
          fetch('/api/calls/recent')
        ]);
        if (statsRes.ok) setStats(await statsRes.json());
        if (historyRes.ok) setHistory(await historyRes.json());
      } catch (e) {
        console.error('Error fetching stats:', e);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [isOpen]);

  if (!isOpen) return null;

  const statusBadges = {
    'completed': 'bg-emerald-950 text-emerald-300 border-emerald-800/40',
    'connected': 'bg-blue-950 text-blue-300 border-blue-800/40',
    'ringing': 'bg-amber-950 text-amber-300 border-amber-800/40 animate-pulse',
    'rejected': 'bg-rose-950 text-rose-300 border-rose-800/40',
    'missed': 'bg-slate-800 text-slate-400 border-slate-700'
  };

  const fmtDuration = (s) => {
    if (!s) return '0s';
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-2.5">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            <h2 className="text-base font-bold text-white tracking-tight">Call Center Statistics & Activity History</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Key Stat Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Total Calls */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <PhoneCall className="w-3.5 h-3.5 text-indigo-400" /> Total Calls
              </span>
              <span className="text-2xl font-extrabold text-white mt-2">
                {stats?.total ?? 0}
              </span>
            </div>

            {/* Completed */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Completed
              </span>
              <span className="text-2xl font-extrabold text-emerald-400 mt-2">
                {stats?.completed ?? 0}
              </span>
            </div>

            {/* Missed / Rejected */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <PhoneOff className="w-3.5 h-3.5 text-rose-400" /> Missed / Rejected
              </span>
              <span className="text-2xl font-extrabold text-rose-400 mt-2">
                {stats?.missed ?? 0}
              </span>
            </div>

            {/* Avg Duration */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800 flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-blue-400" /> Avg Duration
              </span>
              <span className="text-2xl font-extrabold text-blue-400 mt-2 font-mono">
                {fmtDuration(stats?.avgDurationSec)}
              </span>
            </div>
          </div>

          {/* Call History Table */}
          <div>
            <h3 className="text-sm font-bold text-slate-200 mb-3 flex items-center gap-2">
              <PhoneForwarded className="w-4 h-4 text-slate-400" />
              <span>Recent Calls Log</span>
            </h3>

            <div className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-950/40">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-900/80 text-slate-400 uppercase font-semibold border-b border-slate-800">
                  <tr>
                    <th className="px-4 py-3">Call ID / Caller</th>
                    <th className="px-4 py-3">Extension</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="px-4 py-8 text-center text-slate-500">
                        No recorded calls yet. Dial the extension to create a call.
                      </td>
                    </tr>
                  ) : (
                    history.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="px-4 py-3 font-medium text-white">
                          <div>{c.caller_name || 'Mobile Device'}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{c.id}</div>
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-emerald-400">
                          {c.extension}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border uppercase tracking-wider ${statusBadges[c.status] || 'bg-slate-800'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-400">
                          {new Date(c.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-3 font-mono text-slate-300">
                          {fmtDuration(c.duration_s)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

