/**
 * Routing through nginx on port 80:
 *
 *   /api/*     → radio-server:3001  (Node REST API)
 *   /stream/*  → radio-server:8000  (Icecast streams)
 *   /ws        → radio-server:3001  (WebSocket live broadcast)
 *
 * SERVER MODE:
 *   Audio plays on the server via Liquidsoap → Icecast.
 *   The browser dashboard is a pure remote control — it sends commands
 *   to the API but does NOT play audio itself.
 *   To hear audio, open VLC on Windows and subscribe to:
 *     http://<server-ip>:8000/deck-a   (or deck-b, deck-c, deck-d)
 */
const host = `${window.location.protocol}//${window.location.hostname}`;

// REST API — all deck control commands go here
export const STREAMING_SERVER = `${host}/api`;

// Icecast stream base URL — what external players (VLC on Windows) connect to
// e.g. STREAM_BASE + '/deck-a' → full MP3 stream URL
export const STREAM_BASE = `${host}/stream`;

// Direct Icecast port — for sharing stream URLs with VLC / external listeners
// Windows VLC: open network stream → http://<server-ip>:8000/deck-a
export const ICECAST_BASE = `${window.location.hostname}:8000`;

// HLS_BASE kept for backward compat (no longer used)
export const HLS_BASE = `${host}/stream`;

export const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
export const WS_SERVER = `${WS_PROTOCOL}://${window.location.hostname}/ws`;

/**
 * SERVER MODE flag.
 * When true:
 *  - The browser does NOT play audio (no Web Audio / HTMLAudioElement playback)
 *  - All play/pause/skip/load commands are sent to the API
 *  - Liquidsoap handles playback on the server
 *  - Audio comes out of Windows VLC (or any player) subscribed to Icecast
 *
 * Set to false to revert to browser-side playback (original behaviour).
 */
export const SERVER_MODE = true;

/**
 * Returns the Icecast stream URL for a given deck.
 * Use this in VLC: Media → Open Network Stream → paste this URL.
 */
export function getDeckStreamUrl(deck: 'A' | 'B' | 'C' | 'D'): string {
  return `http://${window.location.hostname}:8000/deck-${deck.toLowerCase()}`;
}
