import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Square, Upload, Volume2, ChevronDown, ChevronUp } from 'lucide-react';
import { DeckControls } from './DeckControls';
import type { DeckState } from '@/hooks/useAudioEngine';
import type { DeckId } from '@/types/channels';
import { DECK_COLORS } from '@/types/channels';

interface DeckProps {
  id: DeckId;
  state: DeckState;
  analyser: AnalyserNode | null;
  channelName?: string;
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
  onYoutubePlay: () => void;
  onYoutubeStop: () => void;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function Deck({ id, state, analyser, channelName, onLoad, onPlay, onPause, onStop, onVolumeChange, onEQChange, onSpeedChange, onSetLoopStart, onSetLoopEnd, onToggleLoop, onClearLoop, onYoutubeUrlChange, onYoutubePlay, onYoutubeStop }: DeckProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showControls, setShowControls] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const hue = DECK_COLORS[id].hue;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (analyser) {
        const bufLen = analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        analyser.getByteFrequencyData(data);
        const barW = canvas.width / bufLen;
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

  const accentClass = DECK_COLORS[id].class;

  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-sm font-bold tracking-wider ${accentClass}`}>DECK {id}</h2>
          {channelName && <p className="text-[10px] text-muted-foreground">{channelName}</p>}
        </div>
        <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[100px]">
          {state.fileName || 'No track'}
        </span>
      </div>

      <canvas ref={canvasRef} width={300} height={40} className="w-full h-[40px] rounded bg-background" />

      <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
        <span>{formatTime(state.currentTime)}</span>
        <div className="flex items-center gap-1">
          {state.speed !== 1 && <span className="text-accent">{(state.speed * 100).toFixed(0)}%</span>}
          {state.loopActive && <span className="text-primary animate-pulse">LOOP</span>}
        </div>
        <span>-{formatTime(Math.max(0, state.duration - state.currentTime))}</span>
      </div>

      <div className="flex items-center gap-1">
        <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
          onChange={(e) => { const file = e.target.files?.[0]; if (file) onLoad(file); e.target.value = ''; }} />
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-3 w-3" />
        </Button>
        {state.isPlaying ? (
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onPause}>
            <Pause className="h-3 w-3" />
          </Button>
        ) : (
          <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onPlay} disabled={!state.fileName}>
            <Play className="h-3 w-3" />
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onStop} disabled={!state.fileName}>
          <Square className="h-3 w-3" />
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto text-[10px] h-7" onClick={() => setShowControls(!showControls)}>
          {showControls ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Volume2 className="h-3 w-3 text-muted-foreground shrink-0" />
        <Slider value={[state.volume * 100]} max={100} step={1} onValueChange={([v]) => onVolumeChange(v / 100)} className="flex-1" />
      </div>

      {showControls && (
        <DeckControls id={id} state={state} onEQChange={onEQChange} onSpeedChange={onSpeedChange}
          onSetLoopStart={onSetLoopStart} onSetLoopEnd={onSetLoopEnd} onToggleLoop={onToggleLoop} onClearLoop={onClearLoop}
          onYoutubeUrlChange={onYoutubeUrlChange} onYoutubePlay={onYoutubePlay} onYoutubeStop={onYoutubeStop} />
      )}
    </div>
  );
}
