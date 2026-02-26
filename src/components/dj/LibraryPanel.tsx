import { useState, useRef, useCallback } from 'react';
import { Music, Upload, Trash2, Play, Library } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS, DECK_COLORS } from '@/types/channels';

export interface LibraryTrack {
  id: string;
  name: string;
  file: File;
  size: string;
  addedAt: number;
}

interface LibraryProps {
  tracks: LibraryTrack[];
  onAddTracks: (files: File[]) => void;
  onLoadToDeck: (track: LibraryTrack, deck: DeckId) => void;
  onDelete: (id: string) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function LibraryPanel({ tracks, onAddTracks, onLoadToDeck, onDelete }: LibraryProps) {
  const [draggingOver, setDraggingOver] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    if (files.length) onAddTracks(files);
  }, [onAddTracks]);

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Library className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-bold tracking-wider text-foreground">LIBRARY</h2>
          {tracks.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{tracks.length}</span>
          )}
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => fileInputRef.current?.click()}>
          <Upload className="h-3 w-3" /> Add Tracks
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) onAddTracks(files);
            e.target.value = '';
          }}
        />
      </div>

      {/* Drop zone or track list */}
      {tracks.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDraggingOver(true); }}
          onDragLeave={() => setDraggingOver(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer
            ${draggingOver ? 'border-primary bg-primary/10' : 'border-muted-foreground/30 hover:border-primary/50'}`}
          onClick={() => fileInputRef.current?.click()}
        >
          <Music className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Drop audio files here or click to browse</p>
          <p className="text-xs text-muted-foreground/60 mt-1">MP3, WAV, OGG, FLAC supported</p>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDraggingOver(true); }}
          onDragLeave={() => setDraggingOver(false)}
          onDrop={handleDrop}
          className={`space-y-1 max-h-64 overflow-y-auto transition-colors rounded-lg
            ${draggingOver ? 'ring-2 ring-primary bg-primary/5' : ''}`}
        >
          {tracks.map(track => (
            <div
              key={track.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-background hover:bg-muted/50 group transition-colors"
            >
              <Music className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{track.name}</p>
                <p className="text-[10px] text-muted-foreground">{track.size}</p>
              </div>

              {/* Load to deck buttons */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {ALL_DECKS.map(deck => (
                  <button
                    key={deck}
                    onClick={() => { onLoadToDeck(track, deck); setOpenMenu(null); }}
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors
                      ${DECK_COLORS[deck].class} border-current hover:bg-current hover:text-background`}
                    title={`Load to Deck ${deck}`}
                  >
                    {deck}
                  </button>
                ))}
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(track.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {tracks.length > 0 && (
        <p className="text-[10px] text-muted-foreground text-center">
          Hover a track → click <span className="font-bold">A B C D</span> to load to deck
        </p>
      )}
    </section>
  );
}
