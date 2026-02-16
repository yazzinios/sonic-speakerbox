import { useState, useEffect, useRef } from 'react';
import { BarChart3, Clock, Music, Mic, Users } from 'lucide-react';

interface StatsSectionProps {
  deckA: { isPlaying: boolean; fileName: string };
  deckB: { isPlaying: boolean; fileName: string };
  micActive: boolean;
  listenerCount: number;
}

export function StatsSection({ deckA, deckB, micActive, listenerCount }: StatsSectionProps) {
  const [sessionTime, setSessionTime] = useState(0);
  const [deckATime, setDeckATime] = useState(0);
  const [deckBTime, setDeckBTime] = useState(0);
  const [micTime, setMicTime] = useState(0);
  const [tracksPlayed, setTracksPlayed] = useState(0);
  const [peakListeners, setPeakListeners] = useState(0);
  const prevTracksRef = useRef({ a: '', b: '' });

  // Session timer
  useEffect(() => {
    const interval = setInterval(() => {
      setSessionTime(prev => prev + 1);
      if (deckA.isPlaying) setDeckATime(prev => prev + 1);
      if (deckB.isPlaying) setDeckBTime(prev => prev + 1);
      if (micActive) setMicTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [deckA.isPlaying, deckB.isPlaying, micActive]);

  // Track count
  useEffect(() => {
    if (deckA.fileName && deckA.fileName !== prevTracksRef.current.a) {
      setTracksPlayed(prev => prev + 1);
      prevTracksRef.current.a = deckA.fileName;
    }
    if (deckB.fileName && deckB.fileName !== prevTracksRef.current.b) {
      setTracksPlayed(prev => prev + 1);
      prevTracksRef.current.b = deckB.fileName;
    }
  }, [deckA.fileName, deckB.fileName]);

  // Peak listeners
  useEffect(() => {
    if (listenerCount > peakListeners) setPeakListeners(listenerCount);
  }, [listenerCount, peakListeners]);

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <h2 className="text-lg font-bold tracking-wider text-foreground">STATISTICS</h2>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatCard icon={<Clock className="h-3.5 w-3.5" />} label="Session" value={fmt(sessionTime)} />
        <StatCard icon={<Music className="h-3.5 w-3.5" />} label="Tracks Played" value={String(tracksPlayed)} />
        <StatCard icon={<Users className="h-3.5 w-3.5" />} label="Peak Listeners" value={String(peakListeners)} />
        <StatCard icon={<Music className="h-3.5 w-3.5 text-primary" />} label="Deck A Time" value={fmt(deckATime)} />
        <StatCard icon={<Music className="h-3.5 w-3.5 text-accent" />} label="Deck B Time" value={fmt(deckBTime)} />
        <StatCard icon={<Mic className="h-3.5 w-3.5" />} label="Mic Time" value={fmt(micTime)} />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-2.5 text-center space-y-1">
      <div className="flex items-center justify-center text-muted-foreground">{icon}</div>
      <p className="text-sm font-bold font-mono text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}
