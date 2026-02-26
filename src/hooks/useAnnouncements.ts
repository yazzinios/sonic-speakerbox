/**
 * useAnnouncements — persistent announcements stored in Supabase
 *
 * - TTS announcements: stored as text in Supabase
 * - Audio file announcements: uploaded to streaming server (/data/announcements)
 *   and the server filename is stored in Supabase audio_url field
 * - Survives browser close / re-login
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { STREAMING_SERVER } from '@/lib/streamingServer';
import { toast } from 'sonner';
import type { DeckId } from '@/types/channels';

export type AnnTarget = 'all' | DeckId;
export type AnnCategory = 'entrance' | 'exit' | 'evacuation' | 'promo';

export interface Announcement {
  id: string;             // Supabase UUID
  name: string;           // display title
  category: AnnCategory;
  contentType: 'audio' | 'tts';
  audioServerName: string | null;  // filename on server (/data/announcements/)
  ttsText: string;
  voiceName: string;
  scheduledTime: string;  // HH:MM or ''
  target: AnnTarget;
  played: boolean;        // local session only — resets on reload
  createdAt: number;
}

export function useAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const uploadingRef = useRef<Set<string>>(new Set());

  // ── Load from Supabase on mount ───────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('announcements')
          .select('*')
          .order('created_at', { ascending: true });
        if (error) throw error;
        if (cancelled || !data) return;

        const loaded: Announcement[] = data.map((row: any) => ({
          id: row.id,
          name: row.title,
          category: row.category as AnnCategory,
          contentType: row.content_type as 'audio' | 'tts',
          audioServerName: row.audio_url || null,
          ttsText: row.tts_text || '',
          voiceName: row.voice_name || '',
          scheduledTime: row.scheduled_time || '',
          target: (row.target_deck as AnnTarget) || 'all',
          played: false,
          createdAt: new Date(row.created_at).getTime(),
        }));

        if (!cancelled) setAnnouncements(loaded);
      } catch (err) {
        console.error('[Announcements] Load failed:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Add announcement ──────────────────────────────────────────────────────
  const addAnnouncement = useCallback(async (opts: {
    name: string;
    category: AnnCategory;
    file: File | null;
    ttsText: string;
    voiceName: string;
    scheduledTime: string;
    target: AnnTarget;
  }) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { toast.error('Not logged in'); return null; }

    const { name, category, file, ttsText, voiceName, scheduledTime, target } = opts;

    let audioServerName: string | null = null;
    const contentType: 'audio' | 'tts' = file ? 'audio' : 'tts';

    // Upload audio file to server if provided
    if (file) {
      const key = `${file.name}_${file.size}`;
      if (uploadingRef.current.has(key)) return null;
      uploadingRef.current.add(key);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${STREAMING_SERVER}/announcements/upload`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) throw new Error(`Server upload failed: ${res.status}`);
        const json = await res.json();
        audioServerName = json.serverName;
      } catch (err) {
        console.error('[Announcements] Audio upload failed:', err);
        toast.error('Failed to upload audio file');
        uploadingRef.current.delete(key);
        return null;
      } finally {
        if (file) uploadingRef.current.delete(`${file.name}_${file.size}`);
      }
    }

    // Save to Supabase
    try {
      const { data: row, error } = await supabase
        .from('announcements')
        .insert({
          user_id: user.id,
          title: name || file?.name || 'Announcement',
          category,
          content_type: contentType,
          audio_url: audioServerName,
          tts_text: ttsText,
          target_deck: target,
          voice_name: voiceName,
          scheduled_time: scheduledTime,
        } as any)
        .select()
        .single();

      if (error) throw error;

      const ann: Announcement = {
        id: row.id,
        name: row.title,
        category,
        contentType,
        audioServerName,
        ttsText,
        voiceName,
        scheduledTime,
        target,
        played: false,
        createdAt: new Date(row.created_at).getTime(),
      };

      setAnnouncements(prev => [...prev, ann]);
      return ann;
    } catch (err) {
      console.error('[Announcements] Supabase save failed:', err);
      toast.error('Failed to save announcement');
      return null;
    }
  }, []);

  // ── Delete announcement ───────────────────────────────────────────────────
  const deleteAnnouncement = useCallback(async (id: string) => {
    const ann = announcements.find(a => a.id === id);
    if (!ann) return;

    // Remove from UI immediately
    setAnnouncements(prev => prev.filter(a => a.id !== id));

    // Delete audio file from server if any
    if (ann.audioServerName) {
      try {
        await fetch(`${STREAMING_SERVER}/announcements/files/${encodeURIComponent(ann.audioServerName)}`, {
          method: 'DELETE',
        });
      } catch { /* server offline */ }
    }

    // Delete from Supabase
    const { error } = await supabase.from('announcements').delete().eq('id', id);
    if (error) console.error('[Announcements] Supabase delete failed:', error);
  }, [announcements]);

  // ── Mark as played (local session) ───────────────────────────────────────
  const markPlayed = useCallback((id: string) => {
    setAnnouncements(prev => prev.map(a => a.id === id ? { ...a, played: true } : a));
  }, []);

  return { announcements, loading, addAnnouncement, deleteAnnouncement, markPlayed };
}
