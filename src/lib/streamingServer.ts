/**
 * Routing through nginx on port 80:
 *
 *   /api/*     → radio-server:3001  (Node REST API)
 *   /stream/*  → radio-server:8000  (Icecast streams)
 *   /ws        → radio-server:3001  (WebSocket live broadcast)
 */
const host = `${window.location.protocol}//${window.location.hostname}`;

// REST API
export const STREAMING_SERVER = `${host}/api`;

// Icecast stream base URL — listeners use this to tune in
// e.g. STREAM_BASE + '/deck-a' → full MP3 stream URL
export const STREAM_BASE = `${host}/stream`;

// Direct Icecast port (for sharing with external players like VLC)
export const ICECAST_BASE = `${window.location.hostname}:8000`;

// HLS_BASE kept for backward compat (no longer used)
export const HLS_BASE = `${host}/stream`;

export const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
export const WS_SERVER = `${WS_PROTOCOL}://${window.location.hostname}/ws`;
