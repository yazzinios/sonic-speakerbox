export type DeckId = 'A' | 'B' | 'C' | 'D';
export const ALL_DECKS: DeckId[] = ['A', 'B', 'C', 'D'];

export interface ListenerChannel {
  id: DeckId;
  name: string;
  code: string;
  bgImage: string;
}

export const DEFAULT_CHANNELS: ListenerChannel[] = [
  { id: 'A', name: 'Channel A', code: 'CH-A-1001', bgImage: '' },
  { id: 'B', name: 'Channel B', code: 'CH-B-2002', bgImage: '' },
  { id: 'C', name: 'Channel C', code: 'CH-C-3003', bgImage: '' },
  { id: 'D', name: 'Channel D', code: 'CH-D-4004', bgImage: '' },
];

export const DECK_COLORS: Record<DeckId, { hue: number; class: string }> = {
  A: { hue: 185, class: 'text-primary' },
  B: { hue: 320, class: 'text-accent' },
  C: { hue: 45, class: 'text-yellow-400' },
  D: { hue: 140, class: 'text-emerald-400' },
};

export function getChannels(): ListenerChannel[] {
  const stored = localStorage.getItem('dj-channels');
  if (stored) {
    try { return JSON.parse(stored); } catch { /* fall through */ }
  }
  return DEFAULT_CHANNELS;
}

export function saveChannels(channels: ListenerChannel[]) {
  localStorage.setItem('dj-channels', JSON.stringify(channels));
}
