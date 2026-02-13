import { Button } from '@/components/ui/button';
import { Mic, MicOff, Radio } from 'lucide-react';

interface MicSectionProps {
  micActive: boolean;
  jinglePlaying: boolean;
  onStartMic: () => void;
  onStopMic: () => void;
}

export function MicSection({ micActive, jinglePlaying, onStartMic, onStopMic }: MicSectionProps) {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold tracking-wider text-foreground">MIC</h2>
        {micActive && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/20 text-destructive text-xs font-bold animate-pulse">
            <Radio className="h-3 w-3" />
            LIVE
          </span>
        )}
        {jinglePlaying && (
          <span className="text-xs text-accent font-mono animate-pulse">♪ Jingle...</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          onClick={onStartMic}
          disabled={micActive || jinglePlaying}
          className="bg-destructive hover:bg-destructive/80 text-destructive-foreground"
        >
          <Mic className="h-4 w-4 mr-1" />
          On Air
        </Button>
        <Button
          variant="outline"
          onClick={onStopMic}
          disabled={!micActive}
        >
          <MicOff className="h-4 w-4 mr-1" />
          Off Air
        </Button>
      </div>
    </div>
  );
}
