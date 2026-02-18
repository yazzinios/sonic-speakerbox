import { useState, useEffect } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { usePeerHost } from '@/hooks/usePeerStreaming';
import { useRequestHost } from '@/hooks/useMusicRequests';
import { useAuth } from '@/hooks/useAuth';
import { useCloudSettings } from '@/hooks/useCloudSettings';
import { Deck } from '@/components/dj/Deck';
import { MicSection, type MicTarget } from '@/components/dj/MicSection';
import { AnnouncementSection } from '@/components/dj/AnnouncementSection';
import { StatsSection } from '@/components/dj/StatsSection';
import { Button } from '@/components/ui/button';
import { Users, Wifi, WifiOff, Copy, Settings, Music, X, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { ALL_DECKS, DECK_COLORS, type DeckId } from '@/types/channels';

const Index = () => {
  const engine = useAudioEngine();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { settings, channels, loading: settingsLoading } = useCloudSettings();
  const { peerId, listenerCount, isHosting, startHosting, stopHosting } = usePeerHost();
  const { requests, requestPeerId, isListening, startListening, stopListening, dismissRequest } = useRequestHost();
  const [micTarget, setMicTarget] = useState<MicTarget>('all');

  useEffect(() => {
    if (settings.jingle_url) {
      fetch(settings.jingle_url).then(r => r.arrayBuffer()).then(buffer => engine.setCustomJingle(buffer)).catch(() => {});
    }
  }, [settings.jingle_url]);

  const handleStartBroadcast = () => {
    const stream = engine.getOutputStream();
    if (stream) {
      startHosting(stream);
      if (!isListening) startListening();
    } else {
      toast.error('Initialize audio first by loading a track');
    }
  };

  const copyChannelCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(`Channel code copied: ${code}`);
  };

  const copyRequestLink = () => {
    const url = `${window.location.origin}/request?host=${requestPeerId}`;
    navigator.clipboard.writeText(url);
    toast.success('Request link copied!');
  };

  const handleStartMic = () => {
    const targets = micTarget === 'all' ? [...ALL_DECKS] : [micTarget as DeckId];
    engine.startMic(targets);
  };

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
          {/* 4 Decks in 2x2 grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {ALL_DECKS.map(id => {
              const ch = channels.find(c => c.id === id);
              return (
                <Deck key={id} id={id}
                  state={engine.decks[id]}
                  analyser={engine.getAnalyser(id)}
                  channelName={ch?.name}
                  onLoad={(f) => engine.loadTrack(id, f)}
                  onPlay={() => engine.play(id)}
                  onPause={() => engine.pause(id)}
                  onStop={() => engine.stop(id)}
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

          {/* Announcements */}
          <AnnouncementSection onPlayAnnouncement={engine.playAnnouncement} onDuckStart={engine.duckStart} onDuckEnd={engine.duckEnd} />

          {/* Statistics */}
          <StatsSection decks={engine.decks} micActive={engine.micActive} listenerCount={listenerCount} />

          {/* Mic, Broadcast, Requests */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MicSection micActive={engine.micActive} jinglePlaying={engine.jinglePlaying}
              micTarget={micTarget} onStartMic={handleStartMic} onStopMic={engine.stopMic} onMicTargetChange={setMicTarget} />

            {/* Broadcast */}
            <section className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-wider text-foreground">BROADCAST</h2>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" /><span>{listenerCount}</span>
                </div>
              </div>

              {!isHosting ? (
                <Button onClick={handleStartBroadcast} className="w-full">
                  <Wifi className="h-4 w-4 mr-1" /> Start Broadcasting
                </Button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Channel codes for listeners:</p>
                  {channels.map(ch => (
                    <div key={ch.id} className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${DECK_COLORS[ch.id].class}`}>{ch.id}</span>
                      <code className="flex-1 bg-background rounded px-2 py-1 text-[10px] font-mono text-foreground truncate">{ch.code}</code>
                      <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => copyChannelCode(ch.code)}>
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
                <h2 className="text-lg font-bold tracking-wider text-foreground">REQUESTS</h2>
                {requests.length > 0 && (
                  <span className="bg-accent text-accent-foreground text-xs px-1.5 py-0.5 rounded-full font-bold">{requests.length}</span>
                )}
              </div>
              {requests.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">No song requests yet</p>
              ) : (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {requests.map(req => (
                    <div key={req.id} className="flex items-start gap-2 p-2 rounded bg-background text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-foreground truncate">{req.song}</p>
                        <p className="text-muted-foreground truncate">{req.name} • {req.phone}</p>
                      </div>
                      <Button size="sm" variant="ghost" className="h-5 w-5 p-0 shrink-0" onClick={() => dismissRequest(req.id)}>
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
      </div>
    </div>
  );
};

export default Index;
