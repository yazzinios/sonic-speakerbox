import { useState, useEffect } from 'react';
import { useAudioEngine } from '@/hooks/useAudioEngine';
import { usePeerHost } from '@/hooks/usePeerStreaming';
import { useRequestHost } from '@/hooks/useMusicRequests';
import { Deck } from '@/components/dj/Deck';
import { MicSection, type MicTarget } from '@/components/dj/MicSection';
import { AnnouncementSection } from '@/components/dj/AnnouncementSection';
import { StatsSection } from '@/components/dj/StatsSection';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Users, Wifi, WifiOff, Copy, Settings, Music, X } from 'lucide-react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

const Index = () => {
  const engine = useAudioEngine();
  const navigate = useNavigate();
  const { peerId, listenerCount, isHosting, startHosting, stopHosting } = usePeerHost();
  const { requests, requestPeerId, isListening, startListening, stopListening, dismissRequest } = useRequestHost();
  const [bgImage, setBgImage] = useState('');
  const [stationName, setStationName] = useState('DJ CONSOLE');
  const [micTarget, setMicTarget] = useState<MicTarget>('all');

  // Load settings from localStorage
  useEffect(() => {
    const bg = localStorage.getItem('dj-bg') || '';
    const station = localStorage.getItem('dj-station') || 'DJ CONSOLE';
    const jingleData = localStorage.getItem('dj-jingle');
    setBgImage(bg);
    setStationName(station);

    if (jingleData) {
      fetch(jingleData)
        .then(r => r.arrayBuffer())
        .then(buffer => engine.setCustomJingle(buffer))
        .catch(() => {});
    }
  }, []);

  const handleStartBroadcast = () => {
    const stream = engine.getOutputStream();
    if (stream) {
      startHosting(stream);
      if (!isListening) startListening();
    } else {
      toast.error('Initialize audio first by loading a track');
    }
  };

  const copyPeerId = () => {
    navigator.clipboard.writeText(peerId);
    toast.success('Broadcaster ID copied!');
  };

  const copyRequestLink = () => {
    const url = `${window.location.origin}/request?host=${requestPeerId}`;
    navigator.clipboard.writeText(url);
    toast.success('Request link copied!');
  };

  return (
    <div
      className="min-h-screen bg-background p-4 md:p-6"
      style={bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' } : undefined}
    >
      {bgImage && <div className="fixed inset-0 bg-background/80 backdrop-blur-sm -z-0" />}
      <div className="relative z-10">
        <header className="text-center mb-6">
          <div className="flex items-center justify-center gap-3">
            <h1 className="text-3xl font-bold text-primary tracking-[0.3em]">{stationName}</h1>
            <Button size="sm" variant="ghost" onClick={() => navigate('/settings')}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Browser-based mixing &amp; broadcasting</p>
        </header>

        <main className="max-w-5xl mx-auto space-y-4">
          {/* Decks */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Deck
              id="A"
              state={engine.deckA}
              analyser={engine.getAnalyser('A')}
              onLoad={(f) => engine.loadTrack('A', f)}
              onPlay={() => engine.play('A')}
              onPause={() => engine.pause('A')}
              onStop={() => engine.stop('A')}
              onVolumeChange={(v) => engine.setVolume('A', v)}
              onEQChange={(band, val) => engine.setEQ('A', band, val)}
              onSpeedChange={(s) => engine.setSpeed('A', s)}
              onSetLoopStart={() => engine.setLoopStart('A')}
              onSetLoopEnd={() => engine.setLoopEnd('A')}
              onToggleLoop={() => engine.toggleLoop('A')}
              onClearLoop={() => engine.clearLoop('A')}
              onYoutubeUrlChange={(url) => engine.setYoutubeUrl('A', url)}
              onYoutubePlay={() => engine.youtubePlay('A')}
              onYoutubeStop={() => engine.youtubeStop('A')}
            />
            <Deck
              id="B"
              state={engine.deckB}
              analyser={engine.getAnalyser('B')}
              onLoad={(f) => engine.loadTrack('B', f)}
              onPlay={() => engine.play('B')}
              onPause={() => engine.pause('B')}
              onStop={() => engine.stop('B')}
              onVolumeChange={(v) => engine.setVolume('B', v)}
              onEQChange={(band, val) => engine.setEQ('B', band, val)}
              onSpeedChange={(s) => engine.setSpeed('B', s)}
              onSetLoopStart={() => engine.setLoopStart('B')}
              onSetLoopEnd={() => engine.setLoopEnd('B')}
              onToggleLoop={() => engine.toggleLoop('B')}
              onClearLoop={() => engine.clearLoop('B')}
              onYoutubeUrlChange={(url) => engine.setYoutubeUrl('B', url)}
              onYoutubePlay={() => engine.youtubePlay('B')}
              onYoutubeStop={() => engine.youtubeStop('B')}
            />
          </div>

          {/* Crossfader */}
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-primary tracking-wider">A</span>
              <span className="text-xs font-bold text-muted-foreground tracking-wider">CROSSFADER</span>
              <span className="text-xs font-bold text-accent tracking-wider">B</span>
            </div>
            <Slider
              value={[engine.crossfader * 100]}
              max={100}
              step={1}
              onValueChange={([v]) => engine.setCrossfader(v / 100)}
            />
          </section>

          {/* Announcements */}
          <AnnouncementSection onPlayAnnouncement={engine.playAnnouncement} onDuckStart={engine.duckStart} onDuckEnd={engine.duckEnd} />

          {/* Statistics */}
          <StatsSection
            deckA={engine.deckA}
            deckB={engine.deckB}
            micActive={engine.micActive}
            listenerCount={listenerCount}
          />

          {/* Mic & Broadcast & Requests */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <MicSection
              micActive={engine.micActive}
              jinglePlaying={engine.jinglePlaying}
              micTarget={micTarget}
              onStartMic={engine.startMic}
              onStopMic={engine.stopMic}
              onMicTargetChange={setMicTarget}
            />

            <section className="rounded-lg border bg-card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold tracking-wider text-foreground">BROADCAST</h2>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="h-3 w-3" />
                  <span>{listenerCount}</span>
                </div>
              </div>

              {!isHosting ? (
                <Button onClick={handleStartBroadcast} className="w-full">
                  <Wifi className="h-4 w-4 mr-1" />
                  Start Broadcasting
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-background rounded px-2 py-1.5 text-xs font-mono text-primary truncate">
                      {peerId}
                    </code>
                    <Button size="sm" variant="outline" onClick={copyPeerId}>
                      <Copy className="h-3 w-3" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Share this ID. Listeners open <code className="text-primary">/listen</code> and paste it.
                  </p>
                  {requestPeerId && (
                    <Button size="sm" variant="outline" onClick={copyRequestLink} className="w-full text-xs">
                      <Music className="h-3 w-3 mr-1" /> Copy Request Link
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => { stopHosting(); stopListening(); }} className="w-full">
                    <WifiOff className="h-4 w-4 mr-1" />
                    Stop Broadcasting
                  </Button>
                </div>
              )}
            </section>

            {/* Music Requests */}
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
