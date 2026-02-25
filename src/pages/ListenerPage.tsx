import { useState, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Headphones, Wifi, WifiOff, Volume2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Hls from 'hls.js';

// HTTP requests go through nginx proxy on same origin
const STREAMING_SERVER = window.location.origin;

const ListenerPage = () => {
  const [searchParams] = useSearchParams();
  const [channelCode, setChannelCode] = useState(searchParams.get('code') || '');
  const [volume, setVolume] = useState(80);
  const [channelName, setChannelName] = useState('');
  const [bgImage, setBgImage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [needsUserGesture, setNeedsUserGesture] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Auto-connect if code is in URL
  useEffect(() => {
    if (searchParams.get('code')) {
      handleConnect();
    }
  }, []);

  const handleConnect = async () => {
    const code = channelCode.trim();
    if (!code) return;
    setIsLoading(true);

    // Look up channel from Supabase
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

    // Check if deck is live
    try {
      const res = await fetch(`${STREAMING_SERVER}/status`);
      const { live } = await res.json();
      if (!live[data.deck_id]) {
        toast.error('DJ is not currently broadcasting on this channel.');
        setIsLoading(false);
        return;
      }
    } catch {
      toast.error('Cannot reach streaming server.');
      setIsLoading(false);
      return;
    }

    setChannelName(data.name);
    setBgImage(data.bg_image || '');

    // Connect to HLS stream for this specific deck
    const streamUrl = `${STREAMING_SERVER}/hls/${data.deck_id.toLowerCase()}/stream.m3u8`;
    connectHLS(streamUrl);
  };

  const connectHLS = (streamUrl: string) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    const audio = audioRef.current;
    audio.volume = volume / 100;

    if (Hls.isSupported()) {
      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 10,
      });
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(audio);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        audio.play()
          .then(() => { setIsConnected(true); setIsLoading(false); })
          .catch(() => { setNeedsUserGesture(true); setIsConnected(true); setIsLoading(false); });
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          toast.error('Stream error. The DJ may have stopped broadcasting.');
          setIsConnected(false);
          setIsLoading(false);
        }
      });
    } else if (audio.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      audio.src = streamUrl;
      audio.play()
        .then(() => { setIsConnected(true); setIsLoading(false); })
        .catch(() => { setNeedsUserGesture(true); setIsConnected(true); setIsLoading(false); });
    } else {
      toast.error('Your browser does not support HLS streaming.');
      setIsLoading(false);
    }
  };

  const resumePlayback = () => {
    audioRef.current?.play().then(() => setNeedsUserGesture(false));
  };

  const disconnect = () => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setIsConnected(false);
    setNeedsUserGesture(false);
  };

  const handleVolumeChange = ([v]: number[]) => {
    setVolume(v);
    if (audioRef.current) audioRef.current.volume = v / 100;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4"
      style={bgImage ? { backgroundImage: `url(${bgImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}>
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
                onChange={(e) => setChannelCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
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
                  <Wifi className="h-3 w-3" /> LIVE
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
