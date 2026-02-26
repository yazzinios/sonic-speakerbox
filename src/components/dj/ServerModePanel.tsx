/**
 * ServerModePanel — Shown when SERVER_MODE = true
 *
 * Displays:
 * - Server connection status
 * - Per-deck status (what's playing on the server)
 * - VLC stream URLs so Windows can play the audio
 * - Controls to load tracks, stop decks, toggle AutoDJ
 */
import { useState } from 'react';
import { Wifi, WifiOff, Radio, Square, Shuffle, Copy, ChevronDown, ChevronUp, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { type DeckId, ALL_DECKS, DECK_COLORS } from '@/types/channels';
import { useServerDeck, type ServerDeckInfo } from '@/hooks/useServerDeck';
import type { LibraryTrack } from '@/hooks/useLibrary';

interface ServerModePanelProps {
  library: LibraryTrack[];
  onLoadTrack: (deck: DeckId, serverName: string) => void;
}

function DeckCard({
  deck,
  info,
  library,
  onLoad,
  onStop,
  onAutoDJ,
}: {
  deck: DeckId;
  info: ServerDeckInfo;
  library: LibraryTrack[];
  onLoad: (serverName: string) => void;
  onStop: () => void;
  onAutoDJ: (enabled: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const color = DECK_COLORS[deck];
  const modeLabel =
    info.mode === 'live' ? '🔴 Live DJ' :
    info.mode === 'playlist' ? '📋 Playlist' :
    info.mode === 'file' ? '🎵 File' :
    info.mode === 'autodj' ? '🔀 AutoDJ' :
    '⏸ Idle';

  const copyUrl = () => {
    navigator.clipboard.writeText(info.streamUrl);
    toast.success(`Copied stream URL for Deck ${deck}`);
  };

  return (
    <div className={`rounded-lg border bg-card p-3 space-y-2 border-${color.class}/30`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${info.streaming ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`} />
          <span className={`font-bold text-sm text-${color.class}`}>Deck {deck}</span>
          <span className="text-xs text-muted-foreground">{modeLabel}</span>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded(p => !p)}>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </div>

      {/* Now playing */}
      <div className="text-xs text-muted-foreground truncate">
        {info.trackName
          ? <span className="text-foreground font-medium">{info.trackName.replace(/^\d+_/, '')}</span>
          : <span className="italic">No track</span>
        }
        {info.mode === 'playlist' && info.playlistLength > 0 && (
          <span className="ml-2 text-muted-foreground">
            ({info.playlistIndex + 1}/{info.playlistLength})
          </span>
        )}
      </div>

      {/* Stream URL */}
      <div className="flex items-center gap-1 bg-muted/30 rounded px-2 py-1">
        <Radio className="h-3 w-3 text-muted-foreground shrink-0" />
        <span className="text-xs font-mono text-muted-foreground truncate flex-1">{info.streamUrl}</span>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={copyUrl}>
          <Copy className="h-3 w-3" />
        </Button>
      </div>

      {/* Controls */}
      <div className="flex gap-1 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onStop}
        >
          <Square className="h-3 w-3 mr-1" />
          Stop
        </Button>
        <Button
          variant={info.autoDJEnabled ? 'default' : 'outline'}
          size="sm"
          className="h-7 text-xs"
          onClick={() => onAutoDJ(!info.autoDJEnabled)}
        >
          <Shuffle className="h-3 w-3 mr-1" />
          AutoDJ
        </Button>
      </div>

      {/* Expanded: load a track from library */}
      {expanded && (
        <div className="space-y-1 border-t pt-2">
          <p className="text-xs text-muted-foreground font-medium">Load from library:</p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {library.length === 0 && (
              <p className="text-xs text-muted-foreground italic">No tracks uploaded yet</p>
            )}
            {library.map(track => (
              <button
                key={track.id}
                onClick={() => onLoad(track.serverName)}
                className="w-full text-left text-xs px-2 py-1 rounded hover:bg-accent truncate flex items-center gap-2"
              >
                <Music className="h-3 w-3 shrink-0 text-muted-foreground" />
                {track.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ServerModePanel({ library }: ServerModePanelProps) {
  const { deckInfo, serverOnline, loadTrack, stopDeck, setAutoDJ } = useServerDeck();

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
        serverOnline ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
      }`}>
        {serverOnline
          ? <><Wifi className="h-4 w-4" /> Server online — audio playing on server</>
          : <><WifiOff className="h-4 w-4" /> Server offline — check docker containers</>
        }
      </div>

      {/* VLC instructions */}
      {serverOnline && (
        <div className="bg-muted/30 rounded-lg px-3 py-2 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">🎧 To hear audio on Windows:</p>
          <p>Open VLC → Media → Open Network Stream → paste a stream URL below</p>
          <p className="text-yellow-400">Keep VLC open — it's your speaker output</p>
        </div>
      )}

      {/* Deck cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {ALL_DECKS.map(deck => (
          <DeckCard
            key={deck}
            deck={deck}
            info={deckInfo[deck]}
            library={library}
            onLoad={serverName => loadTrack(deck, serverName)}
            onStop={() => stopDeck(deck)}
            onAutoDJ={enabled => setAutoDJ(deck, enabled)}
          />
        ))}
      </div>
    </div>
  );
}
