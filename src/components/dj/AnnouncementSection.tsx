import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Megaphone, Upload, Play, Trash2, Clock, Plus } from 'lucide-react';

interface Announcement {
  id: string;
  name: string;
  file: File | null;
  text: string;
  duration: number; // seconds before auto-play (0 = manual)
  scheduledTime: string; // HH:MM format or empty
  played: boolean;
}

interface AnnouncementSectionProps {
  onPlayAnnouncement: (file: File, duck?: boolean) => Promise<void>;
}

export function AnnouncementSection({ onPlayAnnouncement }: AnnouncementSectionProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newText, setNewText] = useState('');
  const [newDuration, setNewDuration] = useState(0);
  const [newSchedule, setNewSchedule] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const addAnnouncement = useCallback(() => {
    if (!newName.trim() && !newFile) return;
    const ann: Announcement = {
      id: Date.now().toString(),
      name: newName || newFile?.name || 'Untitled',
      file: newFile,
      text: newText,
      duration: newDuration,
      scheduledTime: newSchedule,
      played: false,
    };
    setAnnouncements(prev => [...prev, ann]);
    setNewName('');
    setNewText('');
    setNewDuration(0);
    setNewSchedule('');
    setNewFile(null);
    setShowAdd(false);
  }, [newName, newFile, newText, newDuration, newSchedule]);

  const removeAnnouncement = useCallback((id: string) => {
    setAnnouncements(prev => prev.filter(a => a.id !== id));
    if (timersRef.current[id]) {
      clearTimeout(timersRef.current[id]);
      delete timersRef.current[id];
    }
  }, []);

  const playNow = useCallback(async (ann: Announcement) => {
    if (!ann.file) return;
    await onPlayAnnouncement(ann.file, true);
    setAnnouncements(prev => prev.map(a => a.id === ann.id ? { ...a, played: true } : a));
  }, [onPlayAnnouncement]);

  // Schedule checker
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      announcements.forEach(ann => {
        if (ann.scheduledTime === currentTime && !ann.played && ann.file) {
          playNow(ann);
        }
      });
    }, 30000); // Check every 30s
    return () => clearInterval(interval);
  }, [announcements, playNow]);

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-accent" />
          <h2 className="text-lg font-bold tracking-wider text-foreground">ANNOUNCEMENTS</h2>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowAdd(!showAdd)}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>

      {showAdd && (
        <div className="space-y-2 p-3 rounded border bg-background">
          <Input placeholder="Announcement name" value={newName} onChange={e => setNewName(e.target.value)} className="h-8 text-xs" />
          <Textarea placeholder="Text description (optional)" value={newText} onChange={e => setNewText(e.target.value)} className="text-xs min-h-[40px]" />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">Schedule (HH:MM)</label>
              <Input type="time" value={newSchedule} onChange={e => setNewSchedule(e.target.value)} className="h-8 text-xs" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-muted-foreground">Duration (s)</label>
              <Input type="number" value={newDuration} onChange={e => setNewDuration(Number(e.target.value))} className="h-8 text-xs" min={0} />
            </div>
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

      {announcements.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground text-center py-2">No announcements yet</p>
      )}

      <div className="space-y-1 max-h-[200px] overflow-y-auto">
        {announcements.map(ann => (
          <div key={ann.id} className={`flex items-center gap-2 p-2 rounded text-xs ${ann.played ? 'opacity-50' : ''} bg-background`}>
            <span className="flex-1 font-medium truncate">{ann.name}</span>
            {ann.scheduledTime && (
              <span className="flex items-center gap-0.5 text-muted-foreground">
                <Clock className="h-2.5 w-2.5" /> {ann.scheduledTime}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => playNow(ann)} disabled={!ann.file} className="h-6 w-6 p-0">
              <Play className="h-3 w-3" />
            </Button>
            <Button size="sm" variant="ghost" onClick={() => removeAnnouncement(ann.id)} className="h-6 w-6 p-0 text-destructive">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
