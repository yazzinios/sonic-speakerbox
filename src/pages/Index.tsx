import { useAudioEngine } from '@/hooks/useAudioEngine';
import { usePeerHost } from '@/hooks/usePeerStreaming';
import { Deck } from '@/components/dj/Deck';
import { MicSection } from '@/components/dj/MicSection';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Users, Wifi, WifiOff, Copy } from 'lucide-react';
import { toast } from 'sonner';

const Index = () => {
  const engine = useAudioEngine();
  const { peerId, listenerCount, isHosting, startHosting, stopHosting } = usePeerHost();

  const handleStartBroadcast = () => {
    const stream = engine.getOutputStream();
    if (stream) {
      startHosting(stream);
    } else {
      toast.error('Initialize audio first by loading a track');
    }
  };

  const copyPeerId = () => {
    navigator.clipboard.writeText(peerId);
    toast.success('Broadcaster ID copied!');
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <header className="text-center mb-6">
        <h1 className="text-3xl font-bold text-primary tracking-[0.3em]">DJ CONSOLE</h1>
        <p className="text-sm text-muted-foreground mt-1">Browser-based mixing &amp; broadcasting</p>
      </header>

      <main className="max-w-4xl mx-auto space-y-4">
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

        {/* Mic & Broadcast */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MicSection
            micActive={engine.micActive}
            jinglePlaying={engine.jinglePlaying}
            onStartMic={engine.startMic}
            onStopMic={engine.stopMic}
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
                <Button variant="outline" onClick={stopHosting} className="w-full">
                  <WifiOff className="h-4 w-4 mr-1" />
                  Stop Broadcasting
                </Button>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
};

export default Index;
