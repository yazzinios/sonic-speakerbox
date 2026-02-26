/**
 * All streaming server API calls go through nginx on the same port as the app (80).
 * nginx proxies /api/* → hls-server:3001
 * This means no direct port 3001 access needed — works through any firewall/reverse proxy.
 */
export const STREAMING_SERVER = `${window.location.protocol}//${window.location.hostname}/api`;

export const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
export const WS_SERVER = `${WS_PROTOCOL}://${window.location.hostname}/ws`;
