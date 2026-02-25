import { Button } from '@/components/ui/button';
import { Mic, MicOff, Radio, Users, Check } from 'lucide-react';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS, DECK_COLORS, getChannels } from '@/types/channels';

// 'all' means broadcast to all channels, or an array of specific deck IDs
export type MicTarget = 'all' | DeckId[];

interface MicSectionProps {
  micActive: boolean;
  jinglePlaying: boolean;
  micTarget: MicTarget;
  onStartMic: () => void;
  onStopMic: () => void;
  onMicTargetChange: (target: MicTarget) => void;
}

export function MicSection({ micActive, jinglePlaying, micTarget, onStartMic, onStopMic, onMicTargetChange }: MicSectionProps) {
  const channels = getChannels();

  // Helper: is a deck currently selected
  const isDeckSelected = (id: DeckId): boolean => {
    if (micTarget === 'all') return true;
    return micTarget.includes(id);
  };

  const isAllSelected = micTarget === 'all';

  const toggleAll = () => {
    if (isAllSelected) {
      // Switch to just deck A as a starting point
      onMicTargetChange(['A']);
    } else {
      onMicTargetChange('all');
    }
  };

  const toggleDeck = (id: DeckId) => {
    if (micTarget === 'all') {
      // Switch from "all" to individual selection, removing this one
      const others = ALL_DECKS.filter(d => d !== id) as DeckId[];
      onMicTargetChange(others.length > 0 ? others : [id]);
    } else {
      const current = micTarget as DeckId[];
      const isOn = current.includes(id);
      if (isOn && current.length === 1) {
        // Can't deselect last one
        return;
      }
      const next = isOn ? current.filter(d => d !== id) : [...current, id];
      // If all 4 selected, simplify to 'all'
      if (next.length === ALL_DECKS.length) {
        onMicTargetChange('all');
      } else {
        onMicTargetChange(next as DeckId[]);
      }
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

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold tracking-wider text-foreground">MIC</h2>
        {micActive && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/20 text-destructive text-xs font-bold animate-pulse">
            <Radio className="h-3 w-3" /> LIVE
          </span>
        )}
        {jinglePlaying && <span className="text-xs text-accent font-mono animate-pulse">♪ Jingle...</span>}
      </div>

      {/* Target selection */}
      <div>
        <label className="text-[10px] text-muted-foreground font-bold uppercase mb-1.5 block">Broadcast To</label>
        <div className="flex flex-wrap gap-1.5">
          {/* All button */}
          <button
            onClick={toggleAll}
            disabled={micActive}
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

          {/* Individual deck buttons */}
          {ALL_DECKS.map(id => {
            const ch = channels.find(c => c.id === id);
            const selected = isDeckSelected(id);
            const colors = DECK_COLORS[id];
            return (
              <button
                key={id}
                onClick={() => toggleDeck(id)}
                disabled={micActive}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-bold border transition-colors
                  ${selected && !isAllSelected
                    ? `border-current bg-opacity-10`
                    : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                style={selected && !isAllSelected ? { borderColor: 'currentColor' } : undefined}
                title={ch?.name || `Channel ${id}`}
              >
                <span className={selected && !isAllSelected ? colors.class : ''}>{id}</span>
                {selected && !isAllSelected && <Check className={`h-2.5 w-2.5 ${colors.class}`} />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2">
        <Button
          onClick={onStartMic}
          disabled={micActive || jinglePlaying}
          className="bg-destructive hover:bg-destructive/80 text-destructive-foreground"
        >
          <Mic className="h-4 w-4 mr-1" /> On Air
        </Button>
        <Button variant="outline" onClick={onStopMic} disabled={!micActive}>
          <MicOff className="h-4 w-4 mr-1" /> Off Air
        </Button>
      </div>

      {micActive && (
        <p className="text-[10px] text-muted-foreground">
          Broadcasting to: <span className="font-bold text-foreground">{targetLabel()}</span>
        </p>
      )}
    </div>
  );
}
