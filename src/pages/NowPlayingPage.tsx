import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getDeckStreamUrl } from '@/lib/streamingServer';
import { ALL_DECKS, type DeckId } from '@/types/channels';
import { Radio, Music2, ExternalLink } from 'lucide-react';

const DECK_HEX: Record<DeckId, string> = {
  A: '#f59e0b',
  B: '#3b82f6',
  C: '#22c55e',
  D: '#a855f7',
};

// Simulated now-playing data (replace with real API call in production)
const MOCK_NOW_PLAYING: Record<DeckId, { title: string; artist: string; progress: number }> = {
  A: { title: 'Midnight Drive', artist: 'Neon Pulse', progress: 62 },
  B: { title: 'Desert Rain', artist: 'Echo Valley', progress: 35 },
  C: { title: 'Static Bloom', artist: 'The Wire', progress: 80 },
  D: { title: 'Low Frequency', artist: 'Bassline Theory', progress: 15 },
};

function DeckNowPlaying({ id, active }: { id: DeckId; active: boolean }) {
  const [progress, setProgress] = useState(MOCK_NOW_PLAYING[id].progress);
  const track = MOCK_NOW_PLAYING[id];

  // Simulate progress ticking
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setProgress(p => (p >= 100 ? 0 : p + 0.5));
    }, 1000);
    return () => clearInterval(interval);
  }, [active]);

  return (
    <div style={{
      border: `1px solid ${active ? DECK_HEX[id] + '55' : '#1a1a1a'}`,
      borderRadius: 16,
      padding: '20px 24px',
      background: active ? `radial-gradient(ellipse at top left, ${DECK_HEX[id]}0a, transparent 60%), #0d0d0d` : '#0a0a0a',
      transition: 'all 0.4s ease',
      boxShadow: active ? `0 0 30px ${DECK_HEX[id]}18` : 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 10,
          letterSpacing: 3,
          color: active ? DECK_HEX[id] : '#333',
        }}>
          {active ? '● LIVE' : '○ OFF'} · DECK {id}
        </span>
        {active && (
          <a
            href={getDeckStreamUrl(id)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 10, color: DECK_HEX[id],
              fontFamily: "'Courier New', monospace",
              textDecoration: 'none',
            }}
          >
            LISTEN <ExternalLink size={10} />
          </a>
        )}
      </div>

      <div style={{ marginBottom: 14 }}>
        <p style={{
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: 18,
          color: active ? '#f0e6d0' : '#2a2a2a',
          marginBottom: 3,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}>
          {track.title}
        </p>
        <p style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          color: active ? '#666' : '#222',
        }}>
          {track.artist}
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ background: '#1a1a1a', borderRadius: 4, height: 3, overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${progress}%`,
          background: active ? DECK_HEX[id] : '#222',
          borderRadius: 4,
          transition: 'width 1s linear',
        }} />
      </div>
    </div>
  );
}

export default function NowPlayingPage() {
  const [searchParams] = useSearchParams();
  const deckParam = searchParams.get('deck') as DeckId | null;
  const decksToShow: DeckId[] = deckParam ? [deckParam] : [...ALL_DECKS];
  const [tick, setTick] = useState(0);

  // Clock
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: '#050505',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px 16px',
      fontFamily: 'system-ui',
    }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 8 }}>
          <Radio size={18} color="#f59e0b" style={{ animation: 'pulse 2s ease infinite' }} />
          <span style={{
            fontFamily: "'Courier New', monospace",
            fontSize: 11,
            letterSpacing: 4,
            color: '#f59e0b',
          }}>
            NOW PLAYING
          </span>
        </div>
        <h1 style={{
          fontFamily: 'Georgia, serif',
          fontStyle: 'italic',
          fontSize: 32,
          color: '#f0e6d0',
          margin: 0,
        }}>
          Sonic Speakerbox
        </h1>
        <p style={{
          fontFamily: "'Courier New', monospace",
          fontSize: 11,
          color: '#333',
          marginTop: 8,
        }}>
          {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      </div>

      {/* Decks */}
      <div style={{
        width: '100%',
        maxWidth: 900,
        display: 'grid',
        gridTemplateColumns: decksToShow.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
      }}>
        {decksToShow.map(id => (
          <DeckNowPlaying key={id} id={id} active={id === 'A' || id === 'C'} />
        ))}
      </div>

      {/* Footer */}
      <div style={{
        marginTop: 40,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}>
        <Music2 size={12} color="#222" />
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: '#222', letterSpacing: 2 }}>
          SONIC SPEAKERBOX · LIVE RADIO
        </span>
      </div>
    </div>
  );
}
