import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Megaphone, Upload, Play, Trash2, Clock, Plus, Volume2, Users } from 'lucide-react';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS, DECK_COLORS, getChannels } from '@/types/channels';

type AnnTarget = 'all' | DeckId;

interface Announcement {
  id: string;
  name: string;
  file: File | null;
  text: string;
  scheduledTime: string;
  voiceName: string;
  target: AnnTarget;
  played: boolean;
}

interface AnnouncementSectionProps {
  onPlayAnnouncement: (file: File, duck?: boolean) => Promise<void>;
  onDuckStart?: () => void;
  onDuckEnd?: () => void;
}

export function AnnouncementSection({ onPlayAnnouncement, onDuckStart, onDuckEnd }: AnnouncementSectionProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newText, setNewText] = useState('');
  const [newSchedule, setNewSchedule] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newVoice, setNewVoice] = useState('');
  const [newTarget, setNewTarget] = useState<AnnTarget>('all');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const channels = getChannels();

  useEffect(() => {
    const loadVoices = () => {
      const available = window.speechSynthesis?.getVoices() || [];
      setVoices(available);
      if (available.length > 0 && !newVoice) setNewVoice(available[0].name);
    };
    loadVoices();
    window.speechSynthesis?.addEventListener('voiceschanged', loadVoices);
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', loadVoices);
  }, []);

  const maleVoices = voices.filter(v => /male|david|james|daniel|google uk english male/i.test(v.name) && !/female/i.test(v.name));
  const femaleVoices = voices.filter(v => /female|zira|samantha|karen|google uk english female/i.test(v.name));
  const otherVoices = voices.filter(v => !maleVoices.includes(v) && !femaleVoices.includes(v));

  const addAnnouncement = useCallback(() => {
    if (!newName.trim() && !newFile && !newText.trim()) return;
    const ann: Announcement = {
      id: Date.now().toString(),
      name: newName || newFile?.name || 'TTS Announcement',
      file: newFile, text: newText, scheduledTime: newSchedule,
      voiceName: newVoice, target: newTarget, played: false,
    };
    setAnnouncements(prev => [...prev, ann]);
    setNewName(''); setNewText(''); setNewSchedule(''); setNewFile(null);
    setShowAdd(false);
  }, [newName, newFile, newText, newSchedule, newVoice, newTarget]);

  const removeAnnouncement = useCallback((id: string) => {
    setAnnouncements(prev => prev.filter(a => a.id !== id));
  }, []);

  const speakText = useCallback((text: string, voiceName?: string, duck: boolean = false) => {
    if (!text.trim() || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9; utterance.pitch = 1;
    if (voiceName) { const voice = voices.find(v => v.name === voiceName); if (voice) utterance.voice = voice; }
    if (duck) onDuckStart?.();
    utterance.onend = () => { if (duck) onDuckEnd?.(); };
    window.speechSynthesis.speak(utterance);
  }, [voices, onDuckStart, onDuckEnd]);

  const playNow = useCallback(async (ann: Announcement) => {
    if (ann.file) {
      await onPlayAnnouncement(ann.file, true);
    } else if (ann.text.trim()) {
      speakText(ann.text, ann.voiceName, true);
    }
    setAnnouncements(prev => prev.map(a => a.id === ann.id ? { ...a, played: true } : a));
  }, [onPlayAnnouncement, speakText]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      announcements.forEach(ann => { if (ann.scheduledTime === currentTime && !ann.played) playNow(ann); });
    }, 30000);
    return () => clearInterval(interval);
  }, [announcements, playNow]);

  const renderVoiceOptions = (list: SpeechSynthesisVoice[]) =>
    list.map(v => <SelectItem key={v.name} value={v.name}>{v.name.length > 30 ? v.name.slice(0, 30) + '…' : v.name}</SelectItem>);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-accent" />
          <h2 className="text-lg font-bold tracking-wider text-foreground">ANNOUNCEMENTS</h2>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}><Plus className="h-3 w-3" /></Button>
      </div>

      {showAdd && (
        <div className="space-y-2 p-3 rounded border bg-background">
          <Input placeholder="Announcement name" value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-xs" />
          <Textarea placeholder="Write announcement text for TTS..." value={newText} onChange={e => setNewText(e.target.value)} className="text-xs min-h-[60px]" />

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground font-bold uppercase">Voice</label>
              <Select value={newVoice} onValueChange={setNewVoice}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select voice..." /></SelectTrigger>
                <SelectContent>
                  {femaleVoices.length > 0 && (<><SelectItem value="__female_header" disabled className="text-[10px] font-bold text-accent">— Female —</SelectItem>{renderVoiceOptions(femaleVoices)}</>)}
                  {maleVoices.length > 0 && (<><SelectItem value="__male_header" disabled className="text-[10px] font-bold text-primary">— Male —</SelectItem>{renderVoiceOptions(maleVoices)}</>)}
                  {otherVoices.length > 0 && (<><SelectItem value="__other_header" disabled className="text-[10px] font-bold text-muted-foreground">— Other —</SelectItem>{renderVoiceOptions(otherVoices)}</>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground font-bold uppercase">Target</label>
              <Select value={newTarget} onValueChange={(v) => setNewTarget(v as AnnTarget)}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all"><div className="flex items-center gap-1"><Users className="h-3 w-3" /> All</div></SelectItem>
                  {ALL_DECKS.map(id => {
                    const ch = channels.find(c => c.id === id);
                    return <SelectItem key={id} value={id}><span className={DECK_COLORS[id].class}>{ch?.name || `Ch ${id}`}</span></SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          {newText.trim() && (
            <Button size="sm" variant="ghost" onClick={() => speakText(newText, newVoice)} className="text-xs w-full">
              <Volume2 className="h-3 w-3 mr-1" /> Preview TTS
            </Button>
          )}

          <div>
            <label className="text-[10px] text-muted-foreground font-bold uppercase">Schedule (optional)</label>
            <Input type="time" value={newSchedule} onChange={e => setNewSchedule(e.target.value)} className="h-8 text-xs" />
          </div>

          <div className="flex gap-2 items-center">
            <input ref={fileRef} type="file" accept="audio/*" className="hidden" onChange={e => setNewFile(e.target.files?.[0] || null)} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} className="text-xs">
              <Upload className="h-3 w-3 mr-1" /> {newFile ? newFile.name : 'Upload MP3'}
            </Button>
            <Button size="sm" onClick={addAnnouncement} className="text-xs ml-auto">Add</Button>
          </div>
        </div>
      )}

      {announcements.length === 0 && !showAdd && <p className="text-xs text-muted-foreground text-center py-2">No announcements yet</p>}

      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {announcements.map(ann => (
          <div key={ann.id} className={`flex items-center gap-2 p-2 rounded text-xs ${ann.played ? 'opacity-50' : ''} bg-background`}>
            <span className="flex-1 font-medium truncate">{ann.name}</span>
            {ann.target !== 'all' && <span className={`text-[10px] font-bold ${DECK_COLORS[ann.target as DeckId]?.class}`}>{ann.target}</span>}
            {ann.file && <span className="text-[10px] text-muted-foreground">MP3</span>}
            {!ann.file && ann.text && <span className="text-[10px] text-accent">TTS</span>}
            {ann.scheduledTime && <span className="flex items-center gap-0.5 text-muted-foreground"><Clock className="h-2.5 w-2.5" /> {ann.scheduledTime}</span>}
            <Button size="sm" variant="ghost" onClick={() => playNow(ann)} disabled={!ann.file && !ann.text.trim()} className="h-6 w-6 p-0"><Play className="h-3 w-3" /></Button>
            <Button size="sm" variant="ghost" onClick={() => removeAnnouncement(ann.id)} className="h-6 w-6 p-0 text-destructive"><Trash2 className="h-3 w-3" /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}
