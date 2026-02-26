/**
 * useLibrary — persistent music library
 *
 * Upload flow:
 *  1. POST file → streaming server /library/upload  (gets serverName back)
 *  2. INSERT row → Supabase library_tracks
 *  3. Show in UI
 *
 * If step 2 fails the toast shows the real Supabase error so we can debug it.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { STREAMING_SERVER } from '@/lib/streamingServer';
import { toast } from 'sonner';

export interface LibraryTrack {
  id: string;
  name: string;
  serverName: string;
  size: string;
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
  const tracksRef = useRef<LibraryTrack[]>([]);
  const uploadingRef = useRef<Set<string>>(new Set());

  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  // ── Load from Supabase ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        // First verify we're authenticated
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError) { console.error('[Library] Auth error:', authError); return; }
        if (!user) { console.warn('[Library] No user — skipping load'); return; }

        console.log('[Library] Loading for user:', user.id);

        const { data, error } = await supabase
          .from('library_tracks')
          .select('*')
          .order('added_at', { ascending: true });

        if (error) {
          console.error('[Library] Supabase select error:', error);
          throw error;
        }

        console.log(`[Library] Loaded ${data?.length ?? 0} rows from Supabase`);
        if (cancelled || !data) return;

        // Reconcile with server — only prune if server responds
        let serverFiles: Set<string> | null = null;
        try {
          const res = await fetch(`${STREAMING_SERVER}/library/files`, {
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) {
            const json = await res.json();
            serverFiles = new Set((json.files || []).map((f: any) => f.serverName));
            console.log(`[Library] Server has ${serverFiles.size} files`);
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
          console.log(`[Library] Showing ${validTracks.length} valid tracks`);
        }

        if (staleIds.length > 0) {
          console.log(`[Library] Pruning ${staleIds.length} stale DB entries`);
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
    // Get auth user — getUser() is always fresh (not cached)
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError) {
      console.error('[Library] Auth error on upload:', authError);
      toast.error('Authentication error — please refresh and try again');
      return [];
    }
    if (!user) {
      toast.error('Not logged in — please sign in first');
      return [];
    }

    console.log('[Library] Adding tracks as user:', user.id);
    const added: LibraryTrack[] = [];

    for (const file of files) {
      const key = `${file.name}_${file.size}`;

      const alreadyInLib = tracksRef.current.some(
        t => t.name === file.name && t.sizeBytes === file.size
      );
      if (alreadyInLib) {
        toast.info(`"${file.name}" is already in your library`);
        continue;
      }

      if (uploadingRef.current.has(key)) {
        console.log(`[Library] Already uploading: ${file.name}`);
        continue;
      }
      uploadingRef.current.add(key);

      try {
        // Step 1 — upload to streaming server
        console.log(`[Library] Uploading to server: ${file.name}`);
        const form = new FormData();
        form.append('track', file);
        const serverRes = await fetch(`${STREAMING_SERVER}/library/upload`, {
          method: 'POST',
          body: form,
        });
        if (!serverRes.ok) {
          const errText = await serverRes.text();
          throw new Error(`Server upload failed (${serverRes.status}): ${errText}`);
        }
        const serverJson = await serverRes.json();
        const serverName: string = serverJson.serverName;
        console.log(`[Library] Server accepted: ${file.name} → ${serverName}`);

        // Step 2 — post-upload dedup check
        const stillDupe = tracksRef.current.some(
          t => t.name === file.name && t.sizeBytes === file.size
        );
        if (stillDupe) {
          console.log(`[Library] Dedup after upload, deleting extra: ${serverName}`);
          fetch(`${STREAMING_SERVER}/library/files/${encodeURIComponent(serverName)}`, {
            method: 'DELETE',
          }).catch(() => {});
          continue;
        }

        // Step 3 — save to Supabase
        console.log(`[Library] Saving to Supabase: ${file.name}`);
        const { data: row, error: dbError } = await supabase
          .from('library_tracks')
          .insert({
            user_id: user.id,
            original_name: file.name,
            server_name: serverName,
            size_bytes: file.size,
          })
          .select()
          .single();

        if (dbError) {
          // Log the full Supabase error so we can see what's wrong
          console.error('[Library] Supabase insert error:', JSON.stringify(dbError, null, 2));
          // Clean up the orphaned server file
          fetch(`${STREAMING_SERVER}/library/files/${encodeURIComponent(serverName)}`, {
            method: 'DELETE',
          }).catch(() => {});
          throw new Error(`Database error: ${dbError.message} (code: ${dbError.code})`);
        }

        console.log(`[Library] Saved to DB: ${file.name} id=${row.id}`);

        const track: LibraryTrack = {
          id: row.id,
          name: file.name,
          serverName,
          size: formatSize(file.size),
          sizeBytes: file.size,
          addedAt: new Date(row.added_at).getTime(),
        };

        added.push(track);
        tracksRef.current = [...tracksRef.current, track];
        setTracks([...tracksRef.current]);
        toast.success(`"${file.name}" added to library`);

      } catch (err: any) {
        console.error(`[Library] Failed to add "${file.name}":`, err);
        toast.error(`Upload failed: ${err.message}`);
      } finally {
        uploadingRef.current.delete(key);
      }
    }

    return added;
  }, []);

  // ── Delete track ──────────────────────────────────────────────────────────
  const deleteTrack = useCallback(async (id: string) => {
    const track = tracksRef.current.find(t => t.id === id);
    if (!track) return;

    tracksRef.current = tracksRef.current.filter(t => t.id !== id);
    setTracks([...tracksRef.current]);

    try {
      await fetch(`${STREAMING_SERVER}/library/files/${encodeURIComponent(track.serverName)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      console.warn('[Library] Server delete failed:', err);
    }

    const { error } = await supabase.from('library_tracks').delete().eq('id', id);
    if (error) console.error('[Library] Supabase delete failed:', error);
  }, []);

  return { tracks, loading, addTracks, deleteTrack };
}
