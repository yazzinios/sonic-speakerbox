import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Headphones, Wifi, WifiOff, Volume2, Loader2, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { STREAMING_SERVER, STREAM_BASE, ICECAST_BASE } from '@/lib/streamingServer';

const ListenerPage = () => {
  const [searchParams] = useSearchParams();
  const [channelCode, setChannelCode] = useState(searchParams.get('code') || '');
  const [volume, setVolume] = useState(80);
  const [channelName, setChannelName] = useState('');
  const [bgImage, setBgImage] = useState('');
  const [deckId, setDeckId] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (searchParams.get('code')) handleConnect();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => { audioRef.current?.pause(); };
  }, []);

  const handleConnect = async () => {
    const code = channelCode.trim();
    if (!code) return;
    setIsLoading(true);

    // Look up channel
    const { data } = await supabase
      .from('channels')
      .select('name, bg_image, deck_id')
      .eq('code', code)
      .maybeSingle();

    if (!data) {
      toast.error('Channel not found. Check the code and try again.');
      setIsLoading(false);
      return;
    }

    setChannelName(data.name);
    setBgImage(data.bg_image || '');
    setDeckId(data.deck_id);

    // Icecast stream URL for this deck
    // e.g. http://host/stream/deck-a
    const streamUrl = `${STREAM_BASE}/deck-${data.deck_id.toLowerCase()}`;
    connectStream(streamUrl);
  };

  const connectStream = (streamUrl: string) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;
    audio.volume = volume / 100;
    audio.preload = 'none';

    // For Icecast MP3 — just set src directly, no HLS needed
    audio.src = streamUrl;

    audio.play()
      .then(() => {
        setIsConnected(true);
        setIsLoading(false);
        setNeedsUserGesture(false);
      })
      .catch(() => {
        // Autoplay blocked — need user gesture
        setNeedsUserGesture(true);
        setIsConnected(true);
        setIsLoading(false);
      });

    audio.onerror = () => {
      console.error('[Listener] Stream error');
      // Retry after 3s
      setTimeout(() => {
        if (audio.src) {
          audio.load();
          audio.play().catch(() => {});
        }
      }, 3000);
    };
  };

  const resumePlayback = () => {
    audioRef.current?.play().then(() => setNeedsUserGesture(false));
  };

  const disconnect = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setIsConnected(false);
    setNeedsUserGesture(false);
    setDeckId('');
  };

  const handleVolumeChange = ([v]: number[]) => {
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v / 100;
  };

  // Direct stream URL for external apps (VLC, phone radio app, etc.)
  const externalStreamUrl = deckId
    ? `http://${ICECAST_BASE}/deck-${deckId.toLowerCase()}`
    : '';

  return (
    <div
      className="min-h-screen bg-background flex items-center justify-center p-4"
      style={bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {bgImage && <div className="fixed inset-0 bg-background/70 backdrop-blur-sm" />}
      <div className="relative z-10 w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Headphones className="h-12 w-12 mx-auto text-primary" />
          <h1 className="text-2xl font-bold text-foreground tracking-[0.2em]">
            {channelName || 'DJ LISTENER'}
          </h1>
          <p className="text-sm text-muted-foreground">Enter your channel code to connect</p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4">
          {!isConnected ? (
            <>
              <Input
                placeholder="Enter channel code..."
                value={channelCode}
                onChange={e => setChannelCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleConnect()}
                className="font-mono text-center text-lg tracking-wider"
                disabled={isLoading}
              />
              <Button onClick={handleConnect} disabled={!channelCode.trim() || isLoading} className="w-full">
                {isLoading
                  ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Connecting...</>
                  : <><Wifi className="h-4 w-4 mr-1" /> Connect &amp; Listen</>}
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center">
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 text-primary text-sm font-bold animate-pulse">
                  <Radio className="h-3 w-3" /> LIVE
                </span>
              </div>

              {channelName && (
                <p className="text-center text-sm text-muted-foreground">
                  Listening to <span className="text-foreground font-bold">{channelName}</span>
                </p>
              )}

              {needsUserGesture ? (
                <Button onClick={resumePlayback} className="w-full animate-pulse">
                  🔊 Tap to Start Listening
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Slider value={[volume]} max={100} step={1} onValueChange={handleVolumeChange} className="flex-1" />
                  <span className="text-xs text-muted-foreground w-8 text-right">{volume}%</span>
                </div>
              )}

              {/* External stream URL for VLC / phone apps */}
              {externalStreamUrl && (
                <div className="rounded border bg-background p-2 space-y-1">
                  <p className="text-[10px] text-muted-foreground">Open in VLC / radio app:</p>
                  <code className="text-[10px] text-foreground break-all">{externalStreamUrl}</code>
                </div>
              )}

              <Button variant="outline" onClick={disconnect} className="w-full">
                <WifiOff className="h-4 w-4 mr-1" /> Disconnect
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ListenerPage;
