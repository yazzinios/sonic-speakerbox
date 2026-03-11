import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Mic, MicOff, Radio, Users, Check, Upload, Music2 } from 'lucide-react';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS, DECK_COLORS, getChannels } from '@/types/channels';
import { STREAMING_SERVER, SERVER_MODE } from '@/lib/streamingServer';
import { toast } from 'sonner';

export type MicTarget = 'all' | DeckId[];

interface MicSectionProps {
  micActive: boolean;
  jinglePlaying: boolean;
  micTarget: MicTarget;
  onStartMic: () => void;
  onStopMic: () => void;
  onMicTargetChange: (target: MicTarget) => void;
}

export function MicSection({
  micActive, jinglePlaying, micTarget,
  onStartMic, onStopMic, onMicTargetChange,
}: MicSectionProps) {
  const channels = getChannels();
  const jingleInputRef = useRef<HTMLInputElement>(null);
  const [jingleExists, setJingleExists] = useState(false);
  const [uploadingJingle, setUploadingJingle] = useState(false);
  // Countdown timer: how many seconds until mic opens after jingle
  const [jingleCountdown, setJingleCountdown] = useState<number | null>(null);

  // Check if a jingle is configured on the server
  useEffect(() => {
    if (!SERVER_MODE) return;
    fetch(`${STREAMING_SERVER}/jingle/exists`)
      .then(r => r.json())
      .then(d => setJingleExists(d.exists))
      .catch(() => {});
  }, []);

  const handleJingleUpload = async (file: File) => {
    if (!file) return;
    setUploadingJingle(true);
    try {
      const form = new FormData();
      form.append('jingle', file);
      const res = await fetch(`${STREAMING_SERVER}/jingle/upload`, { method: 'POST', body: form });
      if (!res.ok) throw new Error('Upload failed');
      setJingleExists(true);
      toast.success(`Jingle uploaded: "${file.name}"`);
    } catch (e) {
      toast.error('Failed to upload jingle');
    } finally {
      setUploadingJingle(false);
    }
  };

  const isDeckSelected = (id: DeckId): boolean => {
    if (micTarget === 'all') return true;
    return micTarget.includes(id);
  };

  const isAllSelected = micTarget === 'all';

  const toggleAll = () => {
    if (isAllSelected) onMicTargetChange(['A']);
    else onMicTargetChange('all');
  };

  const toggleDeck = (id: DeckId) => {
    if (micTarget === 'all') {
      const others = ALL_DECKS.filter(d => d !== id) as DeckId[];
      onMicTargetChange(others.length > 0 ? others : [id]);
    } else {
      const current = micTarget as DeckId[];
      const isOn = current.includes(id);
      if (isOn && current.length === 1) return;
      const next = isOn ? current.filter(d => d !== id) : [...current, id];
      if (next.length === ALL_DECKS.length) onMicTargetChange('all');
      else onMicTargetChange(next as DeckId[]);
    }
  };

  const targetLabel = (): string => {
    if (micTarget === 'all') return 'All Listeners';
    const ids = micTarget as DeckId[];
    if (ids.length === 0) return 'None';
    return ids.map(id => {
      const ch = channels.find(c => c.id === id);
      return ch?.name || `Channel ${id}`;
    }).join(', ');
  };

  // Handles the ON AIR button click
  // In server mode: calls /jingle/play first (if jingle exists), waits for duration, then opens mic
  const handleOnAir = async () => {
    if (!SERVER_MODE) {
      onStartMic();
      return;
    }

    // If a jingle is configured, show countdown and delay mic opening
    if (jingleExists) {
      try {
        const targets = micTarget === 'all' ? ['ALL'] : (micTarget as DeckId[]);
        const res = await fetch(`${STREAMING_SERVER}/jingle/play`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targets }),
        });
        const data = await res.json();
        const duration = data.durationMs || 0;

        if (duration > 500) {
          // Show countdown so DJ knows when mic will open
          const seconds = Math.ceil(duration / 1000);
          setJingleCountdown(seconds);
          const interval = setInterval(() => {
            setJingleCountdown(prev => {
              if (prev === null || prev <= 1) {
                clearInterval(interval);
                return null;
              }
              return prev - 1;
            });
          }, 1000);
          // Wait for jingle to finish before telling the UI mic is active
          setTimeout(() => {
            onStartMic();
          }, duration);
          return;
        }
      } catch (e) {
        console.warn('[Mic] Jingle play failed, opening mic directly:', e);
      }
    }

    // No jingle or jingle failed — open mic immediately
    onStartMic();
  };

  const isOnAirDisabled = micActive || jinglePlaying || jingleCountdown !== null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-bold tracking-wider text-foreground">MIC</h2>
        {micActive && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/20 text-destructive text-xs font-bold animate-pulse">
            <Radio className="h-3 w-3" /> ON AIR
          </span>
        )}
        {jingleCountdown !== null && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400 text-xs font-bold animate-pulse">
            <Music2 className="h-3 w-3" /> Jingle... {jingleCountdown}s
          </span>
        )}
        {jinglePlaying && jingleCountdown === null && (
          <span className="text-xs text-accent font-mono animate-pulse">♪ Jingle...</span>
        )}

        {/* Jingle upload (server mode only) */}
        {SERVER_MODE && (
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => jingleInputRef.current?.click()}
              disabled={uploadingJingle}
              className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border transition-colors
                ${jingleExists
                  ? 'border-green-500/50 text-green-400 hover:bg-green-500/10'
                  : 'border-muted-foreground/40 text-muted-foreground hover:border-primary/50 hover:text-primary'
                }`}
              title={jingleExists ? 'Jingle set — click to replace' : 'Upload a jingle (plays on ON AIR)'}
            >
              <Music2 className="h-2.5 w-2.5" />
              {uploadingJingle ? 'Uploading...' : jingleExists ? '✓ Jingle' : 'Add Jingle'}
            </button>
            <input
              ref={jingleInputRef}
              type="file"
              accept="audio/mp3,audio/mpeg,audio/wav,audio/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleJingleUpload(f);
                e.target.value = '';
              }}
            />
          </div>
        )}
      </div>

      {/* Target selection */}
      <div>
        <label className="text-[10px] text-muted-foreground font-bold uppercase mb-1.5 block">Broadcast To</label>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={toggleAll}
            disabled={micActive || isOnAirDisabled}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border transition-colors
              ${isAllSelected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:border-primary/50'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Users className="h-3 w-3" />
            All
            {isAllSelected && <Check className="h-2.5 w-2.5" />}
          </button>

          {ALL_DECKS.map(id => {
            const ch = channels.find(c => c.id === id);
            const selected = isDeckSelected(id);
            const colors = DECK_COLORS[id];
            return (
              <button
                key={id}
                onClick={() => toggleDeck(id)}
                disabled={isOnAirDisabled}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border transition-colors
                  ${selected && !isAllSelected
                    ? 'border-current bg-opacity-10'
                    : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                title={ch?.name || `Channel ${id}`}
              >
                <span className={selected && !isAllSelected ? colors.class : ''}>{id}</span>
                {selected && !isAllSelected && <Check className={`h-2.5 w-2.5 ${colors.class}`} />}
              </button>
            );
          })}
        </div>
      </div>

      {/* ON AIR / OFF AIR buttons */}
      <div className="flex gap-2">
        <Button
          onClick={handleOnAir}
          disabled={isOnAirDisabled}
          className={`relative overflow-hidden ${
            isOnAirDisabled
              ? 'bg-destructive/50'
              : 'bg-destructive hover:bg-destructive/80'
          } text-destructive-foreground`}
        >
          <Mic className="h-4 w-4 mr-1" />
          {jingleCountdown !== null ? `Open in ${jingleCountdown}s` : 'On Air'}
          {/* Pulse ring when about to go live */}
          {jingleCountdown !== null && (
            <span className="absolute inset-0 rounded animate-ping bg-destructive/30 pointer-events-none" />
          )}
        </Button>
        <Button
          variant="outline"
          onClick={onStopMic}
          disabled={!micActive}
          className={micActive ? 'border-destructive/50 text-destructive hover:bg-destructive/10' : ''}
        >
          <MicOff className="h-4 w-4 mr-1" /> Off Air
        </Button>
      </div>

      {/* Status info */}
      {micActive && (
        <p className="text-[10px] text-muted-foreground">
          🎙️ On air →{' '}
          <span className="font-bold text-foreground">{targetLabel()}</span>
          <span className="ml-2 text-destructive/70">Music ducked to 5%</span>
        </p>
      )}
      {jingleExists && !micActive && jingleCountdown === null && (
        <p className="text-[10px] text-muted-foreground">
          🎵 Jingle plays on stream before mic opens
        </p>
      )}
    </div>
  );
}
