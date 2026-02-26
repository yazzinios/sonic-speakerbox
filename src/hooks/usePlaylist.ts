/**
 * usePlaylist — manage playlists stored in Supabase
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { STREAMING_SERVER } from '@/lib/streamingServer';
import { toast } from 'sonner';
import type { DeckId } from '@/types/channels';
import type { LibraryTrack } from './useLibrary';

export interface PlaylistTrack {
  id: string;
  playlistId: string;
  title: string;
  serverName: string;
  position: number;
}

export interface Playlist {
  id: string;
  deckId: DeckId;
  name: string;
  tracks: PlaylistTrack[];
  createdAt: number;
}

export function usePlaylists() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  // Always-current ref — avoids stale closure bugs in callbacks
  const playlistsRef = useRef<Playlist[]>([]);
  useEffect(() => { playlistsRef.current = playlists; }, [playlists]);

  // ── Load from Supabase ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data: playlistRows, error: pe } = await supabase
          .from('playlists')
          .select('id, deck_id, name, created_at')
          .order('created_at', { ascending: true });
        if (pe) throw pe;
        if (cancelled || !playlistRows) return;

        // Only fetch tracks if there are playlists
        let trackRows: any[] = [];
        if (playlistRows.length > 0) {
          const { data: td, error: te } = await supabase
            .from('playlist_tracks')
            .select('id, playlist_id, title, source_url, position')
            .in('playlist_id', playlistRows.map(p => p.id))
            .order('position', { ascending: true });
          if (te) throw te;
          trackRows = td || [];
        }

        const built: Playlist[] = playlistRows.map(p => ({
          id: p.id,
          deckId: p.deck_id as DeckId,
          name: p.name,
          tracks: trackRows
            .filter(t => t.playlist_id === p.id)
            .map(t => ({
              id: t.id,
              playlistId: p.id,
              title: t.title,
              serverName: t.source_url,
              position: t.position,
            })),
          createdAt: new Date(p.created_at).getTime(),
        }));

        if (!cancelled) {
          setPlaylists(built);
          playlistsRef.current = built;
        }
      } catch (err) {
        console.error('[Playlist] Load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Create playlist ───────────────────────────────────────────────────────
  const createPlaylist = useCallback(async (deckId: DeckId, name: string): Promise<Playlist | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase
      .from('playlists')
      .insert({ user_id: user.id, deck_id: deckId, name })
      .select()
      .single();
    if (error) { toast.error('Failed to create playlist: ' + error.message); return null; }

    const pl: Playlist = { id: data.id, deckId, name, tracks: [], createdAt: new Date(data.created_at).getTime() };
    // Update both ref and state atomically
    playlistsRef.current = [...playlistsRef.current, pl];
    setPlaylists([...playlistsRef.current]);
    return pl;
  }, []);

  // ── Rename playlist ───────────────────────────────────────────────────────
  const renamePlaylist = useCallback(async (playlistId: string, newName: string) => {
    const { error } = await supabase.from('playlists').update({ name: newName }).eq('id', playlistId);
    if (error) { toast.error('Failed to rename playlist'); return; }
    playlistsRef.current = playlistsRef.current.map(p => p.id === playlistId ? { ...p, name: newName } : p);
    setPlaylists([...playlistsRef.current]);
  }, []);

  // ── Delete playlist ───────────────────────────────────────────────────────
  const deletePlaylist = useCallback(async (playlistId: string) => {
    const { error } = await supabase.from('playlists').delete().eq('id', playlistId);
    if (error) { toast.error('Failed to delete playlist'); return; }
    playlistsRef.current = playlistsRef.current.filter(p => p.id !== playlistId);
    setPlaylists([...playlistsRef.current]);
  }, []);

  // ── Add tracks to playlist ────────────────────────────────────────────────
  const addTracksToPlaylist = useCallback(async (playlistId: string, libraryTracks: LibraryTrack[]) => {
    // Use ref — never stale, even if called right after createPlaylist
    const playlist = playlistsRef.current.find(p => p.id === playlistId);
    if (!playlist) {
      console.error('[Playlist] addTracksToPlaylist: playlist not found', playlistId, playlistsRef.current.map(p => p.id));
      toast.error('Playlist not found');
      return;
    }

    const startPos = playlist.tracks.length;
    const inserts = libraryTracks.map((lt, i) => ({
      playlist_id: playlistId,
      title: lt.name,
      source_type: 'upload',
      source_url: lt.serverName,
      position: startPos + i,
    }));

    const { data, error } = await supabase.from('playlist_tracks').insert(inserts).select();
    if (error) { toast.error('Failed to add tracks: ' + error.message); return; }

    const newTracks: PlaylistTrack[] = (data || []).map(t => ({
      id: t.id,
      playlistId,
      title: t.title,
      serverName: t.source_url,
      position: t.position,
    }));

    playlistsRef.current = playlistsRef.current.map(p =>
      p.id === playlistId ? { ...p, tracks: [...p.tracks, ...newTracks] } : p
    );
    setPlaylists([...playlistsRef.current]);
    toast.success(`Added ${newTracks.length} track${newTracks.length !== 1 ? 's' : ''} to "${playlist.name}"`);
  }, []);

  // ── Remove track ──────────────────────────────────────────────────────────
  const removeTrackFromPlaylist = useCallback(async (playlistId: string, trackId: string) => {
    const { error } = await supabase.from('playlist_tracks').delete().eq('id', trackId);
    if (error) { toast.error('Failed to remove track'); return; }
    playlistsRef.current = playlistsRef.current.map(p =>
      p.id === playlistId ? { ...p, tracks: p.tracks.filter(t => t.id !== trackId) } : p
    );
    setPlaylists([...playlistsRef.current]);
  }, []);

  // ── Reorder track ─────────────────────────────────────────────────────────
  const moveTrack = useCallback(async (playlistId: string, fromIndex: number, toIndex: number) => {
    const playlist = playlistsRef.current.find(p => p.id === playlistId);
    if (!playlist) return;
    const tracks = [...playlist.tracks];
    const [moved] = tracks.splice(fromIndex, 1);
    tracks.splice(toIndex, 0, moved);
    const updated = tracks.map((t, i) => ({ ...t, position: i }));

    playlistsRef.current = playlistsRef.current.map(p => p.id === playlistId ? { ...p, tracks: updated } : p);
    setPlaylists([...playlistsRef.current]);

    await Promise.all(updated.map(t =>
      supabase.from('playlist_tracks').update({ position: t.position }).eq('id', t.id)
    ));
  }, []);

  // ── Play playlist on deck ─────────────────────────────────────────────────
  const playPlaylistOnDeck = useCallback(async (
    playlistId: string,
    deckId: DeckId,
    options?: { loop?: boolean; startIndex?: number }
  ) => {
    const playlist = playlistsRef.current.find(p => p.id === playlistId);
    if (!playlist || playlist.tracks.length === 0) {
      toast.error('Playlist is empty — add tracks from the Library first');
      return;
    }

    const sortedTracks = [...playlist.tracks].sort((a, b) => a.position - b.position);
    try {
      const res = await fetch(`${STREAMING_SERVER}/deck/${deckId}/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tracks: sortedTracks.map(t => ({ id: t.id, serverName: t.serverName, name: t.title })),
          loop: options?.loop || false,
          startIndex: options?.startIndex || 0,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Server error');
      toast.success(`▶ "${playlist.name}" on Deck ${deckId}`);
    } catch (err: any) {
      toast.error(`Failed to play playlist: ${err.message}`);
    }
  }, []);

  // ── Skip / Jump ───────────────────────────────────────────────────────────
  const skipNext = useCallback(async (deckId: DeckId) => {
    try { await fetch(`${STREAMING_SERVER}/deck/${deckId}/playlist/next`, { method: 'POST' }); } catch {}
  }, []);

  const jumpToTrack = useCallback(async (deckId: DeckId, index: number) => {
    try {
      await fetch(`${STREAMING_SERVER}/deck/${deckId}/playlist/jump`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index }),
      });
    } catch {}
  }, []);

  return {
    playlists, loading,
    createPlaylist, renamePlaylist, deletePlaylist,
    addTracksToPlaylist, removeTrackFromPlaylist, moveTrack,
    playPlaylistOnDeck, skipNext, jumpToTrack,
  };
}
