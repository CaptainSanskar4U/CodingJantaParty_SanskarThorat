import React from 'react';
import { Sparkles, Brain, AlertTriangle, Target, Tag, HelpCircle, CheckCircle2, FileText, Zap } from 'lucide-react';

export function AIInsightCards({ analysis, activeCall }) {
  if (!activeCall) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl h-[520px] p-6 flex flex-col items-center justify-center text-center text-slate-500">
        <Brain className="w-10 h-10 mb-3 opacity-30 animate-pulse text-indigo-400" />
        <h3 className="text-base font-semibold text-slate-300">Local AI Engine Standing By</h3>
        <p className="text-xs max-w-sm mt-1.5 leading-relaxed">
          AI analysis activates in real time when a call is answered. Customer intent, sentiment, keywords, urgency, and operator recommendations will populate live.
        </p>
      </div>
    );
  }

  const sentiment = analysis?.sentiment || 'Neutral';
  const urgency = analysis?.urgency || 'LOW';
  const intent = analysis?.intent || 'Analyzing conversation...';
  const keywords = analysis?.keywords || [];
  const topics = analysis?.topics || [];
  const questions = analysis?.questions || [];
  const concerns = analysis?.concerns || [];
  const recommendations = analysis?.recommendations || [];
  const summary = analysis?.summary || 'Analyzing live speech stream...';

  // Sentiment color map
  const sentimentStyles = {
    'Positive': 'bg-emerald-950 text-emerald-300 border-emerald-800/60',
    'Neutral': 'bg-slate-800 text-slate-300 border-slate-700',
    'Anxious': 'bg-amber-950 text-amber-300 border-amber-800/60',
    'Frustrated': 'bg-orange-950 text-orange-300 border-orange-800/60',
    'Distressed': 'bg-rose-950 text-rose-300 border-rose-800/60'
  };

  // Urgency color map
  const urgencyStyles = {
    'LOW': 'bg-slate-800 text-slate-300 border-slate-700',
    'MEDIUM': 'bg-amber-950 text-amber-300 border-amber-800/60',
    'HIGH': 'bg-orange-950 text-orange-300 border-orange-800/60',
    'CRITICAL': 'bg-rose-600 text-white border-rose-400 animate-pulse shadow-lg shadow-rose-600/30'
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl h-[520px] flex flex-col shadow-lg overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40 shrink-0">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4 text-indigo-400" />
          <h2 className="text-sm font-bold text-white tracking-tight">Real-Time AI Conversation Insights</h2>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-indigo-300 bg-indigo-950/80 px-2.5 py-0.5 rounded-full border border-indigo-800/60">
          <Zap className="w-3 h-3 text-indigo-400" /> Local Inference Active
        </div>
      </div>

      {/* Content Stream */}
      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        {/* Top Badges: Intent, Urgency, Sentiment */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {/* Customer Intent */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Target className="w-3 h-3 text-blue-400" /> Detected Intent
            </span>
            <span className="text-xs font-semibold text-slate-200 mt-1 line-clamp-2">
              {intent}
            </span>
          </div>

          {/* Urgency */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-400" /> Urgency Level
            </span>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-lg border w-fit mt-1 uppercase tracking-wider ${urgencyStyles[urgency] || urgencyStyles.LOW}`}>
              {urgency}
            </span>
          </div>

          {/* Sentiment */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex flex-col justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-indigo-400" /> Sentiment
            </span>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border w-fit mt-1 ${sentimentStyles[sentiment] || sentimentStyles.Neutral}`}>
              {sentiment}
            </span>
          </div>
        </div>

        {/* Live Conversation Summary */}
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-300 mb-1">
            <FileText className="w-3.5 h-3.5 text-indigo-400" />
            <span>Live Brief Summary</span>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed font-medium">
            {summary}
          </p>
        </div>

        {/* Actionable AI Recommendations */}
        <div className="p-3.5 rounded-xl bg-indigo-950/30 border border-indigo-900/40">
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Operator Guidance & Recommended Actions</span>
          </div>
          <ul className="space-y-1.5">
            {recommendations.length === 0 ? (
              <li className="text-xs text-slate-400">Listening to conversation context...</li>
            ) : (
              recommendations.map((rec, idx) => (
                <li key={idx} className="text-xs text-indigo-100 flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0 mt-1.5" />
                  <span>{rec}</span>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* Extracted Keywords & Topics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Keywords */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              <Tag className="w-3 h-3 text-emerald-400" />
              <span>Key Terms</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {keywords.length === 0 ? (
                <span className="text-xs text-slate-500">None extracted yet</span>
              ) : (
                keywords.map((kw, i) => (
                  <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-800 text-emerald-300 border border-slate-700">
                    #{kw}
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Topics */}
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              <HelpCircle className="w-3 h-3 text-purple-400" />
              <span>Topics</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {topics.length === 0 ? (
                <span className="text-xs text-slate-500">Scanning...</span>
              ) : (
                topics.map((tp, i) => (
                  <span key={i} className="text-[11px] px-2 py-0.5 rounded-md bg-purple-950/60 text-purple-300 border border-purple-800/40">
                    {tp}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Customer Questions & Concerns */}
        {(questions.length > 0 || concerns.length > 0) && (
          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2">
            {concerns.length > 0 && (
              <div>
                <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block mb-1">
                  Identified Concerns:
                </span>
                {concerns.map((c, i) => (
                  <p key={i} className="text-xs text-slate-300 pl-2 border-l border-rose-500/50 mb-1">
                    {c}
                  </p>
                ))}
              </div>
            )}
            {questions.length > 0 && (
              <div>
                <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block mb-1">
                  Questions Asked:
                </span>
                {questions.map((q, i) => (
                  <p key={i} className="text-xs text-slate-300 pl-2 border-l border-blue-500/50 mb-1">
                    "{q}"
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

