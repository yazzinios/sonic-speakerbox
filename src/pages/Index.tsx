import { useState, useCallback, useRef } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { useHLSBroadcast } from '@/hooks/useHLSBroadcast';
import { useRequestHost } from '@/hooks/useMusicRequests';
import { useAuth } from '@/hooks/useAuth';
import { useCloudSettings } from '@/hooks/useCloudSettings';
import { useLibrary } from '@/hooks/useLibrary';
import { usePlaylists } from '@/hooks/usePlaylist';
import { useServerDeck } from '@/hooks/useServerDeck';
import { Deck } from '@/components/dj/Deck';
import { MicSection, type MicTarget } from '@/components/dj/MicSection';
import { AnnouncementSection } from '@/components/dj/AnnouncementSection';
import { StatsSection } from '@/components/dj/StatsSection';
import { LibraryPanel } from '@/components/dj/LibraryPanel';
import { PlaylistPanel } from '@/components/dj/PlaylistPanel';
import { Button } from '@/components/ui/button';
import { Users, Wifi, WifiOff, Copy, Settings, Music, X, LogOut, Radio, BarChart2 } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { ALL_DECKS, DECK_COLORS, type DeckId } from '@/types/channels';
import { STREAMING_SERVER, SERVER_MODE, getDeckStreamUrl } from '@/lib/streamingServer';
import type { LibraryTrack } from '@/hooks/useLibrary';
import { useEffect } from 'react';

const Index = () => {
  const engine = useAudioEngine();
  const server = useServerDeck(); // always initialized — used in SERVER_MODE
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { settings, channels } = useCloudSettings();
  const { isHosting, listenerCount, listenerCounts, startHosting, stopHosting } = useHLSBroadcast();
  const { requests, requestPeerId, isListening, startListening, stopListening, dismissRequest } = useRequestHost();
  const [micTarget, setMicTarget] = useState<MicTarget>('all');

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

  // Load jingle if configured
  useEffect(() => {
    if (settings.jingle_url) {
      fetch(settings.jingle_url)
        .then(r => r.arrayBuffer())
        .then(b => engine.setCustomJingle(b))
        .catch(() => {});
    }
  }, [settings.jingle_url]);

  // ── Library: load track to deck ─────────────────────────────────────────
  // SERVER_MODE: only tell server — no browser audio
  // BROWSER_MODE: fetch file + play locally + tell server to stream
  const loadLibraryTrackToDeck = useCallback(async (track: LibraryTrack, deck: DeckId) => {
    if (SERVER_MODE) {
      await server.loadTrack(deck, track);
      return;
    }
    // Browser mode
    try {
      const fileRes = await fetch(`${STREAMING_SERVER}/library/audio/${encodeURIComponent(track.serverName)}`);
      if (!fileRes.ok) throw new Error('Audio file not found on server');
      const blob = await fileRes.blob();
      const file = new File([blob], track.name, { type: blob.type || 'audio/mpeg' });
      engine.loadTrack(deck, file);
      engine.play(deck);
      await fetch(`${STREAMING_SERVER}/deck/${deck}/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverName: track.serverName, loop: false }),
      });
      toast.success(`▶ "${track.name}" on Deck ${deck}`);
    } catch (err: any) {
      toast.error(`Could not load to deck: ${err.message}`);
    }
  }, [engine, server]);

  // ── Playlist: play on deck ────────────────────────────────────────────────
  // In server mode, playPlaylistOnDeck already sends to the API correctly
  // (it calls STREAMING_SERVER/deck/:deck/playlist which Liquidsoap handles)

  // ── Create playlist shortcut ──────────────────────────────────────────────
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

  // ── Broadcast (browser mode only) ────────────────────────────────────────
  const handleStartBroadcast = async () => {
    if (SERVER_MODE) {
      toast.info('Server mode is active — audio streams from the server via Icecast, not the browser.');
      return;
    }
    const stream = engine.getOutputStream();
    if (!stream) {
      toast.error('Could not initialize audio. Try clicking Play first.');
      return;
    }
    try {
      const res = await fetch(`${STREAMING_SERVER}/health`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error('unhealthy');
    } catch {
      toast.error('Streaming server not reachable.');
      return;
    }
    startHosting(engine.getDeckOutputStream);
    if (!isListening) startListening();
  };

  // ── Mic ───────────────────────────────────────────────────────────────────
  const handleStartMic = () => {
    const targets: DeckId[] = micTarget === 'all' ? [...ALL_DECKS] : (micTarget as DeckId[]);
    engine.startMic(targets);
  };

  // ── Clipboard helpers ─────────────────────────────────────────────────────
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
    copyToClipboard(`${window.location.origin}/listen?code=${code}`, 'Listen link copied!');
  const copyRequestLink = () => {
    if (!requestPeerId) { toast.error('Request system initializing…'); return; }
    copyToClipboard(`${window.location.origin}/request?host=${requestPeerId}`, 'Request link copied!');
  };

  // serverDeckInfo shape expected by PlaylistPanel (raw object)
  const serverDeckInfoForPlaylists: Record<string, any> = SERVER_MODE
    ? Object.fromEntries(ALL_DECKS.map(id => [id, server.decks[id]]))
    : {};

  return (
    <div
      className="min-h-screen bg-background p-3 md:p-4"
      style={settings.bg_image
        ? { backgroundImage: `url(${settings.bg_image})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }
        : undefined
      }
    >
      {settings.bg_image && <div className="fixed inset-0 bg-background/80 backdrop-blur-sm -z-0" />}
      <div className="relative z-10">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <header className="text-center mb-4">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-2xl font-bold text-primary tracking-[0.3em]">{settings.station_name}</h1>
            {SERVER_MODE && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                server.serverOnline
                  ? 'border-green-500/50 bg-green-500/10 text-green-400'
                  : 'border-red-500/50 bg-red-500/10 text-red-400'
              }`}>
                {server.serverOnline ? '● SERVER' : '○ OFFLINE'}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => navigate('/analytics')}><BarChart2 className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/settings')}><Settings className="h-4 w-4" /></Button>
            <Button size="sm" variant="ghost" onClick={signOut}><LogOut className="h-4 w-4" /></Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {SERVER_MODE ? '4-Channel Server Radio — Browser Remote Control' : '4-Channel DJ Console'}
          </p>
        </header>

        <main className="max-w-6xl mx-auto space-y-4">

          {/* ── Server offline warning ───────────────────────────────────── */}
          {SERVER_MODE && !server.serverOnline && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 flex items-center gap-3">
              <Radio className="h-5 w-5 text-red-400 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-red-400">Server offline</p>
                <p className="text-xs text-muted-foreground">
                  Make sure the Docker containers are running: <code className="bg-muted px-1 rounded">docker compose up -d</code>
                </p>
              </div>
            </div>
          )}

          {/* ── Server mode VLC instructions (shown once when online) ────── */}
          {SERVER_MODE && server.serverOnline && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex flex-wrap items-center gap-3">
              <Radio className="h-4 w-4 text-primary shrink-0" />
              <p className="text-xs text-muted-foreground flex-1">
                <span className="font-semibold text-foreground">VLC on Windows:</span>{' '}
                Media → Open Network Stream → paste a stream URL from any deck below
              </p>
              <div className="flex gap-2 flex-wrap">
                {ALL_DECKS.map(id => (
                  <button
                    key={id}
                    onClick={() => copyToClipboard(getDeckStreamUrl(id), `Deck ${id} stream URL copied!`)}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${DECK_COLORS[id].class} border-current hover:bg-current/10 transition-colors`}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ── 4 Decks ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ALL_DECKS.map(id => {
              const ch = channels.find(c => c.deck_id === id);
              return (
                <Deck
                  key={id}
                  id={id}
                  channelName={ch?.name}
                  // Server mode props
                  serverState={SERVER_MODE ? server.decks[id] : undefined}
                  onServerPlay={SERVER_MODE ? () => server.play(id) : undefined}
                  onServerPause={SERVER_MODE ? () => server.pause(id) : undefined}
                  onServerStop={SERVER_MODE ? () => server.stop(id) : undefined}
                  onServerSkip={SERVER_MODE ? () => server.skip(id) : undefined}
                  onServerAutoDJ={SERVER_MODE ? (enabled) => server.setAutoDJ(id, enabled) : undefined}
                  // Browser mode props
                  browserState={!SERVER_MODE ? engine.decks[id] : undefined}
                  analyser={!SERVER_MODE ? engine.getAnalyser(id) : undefined}
                  onBrowserLoad={!SERVER_MODE ? (f) => { addTracks([f]); engine.loadTrack(id, f); } : undefined}
                  onBrowserPlay={!SERVER_MODE ? () => engine.play(id) : undefined}
                  onBrowserPause={!SERVER_MODE ? () => engine.pause(id) : undefined}
                  onBrowserStop={!SERVER_MODE ? () => engine.stop(id) : undefined}
                  onVolumeChange={!SERVER_MODE ? (v) => engine.setVolume(id, v) : undefined}
                  onEQChange={!SERVER_MODE ? (band, val) => engine.setEQ(id, band, val) : undefined}
                  onSpeedChange={!SERVER_MODE ? (s) => engine.setSpeed(id, s) : undefined}
                  onSetLoopStart={!SERVER_MODE ? () => engine.setLoopStart(id) : undefined}
                  onSetLoopEnd={!SERVER_MODE ? () => engine.setLoopEnd(id) : undefined}
                  onToggleLoop={!SERVER_MODE ? () => engine.toggleLoop(id) : undefined}
                  onClearLoop={!SERVER_MODE ? () => engine.clearLoop(id) : undefined}
                  onYoutubeUrlChange={!SERVER_MODE ? (url) => engine.setYoutubeUrl(id, url) : undefined}
                  onYoutubePlay={!SERVER_MODE ? () => engine.youtubePlay(id) : undefined}
                  onYoutubeStop={!SERVER_MODE ? () => engine.youtubeStop(id) : undefined}
                />
              );
            })}
          </div>

          {/* ── Library + Playlists ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <LibraryPanel
              tracks={library}
              loading={libraryLoading}
              onAddTracks={addTracks}
              onLoadToDeck={loadLibraryTrackToDeck}
              onServerLoadToDeck={SERVER_MODE ? loadLibraryTrackToDeck : undefined}
              onDelete={deleteTrack}
              playlists={playlists}
              onAddToPlaylist={(track, playlistId) => addTracksToPlaylist(playlistId, [track])}
              onCreatePlaylistFromTrack={handleCreatePlaylistFromTrack}
            />
            <PlaylistPanel
              playlists={playlists}
              loading={playlistLoading}
              serverDeckInfo={serverDeckInfoForPlaylists}
              onCreatePlaylist={createPlaylist}
              onRenamePlaylist={renamePlaylist}
              onDeletePlaylist={deletePlaylist}
              onRemoveTrack={removeTrackFromPlaylist}
              onMoveTrack={moveTrack}
              onPlayOnDeck={playPlaylistOnDeck}
              onSkipNext={SERVER_MODE ? server.playlistNext : skipNext}
              onJumpToTrack={SERVER_MODE ? server.playlistJump : jumpToTrack}
            />
          </div>

          {/* ── Announcements ────────────────────────────────────────────── */}
          <AnnouncementSection
            onPlayAnnouncement={engine.playAnnouncement}
            onDuckStart={engine.duckStart}
            onDuckEnd={engine.duckEnd}
          />

          {/* ── Stats ────────────────────────────────────────────────────── */}
          <StatsSection
            decks={!SERVER_MODE ? engine.decks : undefined}
            micActive={!SERVER_MODE ? engine.micActive : undefined}
            listenerCount={listenerCount}
            serverDecks={SERVER_MODE ? server.decks : undefined}
            serverOnline={SERVER_MODE ? server.serverOnline : undefined}
          />

          {/* ── Bottom row: Mic / Broadcast / Requests ───────────────────── */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* Mic — always shown (browser mic routes to Icecast via live harbor) */}
            <MicSection
              micActive={engine.micActive}
              jinglePlaying={engine.jinglePlaying}
              micTarget={micTarget}
              onStartMic={handleStartMic}
              onStopMic={engine.stopMic}
              onMicTargetChange={setMicTarget}
            />

            {/* Broadcast */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-wider">BROADCAST</h2>
                {!SERVER_MODE && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Users className="h-3 w-3" /><span>{listenerCount}</span>
                  </div>
                )}
              </div>

              {SERVER_MODE ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Server streams automatically via Icecast. Open VLC on Windows to listen:
                  </p>
                  {ALL_DECKS.map(id => (
                    <div key={id} className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${DECK_COLORS[id].class}`}>{id}</span>
                      <code className="flex-1 bg-background rounded px-2 py-1 text-[10px] font-mono truncate">
                        {getDeckStreamUrl(id)}
                      </code>
                      <Button size="sm" variant="outline" className="h-6 w-6 p-0 shrink-0"
                        onClick={() => copyToClipboard(getDeckStreamUrl(id), `Deck ${id} URL copied!`)}>
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : !isHosting ? (
                <Button onClick={handleStartBroadcast} className="w-full">
                  <Wifi className="h-4 w-4 mr-1" /> Start Broadcasting
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
                      <Button size="sm" variant="outline" className="h-6 w-6 p-0"
                        onClick={() => copyListenLink(ch.code)}>
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
                  <span className="bg-accent text-accent-foreground text-xs px-1.5 py-0.5 rounded-full font-bold">
                    {requests.length}
                  </span>
                )}
              </div>
              {requests.length === 0
                ? <p className="text-xs text-muted-foreground text-center py-3">No song requests yet</p>
                : (
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {requests.map(req => (
                      <div key={req.id} className="flex items-start gap-2 p-2 rounded bg-background text-xs">
                        <div className="flex-1 min-w-0">
                          <p className="font-bold truncate">{req.song}</p>
                          <p className="text-muted-foreground truncate">{req.name} • {req.phone}</p>
                        </div>
                        <Button size="sm" variant="ghost" className="h-5 w-5 p-0 shrink-0"
                          onClick={() => dismissRequest(req.id)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )
              }
            </section>
          </div>

        </main>
      </div>

      {/* ── Create playlist dialog ───────────────────────────────────────── */}
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
              onKeyDown={e => {
                if (e.key === 'Enter') confirmCreatePlaylist();
                if (e.key === 'Escape') setPendingTrackForPlaylist(null);
              }}
              autoFocus
            />
            <div>
              <p className="text-[10px] text-muted-foreground mb-1">Assign to deck:</p>
              <div className="flex gap-1">
                {ALL_DECKS.map(d => (
                  <button
                    key={d}
                    onClick={() => setNewPlaylistDeck(d)}
                    className={`flex-1 text-xs font-bold py-1 rounded border transition-colors
                      ${newPlaylistDeck === d
                        ? `${DECK_COLORS[d].class} border-current bg-current/10`
                        : 'border-muted-foreground/30 text-muted-foreground'
                      }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1 text-xs h-7" onClick={confirmCreatePlaylist}
                disabled={!newPlaylistName.trim()}>
                Create & Add
              </Button>
              <Button variant="outline" className="flex-1 text-xs h-7"
                onClick={() => setPendingTrackForPlaylist(null)}>
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
