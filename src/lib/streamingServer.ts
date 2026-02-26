/**
 * SonicBeat — Streaming Server Config
 *
 * All API calls go through nginx on port 80 (proxied to radio-server:3001).
 * Icecast streams are on port 8000 (direct, not proxied — for VLC).
 *
 * SERVER_MODE = true  → browser is a remote control only. No local audio playback.
 *                        Audio plays on the server via Liquidsoap → Icecast.
 *                        Open VLC on Windows and point it to getDeckStreamUrl(deck).
 *
 * SERVER_MODE = false → original browser-playback mode (Web Audio API).
 */

const host = `${window.location.protocol}//${window.location.hostname}`;

/** REST API base — all deck/library/playlist calls go here */
export const STREAMING_SERVER = `${host}/api`;

/** Icecast stream base URL through nginx proxy (for in-browser preview only) */
export const STREAM_BASE = `${host}/stream`;

/** Direct Icecast port — use this for VLC and external players */
export const ICECAST_PORT = 8000;

/** Direct Icecast base (host:port) — use in external player URLs */
export const ICECAST_BASE = `${window.location.hostname}:${ICECAST_PORT}`;

export const HLS_BASE = `${host}/stream`; // kept for compat

export const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
export const WS_SERVER = `${WS_PROTOCOL}://${window.location.hostname}/ws`;

/**
 * SERVER MODE
 * true  → no browser audio, all actions go to the API
 * false → original browser-playback + broadcast mode
 */
export const SERVER_MODE = true;

/** Direct Icecast stream URL for a deck (use in VLC: Media → Open Network Stream) */
export function getDeckStreamUrl(deck: 'A' | 'B' | 'C' | 'D'): string {
  return `http://${window.location.hostname}:${ICECAST_PORT}/deck-${deck.toLowerCase()}`;
}
