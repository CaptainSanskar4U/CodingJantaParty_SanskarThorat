import React, { useRef, useEffect, useState } from 'react';
import { MessageSquare, User, Shield, Send, Mic, Copy, Check } from 'lucide-react';

export function LiveTranscriptPanel({
  transcripts = [],
  activeCall,
  onSendTranscript
}) {
  const [inputText, setInputText] = useState('');
  const [speakerRole, setSpeakerRole] = useState('caller');
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcripts]);

  const handleSend = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onSendTranscript({
      speaker: speakerRole,
      text: inputText.trim()
    });
    setInputText('');
  };

  const handleCopyTranscript = () => {
    const text = transcripts.map(t => `[${t.speaker.toUpperCase()}]: ${t.text}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const fmtTime = (ts) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl flex flex-col h-[520px] shadow-lg overflow-hidden">
      {/* Panel Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold text-white tracking-tight">Live Conversation Transcript</h2>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
            {transcripts.length} {transcripts.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {transcripts.length > 0 && (
          <button
            type="button"
            onClick={handleCopyTranscript}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition-colors py-1 px-2 rounded-lg hover:bg-slate-800"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        )}
      </div>

      {/* Transcript Bubbles Stream */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3.5">
        {transcripts.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <Mic className="w-8 h-8 mb-2 opacity-40 animate-pulse" />
            <p className="text-sm font-medium text-slate-400">Awaiting audio speech stream...</p>
            <p className="text-xs max-w-xs mt-1">
              Speak into the mobile dialer or operator microphone, or use the speech input bar below to send utterances.
            </p>
          </div>
        ) : (
          transcripts.map((entry, idx) => {
            const isCaller = entry.speaker === 'caller';
            return (
              <div
                key={entry.id || idx}
                className={`flex gap-3 items-start animate-in fade-in slide-in-from-bottom-2 duration-150 ${
                  isCaller ? 'flex-row' : 'flex-row-reverse'
                }`}
              >
                {/* Speaker Avatar */}
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-1 shadow-sm ${
                    isCaller
                      ? 'bg-indigo-600 text-white'
                      : 'bg-emerald-600 text-white'
                  }`}
                  title={isCaller ? 'Caller (Mobile)' : 'Operator (Dashboard)'}
                >
                  {isCaller ? <User className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                </div>

                {/* Speech Bubble */}
                <div className={`max-w-[78%] flex flex-col ${isCaller ? 'items-start' : 'items-end'}`}>
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-[11px] font-bold text-slate-300">
                      {isCaller ? 'Caller (Mobile)' : 'Operator (Dashboard)'}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {fmtTime(entry.created_at || entry.timestampMs)}
                    </span>
                  </div>

                  <div
                    className={`p-3 rounded-2xl text-sm leading-relaxed shadow-md border ${
                      isCaller
                        ? 'bg-slate-800/90 text-slate-100 rounded-tl-sm border-slate-700/60'
                        : 'bg-indigo-950/70 text-indigo-100 rounded-tr-sm border-indigo-800/60'
                    }`}
                  >
                    {entry.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Manual Utterance Input Bar */}
      {activeCall && (
        <form onSubmit={handleSend} className="p-3 border-t border-slate-800 bg-slate-950/60 flex items-center gap-2">
          {/* Speaker Switcher Pill */}
          <button
            type="button"
            onClick={() => setSpeakerRole(prev => (prev === 'caller' ? 'operator' : 'caller'))}
            className={`text-xs font-semibold px-2.5 py-2 rounded-xl transition-all border shrink-0 ${
              speakerRole === 'caller'
                ? 'bg-indigo-950 text-indigo-300 border-indigo-800/80'
                : 'bg-emerald-950 text-emerald-300 border-emerald-800/80'
            }`}
            title="Click to toggle speaker identity"
          >
            {speakerRole === 'caller' ? '🗣️ Caller' : '🛡️ Operator'}
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={`Type ${speakerRole} speech to simulate conversation...`}
            className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />

          <button
            type="submit"
            disabled={!inputText.trim()}
            className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white transition-all shadow-md active:scale-95 shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      )}
    </div>
  );
}

