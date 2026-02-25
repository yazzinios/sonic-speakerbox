/**
 * The base URL of the streaming server.
 * Always points directly to port 3001 on the same hostname.
 * This bypasses the Vite dev proxy and works the same in dev and production.
 */
export const STREAMING_SERVER = `${window.location.protocol}//${window.location.hostname}:3001`;

export const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
export const WS_SERVER = `${WS_PROTOCOL}://${window.location.hostname}:3001/ws`;
