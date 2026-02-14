import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Square, Upload, Volume2, ChevronDown, ChevronUp } from 'lucide-react';
import { DeckControls } from './DeckControls';
import type { DeckState } from '@/hooks/useAudioEngine';

interface DeckProps {
  id: 'A' | 'B';
  state: DeckState;
  analyser: AnalyserNode | null;
  onLoad: (file: File) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onVolumeChange: (vol: number) => void;
  onEQChange: (band: 'low' | 'mid' | 'high', value: number) => void;
  onSpeedChange: (speed: number) => void;
  onSetLoopStart: () => void;
  onSetLoopEnd: () => void;
  onToggleLoop: () => void;
  onClearLoop: () => void;
  onYoutubeUrlChange: (url: string) => void;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Deck({ id, state, analyser, onLoad, onPlay, onPause, onStop, onVolumeChange, onEQChange, onSpeedChange, onSetLoopStart, onSetLoopEnd, onToggleLoop, onClearLoop, onYoutubeUrlChange }: DeckProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (analyser) {
        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        analyser.getByteFrequencyData(data);
        const barW = canvas.width / bufLen;
        const hue = id === 'A' ? 185 : 320;

        for (let i = 0; i < bufLen; i++) {
          const h = (data[i] / 255) * canvas.height;
          const lightness = 50 + (data[i] / 255) * 20;
          ctx.fillStyle = `hsla(${hue}, 100%, ${lightness}%, 0.85)`;
          ctx.fillRect(i * barW, canvas.height - h, barW - 1, h);
        }
      }

      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [analyser, id]);

  const accentClass = id === 'A' ? 'text-primary' : 'text-accent';

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className={`text-lg font-bold tracking-wider ${accentClass}`}>DECK {id}</h2>
        <span className="text-xs text-muted-foreground font-mono truncate max-w-[140px]">
          {state.fileName || 'No track loaded'}
        </span>
      </div>

      <canvas
        ref={canvasRef}
        width={300}
        height={60}
        className="w-full h-[60px] rounded bg-background"
      />

      <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
        <span>{formatTime(state.currentTime)}</span>
        <div className="flex items-center gap-2">
          {state.speed !== 1 && <span className="text-accent">{(state.speed * 100).toFixed(0)}%</span>}
          {state.loopActive && <span className="text-primary animate-pulse">LOOP</span>}
        </div>
        <span>-{formatTime(Math.max(0, state.duration - state.currentTime))}</span>
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onLoad(file);
            e.target.value = '';
          }}
        />
        <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-3 w-3" />
        </Button>
        {state.isPlaying ? (
          <Button size="sm" variant="outline" onClick={onPause}>
            <Pause className="h-3 w-3" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onPlay} disabled={!state.fileName}>
            <Play className="h-3 w-3" />
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onStop} disabled={!state.fileName}>
          <Square className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-xs"
          onClick={() => setShowControls(!showControls)}
        >
          {showControls ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          <span className="ml-1">Controls</span>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Volume2 className="h-3 w-3 text-muted-foreground shrink-0" />
        <Slider
          value={[state.volume * 100]}
          max={100}
          step={1}
          onValueChange={([v]) => onVolumeChange(v / 100)}
          className="flex-1"
        />
      </div>

      {showControls && (
        <DeckControls
          id={id}
          state={state}
          onEQChange={onEQChange}
          onSpeedChange={onSpeedChange}
          onSetLoopStart={onSetLoopStart}
          onSetLoopEnd={onSetLoopEnd}
          onToggleLoop={onToggleLoop}
          onClearLoop={onClearLoop}
          onYoutubeUrlChange={onYoutubeUrlChange}
        />
      )}
    </div>
  );
}
