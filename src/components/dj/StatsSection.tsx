import { useState, useEffect, useRef } from 'react';
import { BarChart3, Clock, Music, Mic, Users } from 'lucide-react';
import type { DeckState } from '@/hooks/useAudioEngine';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS, DECK_COLORS, getChannels } from '@/types/channels';

interface StatsSectionProps {
  decks: Record<DeckId, DeckState>;
  micActive: boolean;
  listenerCount: number;
}

export function StatsSection({ decks, micActive, listenerCount }: StatsSectionProps) {
  const [sessionTime, setSessionTime] = useState(0);
  const [deckTimes, setDeckTimes] = useState<Record<DeckId, number>>({ A: 0, B: 0, C: 0, D: 0 });
  const [micTime, setMicTime] = useState(0);
  const [tracksPlayed, setTracksPlayed] = useState(0);
  const [peakListeners, setPeakListeners] = useState(0);
  const prevTracksRef = useRef<Record<DeckId, string>>({ A: '', B: '', C: '', D: '' });
  const channels = getChannels();

  useEffect(() => {
    const interval = setInterval(() => {
      setSessionTime(prev => prev + 1);
      for (const id of ALL_DECKS) {
        if (decks[id].isPlaying) setDeckTimes(prev => ({ ...prev, [id]: prev[id] + 1 }));
      }
      if (micActive) setMicTime(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [decks, micActive]);

  useEffect(() => {
    for (const id of ALL_DECKS) {
      if (decks[id].fileName && decks[id].fileName !== prevTracksRef.current[id]) {
        setTracksPlayed(prev => prev + 1);
        prevTracksRef.current[id] = decks[id].fileName;
      }
    }
  }, [decks]);

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
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        <StatCard icon={<Clock className="h-3.5 w-3.5" />} label="Session" value={fmt(sessionTime)} />
        <StatCard icon={<Music className="h-3.5 w-3.5" />} label="Tracks" value={String(tracksPlayed)} />
        <StatCard icon={<Users className="h-3.5 w-3.5" />} label="Peak" value={String(peakListeners)} />
        <StatCard icon={<Mic className="h-3.5 w-3.5" />} label="Mic Time" value={fmt(micTime)} />
        {ALL_DECKS.map(id => (
          <StatCard key={id} icon={<Music className={`h-3.5 w-3.5 ${DECK_COLORS[id].class}`} />}
            label={channels.find(c => c.id === id)?.name || `Deck ${id}`} value={fmt(deckTimes[id])} />
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background p-2 text-center space-y-0.5">
      <div className="flex items-center justify-center text-muted-foreground">{icon}</div>
      <p className="text-xs font-bold font-mono text-foreground">{value}</p>
      <p className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}
