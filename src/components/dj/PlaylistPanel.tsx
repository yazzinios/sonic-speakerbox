import { useState } from 'react';
import {
  ListMusic, Plus, Trash2, Play, SkipForward, ChevronDown, ChevronUp,
  GripVertical, Repeat, Edit2, Check, X, Loader2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Playlist } from '@/hooks/usePlaylist';
import type { DeckId } from '@/types/channels';
import { ALL_DECKS, DECK_COLORS } from '@/types/channels';

interface PlaylistPanelProps {
  playlists: Playlist[];
  loading: boolean;
  serverDeckInfo: Record<string, any>;   // from /deck-info
  onCreatePlaylist: (deckId: DeckId, name: string) => Promise<any>;
  onRenamePlaylist: (id: string, name: string) => void;
  onDeletePlaylist: (id: string) => void;
  onRemoveTrack: (playlistId: string, trackId: string) => void;
  onMoveTrack: (playlistId: string, from: number, to: number) => void;
  onPlayOnDeck: (playlistId: string, deckId: DeckId, options?: { loop?: boolean }) => void;
  onSkipNext: (deckId: DeckId) => void;
  onJumpToTrack: (deckId: DeckId, index: number) => void;
}

export function PlaylistPanel({
  playlists, loading, serverDeckInfo,
  onCreatePlaylist, onRenamePlaylist, onDeletePlaylist,
  onRemoveTrack, onMoveTrack, onPlayOnDeck, onSkipNext, onJumpToTrack,
}: PlaylistPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDeck, setNewDeck] = useState<DeckId>('A');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [loopStates, setLoopStates] = useState<Record<string, boolean>>({});

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(false);
    await onCreatePlaylist(newDeck, newName.trim());
    setNewName('');
  };

  const toggleLoop = (playlistId: string) => {
    setLoopStates(prev => ({ ...prev, [playlistId]: !prev[playlistId] }));
  };

  return (
    <section className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListMusic className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-bold tracking-wider text-foreground">PLAYLISTS</h2>
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          {playlists.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
              {playlists.length}
            </span>
          )}
        </div>
        <Button
          size="sm" variant="outline" className="h-7 text-xs gap-1"
          onClick={() => setCreating(!creating)}
        >
          <Plus className="h-3 w-3" /> New Playlist
        </Button>
      </div>

      {/* Create playlist form */}
      {creating && (
        <div className="flex gap-2 items-center bg-muted/40 rounded-lg p-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Playlist name..."
            className="h-7 text-xs flex-1"
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setCreating(false); }}
            autoFocus
          />
          <div className="flex gap-0.5">
            {ALL_DECKS.map(d => (
              <button
                key={d}
                onClick={() => setNewDeck(d)}
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded border transition-colors
                  ${newDeck === d ? `${DECK_COLORS[d].class} border-current bg-current/10` : 'border-muted-foreground/30 text-muted-foreground'}`}
              >
                {d}
              </button>
            ))}
          </div>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={handleCreate}>
            <Check className="h-3 w-3 text-green-500" />
          </Button>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => setCreating(false)}>
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {playlists.length === 0 && !loading && !creating && (
        <div className="text-center py-6 text-muted-foreground">
          <ListMusic className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No playlists yet</p>
          <p className="text-xs mt-1">Create a playlist and add tracks from your library</p>
        </div>
      )}

      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {playlists.map(pl => {
          const isExpanded = expanded === pl.id;
          const deckInfo = serverDeckInfo[pl.deckId] || {};
          const isPlayingThis = deckInfo.mode === 'playlist' && deckInfo.playlistLength > 0;
          const currentIdx = deckInfo.playlistIndex || 0;
          const loop = loopStates[pl.id] || false;

          return (
            <div key={pl.id} className="rounded-lg border bg-background overflow-hidden">
              {/* Playlist header */}
              <div className="flex items-center gap-2 p-2 hover:bg-muted/30 transition-colors">
                <button
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                  onClick={() => setExpanded(isExpanded ? null : pl.id)}
                >
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${DECK_COLORS[pl.deckId].class} border-current`}>
                    {pl.deckId}
                  </span>
                  {editingId === pl.id ? (
                    <Input
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="h-5 text-xs flex-1"
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => {
                        e.stopPropagation();
                        if (e.key === 'Enter') { onRenamePlaylist(pl.id, editName); setEditingId(null); }
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span className="text-xs font-semibold truncate">{pl.name}</span>
                  )}
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {pl.tracks.length} track{pl.tracks.length !== 1 ? 's' : ''}
                  </span>
                  {isPlayingThis && (
                    <span className="text-[10px] text-green-500 font-bold animate-pulse shrink-0">▶ LIVE</span>
                  )}
                </button>

                {/* Controls */}
                <div className="flex items-center gap-0.5">
                  {/* Loop toggle */}
                  <button
                    onClick={() => toggleLoop(pl.id)}
                    className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${loop ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    title={loop ? 'Loop on' : 'Loop off'}
                  >
                    <Repeat className="h-3 w-3" />
                  </button>

                  {/* Play on deck */}
                  <button
                    onClick={() => onPlayOnDeck(pl.id, pl.deckId, { loop })}
                    className={`h-6 w-6 flex items-center justify-center rounded transition-colors text-muted-foreground hover:text-green-500`}
                    title={`Play on Deck ${pl.deckId}`}
                    disabled={pl.tracks.length === 0}
                  >
                    <Play className="h-3 w-3" />
                  </button>

                  {/* Skip next (only when this playlist is live) */}
                  {isPlayingThis && (
                    <button
                      onClick={() => onSkipNext(pl.deckId)}
                      className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                      title="Skip to next track"
                    >
                      <SkipForward className="h-3 w-3" />
                    </button>
                  )}

                  {/* Rename */}
                  <button
                    onClick={() => { setEditingId(pl.id); setEditName(pl.name); }}
                    className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Edit2 className="h-3 w-3" />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => onDeletePlaylist(pl.id)}
                    className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>

                  {/* Expand */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : pl.id)}
                    className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground"
                  >
                    {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                </div>
              </div>

              {/* Track list */}
              {isExpanded && (
                <div className="border-t">
                  {pl.tracks.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-3">
                      No tracks — add from the Library above
                    </p>
                  ) : (
                    <div className="max-h-48 overflow-y-auto">
                      {[...pl.tracks].sort((a, b) => a.position - b.position).map((track, idx) => {
                        const isCurrentTrack = isPlayingThis && idx === currentIdx;
                        return (
                          <div
                            key={track.id}
                            className={`flex items-center gap-2 px-2 py-1.5 group transition-colors
                              ${isCurrentTrack ? 'bg-primary/10' : 'hover:bg-muted/30'}`}
                          >
                            <GripVertical className="h-3 w-3 text-muted-foreground/30 shrink-0" />
                            <span className="text-[10px] text-muted-foreground w-4 text-right shrink-0">
                              {idx + 1}
                            </span>
                            <p className={`text-xs flex-1 truncate ${isCurrentTrack ? 'text-primary font-semibold' : ''}`}>
                              {isCurrentTrack && '▶ '}{track.title}
                            </p>
                            <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              {isPlayingThis && (
                                <button
                                  onClick={() => onJumpToTrack(pl.deckId, idx)}
                                  className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-green-500 transition-colors"
                                  title="Jump to this track"
                                >
                                  <Play className="h-2.5 w-2.5" />
                                </button>
                              )}
                              {idx > 0 && (
                                <button
                                  onClick={() => onMoveTrack(pl.id, idx, idx - 1)}
                                  className="h-5 px-1 text-[9px] rounded text-muted-foreground hover:text-foreground transition-colors"
                                >↑</button>
                              )}
                              {idx < pl.tracks.length - 1 && (
                                <button
                                  onClick={() => onMoveTrack(pl.id, idx, idx + 1)}
                                  className="h-5 px-1 text-[9px] rounded text-muted-foreground hover:text-foreground transition-colors"
                                >↓</button>
                              )}
                              <button
                                onClick={() => onRemoveTrack(pl.id, track.id)}
                                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
                              >
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
