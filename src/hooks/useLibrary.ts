/**
 * useLibrary — persistent music library
 *
 * - Files are uploaded to the streaming server (/data/uploads) which is a
 *   persistent Docker volume. They survive container restarts.
 * - Metadata (original name, server filename, size) is stored in Supabase
 *   so the DJ's library is restored on every login.
 * - Reconciliation ONLY removes stale DB entries when the server IS reachable.
 *   If the server is offline, we show all tracks optimistically (never delete).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { STREAMING_SERVER } from '@/lib/streamingServer';
import { toast } from 'sonner';

export interface LibraryTrack {
  id: string;           // Supabase UUID
  name: string;         // original filename (display)
  serverName: string;   // filename on the streaming server
  size: string;         // human-readable size
  sizeBytes: number;
  addedAt: number;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function useLibrary() {
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const uploadingRef = useRef<Set<string>>(new Set());

  // ── Load library from Supabase on mount ──────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('library_tracks')
          .select('*')
          .order('added_at', { ascending: true });

        if (error) throw error;
        if (cancelled || !data) return;

        // Try to reconcile with server — but ONLY delete stale entries if server responded
        let serverFiles: Set<string> | null = null;
        try {
          const res = await fetch(`${STREAMING_SERVER}/library/files`, {
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) {
            const json = await res.json();
            serverFiles = new Set((json.files || []).map((f: any) => f.serverName));
          }
        } catch {
          // Server offline — keep serverFiles null, show all tracks
          console.warn('[Library] Server offline — showing all library tracks without reconciliation');
        }

        const validTracks: LibraryTrack[] = [];
        const staleIds: string[] = [];

        for (const row of data) {
          // Only prune if server responded AND file is missing
          if (serverFiles !== null && !serverFiles.has(row.server_name)) {
            staleIds.push(row.id);
            continue;
          }
          validTracks.push({
            id: row.id,
            name: row.original_name,
            serverName: row.server_name,
            size: formatSize(row.size_bytes),
            sizeBytes: row.size_bytes,
            addedAt: new Date(row.added_at).getTime(),
          });
        }

        if (!cancelled) setTracks(validTracks);

        // Only clean stale entries when server confirmed they're gone
        if (staleIds.length > 0) {
          console.log(`[Library] Cleaning ${staleIds.length} stale entries`);
          supabase.from('library_tracks').delete().in('id', staleIds).then(() => {});
        }
      } catch (err) {
        console.error('[Library] Load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  // ── Add tracks (upload to server + save to Supabase) ─────────────────────
  const addTracks = useCallback(async (files: File[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error('Not logged in');
      return [];
    }

    const added: LibraryTrack[] = [];

    for (const file of files) {
      // Deduplicate by name+size in current library
      const exists = tracks.some(t => t.name === file.name && t.sizeBytes === file.size);
      if (exists) {
        toast.info(`"${file.name}" is already in your library`);
        continue;
      }

      // Also skip if already uploading
      const key = `${file.name}_${file.size}`;
      if (uploadingRef.current.has(key)) continue;
      uploadingRef.current.add(key);

      try {
        // 1. Upload to streaming server
        const form = new FormData();
        form.append('track', file);
        const res = await fetch(`${STREAMING_SERVER}/library/upload`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) throw new Error(`Server upload failed: ${res.status}`);
        const json = await res.json();

        // 2. Save metadata to Supabase
        const { data: row, error } = await supabase
          .from('library_tracks')
          .insert({
            user_id: user.id,
            original_name: file.name,
            server_name: json.serverName,
            size_bytes: file.size,
          })
          .select()
          .single();

        if (error) throw error;

        const track: LibraryTrack = {
          id: row.id,
          name: file.name,
          serverName: json.serverName,
          size: formatSize(file.size),
          sizeBytes: file.size,
          addedAt: new Date(row.added_at).getTime(),
        };

        added.push(track);
        setTracks(prev => {
          if (prev.some(t => t.id === track.id)) return prev;
          return [...prev, track];
        });
      } catch (err) {
        console.error(`[Library] Failed to upload ${file.name}:`, err);
        toast.error(`Failed to upload ${file.name}`);
      } finally {
        uploadingRef.current.delete(key);
      }
    }

    return added;
  }, [tracks]);

  // ── Delete a track ────────────────────────────────────────────────────────
  const deleteTrack = useCallback(async (id: string) => {
    const track = tracks.find(t => t.id === id);
    if (!track) return;

    // Remove from UI immediately
    setTracks(prev => prev.filter(t => t.id !== id));

    // Delete from server
    try {
      await fetch(`${STREAMING_SERVER}/library/files/${encodeURIComponent(track.serverName)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn('[Library] Server delete failed (file may not exist):', err);
    }

    // Delete from Supabase
    const { error } = await supabase.from('library_tracks').delete().eq('id', id);
    if (error) console.error('[Library] Supabase delete failed:', error);
  }, [tracks]);

  return { tracks, loading, addTracks, deleteTrack };
}
