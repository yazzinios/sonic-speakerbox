import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Mic, MicOff, Radio, Users } from 'lucide-react';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS, DECK_COLORS, getChannels } from '@/types/channels';

export type MicTarget = 'all' | DeckId;

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

      <div>
        <label className="text-[10px] text-muted-foreground font-bold uppercase">Broadcast To</label>
        <Select value={micTarget} onValueChange={(v) => onMicTargetChange(v as MicTarget)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              <div className="flex items-center gap-1.5">
                <Users className="h-3 w-3" /> All Listeners
              </div>
            </SelectItem>
            {ALL_DECKS.map(id => {
              const ch = channels.find(c => c.id === id);
              return (
                <SelectItem key={id} value={id}>
                  <div className="flex items-center gap-1.5">
                    <span className={`font-bold ${DECK_COLORS[id].class}`}>{id}</span> {ch?.name || `Channel ${id}`}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button onClick={onStartMic} disabled={micActive || jinglePlaying} className="bg-destructive hover:bg-destructive/80 text-destructive-foreground">
          <Mic className="h-4 w-4 mr-1" /> On Air
        </Button>
        <Button variant="outline" onClick={onStopMic} disabled={!micActive}>
          <MicOff className="h-4 w-4 mr-1" /> Off Air
        </Button>
      </div>
      {micActive && (
        <p className="text-[10px] text-muted-foreground">
          Broadcasting to: <span className="font-bold text-foreground">{micTarget === 'all' ? 'All listeners' : channels.find(c => c.id === micTarget)?.name || `Channel ${micTarget}`}</span>
        </p>
      )}
    </div>
  );
}
