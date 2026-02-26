const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, verifyClient: ({ origin }, cb) => cb(true) });

const HLS_DIR = '/tmp/hls';
const UPLOAD_DIR = '/data/uploads';
const ANN_DIR = '/data/announcements';
const STATE_FILE = '/data/deck-state.json';
const DECKS = ['A', 'B', 'C', 'D'];
const KEEP_ALIVE_MS = 10000; // 10s grace then fall back to AutoDJ

DECKS.forEach(deck => fs.mkdirSync(path.join(HLS_DIR, deck.toLowerCase()), { recursive: true }));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ANN_DIR, { recursive: true });

// ─── Persistent state ─────────────────────────────────────────────────────────
function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (err) { console.warn('[State] Load error:', err.message); }
  return {};
}

function savePersistedState() {
  try {
    const toSave = {};
    DECKS.forEach(deck => {
      const s = state[deck];
      toSave[deck] = {
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
    fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
  } catch (err) { console.warn('[State] Save error:', err.message); }
}

const persistedState = loadPersistedState();

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

// ─── Per-deck state ───────────────────────────────────────────────────────────
const state = {};
DECKS.forEach(deck => {
  const saved = persistedState[deck] || {};
  state[deck] = {
    ffmpeg: null,
    socket: null,
    keepAliveTimer: null,
    isLive: false,
    mode: null,
    trackPath: saved.trackPath || null,
    trackName: saved.trackName || null,
    looping: saved.looping || false,
    pendingChunks: [],
    ffmpegSpawned: false,
    playlist: saved.playlist || [],
    playlistIndex: saved.playlistIndex || 0,
    playlistLoop: saved.playlistLoop || false,
    persistedMode: saved.mode || null,
    // AutoDJ: when enabled, picks random tracks from library when DJ is offline
    autoDJEnabled: saved.autoDJEnabled !== undefined ? saved.autoDJEnabled : true,
    autoDJActive: false,
  };
});

// ─── AutoDJ: pick random files from library and loop them ────────────────────
function getLibraryFiles() {
  try {
    return fs.readdirSync(UPLOAD_DIR)
      .filter(f => /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(f))
      .map(f => path.join(UPLOAD_DIR, f));
  } catch { return []; }
}

function startAutoDJ(deck) {
  const s = state[deck];
  if (!s.autoDJEnabled) return;

  const files = getLibraryFiles();
  if (files.length === 0) {
    console.log(`[${deck}] AutoDJ: no library files, will retry in 30s`);
    s.keepAliveTimer = setTimeout(() => startAutoDJ(deck), 30000);
    return;
  }

  // Shuffle library into a playlist
  const shuffled = [...files].sort(() => Math.random() - 0.5);
  s.playlist = shuffled.map(p => ({ path: p, name: path.basename(p), serverName: path.basename(p) }));
  s.playlistIndex = 0;
  s.playlistLoop = true;
  s.mode = 'playlist';
  s.autoDJActive = true;
  console.log(`[${deck}] AutoDJ started — ${shuffled.length} tracks, looping`);
  savePersistedState();
  playPlaylistTrack(deck);
}

function stopAutoDJ(deck) {
  const s = state[deck];
  if (s.autoDJActive) {
    console.log(`[${deck}] AutoDJ stopping (DJ taking over)`);
    s.autoDJActive = false;
  }
}

// ─── ffmpeg: FILE mode ────────────────────────────────────────────────────────
function startFFmpegFile(deck, filePath, loop = false, onFinished = null) {
  const s = state[deck];
  stopFFmpeg(deck, true);

  if (!fs.existsSync(filePath)) {
    console.error(`[${deck}] File not found: ${filePath}`);
    return;
  }

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const hlsPath = path.join(outDir, 'stream.m3u8');

  try {
    fs.readdirSync(outDir).forEach(f => {
      if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
        try { fs.unlinkSync(path.join(outDir, f)); } catch (_) {}
      }
    });
  } catch (_) {}

  console.log(`[${deck}] ffmpeg file: ${path.basename(filePath)}${loop ? ' [loop]' : ''}`);

  const args = [
    ...(loop ? ['-stream_loop', '-1'] : []),
    '-i', filePath,
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list+independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg%05d.ts'),
    '-y', hlsPath,
  ];

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  ffmpeg.stderr.on('data', d => { if (d.toString().includes('.ts')) s.isLive = true; });
  ffmpeg.on('close', code => {
    console.log(`[${deck}] ffmpeg file exited (${code})`);
    s.ffmpeg = null;
    s.isLive = false;
    if (s.mode !== 'playlist') { s.mode = null; savePersistedState(); }
    if (onFinished) onFinished(deck, code);
  });

  s.ffmpeg = ffmpeg;
  if (s.mode !== 'playlist') s.mode = 'file';
  s.isLive = false;
  s.looping = loop;
  s.trackPath = filePath;
  s.trackName = path.basename(filePath);
  savePersistedState();
}

// ─── ffmpeg: LIVE mode (WebSocket from browser) ───────────────────────────────
function startFFmpegLive(deck) {
  const s = state[deck];
  if (s.ffmpeg) return;

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const hlsPath = path.join(outDir, 'stream.m3u8');

  try {
    fs.readdirSync(outDir).forEach(f => {
      if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
        try { fs.unlinkSync(path.join(outDir, f)); } catch (_) {}
      }
    });
  } catch (_) {}

  console.log(`[${deck}] ffmpeg live mode starting...`);

  const ffmpeg = spawn('ffmpeg', [
    '-fflags', '+genpts+igndts',
    '-analyzeduration', '0', '-probesize', '32',
    '-f', 'webm', '-i', 'pipe:0',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100',
    '-f', 'hls',
    '-hls_time', '2', '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list+independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg%05d.ts'),
    '-y', hlsPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ffmpeg.stderr.on('data', d => { if (d.toString().includes('.ts')) s.isLive = true; });
  ffmpeg.stdin.on('error', err => { if (err.code !== 'EPIPE') console.error(`[${deck}] stdin error:`, err.message); });
  ffmpeg.on('close', code => {
    console.log(`[${deck}] ffmpeg live exited (${code})`);
    s.ffmpeg = null; s.isLive = false; s.ffmpegSpawned = false;
    if (s.mode === 'live') { s.mode = null; savePersistedState(); }
    if (s.socket && s.socket.readyState === WebSocket.OPEN) {
      s.pendingChunks = [];
    }
  });

  s.ffmpeg = ffmpeg;
  s.mode = 'live';
  s.isLive = false;
  s.ffmpegSpawned = true;
  savePersistedState();
  return ffmpeg;
}

// ─── Playlist playback ────────────────────────────────────────────────────────
function playPlaylistTrack(deck) {
  const s = state[deck];
  if (!s.playlist || s.playlist.length === 0) return;

  const idx = s.playlistIndex;
  if (idx >= s.playlist.length) {
    if (s.playlistLoop) {
      // Re-shuffle if AutoDJ
      if (s.autoDJActive) {
        const files = getLibraryFiles();
        if (files.length > 0) {
          s.playlist = [...files].sort(() => Math.random() - 0.5)
            .map(p => ({ path: p, name: path.basename(p), serverName: path.basename(p) }));
        }
      }
      s.playlistIndex = 0;
      savePersistedState();
      playPlaylistTrack(deck);
    } else {
      console.log(`[${deck}] Playlist finished`);
      s.mode = null;
      s.autoDJActive = false;
      savePersistedState();
    }
    return;
  }

  const track = s.playlist[idx];
  s.mode = 'playlist';
  s.trackPath = track.path;
  s.trackName = track.name;
  savePersistedState();

  startFFmpegFile(deck, track.path, false, (d, code) => {
    const ds = state[d];
    if (ds.mode !== 'playlist') return;
    ds.playlistIndex++;
    savePersistedState();
    playPlaylistTrack(d);
  });
}

function stopFFmpeg(deck, silent = false) {
  const s = state[deck];
  if (s.ffmpeg) {
    try { s.ffmpeg.stdin.end(); } catch (_) {}
    try { s.ffmpeg.kill('SIGTERM'); } catch (_) {}
    s.ffmpeg = null; s.isLive = false; s.ffmpegSpawned = false;
    if (!silent) { s.mode = null; savePersistedState(); }
  }
}

// ─── When DJ disconnects: fall back to AutoDJ after grace period ──────────────
function onDJDisconnect(deck) {
  const s = state[deck];
  if (s.keepAliveTimer) { clearTimeout(s.keepAliveTimer); s.keepAliveTimer = null; }

  // If already playing file/playlist (not live), keep going
  if (s.mode === 'file' || s.mode === 'playlist') {
    console.log(`[${deck}] DJ left — file/playlist mode continues`);
    return;
  }

  console.log(`[${deck}] DJ left — AutoDJ starts in ${KEEP_ALIVE_MS / 1000}s`);
  s.keepAliveTimer = setTimeout(() => {
    s.keepAliveTimer = null;
    if (!s.socket || s.socket.readyState !== WebSocket.OPEN) {
      console.log(`[${deck}] Grace period ended — starting AutoDJ`);
      stopFFmpeg(deck, true);
      s.autoDJActive = false;
      startAutoDJ(deck);
    }
  }, KEEP_ALIVE_MS);
}

// ─── Auto-resume on startup ───────────────────────────────────────────────────
setTimeout(() => {
  DECKS.forEach(deck => {
    const s = state[deck];
    if (s.persistedMode === 'playlist' && s.playlist.length > 0) {
      console.log(`[${deck}] Resuming playlist from track ${s.playlistIndex}`);
      s.mode = 'playlist';
      playPlaylistTrack(deck);
    } else if (s.persistedMode === 'file' && s.trackPath && fs.existsSync(s.trackPath)) {
      console.log(`[${deck}] Resuming file: ${s.trackName}`);
      startFFmpegFile(deck, s.trackPath, s.looping);
    } else if (s.autoDJEnabled) {
      console.log(`[${deck}] No saved state — starting AutoDJ`);
      startAutoDJ(deck);
    }
  });
}, 1500);

// ─── WebSocket: live broadcast ────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const deck = url.searchParams.get('deck')?.toUpperCase();
  const type = url.searchParams.get('type');

  if (!deck || !DECKS.includes(deck) || type !== 'broadcast') { ws.close(); return; }

  const s = state[deck];

  if (s.keepAliveTimer) { clearTimeout(s.keepAliveTimer); s.keepAliveTimer = null; }
  if (s.socket && s.socket !== ws) { try { s.socket.close(); } catch (_) {} }

  // Stop AutoDJ when DJ connects
  stopAutoDJ(deck);

  if (s.ffmpeg) {
    console.log(`[${deck}] DJ connected — stopping AutoDJ/file ffmpeg`);
    try { s.ffmpeg.stdin.end(); } catch (_) {}
    try { s.ffmpeg.kill('SIGTERM'); } catch (_) {}
    s.ffmpeg = null; s.isLive = false;
  }

  console.log(`[${deck}] DJ connected — live mode`);
  s.socket = ws;
  s.pendingChunks = [];
  s.ffmpegSpawned = false;

  ws.on('message', data => {
    const chunk = Buffer.from(data);
    if (!s.ffmpegSpawned) {
      s.pendingChunks.push(chunk);
      s.ffmpegSpawned = true;
      const ffmpeg = startFFmpegLive(deck);
      if (ffmpeg?.stdin.writable) {
        s.pendingChunks.forEach(c => { try { ffmpeg.stdin.write(c); } catch (_) {} });
        s.pendingChunks = [];
      }
      return;
    }
    if (s.ffmpeg?.stdin.writable) { try { s.ffmpeg.stdin.write(chunk); } catch (_) {} }
  });

  ws.on('close', () => {
    console.log(`[${deck}] DJ disconnected`);
    if (s.socket === ws) { s.socket = null; s.pendingChunks = []; onDJDisconnect(deck); }
  });

  ws.on('error', err => { console.error(`[${deck}] WS error:`, err.message); ws.close(); });
});

// ─── Library endpoints ────────────────────────────────────────────────────────
app.post('/library/upload', upload.single('track'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  console.log(`[Library] Uploaded: ${req.file.originalname} → ${req.file.filename}`);
  res.json({ ok: true, serverName: req.file.filename, originalName: req.file.originalname, size: req.file.size });
});

app.use('/library/audio', express.static(UPLOAD_DIR, {
  setHeaders: res => { res.set('Cache-Control', 'public, max-age=3600'); res.set('Access-Control-Allow-Origin', '*'); },
}));

app.get('/library/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).map(name => ({
      serverName: name,
      size: fs.statSync(path.join(UPLOAD_DIR, name)).size,
    }));
    res.json({ ok: true, files });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/library/files/:name', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(fp); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Deck control ─────────────────────────────────────────────────────────────
app.post('/deck/:deck/load', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { serverName, loop } = req.body;
  if (!serverName) return res.status(400).json({ error: 'serverName required' });
  const fp = path.join(UPLOAD_DIR, serverName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  const s = state[deck];
  s.autoDJActive = false;
  s.trackPath = fp; s.trackName = serverName; s.mode = null;
  startFFmpegFile(deck, fp, loop || false);
  res.json({ ok: true, deck, serverName });
});

app.post('/deck/:deck/play', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  if (!s.trackPath || !fs.existsSync(s.trackPath)) return res.status(400).json({ error: 'No track' });
  s.autoDJActive = false;
  startFFmpegFile(deck, s.trackPath, req.body?.loop ?? s.looping);
  res.json({ ok: true });
});

app.post('/deck/:deck/stop', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  stopFFmpeg(deck);
  s.playlist = []; s.playlistIndex = 0;
  s.trackPath = null; s.trackName = null;
  s.autoDJActive = false;
  savePersistedState();
  res.json({ ok: true });
});

// AutoDJ toggle per deck
app.post('/deck/:deck/autodj', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { enabled } = req.body;
  const s = state[deck];
  s.autoDJEnabled = !!enabled;
  savePersistedState();
  if (s.autoDJEnabled && !s.ffmpeg) startAutoDJ(deck);
  if (!s.autoDJEnabled && s.autoDJActive) { stopFFmpeg(deck); s.autoDJActive = false; }
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
  s.autoDJActive = false;
  s.playlist = playlist;
  s.playlistIndex = startIndex || 0;
  s.playlistLoop = loop || false;
  s.mode = 'playlist';
  savePersistedState();
  playPlaylistTrack(deck);
  res.json({ ok: true, trackCount: playlist.length });
});

app.post('/deck/:deck/playlist/next', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  if (s.mode !== 'playlist' || !s.playlist.length) return res.status(400).json({ error: 'Not in playlist mode' });
  s.playlistIndex = Math.min(s.playlistIndex + 1, s.playlist.length);
  savePersistedState();
  stopFFmpeg(deck, true); s.mode = 'playlist';
  playPlaylistTrack(deck);
  res.json({ ok: true, newIndex: s.playlistIndex });
});

app.post('/deck/:deck/playlist/jump', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { index } = req.body;
  const s = state[deck];
  if (s.mode !== 'playlist') return res.status(400).json({ error: 'Not in playlist mode' });
  if (typeof index !== 'number' || index < 0 || index >= s.playlist.length) return res.status(400).json({ error: 'Invalid index' });
  s.playlistIndex = index;
  savePersistedState();
  stopFFmpeg(deck, true); s.mode = 'playlist';
  playPlaylistTrack(deck);
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
  try { fs.unlinkSync(fp); res.json({ ok: true }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── HLS static ───────────────────────────────────────────────────────────────
app.use('/hls', express.static(HLS_DIR, {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.m3u8')) { res.set('Content-Type', 'application/vnd.apple.mpegurl'); res.set('Cache-Control', 'no-cache'); }
    else if (fp.endsWith('.ts')) { res.set('Content-Type', 'video/mp2t'); res.set('Cache-Control', 'public, max-age=60'); }
  },
}));

// ─── Status / health / deck-info ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/status', (req, res) => {
  const live = {};
  DECKS.forEach(deck => {
    const hlsPath = path.join(HLS_DIR, deck.toLowerCase(), 'stream.m3u8');
    live[deck] = !!(state[deck].ffmpeg) && fs.existsSync(hlsPath);
  });
  res.json({ live });
});

app.get('/deck-info', (req, res) => {
  const info = {};
  DECKS.forEach(deck => {
    const s = state[deck];
    const hlsPath = path.join(HLS_DIR, deck.toLowerCase(), 'stream.m3u8');
    info[deck] = {
      djConnected: !!(s.socket?.readyState === WebSocket.OPEN),
      streaming: !!(s.ffmpeg) && fs.existsSync(hlsPath),
      mode: s.mode,
      trackName: s.trackName,
      trackPath: s.trackPath,
      looping: s.looping,
      playlistLength: s.playlist.length,
      playlistIndex: s.playlistIndex,
      playlistLoop: s.playlistLoop,
      currentTrack: s.mode === 'playlist' ? (s.playlist[s.playlistIndex] || null) : null,
      playlist: s.playlist,
      autoDJEnabled: s.autoDJEnabled,
      autoDJActive: s.autoDJActive,
    };
  });
  res.json(info);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SonicBeat Streaming Server on port ${PORT}`);
  console.log(`Uploads: ${UPLOAD_DIR} | Announcements: ${ANN_DIR}`);
});
