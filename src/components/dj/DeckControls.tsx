import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Repeat, Repeat1, Gauge, X, Youtube } from 'lucide-react';
import { YouTubeSearch } from './YouTubeSearch';
import type { DeckState } from '@/hooks/useAudioEngine';

interface DeckControlsProps {
  id: 'A' | 'B';
  state: DeckState;
  onEQChange: (band: 'low' | 'mid' | 'high', value: number) => void;
  onSpeedChange: (speed: number) => void;
  onSetLoopStart: () => void;
  onSetLoopEnd: () => void;
  onToggleLoop: () => void;
  onClearLoop: () => void;
  onYoutubeUrlChange: (url: string) => void;
}

function extractYoutubeId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|v=|\/embed\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

export function DeckControls({
  id, state, onEQChange, onSpeedChange,
  onSetLoopStart, onSetLoopEnd, onToggleLoop, onClearLoop,
  onYoutubeUrlChange
}: DeckControlsProps) {
  const accentClass = id === 'A' ? 'text-primary' : 'text-accent';
  const youtubeId = extractYoutubeId(state.youtubeUrl);

  return (
    <div className="space-y-3">
      {/* EQ */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <h3 className={`text-xs font-bold tracking-wider ${accentClass}`}>EQ — DECK {id}</h3>
        <div className="grid grid-cols-3 gap-3">
          {(['low', 'mid', 'high'] as const).map(band => (
            <div key={band} className="space-y-1">
              <label className="text-[10px] text-muted-foreground uppercase font-bold">{band}</label>
              <Slider
                orientation="vertical"
                value={[state.eq[band]]}
                min={-12}
                max={12}
                step={0.5}
                onValueChange={([v]) => onEQChange(band, v)}
                className="h-16 mx-auto"
              />
              <span className="text-[10px] text-muted-foreground font-mono block text-center">{state.eq[band] > 0 ? '+' : ''}{state.eq[band]}dB</span>
            </div>
          ))}
        </div>
      </div>

      {/* Speed */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Gauge className="h-3 w-3 text-muted-foreground" />
          <h3 className="text-xs font-bold tracking-wider text-muted-foreground">SPEED</h3>
          <span className="text-xs font-mono text-muted-foreground ml-auto">{(state.speed * 100).toFixed(0)}%</span>
        </div>
        <Slider
          value={[state.speed * 100]}
          min={50}
          max={200}
          step={1}
          onValueChange={([v]) => onSpeedChange(v / 100)}
        />
        <Button size="sm" variant="ghost" className="text-xs w-full" onClick={() => onSpeedChange(1)}>
          Reset to 100%
        </Button>
      </div>

      {/* Loop */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <h3 className="text-xs font-bold tracking-wider text-muted-foreground">LOOP</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={onSetLoopStart} className="flex-1 text-xs">
            IN
          </Button>
          <Button size="sm" variant="outline" onClick={onSetLoopEnd} className="flex-1 text-xs">
            OUT
          </Button>
          <Button
            size="sm"
            variant={state.loopActive ? 'default' : 'outline'}
            onClick={onToggleLoop}
            disabled={state.loopStart === null || state.loopEnd === null}
            className="text-xs"
          >
            {state.loopActive ? <Repeat1 className="h-3 w-3" /> : <Repeat className="h-3 w-3" />}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClearLoop} className="text-xs">
            <X className="h-3 w-3" />
          </Button>
        </div>
        {state.loopStart !== null && state.loopEnd !== null && (
          <p className="text-[10px] text-muted-foreground font-mono text-center">
            {state.loopStart.toFixed(1)}s → {state.loopEnd.toFixed(1)}s
          </p>
        )}
      </div>

      {/* YouTube */}
      <div className="rounded-lg border bg-card p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Youtube className="h-3 w-3 text-destructive" />
          <h3 className="text-xs font-bold tracking-wider text-muted-foreground">YOUTUBE</h3>
        </div>
        <YouTubeSearch
          onSelect={(videoId, title) => onYoutubeUrlChange(`https://www.youtube.com/watch?v=${videoId}`)}
        />
        <Input
          placeholder="Or paste YouTube URL..."
          value={state.youtubeUrl}
          onChange={(e) => onYoutubeUrlChange(e.target.value)}
          className="text-xs h-8"
        />
        {youtubeId && (
          <div className="aspect-video rounded overflow-hidden">
            <iframe
              src={`https://www.youtube.com/embed/${youtubeId}?enablejsapi=1`}
              className="w-full h-full"
              allow="autoplay; encrypted-media"
              allowFullScreen
              title={`YouTube Deck ${id}`}
            />
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">
          YouTube plays separately — use for preview/reference.
        </p>
      </div>
    </div>
  );
}
