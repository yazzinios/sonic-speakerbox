import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Play, Pause, Square, Upload, Volume2, ChevronDown, ChevronUp, Radio, ListMusic, SkipForward, Shuffle, Copy } from 'lucide-react';
import { DeckControls } from './DeckControls';
import type { DeckState } from '@/hooks/useAudioEngine';
import type { ServerDeckState } from '@/hooks/useServerDeck';
import type { DeckId } from '@/types/channels';
import { DECK_COLORS } from '@/types/channels';
import { SERVER_MODE, getDeckStreamUrl } from '@/lib/streamingServer';
import { toast } from 'sonner';

interface DeckProps {
  id: DeckId;
  channelName?: string;

  // Browser mode props (used when SERVER_MODE = false)
  browserState?: DeckState;
  analyser?: AnalyserNode | null;
  onBrowserLoad?: (file: File) => void;
  onBrowserPlay?: () => void;
  onBrowserPause?: () => void;
  onBrowserStop?: () => void;
  onVolumeChange?: (vol: number) => void;
  onEQChange?: (band: 'low' | 'mid' | 'high', value: number) => void;
  onSpeedChange?: (speed: number) => void;
  onSetLoopStart?: () => void;
  onSetLoopEnd?: () => void;
  onToggleLoop?: () => void;
  onClearLoop?: () => void;
  onYoutubeUrlChange?: (url: string) => void;
  onYoutubePlay?: () => void;
  onYoutubeStop?: () => void;

  // Server mode props (used when SERVER_MODE = true)
  serverState?: ServerDeckState;
  onServerPlay?: () => void;
  onServerPause?: () => void;
  onServerStop?: () => void;
  onServerSkip?: () => void;
  onServerAutoDJ?: (enabled: boolean) => void;
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function cleanTrackName(name: string | null): string {
  if (!name) return 'No track';
  return name.replace(/^\d+_/, '');
}

export function Deck({
  id, channelName,
  browserState, analyser,
  onBrowserLoad, onBrowserPlay, onBrowserPause, onBrowserStop,
  onVolumeChange, onEQChange, onSpeedChange,
  onSetLoopStart, onSetLoopEnd, onToggleLoop, onClearLoop,
  onYoutubeUrlChange, onYoutubePlay, onYoutubeStop,
  serverState,
  onServerPlay, onServerPause, onServerStop, onServerSkip, onServerAutoDJ,
}: DeckProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showControls, setShowControls] = useState(false);

  const color = DECK_COLORS[id];

  // ── Visualizer ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const hue = color.hue;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (!SERVER_MODE && analyser) {
        // Real frequency data from Web Audio
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
      } else if (SERVER_MODE && serverState?.streaming) {
        // Animated pulse when server is streaming
        const t = Date.now() / 800;
        const barCount = 32;
        const barW = canvas.width / barCount;
        for (let i = 0; i < barCount; i++) {
          const h = (Math.sin(t + i * 0.4) * 0.4 + 0.5) * canvas.height * 0.65;
          ctx.fillStyle = `hsla(${hue}, 80%, 55%, 0.6)`;
          ctx.fillRect(i * barW, canvas.height - h, barW - 1, h);
        }
      }
      animRef.current = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, [analyser, color.hue, serverState?.streaming]);

  // ── Derived display values ────────────────────────────────────────────────
  const isServerMode = SERVER_MODE;

  // Track name to display
  const displayTrack = isServerMode
    ? cleanTrackName(serverState?.currentTrack?.name || serverState?.trackName || null)
    : cleanTrackName(browserState?.fileName || null);

  // Is something playing?
  const isPlaying = isServerMode
    ? (serverState?.streaming && serverState?.mode !== null)
    : (browserState?.isPlaying ?? false);

  // Playlist info
  const inPlaylist = isServerMode
    ? serverState?.mode === 'playlist'
    : false;
  const playlistIdx = serverState?.playlistIndex ?? 0;
  const playlistLen = serverState?.playlistLength ?? 0;

  // Mode badge
  const modeBadge = isServerMode ? (
    serverState?.mode === 'live' ? '🔴 Live' :
    serverState?.mode === 'playlist' ? '📋 Playlist' :
    serverState?.mode === 'file' ? '🎵 File' :
    serverState?.mode === 'autodj' ? '🔀 AutoDJ' : null
  ) : null;

  const copyStreamUrl = () => {
    const url = getDeckStreamUrl(id);
    navigator.clipboard.writeText(url).then(
      () => toast.success(`Stream URL copied — paste into VLC`),
      () => toast.info(`VLC URL: ${url}`)
    );
  };

  return (
    <div className={`rounded-lg border bg-card p-3 space-y-2 transition-colors ${
      isServerMode && serverState?.streaming ? `border-${color.class}/40` : ''
    }`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className={`text-sm font-bold tracking-wider ${color.class}`}>DECK {id}</h2>
          {channelName && <p className="text-[10px] text-muted-foreground">{channelName}</p>}
        </div>
        <div className="text-right space-y-0.5">
          <span className="text-[10px] text-muted-foreground font-mono truncate max-w-[110px] block">
            {displayTrack}
          </span>
          <div className="flex items-center justify-end gap-1.5 flex-wrap">
            {isServerMode && serverState?.streaming && (
              <span className="flex items-center gap-0.5 text-[9px] text-green-500 font-bold">
                <Radio className="h-2.5 w-2.5 animate-pulse" /> LIVE
              </span>
            )}
            {modeBadge && (
              <span className="text-[9px] text-muted-foreground">{modeBadge}</span>
            )}
            {inPlaylist && (
              <span className="flex items-center gap-0.5 text-[9px] text-primary font-semibold">
                <ListMusic className="h-2.5 w-2.5" /> {playlistIdx + 1}/{playlistLen}
              </span>
            )}
            {!isServerMode && browserState?.loopActive && (
              <span className="text-[9px] text-primary animate-pulse">LOOP</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Visualizer ──────────────────────────────────────────────────── */}
      <canvas ref={canvasRef} width={300} height={40} className="w-full h-[40px] rounded bg-background" />

      {/* ── Time bar (browser mode only) ────────────────────────────────── */}
      {!isServerMode && browserState && (
        <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
          <span>{formatTime(browserState.currentTime)}</span>
          <div className="flex items-center gap-1">
            {browserState.speed !== 1 && <span className="text-accent">{(browserState.speed * 100).toFixed(0)}%</span>}
          </div>
          <span>-{formatTime(Math.max(0, browserState.duration - browserState.currentTime))}</span>
        </div>
      )}

      {/* ── Controls ────────────────────────────────────────────────────── */}
      {isServerMode ? (
        /* Server mode controls */
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            {/* Play */}
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onServerPlay}
              title="Play / Resume">
              <Play className="h-3 w-3" />
            </Button>
            {/* Stop */}
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onServerStop}
              title="Stop (returns to AutoDJ)">
              <Square className="h-3 w-3" />
            </Button>
            {/* Skip */}
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onServerSkip}
              title="Skip to next track">
              <SkipForward className="h-3 w-3" />
            </Button>
            {/* AutoDJ toggle */}
            <Button
              size="sm"
              variant={serverState?.autoDJEnabled ? 'default' : 'outline'}
              className="h-7 px-2 text-[10px]"
              onClick={() => onServerAutoDJ?.(!serverState?.autoDJEnabled)}
              title="Toggle AutoDJ"
            >
              <Shuffle className="h-3 w-3 mr-1" />
              ADJ
            </Button>
            {/* Copy VLC URL */}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 ml-auto" onClick={copyStreamUrl}
              title="Copy VLC stream URL">
              <Copy className="h-3 w-3" />
            </Button>
            {/* Expand (for EQ etc. — still useful for server mode visual) */}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setShowControls(!showControls)}>
              {showControls ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>
          {/* VLC stream URL display */}
          <div className="flex items-center gap-1 bg-muted/30 rounded px-2 py-1">
            <Radio className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
            <span className="text-[10px] font-mono text-muted-foreground truncate">
              {getDeckStreamUrl(id)}
            </span>
          </div>
        </div>
      ) : (
        /* Browser mode controls */
        <div className="space-y-1">
          <div className="flex items-center gap-1">
            <input ref={fileInputRef} type="file" accept="audio/*" className="hidden"
              onChange={(e) => { const file = e.target.files?.[0]; if (file) onBrowserLoad?.(file); e.target.value = ''; }} />
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3 w-3" />
            </Button>
            {browserState?.isPlaying ? (
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onBrowserPause}>
                <Pause className="h-3 w-3" />
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onBrowserPlay}
                disabled={!browserState?.fileName}>
                <Play className="h-3 w-3" />
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={onBrowserStop}
              disabled={!browserState?.fileName}>
              <Square className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto h-7 w-7 p-0" onClick={() => setShowControls(!showControls)}>
              {showControls ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
          </div>
          {browserState && (
            <div className="flex items-center gap-1">
              <Volume2 className="h-3 w-3 text-muted-foreground shrink-0" />
              <Slider value={[browserState.volume * 100]} max={100} step={1}
                onValueChange={([v]) => onVolumeChange?.(v / 100)} className="flex-1" />
            </div>
          )}
        </div>
      )}

      {/* ── Extended controls (EQ, speed, loop, YouTube) — browser mode only ── */}
      {showControls && !isServerMode && browserState && (
        <DeckControls
          id={id} state={browserState}
          onEQChange={onEQChange!} onSpeedChange={onSpeedChange!}
          onSetLoopStart={onSetLoopStart!} onSetLoopEnd={onSetLoopEnd!}
          onToggleLoop={onToggleLoop!} onClearLoop={onClearLoop!}
          onYoutubeUrlChange={onYoutubeUrlChange!}
          onYoutubePlay={onYoutubePlay!} onYoutubeStop={onYoutubeStop!}
        />
      )}

      {/* Server mode expanded: show playlist tracks if in playlist mode */}
      {showControls && isServerMode && inPlaylist && serverState?.playlist && (
        <div className="border-t pt-2 space-y-1 max-h-28 overflow-y-auto">
          {serverState.playlist.map((t, i) => (
            <div key={i} className={`text-xs px-2 py-0.5 rounded truncate ${i === playlistIdx ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground'}`}>
              {i === playlistIdx ? '▶ ' : `${i + 1}. `}{cleanTrackName(t.name)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
