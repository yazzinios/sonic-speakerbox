import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2 } from 'lucide-react';

interface YouTubeResult {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
}

interface YouTubeSearchProps {
  onSelect: (videoId: string, title: string) => void;
}

export function YouTubeSearch({ onSelect }: YouTubeSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const search = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError('');
    try {
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/youtube-search?q=${encodeURIComponent(query.trim())}&maxResults=8`;
      const res = await fetch(url, {
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Search failed');
      setResults(json.results || []);
    } catch (e: any) {
      setError(e.message || 'Search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
        <Input
          placeholder="Search YouTube..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
          className="text-xs h-8"
        />
        <Button size="sm" variant="outline" onClick={search} disabled={loading} className="h-8 px-2">
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
        </Button>
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
      {results.length > 0 && (
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {results.map(r => (
            <button
              key={r.videoId}
              onClick={() => onSelect(r.videoId, r.title)}
              className="flex items-center gap-2 w-full p-1.5 rounded bg-background hover:bg-muted text-left transition-colors"
            >
              <img src={r.thumbnail} alt="" className="w-10 h-7 rounded object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium truncate text-foreground" dangerouslySetInnerHTML={{ __html: r.title }} />
                <p className="text-[10px] text-muted-foreground truncate">{r.channel}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
