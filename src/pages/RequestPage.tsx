import { useState } from 'react';
import { useRequestClient } from '@/hooks/useMusicRequests';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Music, Send, CheckCircle, ArrowLeft } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

const RequestPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hostId = searchParams.get('host') || '';
  
  const { isSending, sent, sendRequest, reset } = useRequestClient();
  const [peerId, setPeerId] = useState(hostId);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [song, setSong] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!peerId.trim()) {
      toast.error('Enter the DJ broadcaster ID');
      return;
    }
    if (!name.trim() || !email.trim() || !phone.trim() || !song.trim()) {
      toast.error('Please fill all fields');
      return;
    }
    try {
      await sendRequest(peerId.trim(), { name, email, phone, song });
      toast.success('Request sent!');
    } catch {
      toast.error('Failed to send request. Check the DJ ID.');
    }
  };

  if (sent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <CheckCircle className="h-16 w-16 text-primary mx-auto" />
          <h1 className="text-2xl font-bold text-foreground">Request Sent!</h1>
          <p className="text-muted-foreground">The DJ will see your request.</p>
          <Button variant="outline" onClick={() => { reset(); setName(''); setEmail(''); setPhone(''); setSong(''); }}>
            Send Another Request
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Music className="h-12 w-12 mx-auto text-accent" />
          <h1 className="text-2xl font-bold text-foreground tracking-[0.2em]">REQUEST A SONG</h1>
          <p className="text-sm text-muted-foreground">Fill in your details and your song request</p>
        </div>

        <form onSubmit={handleSubmit} className="rounded-lg border bg-card p-6 space-y-4">
          {!hostId && (
            <div className="space-y-1">
              <Label className="text-xs">DJ Broadcaster ID</Label>
              <Input
                placeholder="Enter DJ ID..."
                value={peerId}
                onChange={e => setPeerId(e.target.value)}
                className="font-mono"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Your Name *</Label>
            <Input placeholder="Your name" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Email *</Label>
            <Input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Phone Number *</Label>
            <Input type="tel" placeholder="+1 234 567 890" value={phone} onChange={e => setPhone(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Song Request *</Label>
            <Input placeholder="Song name - Artist" value={song} onChange={e => setSong(e.target.value)} required />
          </div>
          <Button type="submit" disabled={isSending} className="w-full">
            <Send className="h-4 w-4 mr-1" />
            {isSending ? 'Sending...' : 'Send Request'}
          </Button>
        </form>

        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-3 w-3 mr-1" /> Back to DJ Console
          </Button>
        </div>
      </div>
    </div>
  );
};

export default RequestPage;
