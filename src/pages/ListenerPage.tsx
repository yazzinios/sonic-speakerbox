import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePeerListener } from '@/hooks/usePeerStreaming';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Headphones, Wifi, WifiOff, Volume2 } from 'lucide-react';

const ListenerPage = () => {
  const { isConnected, connect, disconnect, setListenerVolume } = usePeerListener();
  const [searchParams] = useSearchParams();
  const [channelCode, setChannelCode] = useState(searchParams.get('code') || '');
  const [volume, setVolume] = useState(80);
  const [channelName, setChannelName] = useState('');
  const [bgImage, setBgImage] = useState('');

  const handleConnect = async () => {
    const code = channelCode.trim();
    if (!code) return;

    // Look up channel from cloud database
    const { data } = await supabase
      .from('channels')
      .select('name, bg_image')
      .eq('code', code)
      .maybeSingle();

    if (data) {
      setChannelName(data.name);
      setBgImage(data.bg_image || '');
    }

    connect(code);
  };

  const handleVolumeChange = ([v]: number[]) => {
    setVolume(v);
    setListenerVolume(v / 100);
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
              />
              <Button onClick={handleConnect} disabled={!channelCode.trim()} className="w-full">
                <Wifi className="h-4 w-4 mr-1" /> Connect &amp; Listen
              </Button>
            </>
          ) : (
            <>
              <div className="flex items-center justify-center">
                <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/20 text-primary text-sm font-bold animate-pulse">
                  <Wifi className="h-3 w-3" /> NOW BROADCASTING
                </span>
              </div>
              {channelName && (
                <p className="text-center text-sm text-muted-foreground">Connected to <span className="text-foreground font-bold">{channelName}</span></p>
              )}
              <div className="flex items-center gap-2">
                <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <Slider value={[volume]} max={100} step={1} onValueChange={handleVolumeChange} className="flex-1" />
              </div>
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
