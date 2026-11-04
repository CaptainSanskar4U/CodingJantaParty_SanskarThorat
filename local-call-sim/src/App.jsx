import React, { useState, useEffect, useCallback } from 'react';
import { useSocket } from './hooks/useSocket';
import { useWebRTC } from './hooks/useWebRTC';
import { Topbar } from './components/Dashboard/Topbar';
import { IncomingCallModal } from './components/Dashboard/IncomingCallModal';
import { ActiveCallControls } from './components/Dashboard/ActiveCallControls';
import { LiveTranscriptPanel } from './components/Dashboard/LiveTranscriptPanel';
import { AIInsightCards } from './components/Dashboard/AIInsightCards';
import { MobileConnectCard } from './components/Dashboard/MobileConnectCard';
import { CallStatsModal } from './components/Dashboard/CallStatsModal';
import { MobileDialer } from './components/Dialer/MobileDialer';

export default function App() {
  const [view, setView] = useState(() => {
    // If URL contains /dialer, default to dialer view
    return window.location.pathname.includes('/dialer') ? 'dialer' : 'dashboard';
  });

  const { socket, connected } = useSocket();

  // State
  const [extension, setExtension] = useState('966');
  const [stats, setStats] = useState({ total: 0, active: 0, completed: 0, missed: 0, avgDurationSec: 0 });
  const [localIp, setLocalIp] = useState('');
  const [httpsPort, setHttpsPort] = useState(3001);

  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [transcripts, setTranscripts] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);

  // WebRTC hook for operator side
  const { startCall, cleanup, toggleMute, isMuted, audioLevel } = useWebRTC({
    socket,
    callId: activeCall?.id,
    isInitiator: false,
    onTranscript: (t) => {
      // Local operator speech captured by Web Speech
      if (socket && activeCall) {
        socket.emit('transcript_utterance', {
          callId: activeCall.id,
          speaker: 'operator',
          text: t.text,
          timestampMs: Date.now()
        });
      }
    }
  });

  // Handle URL change for view switching
  useEffect(() => {
    const handlePopState = () => {
      setView(window.location.pathname.includes('/dialer') ? 'dialer' : 'dashboard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (newView) => {
    setView(newView);
    const path = newView === 'dialer' ? '/dialer' : '/';
    window.history.pushState({}, '', path);
  };

  // Socket setup & event listeners
  useEffect(() => {
    if (!socket) return;

    socket.emit('operator_register');

    socket.on('operator_ready', (data) => {
      if (data.extension) setExtension(data.extension);
      if (data.stats) setStats(data.stats);
      if (data.localIp) setLocalIp(data.localIp);
      if (data.httpsPort) setHttpsPort(data.httpsPort);
      if (data.activeCall) {
        setActiveCall(data.activeCall);
      }
    });

    socket.on('extension_updated', ({ extension: newExt }) => {
      setExtension(newExt);
    });

    socket.on('incoming_call', ({ call }) => {
      setIncomingCall(call);
    });

    socket.on('call_connected', ({ call }) => {
      setIncomingCall(null);
      setActiveCall(call);
      setTranscripts([]);
      setAnalysis(call.analysis || null);
      startCall('operator');
    });

    socket.on('call_rejected', () => {
      setIncomingCall(null);
      cleanup();
    });

    socket.on('call_cancelled', () => {
      setIncomingCall(null);
      cleanup();
    });

    socket.on('call_ended', () => {
      setActiveCall(null);
      setIncomingCall(null);
      cleanup();
    });

    socket.on('call_status_changed', ({ call }) => {
      if (!call) {
        setActiveCall(null);
        setIncomingCall(null);
        cleanup();
      }
    });

    socket.on('transcript_received', ({ entry }) => {
      setTranscripts(prev => [...prev, entry]);
    });

    socket.on('live_ai_analysis_update', ({ analysis: newAnalysis }) => {
      setAnalysis(newAnalysis);
    });

    socket.on('stats_updated', (newStats) => {
      setStats(newStats);
    });

    return () => {
      socket.off('operator_ready');
      socket.off('extension_updated');
      socket.off('incoming_call');
      socket.off('call_connected');
      socket.off('call_rejected');
      socket.off('call_cancelled');
      socket.off('call_ended');
      socket.off('call_status_changed');
      socket.off('transcript_received');
      socket.off('live_ai_analysis_update');
      socket.off('stats_updated');
    };
  }, [socket, startCall, cleanup]);

  // Actions
  const handleRegenerateExtension = async () => {
    try {
      const res = await fetch('/api/extension/regenerate', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setExtension(data.extension);
      }
    } catch (e) {
      console.error('Error regenerating extension:', e);
    }
  };

  const handleAnswerCall = (callId) => {
    socket.emit('answer_call', { callId });
  };

  const handleRejectCall = (callId) => {
    socket.emit('reject_call', { callId });
    setIncomingCall(null);
  };

  const handleEndCall = () => {
    if (activeCall && socket) {
      socket.emit('end_call', { callId: activeCall.id, endedBy: 'operator' });
    }
    setActiveCall(null);
    cleanup();
  };

  const handleSendTranscript = ({ speaker, text }) => {
    if (activeCall && socket) {
      socket.emit('transcript_utterance', {
        callId: activeCall.id,
        speaker,
        text,
        timestampMs: Date.now()
      });
    }
  };

  // If user navigated to Mobile Dialer view
  if (view === 'dialer') {
    return (
      <MobileDialer
        socket={socket}
        connected={connected}
        onNavigateDashboard={() => navigateTo('dashboard')}
      />
    );
  }

  // Otherwise render Operator Dashboard view
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Topbar */}
      <Topbar
        extension={extension}
        onRegenerateExtension={handleRegenerateExtension}
        stats={stats}
        localIp={localIp}
        httpsPort={httpsPort}
        onOpenMobileDialer={() => navigateTo('dialer')}
        onOpenStatsModal={() => setIsStatsOpen(true)}
      />

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 space-y-5">
        {/* Mobile Wi-Fi Connect Banner */}
        <MobileConnectCard
          localIp={localIp}
          httpsPort={httpsPort}
          extension={extension}
          onOpenDialerTab={() => window.open('/dialer', '_blank')}
        />

        {/* Active Call Controls Bar (visible when a call is connected) */}
        {activeCall && (
          <ActiveCallControls
            call={activeCall}
            onEndCall={handleEndCall}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            audioLevel={audioLevel}
            onOperatorSpeak={(phrase) => handleSendTranscript({ speaker: 'operator', text: phrase })}
          />
        )}

        {/* Split Grid: Live Transcript Panel & Real-Time AI Insights */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Left Column: Live Transcript Panel */}
          <LiveTranscriptPanel
            transcripts={transcripts}
            activeCall={activeCall}
            onSendTranscript={handleSendTranscript}
          />

          {/* Right Column: AI Insights & Recommendation Cards */}
          <AIInsightCards
            analysis={analysis}
            activeCall={activeCall}
          />
        </div>
      </main>

      {/* Incoming Call Modal Overlay */}
      {incomingCall && (
        <IncomingCallModal
          call={incomingCall}
          onAnswer={handleAnswerCall}
          onReject={handleRejectCall}
        />
      )}

      {/* Call Center Stats & History Modal */}
      <CallStatsModal
        isOpen={isStatsOpen}
        onClose={() => setIsStatsOpen(false)}
      />
    </div>
  );
}

