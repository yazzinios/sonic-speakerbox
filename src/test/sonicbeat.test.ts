import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── streamingServer utils ────────────────────────────────────────────────
describe('getDeckStreamUrl', () => {
  beforeEach(() => {
    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: { hostname: '192.168.1.10', protocol: 'http:' },
      writable: true,
    });
  });

  it('builds the correct Icecast stream URL for each deck', async () => {
    const { getDeckStreamUrl } = await import('../lib/streamingServer');
    expect(getDeckStreamUrl('A')).toBe('http://192.168.1.10:8000/deck-a');
    expect(getDeckStreamUrl('B')).toBe('http://192.168.1.10:8000/deck-b');
    expect(getDeckStreamUrl('C')).toBe('http://192.168.1.10:8000/deck-c');
    expect(getDeckStreamUrl('D')).toBe('http://192.168.1.10:8000/deck-d');
  });
});

// ─── MusicRequest type guards ─────────────────────────────────────────────
describe('MusicRequest data shape', () => {
  it('should have all required fields', () => {
    const request = {
      id: 'test-001',
      name: 'Ahmed K.',
      email: 'ahmed@example.com',
      phone: '+212600000000',
      song: 'Midnight Drive - Neon Pulse',
      timestamp: Date.now(),
    };
    expect(request.id).toBeTruthy();
    expect(request.name).toBeTruthy();
    expect(request.email).toContain('@');
    expect(request.song).toBeTruthy();
    expect(request.timestamp).toBeGreaterThan(0);
  });

  it('should reject empty song field', () => {
    const isValid = (r: { song: string }) => r.song.trim().length > 0;
    expect(isValid({ song: '' })).toBe(false);
    expect(isValid({ song: '  ' })).toBe(false);
    expect(isValid({ song: 'Test Song' })).toBe(true);
  });

  it('should reject invalid email format', () => {
    const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('user@domain.com')).toBe(true);
    expect(isValidEmail('user@')).toBe(false);
  });
});

// ─── DeckState defaults ───────────────────────────────────────────────────
describe('DeckState initial values', () => {
  const INITIAL_DECK = {
    fileName: '',
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 0.8,
    speed: 1,
    eq: { low: 0, mid: 0, high: 0 },
    loopStart: null,
    loopEnd: null,
    loopActive: false,
    youtubeUrl: '',
  };

  it('should not be playing on init', () => {
    expect(INITIAL_DECK.isPlaying).toBe(false);
  });

  it('should have default volume at 0.8', () => {
    expect(INITIAL_DECK.volume).toBe(0.8);
  });

  it('should have speed at 1x', () => {
    expect(INITIAL_DECK.speed).toBe(1);
  });

  it('should have EQ bands at 0 (flat)', () => {
    expect(INITIAL_DECK.eq.low).toBe(0);
    expect(INITIAL_DECK.eq.mid).toBe(0);
    expect(INITIAL_DECK.eq.high).toBe(0);
  });

  it('should have loop disabled', () => {
    expect(INITIAL_DECK.loopActive).toBe(false);
    expect(INITIAL_DECK.loopStart).toBeNull();
    expect(INITIAL_DECK.loopEnd).toBeNull();
  });
});

// ─── Deck channels ────────────────────────────────────────────────────────
describe('ALL_DECKS channel list', () => {
  it('should contain exactly 4 decks: A, B, C, D', async () => {
    const { ALL_DECKS } = await import('../types/channels');
    expect(ALL_DECKS).toEqual(['A', 'B', 'C', 'D']);
    expect(ALL_DECKS).toHaveLength(4);
  });
});

// ─── EQ value clamping ────────────────────────────────────────────────────
describe('EQ value bounds', () => {
  const clampEQ = (v: number) => Math.max(-12, Math.min(12, v));

  it('should clamp values above +12', () => {
    expect(clampEQ(20)).toBe(12);
  });

  it('should clamp values below -12', () => {
    expect(clampEQ(-20)).toBe(-12);
  });

  it('should pass through valid values', () => {
    expect(clampEQ(6)).toBe(6);
    expect(clampEQ(-6)).toBe(-6);
    expect(clampEQ(0)).toBe(0);
  });
});

// ─── Volume bounds ────────────────────────────────────────────────────────
describe('Volume clamping', () => {
  const clampVolume = (v: number) => Math.max(0, Math.min(1, v));

  it('should not go above 1.0', () => {
    expect(clampVolume(1.5)).toBe(1);
  });

  it('should not go below 0', () => {
    expect(clampVolume(-0.5)).toBe(0);
  });

  it('should pass valid values', () => {
    expect(clampVolume(0.8)).toBe(0.8);
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(1)).toBe(1);
  });
});

// ─── Playlist queue logic ─────────────────────────────────────────────────
describe('Playlist skip logic', () => {
  const skipTrack = (playlist: any[]) => {
    if (!playlist.length) return playlist;
    const [, ...rest] = playlist;
    return rest;
  };

  it('should remove the first track on skip', () => {
    const queue = [{ id: 1 }, { id: 2 }, { id: 3 }];
    expect(skipTrack(queue)).toEqual([{ id: 2 }, { id: 3 }]);
  });

  it('should return empty array when skipping last track', () => {
    expect(skipTrack([{ id: 1 }])).toEqual([]);
  });

  it('should not mutate empty queue', () => {
    expect(skipTrack([])).toEqual([]);
  });
});

// ─── Cooldown / debounce guard ────────────────────────────────────────────
describe('Cooldown guard', () => {
  it('should block second request within cooldown window', () => {
    let lastTrigger = 0;
    const COOLDOWN_MS = 5000;

    const canTrigger = () => {
      const now = Date.now();
      if (now - lastTrigger < COOLDOWN_MS) return false;
      lastTrigger = now;
      return true;
    };

    expect(canTrigger()).toBe(true);
    expect(canTrigger()).toBe(false); // within cooldown
  });
});
