/**
 * useLibrary — persistent music library
 *
 * - Files are uploaded to the streaming server (/data/uploads) — persistent Docker volume.
 * - Metadata is stored in Supabase so the library is restored on every login.
 * - Deduplication uses a ref so it's always current, even across concurrent uploads.
 * - Reconciliation ONLY removes stale entries when the server IS reachable.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { STREAMING_SERVER } from '@/lib/streamingServer';
import { toast } from 'sonner';

export interface LibraryTrack {
  id: string;
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

  // Refs always reflect the latest state — safe in concurrent async callbacks
  const tracksRef = useRef<LibraryTrack[]>([]);
  const uploadingRef = useRef<Set<string>>(new Set()); // key = "name_size"

  // Keep ref in sync with state
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

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

        // Reconcile with server — ONLY prune if server responded
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
          console.warn('[Library] Server offline — skipping reconciliation');
        }

        const validTracks: LibraryTrack[] = [];
        const staleIds: string[] = [];

        for (const row of data) {
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

        if (!cancelled) {
          setTracks(validTracks);
          tracksRef.current = validTracks;
        }

        if (staleIds.length > 0) {
          console.log(`[Library] Pruning ${staleIds.length} missing entries`);
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

  // ── Add tracks ────────────────────────────────────────────────────────────
  const addTracks = useCallback(async (files: File[]) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not logged in'); return []; }

    const added: LibraryTrack[] = [];

    for (const file of files) {
      const key = `${file.name}_${file.size}`;

      // Check ref (always current) for duplicates already in library
      const alreadyInLib = tracksRef.current.some(
        t => t.name === file.name && t.sizeBytes === file.size
      );
      if (alreadyInLib) {
        toast.info(`"${file.name}" is already in your library`);
        continue;
      }

      // Skip if this exact file is currently being uploaded
      if (uploadingRef.current.has(key)) continue;
      uploadingRef.current.add(key);

      try {
        // 1. Upload file to streaming server
        const form = new FormData();
        form.append('track', file);
        const res = await fetch(`${STREAMING_SERVER}/library/upload`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) throw new Error(`Server upload failed: ${res.status}`);
        const json = await res.json();

        // 2. Check again after upload (another tab or concurrent call may have added it)
        const stillDupe = tracksRef.current.some(
          t => t.name === file.name && t.sizeBytes === file.size
        );
        if (stillDupe) {
          // Clean up the duplicate file we just uploaded
          fetch(`${STREAMING_SERVER}/library/files/${encodeURIComponent(json.serverName)}`, {
            method: 'DELETE',
          }).catch(() => {});
          continue;
        }

        // 3. Save metadata to Supabase
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
        // Update both state and ref atomically
        tracksRef.current = [...tracksRef.current, track];
        setTracks([...tracksRef.current]);

      } catch (err) {
        console.error(`[Library] Failed to upload ${file.name}:`, err);
        toast.error(`Failed to upload ${file.name}`);
      } finally {
        uploadingRef.current.delete(key);
      }
    }

    return added;
  }, []); // no deps — uses refs only

  // ── Delete a track ────────────────────────────────────────────────────────
  const deleteTrack = useCallback(async (id: string) => {
    const track = tracksRef.current.find(t => t.id === id);
    if (!track) return;

    // Optimistic UI remove
    tracksRef.current = tracksRef.current.filter(t => t.id !== id);
    setTracks([...tracksRef.current]);

    // Delete from server
    try {
      await fetch(`${STREAMING_SERVER}/library/files/${encodeURIComponent(track.serverName)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn('[Library] Server delete failed:', err);
    }

    // Delete from Supabase
    const { error } = await supabase.from('library_tracks').delete().eq('id', id);
    if (error) console.error('[Library] Supabase delete failed:', error);
  }, []);

  return { tracks, loading, addTracks, deleteTrack };
}
