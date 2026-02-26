/**
 * SonicBeat API Server
 *
 * Same REST API as before — the dashboard doesn't change.
 * Backend is now Icecast + Liquidsoap instead of custom ffmpeg/HLS.
 *
 * Ports (internal only):
 *   3001  — this Node API (proxied by nginx as /api/)
 *   8000  — Icecast (proxied by nginx as /stream/ and /icecast/)
 *   8005  — Liquidsoap harbor input (live DJ audio push)
 *   1234  — Liquidsoap telnet control
 */
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const net = require('net');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, verifyClient: (_, cb) => cb(true) });

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const ANN_DIR = '/data/announcements';
const STATE_FILE = '/data/deck-state.json';
const DECKS = ['A', 'B', 'C', 'D'];

const ICECAST_HOST = process.env.ICECAST_HOST || 'icecast';
const ICECAST_PORT = parseInt(process.env.ICECAST_PORT || '8000');
const SOURCE_PASSWORD = process.env.ICECAST_SOURCE_PASSWORD || 'sonicbeat_source';
const LIQ_HOST = process.env.LIQ_HOST || 'liquidsoap';
const LIQ_TELNET_PORT = parseInt(process.env.LIQ_TELNET_PORT || '1234');
const LIQ_HARBOR_PORT = parseInt(process.env.LIQ_HARBOR_PORT || '8005');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ANN_DIR, { recursive: true });

// ─── Persistent state ─────────────────────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) { console.warn('[State] Load error:', e.message); }
  return {};
}
function saveState() {
  try {
    const out = {};
    DECKS.forEach(d => {
      const s = state[d];
      out[d] = {
        mode: s.mode,
        trackPath: s.trackPath,
        trackName: s.trackName,
        looping: s.looping,
        playlist: s.playlist,
        playlistIndex: s.playlistIndex,
        playlistLoop: s.playlistLoop,
        autoDJEnabled: s.autoDJEnabled,
      };
    });
    fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 2));
  } catch (e) { console.warn('[State] Save error:', e.message); }
}

const persisted = loadState();
const state = {};
DECKS.forEach(d => {
  const s = persisted[d] || {};
  state[d] = {
    mode: null,
    trackPath: s.trackPath || null,
    trackName: s.trackName || null,
    looping: s.looping || false,
    playlist: s.playlist || [],
    playlistIndex: s.playlistIndex || 0,
    playlistLoop: s.playlistLoop || false,
    autoDJEnabled: s.autoDJEnabled !== undefined ? s.autoDJEnabled : true,
    autoDJActive: false,
    // Live broadcast state
    socket: null,
    liveProcess: null,   // ffmpeg process pushing to Liquidsoap harbor
    liveActive: false,
    // Persisted mode for resume on startup
    persistedMode: s.mode || null,
  };
});

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const annStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ANN_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, `ann_${Date.now()}_${safe}`);
  },
});
const uploadAnn = multer({ storage: annStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Liquidsoap telnet control ────────────────────────────────────────────────
function liqCmd(command) {
  return new Promise((resolve) => {
    const client = new net.Socket();
    let response = '';
    client.setTimeout(3000);
    client.connect(LIQ_TELNET_PORT, LIQ_HOST, () => {
      client.write(command + '\n');
    });
    client.on('data', d => { response += d.toString(); });
    client.on('close', () => resolve(response.trim()));
    client.on('error', (e) => {
      console.warn('[Liquidsoap] Telnet error:', e.message);
      resolve('');
    });
    client.on('timeout', () => { client.destroy(); resolve(''); });
  });
}

// ─── Push a file to Icecast via ffmpeg (for file/playlist mode) ───────────────
// Liquidsoap handles AutoDJ from the uploads dir automatically.
// For explicit "load this file now" we use Liquidsoap's telnet to queue it.
function liqSkipToCurrent(deck) {
  // Tell Liquidsoap's autodj to reload and skip to new content
  // We use the playlist.reload command
  liqCmd(`autodj_${deck}.reload`);
  liqCmd(`autodj_${deck}.skip`);
}

// ─── Start live DJ broadcast to Liquidsoap harbor ─────────────────────────────
// Browser sends WebM/Opus via WebSocket → ffmpeg transcodes → HTTP PUT to harbor
function startLiveBroadcast(deck, ws) {
  const s = state[deck];
  stopLiveBroadcast(deck);

  const mountUser = `source_${deck.toLowerCase()}`;
  const harborUrl = `http://${LIQ_HOST}:${LIQ_HARBOR_PORT}/live/deck-${deck.toLowerCase()}`;

  console.log(`[${deck}] Starting live broadcast → ${harborUrl}`);

  // ffmpeg: WebM stdin → MP3 → HTTP PUT to Liquidsoap harbor
  const ffmpeg = spawn('ffmpeg', [
    '-fflags', '+genpts+igndts',
    '-analyzeduration', '0',
    '-probesize', '32',
    '-f', 'webm',
    '-i', 'pipe:0',
    '-c:a', 'libmp3lame',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    '-f', 'mp3',
    `icecast://source:${SOURCE_PASSWORD}@${LIQ_HOST}:${LIQ_HARBOR_PORT}/live/deck-${deck.toLowerCase()}`,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ffmpeg.stdout.on('data', () => {});
  ffmpeg.stderr.on('data', d => {
    const msg = d.toString();
    if (msg.includes('error') && !msg.includes('deprecated')) {
      console.error(`[${deck}] ffmpeg:`, msg.trim().split('\n')[0]);
    }
  });
  ffmpeg.stdin.on('error', e => { if (e.code !== 'EPIPE') console.error(`[${deck}] stdin:`, e.message); });
  ffmpeg.on('close', code => {
    console.log(`[${deck}] Live ffmpeg exited (${code})`);
    s.liveProcess = null;
    if (s.mode === 'live') { s.mode = null; saveState(); }
  });

  s.liveProcess = ffmpeg;
  s.mode = 'live';
  s.liveActive = true;
  saveState();

  return ffmpeg;
}

function stopLiveBroadcast(deck) {
  const s = state[deck];
  if (s.liveProcess) {
    try { s.liveProcess.stdin.end(); } catch (_) {}
    try { s.liveProcess.kill('SIGTERM'); } catch (_) {}
    s.liveProcess = null;
    s.liveActive = false;
  }
}

// ─── WebSocket: receive live audio from browser DJ ────────────────────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const deck = url.searchParams.get('deck')?.toUpperCase();
  const type = url.searchParams.get('type');

  if (!deck || !DECKS.includes(deck) || type !== 'broadcast') { ws.close(); return; }

  const s = state[deck];
  if (s.socket && s.socket !== ws) { try { s.socket.close(); } catch (_) {} }
  s.socket = ws;

  let ffmpegProc = null;
  let spawned = false;
  let pendingChunks = [];

  console.log(`[${deck}] DJ connected via WebSocket`);

  ws.on('message', data => {
    const chunk = Buffer.from(data);

    if (!spawned) {
      pendingChunks.push(chunk);
      spawned = true;
      ffmpegProc = startLiveBroadcast(deck, ws);
      s.liveProcess = ffmpegProc;

      // Write buffered chunks
      if (ffmpegProc?.stdin.writable) {
        pendingChunks.forEach(c => { try { ffmpegProc.stdin.write(c); } catch (_) {} });
        pendingChunks = [];
      }
      return;
    }

    if (ffmpegProc?.stdin.writable) {
      try { ffmpegProc.stdin.write(chunk); } catch (_) {}
    }
  });

  ws.on('close', () => {
    console.log(`[${deck}] DJ disconnected`);
    if (s.socket === ws) {
      s.socket = null;
      stopLiveBroadcast(deck);
      // Liquidsoap falls back to AutoDJ automatically since live harbor drops
      s.mode = 'autodj';
      s.autoDJActive = true;
      saveState();
    }
  });

  ws.on('error', e => { console.error(`[${deck}] WS:`, e.message); ws.close(); });
});

// ─── Library endpoints ────────────────────────────────────────────────────────
app.post('/library/upload', upload.single('track'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  console.log(`[Library] ${req.file.originalname} → ${req.file.filename}`);
  res.json({ ok: true, serverName: req.file.filename, originalName: req.file.originalname, size: req.file.size });
});

app.use('/library/audio', express.static(UPLOAD_DIR, {
  setHeaders: res => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Access-Control-Allow-Origin', '*');
  },
}));

app.get('/library/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR)
      .filter(f => /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(f))
      .map(name => ({ serverName: name, size: fs.statSync(path.join(UPLOAD_DIR, name)).size }));
    res.json({ ok: true, files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/library/files/:name', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(fp); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Deck control ─────────────────────────────────────────────────────────────
// Load a specific track — tell Liquidsoap to queue it as a single-track playlist
app.post('/deck/:deck/load', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { serverName, loop } = req.body;
  if (!serverName) return res.status(400).json({ error: 'serverName required' });
  const fp = path.join(UPLOAD_DIR, serverName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });

  const s = state[deck];
  s.trackPath = fp;
  s.trackName = serverName;
  s.looping = loop || false;
  s.mode = 'file';
  s.autoDJActive = false;

  // Tell Liquidsoap to push this track next via request.push
  liqCmd(`autodj_${deck}.push ${fp}`).then(() => {
    liqCmd(`autodj_${deck}.skip`);
  });

  saveState();
  res.json({ ok: true, deck, serverName });
});

app.post('/deck/:deck/stop', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  stopLiveBroadcast(deck);
  s.playlist = []; s.playlistIndex = 0;
  s.trackPath = null; s.trackName = null;
  s.mode = 'autodj'; s.autoDJActive = true;
  saveState();
  // Skip current track — liquidsoap autodj keeps going
  liqCmd(`autodj_${deck}.skip`);
  res.json({ ok: true });
});

// AutoDJ toggle
app.post('/deck/:deck/autodj', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  s.autoDJEnabled = !!req.body.enabled;
  saveState();
  res.json({ ok: true, autoDJEnabled: s.autoDJEnabled });
});

// ─── Playlist endpoints ───────────────────────────────────────────────────────
app.post('/deck/:deck/playlist', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { tracks, loop, startIndex } = req.body;
  if (!Array.isArray(tracks) || tracks.length === 0) return res.status(400).json({ error: 'tracks required' });

  const playlist = tracks.map(t => ({
    id: t.id,
    path: path.join(UPLOAD_DIR, t.serverName),
    name: t.name || t.serverName,
    serverName: t.serverName,
  })).filter(t => fs.existsSync(t.path));

  if (playlist.length === 0) return res.status(400).json({ error: 'No valid tracks on server' });

  const s = state[deck];
  s.playlist = playlist;
  s.playlistIndex = startIndex || 0;
  s.playlistLoop = loop || false;
  s.mode = 'playlist';
  s.autoDJActive = false;
  saveState();

  // Push all tracks into Liquidsoap's request queue
  playPlaylistFromIndex(deck, startIndex || 0);
  res.json({ ok: true, trackCount: playlist.length });
});

function playPlaylistFromIndex(deck, index) {
  const s = state[deck];
  if (!s.playlist.length) return;

  // Clear queue then push tracks from index onwards
  liqCmd(`autodj_${deck}.skip`).then(async () => {
    const tracks = s.playlist.slice(index);
    for (const track of tracks) {
      await liqCmd(`autodj_${deck}.push ${track.path}`);
    }
    if (s.playlistLoop) {
      // Push from beginning again
      for (const track of s.playlist.slice(0, index)) {
        await liqCmd(`autodj_${deck}.push ${track.path}`);
      }
    }
  });
}

app.post('/deck/:deck/playlist/next', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  s.playlistIndex = Math.min(s.playlistIndex + 1, s.playlist.length - 1);
  saveState();
  liqCmd(`autodj_${deck}.skip`);
  res.json({ ok: true, newIndex: s.playlistIndex });
});

app.post('/deck/:deck/playlist/jump', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { index } = req.body;
  const s = state[deck];
  if (typeof index !== 'number' || index < 0 || index >= s.playlist.length)
    return res.status(400).json({ error: 'Invalid index' });
  s.playlistIndex = index;
  saveState();
  playPlaylistFromIndex(deck, index);
  res.json({ ok: true, newIndex: index });
});

// ─── Announcements ────────────────────────────────────────────────────────────
app.post('/announcements/upload', uploadAnn.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ ok: true, serverName: req.file.filename });
});
app.use('/announcements/audio', express.static(ANN_DIR, {
  setHeaders: res => res.set('Cache-Control', 'public, max-age=3600'),
}));
app.delete('/announcements/files/:name', (req, res) => {
  const fp = path.join(ANN_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(fp); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Health / status / deck-info ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/status', async (req, res) => {
  const live = {};
  for (const deck of DECKS) {
    try {
      const result = await liqCmd(`out_${deck}.is_started`);
      live[deck] = result.includes('true');
    } catch { live[deck] = false; }
  }
  res.json({ live });
});

app.get('/deck-info', async (req, res) => {
  const info = {};
  for (const deck of DECKS) {
    const s = state[deck];
    let currentTrackName = s.trackName || null;

    // Ask Liquidsoap what's currently playing
    try {
      const metadata = await liqCmd(`autodj_${deck}.last_metadata`);
      const titleMatch = metadata.match(/title="([^"]+)"/);
      const fileMatch = metadata.match(/filename="([^"]+)"/);
      if (titleMatch) currentTrackName = titleMatch[1];
      else if (fileMatch) currentTrackName = path.basename(fileMatch[1]);
    } catch (_) {}

    info[deck] = {
      djConnected: !!(s.socket?.readyState === 1),
      streaming: true, // Icecast/Liquidsoap always streaming
      mode: s.liveActive ? 'live' : (s.mode || 'autodj'),
      trackName: currentTrackName,
      trackPath: s.trackPath,
      looping: s.looping,
      playlistLength: s.playlist.length,
      playlistIndex: s.playlistIndex,
      playlistLoop: s.playlistLoop,
      currentTrack: s.mode === 'playlist' ? (s.playlist[s.playlistIndex] || null) : null,
      playlist: s.playlist,
      autoDJEnabled: s.autoDJEnabled,
      autoDJActive: !s.liveActive,
      // Stream URLs for listeners
      streamUrl: `http://${req.hostname}:8000/deck-${deck.toLowerCase()}`,
    };
  }
  res.json(info);
});

// Proxy Icecast status for dashboard
app.get('/icecast-status', async (req, res) => {
  try {
    const response = await fetch(`http://${ICECAST_HOST}:${ICECAST_PORT}/status-json.xsl`);
    const data = await response.json();
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: 'Icecast not reachable' });
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] SonicBeat API on port ${PORT}`);
  console.log(`[API] Icecast streams: http://${ICECAST_HOST}:${ICECAST_PORT}/deck-{a,b,c,d}`);
});
