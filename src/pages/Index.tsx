import { useState, useEffect, useCallback, useRef } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { useHLSBroadcast } from '@/hooks/useHLSBroadcast';
import { useRequestHost } from '@/hooks/useMusicRequests';
import { useAuth } from '@/hooks/useAuth';
import { useCloudSettings } from '@/hooks/useCloudSettings';
import { useLibrary } from '@/hooks/useLibrary';
import { usePlaylists } from '@/hooks/usePlaylist';
import { Deck } from '@/components/dj/Deck';
import { MicSection, type MicTarget } from '@/components/dj/MicSection';
import { AnnouncementSection } from '@/components/dj/AnnouncementSection';
import { StatsSection } from '@/components/dj/StatsSection';
import { LibraryPanel } from '@/components/dj/LibraryPanel';
import { PlaylistPanel } from '@/components/dj/PlaylistPanel';
import { Button } from '@/components/ui/button';
import { Users, Wifi, WifiOff, Copy, Settings, Music, X, LogOut, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { ALL_DECKS, DECK_COLORS, type DeckId } from '@/types/channels';
import { STREAMING_SERVER, SERVER_MODE } from '@/lib/streamingServer';
import { ServerModePanel } from '@/components/dj/ServerModePanel';
import type { LibraryTrack } from '@/hooks/useLibrary';

function decodeServerName(serverName: string): string {
  return serverName.replace(/^\d+_/, '');
}

const Index = () => {
  const engine = useAudioEngine();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { settings, channels } = useCloudSettings();
  const { isHosting, listenerCount, listenerCounts, startHosting, stopHosting } = useHLSBroadcast();
  const { requests, requestPeerId, isListening, startListening, stopListening, dismissRequest } = useRequestHost();
  const [micTarget, setMicTarget] = useState<MicTarget>('all');

  const [serverDeckInfo, setServerDeckInfo] = useState<Record<string, any>>({});
  const [serverHasStream, setServerHasStream] = useState(false);
  // Always-current ref for use in event handlers / beforeunload
  const serverDeckInfoRef = useRef<Record<string, any>>({});
  useEffect(() => { serverDeckInfoRef.current = serverDeckInfo; }, [serverDeckInfo]);

  const { tracks: library, loading: libraryLoading, addTracks, deleteTrack } = useLibrary();

  const {
    playlists, loading: playlistLoading,
    createPlaylist, renamePlaylist, deletePlaylist,
    addTracksToPlaylist, removeTrackFromPlaylist, moveTrack,
    playPlaylistOnDeck, skipNext, jumpToTrack,
  } = usePlaylists();

  const [pendingTrackForPlaylist, setPendingTrackForPlaylist] = useState<LibraryTrack | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [newPlaylistDeck, setNewPlaylistDeck] = useState<DeckId>('A');

  // ── Poll server deck info every 3s ────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${STREAMING_SERVER}/deck-info`, { signal: AbortSignal.timeout(2500) });
        if (!res.ok) return;
        const info = await res.json();
        if (!cancelled) {
          setServerDeckInfo(info);
          const anyStreaming = Object.values(info).some((d: any) => d.streaming);
          setServerHasStream(anyStreaming && !isHosting);
        }
      } catch { /* server offline */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [isHosting]);

  // ── Keep stream alive when browser closes ─────────────────────────────────
  // If a deck is in live WebSocket mode and the browser closes, switch it to
  // file mode via sendBeacon so the stream keeps playing server-side.
  useEffect(() => {
    const handleUnload = () => {
      const info = serverDeckInfoRef.current;
      ALL_DECKS.forEach(deck => {
        const d = info[deck];
        if (!d) return;
        // file/playlist modes already keep playing — only need to handle live mode
        if (d.mode === 'live' && d.trackPath) {
          navigator.sendBeacon(
            `${STREAMING_SERVER}/deck/${deck}/play`,
            new Blob([JSON.stringify({ loop: false })], { type: 'application/json' })
          );
        }
      });
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, []);

  useEffect(() => {
    if (settings.jingle_url) {
      fetch(settings.jingle_url).then(r => r.arrayBuffer()).then(b => engine.setCustomJingle(b)).catch(() => {});
    }
  }, [settings.jingle_url]);

  // ── Stop server deck ──────────────────────────────────────────────────────
  const stopServerDeck = useCallback(async (deck: DeckId) => {
    try {
      await fetch(`${STREAMING_SERVER}/deck/${deck}/stop`, { method: 'POST' });
    } catch { /* ignore */ }
  }, []);

  // ── Load library track to deck ────────────────────────────────────────────
  // FIX: fetches audio from server → loads into local engine (so it plays in
  // browser with waveform) → tells server to stream it via HLS
  const loadLibraryTrackToDeck = useCallback(async (track: LibraryTrack, deck: DeckId) => {
    try {
      // 1. Fetch audio blob from server for local playback
      const fileRes = await fetch(
        `${STREAMING_SERVER}/library/audio/${encodeURIComponent(track.serverName)}`
      );
      if (!fileRes.ok) throw new Error('Audio file not found on server');
      const blob = await fileRes.blob();
      const file = new File([blob], track.name, { type: blob.type || 'audio/mpeg' });

      // 2. Load into browser audio engine + auto-play
      engine.loadTrack(deck, file);
      engine.play(deck);

      // 3. Tell server to also play it on the HLS stream
      const res = await fetch(`${STREAMING_SERVER}/deck/${deck}/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName: track.serverName, loop: false }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Server error');
      }
      toast.success(`▶ "${track.name}" on Deck ${deck}`);
    } catch (err: any) {
      toast.error(`Could not load to deck: ${err.message}`);
    }
  }, [engine]);

  // ── Create playlist from track shortcut ──────────────────────────────────
  const handleCreatePlaylistFromTrack = useCallback((track: LibraryTrack) => {
    setPendingTrackForPlaylist(track);
    setNewPlaylistName('My Playlist');
    setNewPlaylistDeck('A');
  }, []);

  const confirmCreatePlaylist = async () => {
    if (!newPlaylistName.trim() || !pendingTrackForPlaylist) return;
    const pl = await createPlaylist(newPlaylistDeck, newPlaylistName.trim());
    if (pl) {
      await addTracksToPlaylist(pl.id, [pendingTrackForPlaylist]);
      toast.success(`Added "${pendingTrackForPlaylist.name}" to "${newPlaylistName}"`);
    }
    setPendingTrackForPlaylist(null);
    setNewPlaylistName('');
  };

  // ── Broadcast ─────────────────────────────────────────────────────────────
  const handleStartBroadcast = async () => {
    const stream = engine.getOutputStream();
    if (!stream) {
      toast.error('Could not initialize audio. Try clicking Play first.');
      return;
    }
    try {
      const res = await fetch(`${STREAMING_SERVER}/health`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('unhealthy');
    } catch {
      toast.error('Streaming server not reachable on port 3001.');
      return;
    }
    startHosting(engine.getDeckOutputStream);
    setServerHasStream(false);
    if (!isListening) startListening();
  };

  const copyToClipboard = (text: string, msg: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => toast.success(msg)).catch(() => fallbackCopy(text, msg));
    } else fallbackCopy(text, msg);
  };
  const fallbackCopy = (text: string, msg: string) => {
    const el = document.createElement('textarea');
    el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
    document.body.appendChild(el); el.focus(); el.select();
    try { document.execCommand('copy'); toast.success(msg); }
    catch { toast.error('Copy failed — paste manually: ' + text); }
    document.body.removeChild(el);
  };
  const copyListenLink = (code: string) =>
    copyToClipboard(`${window.location.origin}/listen?code=${code}`, `Listen link copied!`);
  const copyRequestLink = () => {
    if (!requestPeerId) { toast.error('Request system initializing…'); return; }
    copyToClipboard(`${window.location.origin}/request?host=${requestPeerId}`, 'Request link copied!');
  };

  const handleStartMic = () => {
    const targets: DeckId[] = micTarget === 'all' ? [...ALL_DECKS] : (micTarget as DeckId[]);
    engine.startMic(targets);
  };

  const liveServerDecks = ALL_DECKS.filter(id => serverDeckInfo[id]?.streaming);

  return (
    <div className="min-h-screen bg-background p-3 md:p-4"
      style={settings.bg_image ? { backgroundImage: `url(${settings.bg_image})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' } : undefined}>
      {settings.bg_image && <div className="fixed inset-0 bg-background/80 backdrop-blur-sm -z-0" />}
      <div className="relative z-10">
        <header className="text-center mb-4">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-2xl font-bold text-primary tracking-[0.3em]">{settings.station_name}</h1>
            <Button size="sm" variant="ghost" onClick={() => navigate('/settings')}><Settings className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">4-Channel DJ Console</p>
        </header>

        <main className="max-w-6xl mx-auto space-y-4">

          {/* ── SERVER MODE PANEL ────────────────────────────────────────── */}
          {SERVER_MODE && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold tracking-wider text-primary">SERVER MODE — Browser is Remote Control Only</h2>
              </div>
              <ServerModePanel library={library} onLoadTrack={() => {}} />
            </div>
          )}

          {/* Stream live banner */}
          {serverHasStream && !isHosting && (
            <div className="rounded-lg border border-green-500/50 bg-green-500/10 p-3 flex items-start gap-3">
              <Radio className="h-5 w-5 text-green-500 shrink-0 mt-0.5 animate-pulse" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-green-600">Stream is live from your last session</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                  {liveServerDecks.map(id => {
                    const info = serverDeckInfo[id];
                    return (
                      <div key={id} className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${DECK_COLORS[id].class} border-current`}>{id}</span>
                        <span className="text-xs text-muted-foreground truncate max-w-[140px]">
                          {info.mode === 'playlist'
                            ? `Playlist · ${(info.playlistIndex || 0) + 1}/${info.playlistLength}`
                            : info.trackName ? decodeServerName(info.trackName) : 'Live'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <Button size="sm" onClick={handleStartBroadcast} className="shrink-0 text-xs gap-1">
                <Wifi className="h-3 w-3" /> Resume Control
              </Button>
            </div>
          )}

          {/* 4 Decks */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ALL_DECKS.map(id => {
              const ch = channels.find(c => c.deck_id === id);
              const deckInfo = serverDeckInfo[id] || {};
              return (
                <Deck key={id} id={id}
                  state={engine.decks[id]}
                  analyser={engine.getAnalyser(id)}
                  channelName={ch?.name}
                  serverInfo={deckInfo}
                  onLoad={(f) => { addTracks([f]); engine.loadTrack(id, f); }}
                  onPlay={() => engine.play(id)}
                  onPause={() => engine.pause(id)}
                  onStop={() => { engine.stop(id); if (deckInfo.streaming) stopServerDeck(id); }}
                  onVolumeChange={(v) => engine.setVolume(id, v)}
                  onEQChange={(band, val) => engine.setEQ(id, band, val)}
                  onSpeedChange={(s) => engine.setSpeed(id, s)}
                  onSetLoopStart={() => engine.setLoopStart(id)}
                  onSetLoopEnd={() => engine.setLoopEnd(id)}
                  onToggleLoop={() => engine.toggleLoop(id)}
                  onClearLoop={() => engine.clearLoop(id)}
                  onYoutubeUrlChange={(url) => engine.setYoutubeUrl(id, url)}
                  onYoutubePlay={() => engine.youtubePlay(id)}
                  onYoutubeStop={() => engine.youtubeStop(id)}
                />
              );
            })}
          </div>

          {/* Library + Playlists */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LibraryPanel
              tracks={library}
              loading={libraryLoading}
              onAddTracks={addTracks}
              onLoadToDeck={loadLibraryTrackToDeck}
              onDelete={deleteTrack}
              playlists={playlists}
              onAddToPlaylist={(track, playlistId) => addTracksToPlaylist(playlistId, [track])}
              onCreatePlaylistFromTrack={handleCreatePlaylistFromTrack}
            />
            <PlaylistPanel
              playlists={playlists}
              loading={playlistLoading}
              serverDeckInfo={serverDeckInfo}
              onCreatePlaylist={createPlaylist}
              onRenamePlaylist={renamePlaylist}
              onDeletePlaylist={deletePlaylist}
              onRemoveTrack={removeTrackFromPlaylist}
              onMoveTrack={moveTrack}
              onPlayOnDeck={playPlaylistOnDeck}
              onSkipNext={skipNext}
              onJumpToTrack={jumpToTrack}
            />
          </div>

          <AnnouncementSection onPlayAnnouncement={engine.playAnnouncement} onDuckStart={engine.duckStart} onDuckEnd={engine.duckEnd} />
          <StatsSection decks={engine.decks} micActive={engine.micActive} listenerCount={listenerCount} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MicSection micActive={engine.micActive} jinglePlaying={engine.jinglePlaying}
              micTarget={micTarget} onStartMic={handleStartMic} onStopMic={engine.stopMic} onMicTargetChange={setMicTarget} />

            {/* Broadcast */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-wider">BROADCAST</h2>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" /><span>{listenerCount}</span>
                </div>
              </div>
              {!isHosting ? (
                <Button onClick={handleStartBroadcast} className="w-full">
                  <Wifi className="h-4 w-4 mr-1" />
                  {serverHasStream ? 'Resume Broadcasting' : 'Start Broadcasting'}
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Channel codes for listeners:</p>
                  {channels.map(ch => (
                    <div key={ch.deck_id} className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${DECK_COLORS[ch.deck_id].class}`}>{ch.deck_id}</span>
                      <code className="flex-1 bg-background rounded px-2 py-1 text-[10px] font-mono truncate">{ch.code}</code>
                      <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                        <Users className="h-3 w-3" />{listenerCounts[ch.deck_id] ?? 0}
                      </span>
                      <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => copyListenLink(ch.code)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  {requestPeerId && (
                    <Button size="sm" variant="outline" onClick={copyRequestLink} className="w-full text-xs">
                      <Music className="h-3 w-3 mr-1" /> Copy Request Link
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => { stopHosting(); stopListening(); }} className="w-full">
                    <WifiOff className="h-4 w-4 mr-1" /> Stop Broadcasting
                  </Button>
                </div>
              )}
            </section>

            {/* Requests */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Music className="h-4 w-4 text-accent" />
                <h2 className="text-lg font-bold tracking-wider">REQUESTS</h2>
                {requests.length > 0 && (
                  <span className="bg-accent text-accent-foreground text-xs px-1.5 py-0.5 rounded-full font-bold">{requests.length}</span>
                )}
              </div>
              {requests.length === 0
                ? <p className="text-xs text-muted-foreground text-center py-3">No song requests yet</p>
                : <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {requests.map(req => (
                      <div key={req.id} className="flex items-start gap-2 p-2 rounded bg-background text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate">{req.song}</p>
                          <p className="text-muted-foreground truncate">{req.name} • {req.phone}</p>
                        </div>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0 shrink-0" onClick={() => dismissRequest(req.id)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
              }
            </section>
          </div>
        </main>
      </div>

      {/* New playlist from track dialog */}
      {pendingTrackForPlaylist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card border rounded-xl p-5 w-80 space-y-3 shadow-2xl">
            <h3 className="text-sm font-bold">Create New Playlist</h3>
            <p className="text-xs text-muted-foreground truncate">
              Adding: <span className="text-foreground">{pendingTrackForPlaylist.name}</span>
            </p>
            <input
              type="text"
              className="w-full rounded border bg-background text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Playlist name..."
              value={newPlaylistName}
              onChange={e => setNewPlaylistName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmCreatePlaylist(); if (e.key === 'Escape') setPendingTrackForPlaylist(null); }}
              autoFocus
            />
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Assign to deck:</p>
              <div className="flex gap-1">
                {ALL_DECKS.map(d => (
                  <button key={d} onClick={() => setNewPlaylistDeck(d)}
                    className={`flex-1 text-xs font-bold py-1 rounded border transition-colors
                      ${newPlaylistDeck === d ? `${DECK_COLORS[d].class} border-current bg-current/10` : 'border-muted-foreground/30 text-muted-foreground'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 text-xs h-7" onClick={confirmCreatePlaylist} disabled={!newPlaylistName.trim()}>
                Create & Add
              </Button>
              <Button variant="outline" className="flex-1 text-xs h-7" onClick={() => setPendingTrackForPlaylist(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
