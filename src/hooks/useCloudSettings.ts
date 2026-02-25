import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { DeckId } from '@/types/channels';

export interface CloudDJSettings {
  station_name: string;
  dj_name: string;
  bg_image: string;
  jingle_url: string;
  jingle_name: string;
}

export interface CloudChannel {
  id?: string;
  deck_id: DeckId;
  name: string;
  code: string;
  bg_image: string;
  peer_id?: string;
}

export function useCloudSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<CloudDJSettings>({
    station_name: 'DJ CONSOLE', dj_name: '', bg_image: '', jingle_url: '', jingle_name: 'Default (tan-tan-tan)',
  });
  const [channels, setChannels] = useState<CloudChannel[]>([]);
  const [loading, setLoading] = useState(true);

  // Load settings from cloud
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setLoading(true);
      // Load DJ settings
      const { data: djData } = await supabase
        .from('dj_settings')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (djData) {
        setSettings({
          station_name: djData.station_name,
          dj_name: djData.dj_name || '',
          bg_image: djData.bg_image || '',
          jingle_url: djData.jingle_url || '',
          jingle_name: djData.jingle_name || 'Default (tan-tan-tan)',
        });
      } else {
        // Create default settings
        await supabase.from('dj_settings').insert({ user_id: user.id });
      }

      // Load channels
      const { data: chData } = await supabase
        .from('channels')
        .select('*')
        .eq('user_id', user.id)
        .order('deck_id');

      if (chData && chData.length > 0) {
        setChannels(chData.map(ch => ({
          id: ch.id, deck_id: ch.deck_id as DeckId, name: ch.name, code: ch.code, bg_image: ch.bg_image || '',
        })));
      } else {
        // Create default channels
        const defaults: { deck_id: DeckId; name: string; code: string }[] = [
          { deck_id: 'A', name: 'Channel A', code: 'CH-A-1001' },
          { deck_id: 'B', name: 'Channel B', code: 'CH-B-2002' },
          { deck_id: 'C', name: 'Channel C', code: 'CH-C-3003' },
          { deck_id: 'D', name: 'Channel D', code: 'CH-D-4004' },
        ];
        const inserts = defaults.map(d => ({ ...d, user_id: user.id, bg_image: '' }));
        const { data: inserted } = await supabase.from('channels').insert(inserts).select();
        if (inserted) {
          setChannels(inserted.map(ch => ({
            id: ch.id, deck_id: ch.deck_id as DeckId, name: ch.name, code: ch.code, bg_image: ch.bg_image || '',
          })));
        }
      }
      setLoading(false);
    };
    load();
  }, [user]);

  const saveSettings = useCallback(async (partial: Partial<CloudDJSettings>) => {
    if (!user) return;
    const next = { ...settings, ...partial };
    setSettings(next);
    await supabase.from('dj_settings').update({
      station_name: next.station_name,
      dj_name: next.dj_name,
      bg_image: next.bg_image,
      jingle_url: next.jingle_url,
      jingle_name: next.jingle_name,
    }).eq('user_id', user.id);
  }, [user, settings]);

  const saveChannels = useCallback(async (updated: CloudChannel[]) => {
    if (!user) return;
    setChannels(updated);
    for (const ch of updated) {
      await supabase.from('channels').update({
        name: ch.name, code: ch.code, bg_image: ch.bg_image,
      }).eq('user_id', user.id).eq('deck_id', ch.deck_id);
    }
  }, [user]);

  const savePeerId = useCallback(async (deckId: DeckId, peerId: string) => {
    if (!user) return;
    setChannels(prev => prev.map(ch => ch.deck_id === deckId ? { ...ch, peer_id: peerId } : ch));
    await supabase.from('channels').update({ peer_id: peerId }).eq('user_id', user.id).eq('deck_id', deckId);
  }, [user]);

  const clearPeerIds = useCallback(async () => {
    if (!user) return;
    setChannels(prev => prev.map(ch => ({ ...ch, peer_id: '' })));
    await supabase.from('channels').update({ peer_id: '' }).eq('user_id', user.id);
  }, [user]);

  return { settings, channels, loading, saveSettings, saveChannels, savePeerId, clearPeerIds };
}
