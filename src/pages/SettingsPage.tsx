import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { ArrowLeft, Image, Music, Save, Trash2, Mic } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useCloudSettings, type CloudChannel } from '@/hooks/useCloudSettings';
import { DECK_COLORS } from '@/types/channels';

const DEFAULT_DUCK = 0.05;

const SettingsPage = () => {
  const navigate = useNavigate();
  const jingleRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const channelBgRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const { settings, channels, loading, saveSettings, saveChannels } = useCloudSettings();

  const [stationName, setStationName] = useState('');
  const [djName, setDjName] = useState('');
  const [bgPreview, setBgPreview] = useState('');
  const [jingleName, setJingleName] = useState('');
  const [localChannels, setLocalChannels] = useState<CloudChannel[]>([]);

  // Mic duck level read from localStorage
  const [localDuckPct, setLocalDuckPct] = useState<number>(() => {
    const saved = localStorage.getItem('mic-duck-level');
    return Math.round((saved !== null ? parseFloat(saved) : DEFAULT_DUCK) * 100);
  });

  // Sync cloud state to local form state
  useEffect(() => {
    if (!loading) {
      setStationName(settings.station_name);
      setDjName(settings.dj_name);
      setBgPreview(settings.bg_image);
      setJingleName(settings.jingle_name);
      setLocalChannels(channels);
    }
  }, [loading, settings, channels]);

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBgPreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleJingleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setJingleName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      localStorage.setItem('dj-jingle', reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const updateChannel = (deckId: string, field: keyof CloudChannel, value: string) => {
    setLocalChannels(prev => prev.map(ch => ch.deck_id === deckId ? { ...ch, [field]: value } : ch));
  };

  const handleChannelBgUpload = (deckId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateChannel(deckId, 'bg_image', reader.result as string);
    reader.readAsDataURL(file);
  };

  const persistDuck = (pct: number) => {
    localStorage.setItem('mic-duck-level', String(pct / 100));
  };

  const handleSave = async () => {
    persistDuck(localDuckPct);
    await saveSettings({
      station_name: stationName,
      dj_name: djName,
      bg_image: bgPreview,
      jingle_name: jingleName,
    });
    await saveChannels(localChannels);
    toast.success('Settings saved!');
  };

  const clearBg = () => setBgPreview('');
  const resetJingle = () => {
    localStorage.removeItem('dj-jingle');
    setJingleName('Default (tan-tan-tan)');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-primary animate-pulse tracking-widest">LOADING...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => navigate('/')}><ArrowLeft className="h-4 w-4" /></Button>
          <h1 className="text-2xl font-bold text-primary tracking-[0.2em]">SETTINGS</h1>
        </div>

        {/* Station Info */}
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="text-sm font-bold tracking-wider text-foreground">STATION INFO</h2>
          <div className="space-y-2">
            <Label className="text-xs">Station Name</Label>
            <Input value={stationName} onChange={e => setStationName(e.target.value)} placeholder="My Radio Station" />
          </div>
          <div className="space-y-2">
            <Label className="text-xs">DJ Name</Label>
            <Input value={djName} onChange={e => setDjName(e.target.value)} placeholder="DJ Name" />
          </div>
        </section>

        {/* Mic Settings */}
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 text-destructive" />
            <h2 className="text-sm font-bold tracking-wider text-foreground">MIC SETTINGS</h2>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Music Volume When Mic is On</Label>
              <span className="text-sm font-mono font-bold text-foreground">{localDuckPct}%</span>
            </div>
            <Slider
              value={[localDuckPct]}
              min={0}
              max={100}
              step={1}
              onValueChange={([v]) => setLocalDuckPct(v)}
              onValueCommit={([v]) => persistDuck(v)}
            />
            <p className="text-[10px] text-muted-foreground">
              When you go On Air, music drops to <strong>{localDuckPct}%</strong> of its current level.
              Default is 5% (near silence).
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-xs"
                onClick={() => { setLocalDuckPct(5); persistDuck(5); }}>
                5% (Default)
              </Button>
              <Button size="sm" variant="outline" className="text-xs"
                onClick={() => { setLocalDuckPct(0); persistDuck(0); }}>
                Mute
              </Button>
              <Button size="sm" variant="outline" className="text-xs"
                onClick={() => { setLocalDuckPct(30); persistDuck(30); }}>
                30%
              </Button>
              <Button size="sm" variant="outline" className="text-xs"
                onClick={() => { setLocalDuckPct(50); persistDuck(50); }}>
                50%
              </Button>
            </div>
          </div>
        </section>

        {/* Listener Channels */}
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="text-sm font-bold tracking-wider text-foreground">LISTENER CHANNELS</h2>
          <p className="text-xs text-muted-foreground">Configure each channel's name, fixed code, and background image for listeners.</p>
          
          <div className="space-y-4">
            {localChannels.map(ch => (
              <div key={ch.deck_id} className="rounded border bg-background p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${DECK_COLORS[ch.deck_id].class}`}>CHANNEL {ch.deck_id}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Channel Name</Label>
                    <Input value={ch.name} onChange={e => updateChannel(ch.deck_id, 'name', e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Fixed Code</Label>
                    <Input value={ch.code} onChange={e => updateChannel(ch.deck_id, 'code', e.target.value)} className="h-8 text-xs font-mono" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Listener Background</Label>
                  <div className="flex items-center gap-2">
                    <input ref={el => { channelBgRefs.current[ch.deck_id] = el; }} type="file" accept="image/*" className="hidden"
                      onChange={e => handleChannelBgUpload(ch.deck_id, e)} />
                    <Button size="sm" variant="outline" className="text-xs"
                      onClick={() => channelBgRefs.current[ch.deck_id]?.click()}>
                      <Image className="h-3 w-3 mr-1" /> Upload
                    </Button>
                    {ch.bg_image && (
                      <Button size="sm" variant="ghost" className="text-xs text-destructive"
                        onClick={() => updateChannel(ch.deck_id, 'bg_image', '')}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {ch.bg_image && (
                    <div className="w-full h-20 rounded border overflow-hidden mt-1">
                      <img src={ch.bg_image} alt={`${ch.name} bg`} className="w-full h-full object-cover" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Mic Jingle */}
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="text-sm font-bold tracking-wider text-foreground">MIC JINGLE</h2>
          <p className="text-xs text-muted-foreground">Upload a custom jingle that plays before you go on air.</p>
          <div className="flex items-center gap-3">
            <input ref={jingleRef} type="file" accept="audio/*" className="hidden" onChange={handleJingleUpload} />
            <Button variant="outline" onClick={() => jingleRef.current?.click()}><Music className="h-4 w-4 mr-1" /> Upload Jingle</Button>
            <span className="text-xs text-muted-foreground truncate">{jingleName}</span>
          </div>
          {jingleName !== 'Default (tan-tan-tan)' && (
            <Button variant="ghost" size="sm" className="text-xs text-destructive" onClick={resetJingle}>Reset to default</Button>
          )}
        </section>

        {/* Background */}
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="text-sm font-bold tracking-wider text-foreground">DJ CONSOLE BACKGROUND</h2>
          <div className="flex items-center gap-3">
            <input ref={bgRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
            <Button variant="outline" onClick={() => bgRef.current?.click()}><Image className="h-4 w-4 mr-1" /> Upload Background</Button>
          </div>
          {bgPreview && (
            <div className="space-y-2">
              <div className="w-full h-32 rounded border overflow-hidden">
                <img src={bgPreview} alt="Background preview" className="w-full h-full object-cover" />
              </div>
              <Button variant="ghost" size="sm" className="text-xs text-destructive" onClick={clearBg}>Remove background</Button>
            </div>
          )}
        </section>

        <Button onClick={handleSave} className="w-full"><Save className="h-4 w-4 mr-1" /> Save Settings</Button>
      </div>
    </div>
  );
};

export default SettingsPage;
