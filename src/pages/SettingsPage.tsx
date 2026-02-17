import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Upload, Image, Music, Save, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ALL_DECKS, DECK_COLORS, getChannels, saveChannels, type ListenerChannel } from '@/types/channels';

const SettingsPage = () => {
  const navigate = useNavigate();
  const jingleRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const channelBgRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [djName, setDjName] = useState(() => localStorage.getItem('dj-name') || '');
  const [stationName, setStationName] = useState(() => localStorage.getItem('dj-station') || 'DJ CONSOLE');
  const [bgPreview, setBgPreview] = useState(() => localStorage.getItem('dj-bg') || '');
  const [jingleName, setJingleName] = useState(() => localStorage.getItem('dj-jingle-name') || 'Default (tan-tan-tan)');
  const [channels, setChannels] = useState<ListenerChannel[]>(getChannels);

  const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { const url = reader.result as string; localStorage.setItem('dj-bg', url); setBgPreview(url); };
    reader.readAsDataURL(file);
  };

  const handleJingleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { localStorage.setItem('dj-jingle', reader.result as string); localStorage.setItem('dj-jingle-name', file.name); setJingleName(file.name); };
    reader.readAsDataURL(file);
  };

  const updateChannel = (id: string, field: keyof ListenerChannel, value: string) => {
    setChannels(prev => prev.map(ch => ch.id === id ? { ...ch, [field]: value } : ch));
  };

  const handleChannelBgUpload = (id: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateChannel(id, 'bgImage', reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    localStorage.setItem('dj-name', djName);
    localStorage.setItem('dj-station', stationName);
    saveChannels(channels);
    toast.success('Settings saved!');
  };

  const clearBg = () => { localStorage.removeItem('dj-bg'); setBgPreview(''); };
  const resetJingle = () => { localStorage.removeItem('dj-jingle'); localStorage.removeItem('dj-jingle-name'); setJingleName('Default (tan-tan-tan)'); };

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

        {/* Listener Channels */}
        <section className="rounded-lg border bg-card p-4 space-y-4">
          <h2 className="text-sm font-bold tracking-wider text-foreground">LISTENER CHANNELS</h2>
          <p className="text-xs text-muted-foreground">Configure each channel's name, fixed code, and background image for listeners.</p>
          
          <div className="space-y-4">
            {channels.map(ch => (
              <div key={ch.id} className="rounded border bg-background p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${DECK_COLORS[ch.id].class}`}>CHANNEL {ch.id}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px]">Channel Name</Label>
                    <Input value={ch.name} onChange={e => updateChannel(ch.id, 'name', e.target.value)} className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px]">Fixed Code</Label>
                    <Input value={ch.code} onChange={e => updateChannel(ch.id, 'code', e.target.value)} className="h-8 text-xs font-mono" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Listener Background</Label>
                  <div className="flex items-center gap-2">
                    <input ref={el => { channelBgRefs.current[ch.id] = el; }} type="file" accept="image/*" className="hidden"
                      onChange={e => handleChannelBgUpload(ch.id, e)} />
                    <Button size="sm" variant="outline" className="text-xs"
                      onClick={() => channelBgRefs.current[ch.id]?.click()}>
                      <Image className="h-3 w-3 mr-1" /> Upload
                    </Button>
                    {ch.bgImage && (
                      <Button size="sm" variant="ghost" className="text-xs text-destructive"
                        onClick={() => updateChannel(ch.id, 'bgImage', '')}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {ch.bgImage && (
                    <div className="w-full h-20 rounded border overflow-hidden mt-1">
                      <img src={ch.bgImage} alt={`${ch.name} bg`} className="w-full h-full object-cover" />
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
