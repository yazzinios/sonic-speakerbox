import { useState, useRef, useCallback } from 'react';
import { Music, Upload, Trash2, Library, ListMusic, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS, DECK_COLORS } from '@/types/channels';
import type { LibraryTrack } from '@/hooks/useLibrary';
import type { Playlist } from '@/hooks/usePlaylist';
import { SERVER_MODE } from '@/lib/streamingServer';

interface LibraryProps {
  tracks: LibraryTrack[];
  loading: boolean;
  onAddTracks: (files: File[]) => void;
  onLoadToDeck: (track: LibraryTrack, deck: DeckId) => void;
  onDelete: (id: string) => void;
  // Playlist integration
  playlists: Playlist[];
  onAddToPlaylist: (track: LibraryTrack, playlistId: string) => void;
  onCreatePlaylistFromTrack?: (track: LibraryTrack) => void;
  /** Server mode: callback for loading to server deck (overrides onLoadToDeck) */
  onServerLoadToDeck?: (track: LibraryTrack, deck: DeckId) => void;
}

export function LibraryPanel({
  tracks, loading, onAddTracks, onLoadToDeck, onDelete,
  playlists, onAddToPlaylist, onCreatePlaylistFromTrack,
}: LibraryProps) {
  const [draggingOver, setDraggingOver] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDraggingOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('audio/'));
    if (files.length) handleFiles(files);
  }, []);

  const handleFiles = useCallback(async (files: File[]) => {
    setUploading(true);
    await onAddTracks(files);
    setUploading(false);
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
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs gap-1"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {uploading ? 'Uploading...' : 'Add Tracks'}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) handleFiles(files);
            e.target.value = '';
          }}
        />
      </div>

      {tracks.length === 0 && !loading ? (
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
          <p className="text-xs text-muted-foreground/60 mt-1">MP3, WAV, OGG, FLAC supported — saved permanently</p>
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
              className="flex items-center gap-2 p-2 rounded-lg bg-background hover:bg-muted/50 group transition-colors relative"
            >
              <Music className="h-3.5 w-3.5 text-muted-foreground shrink-0" />

              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">{track.name}</p>
                <p className="text-[10px] text-muted-foreground">{track.size}</p>
              </div>

              {/* Action buttons (visible on hover) */}
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                {/* Load to deck */}
                {ALL_DECKS.map(deck => (
                  <button
                    key={deck}
                    onClick={() => SERVER_MODE && onServerLoadToDeck
                      ? onServerLoadToDeck(track, deck)
                      : onLoadToDeck(track, deck)
                    }
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors
                      ${DECK_COLORS[deck].class} border-current hover:bg-current hover:text-background`}
                    title={`Load to Deck ${deck}`}
                  >
                    {deck}
                  </button>
                ))}

                {/* Add to playlist dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setOpenMenu(openMenu === track.id ? null : track.id)}
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-muted-foreground/50 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                    title="Add to playlist"
                  >
                    <ListMusic className="h-2.5 w-2.5" />
                  </button>
                  {openMenu === track.id && (
                    <div className="absolute right-0 top-5 z-50 bg-card border rounded-lg shadow-lg min-w-[140px] py-1">
                      <p className="text-[10px] text-muted-foreground px-2 py-1 font-semibold">ADD TO PLAYLIST</p>
                      {playlists.length === 0 && (
                        <p className="text-[10px] text-muted-foreground px-2 py-1">No playlists yet</p>
                      )}
                      {playlists.map(pl => (
                        <button
                          key={pl.id}
                          onClick={() => { onAddToPlaylist(track, pl.id); setOpenMenu(null); }}
                          className="w-full text-left text-xs px-2 py-1.5 hover:bg-muted truncate flex items-center gap-1.5"
                        >
                          <ListMusic className="h-3 w-3 text-muted-foreground shrink-0" />
                          {pl.name}
                          <span className="text-[10px] text-muted-foreground ml-auto">{pl.deckId}</span>
                        </button>
                      ))}
                      <div className="border-t mt-1 pt-1">
                        <button
                          onClick={() => { onCreatePlaylistFromTrack?.(track); setOpenMenu(null); }}
                          className="w-full text-left text-xs px-2 py-1.5 hover:bg-muted flex items-center gap-1.5 text-primary"
                        >
                          <Plus className="h-3 w-3" /> New playlist...
                        </button>
                      </div>
                    </div>
                  )}
                </div>
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
          Hover → <span className="font-bold">A B C D</span> to load deck · <span className="font-bold">≡</span> to add to playlist · Library saved permanently
        </p>
      )}

      {/* Close menu on outside click */}
      {openMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
      )}
    </section>
  );
}
