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
const wss = new WebSocket.Server({
  server,
  verifyClient: ({ origin }, cb) => cb(true),
});

const HLS_DIR = '/tmp/hls';
const UPLOAD_DIR = '/data/uploads';
const ANN_DIR = '/data/announcements';
// Persistent state file — survives Docker restarts (stored on the uploads volume)
const STATE_FILE = '/data/deck-state.json';
const DECKS = ['A', 'B', 'C', 'D'];
const KEEP_ALIVE_MS = 300000; // 5 minutes grace period

DECKS.forEach(deck => {
  fs.mkdirSync(path.join(HLS_DIR, deck.toLowerCase()), { recursive: true });
});
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ANN_DIR, { recursive: true });

// ─── Persistent state save / restore ──────────────────────────────────────────
function loadPersistedState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('[State] Could not load persisted state:', err.message);
  }
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
      };
    });
    fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2), 'utf8');
  } catch (err) {
    console.warn('[State] Could not save state:', err.message);
  }
}

const persistedState = loadPersistedState();

// Multer — library uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

// Multer — announcement audio uploads
const annStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ANN_DIR),
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, `ann_${Date.now()}_${safeName}`);
  },
});
const uploadAnn = multer({ storage: annStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Per-deck state ────────────────────────────────────────────────────────────
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
    // Playlist state
    playlist: saved.playlist || [],
    playlistIndex: saved.playlistIndex || 0,
    playlistLoop: saved.playlistLoop || false,
    // Persisted mode (used for auto-resume on startup)
    persistedMode: saved.mode || null,
  };
});

// ─── Auto-resume on startup ────────────────────────────────────────────────────
// After a short delay to let everything initialize, resume any persisted playback
setTimeout(() => {
  DECKS.forEach(deck => {
    const s = state[deck];
    if (!s.persistedMode) return;

    if (s.persistedMode === 'playlist' && s.playlist.length > 0) {
      console.log(`[${deck}] Auto-resuming playlist from track ${s.playlistIndex}`);
      s.mode = 'playlist';
      playPlaylistTrack(deck);
    } else if ((s.persistedMode === 'file') && s.trackPath) {
      if (fs.existsSync(s.trackPath)) {
        console.log(`[${deck}] Auto-resuming file: ${s.trackName}`);
        startFFmpegFile(deck, s.trackPath, s.looping);
      } else {
        console.warn(`[${deck}] Persisted file not found: ${s.trackPath}`);
        s.mode = null;
        savePersistedState();
      }
    }
  });
}, 1000);

// ─── ffmpeg: LIVE mode ─────────────────────────────────────────────────────────
function startFFmpegLive(deck) {
  const s = state[deck];
  if (s.ffmpeg) return;

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const playlistPath = path.join(outDir, 'stream.m3u8');

  try {
    fs.readdirSync(outDir).forEach(f => {
      if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
        try { fs.unlinkSync(path.join(outDir, f)); } catch (_) {}
      }
    });
  } catch (_) {}

  console.log(`[${deck}] Starting ffmpeg (live mode)...`);

  const ffmpeg = spawn('ffmpeg', [
    '-fflags', '+genpts+igndts',
    '-analyzeduration', '0',
    '-probesize', '32',
    '-f', 'webm',
    '-i', 'pipe:0',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list+independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg%05d.ts'),
    '-y',
    playlistPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ffmpeg.stdout.on('data', () => {});
  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('.ts')) s.isLive = true;
    if (msg.includes('Error') || msg.includes('Invalid data') || msg.includes('error')) {
      const firstLine = msg.trim().split('\n')[0];
      if (!firstLine.includes('deprecated') && !firstLine.includes('No such file')) {
        console.error(`[ffmpeg ${deck}] ${firstLine}`);
      }
    }
  });

  ffmpeg.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') console.error(`[${deck}] ffmpeg stdin error:`, err.message);
  });

  ffmpeg.on('close', (code) => {
    console.log(`[${deck}] ffmpeg (live) exited (code ${code})`);
    s.ffmpeg = null;
    s.isLive = false;
    s.ffmpegSpawned = false;
    s.mode = null;
    savePersistedState();

    if (s.socket && s.socket.readyState === WebSocket.OPEN) {
      console.log(`[${deck}] Socket still alive — waiting for next chunk to restart ffmpeg`);
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

// ─── ffmpeg: FILE mode ─────────────────────────────────────────────────────────
function startFFmpegFile(deck, filePath, loop = false, onFinished = null) {
  const s = state[deck];
  stopFFmpeg(deck, true /* silent */);

  if (!fs.existsSync(filePath)) {
    console.error(`[${deck}] File not found: ${filePath}`);
    return;
  }

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const hlsPlaylistPath = path.join(outDir, 'stream.m3u8');

  try {
    fs.readdirSync(outDir).forEach(f => {
      if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
        try { fs.unlinkSync(path.join(outDir, f)); } catch (_) {}
      }
    });
  } catch (_) {}

  console.log(`[${deck}] Starting ffmpeg (file mode) — ${path.basename(filePath)}${loop ? ' [loop]' : ''}`);

  const args = [
    ...(loop ? ['-stream_loop', '-1'] : []),
    '-i', filePath,
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ac', '2',
    '-ar', '44100',
    '-f', 'hls',
    '-hls_time', '2',
    '-hls_list_size', '10',
    '-hls_flags', 'delete_segments+append_list+independent_segments',
    '-hls_segment_type', 'mpegts',
    '-hls_segment_filename', path.join(outDir, 'seg%05d.ts'),
    '-y',
    hlsPlaylistPath,
  ];

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.stdout.on('data', () => {});
  ffmpeg.stderr.on('data', (data) => {
    if (data.toString().includes('.ts')) s.isLive = true;
  });
  ffmpeg.on('close', (code) => {
    console.log(`[${deck}] ffmpeg (file) exited (code ${code})`);
    s.ffmpeg = null;
    s.isLive = false;

    if (s.mode !== 'playlist') {
      s.mode = null;
      savePersistedState();
    }

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

// ─── Playlist playback ─────────────────────────────────────────────────────────
function playPlaylistTrack(deck) {
  const s = state[deck];
  if (!s.playlist || s.playlist.length === 0) return;

  const idx = s.playlistIndex;
  if (idx >= s.playlist.length) {
    if (s.playlistLoop) {
      s.playlistIndex = 0;
      savePersistedState();
      playPlaylistTrack(deck);
    } else {
      console.log(`[${deck}] Playlist finished`);
      s.mode = null;
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
    ds.playlistIndex = ds.playlistIndex + 1;
    savePersistedState();
    playPlaylistTrack(d);
  });
}

function stopFFmpeg(deck, silent = false) {
  const s = state[deck];
  if (s.ffmpeg) {
    try { s.ffmpeg.stdin.end(); } catch (_) {}
    try { s.ffmpeg.kill('SIGTERM'); } catch (_) {}
    s.ffmpeg = null;
    s.isLive = false;
    s.ffmpegSpawned = false;
    if (!silent) {
      s.mode = null;
      savePersistedState();
      console.log(`[${deck}] ffmpeg stopped`);
    }
  }
}

function scheduleStopFFmpeg(deck) {
  const s = state[deck];
  if (s.keepAliveTimer) { clearTimeout(s.keepAliveTimer); s.keepAliveTimer = null; }

  if (s.mode === 'file' || s.mode === 'playlist') {
    console.log(`[${deck}] File/playlist mode — stream continues without DJ`);
    return;
  }

  console.log(`[${deck}] DJ disconnected — keeping stream alive for ${KEEP_ALIVE_MS / 60000} minutes`);
  s.keepAliveTimer = setTimeout(() => {
    s.keepAliveTimer = null;
    if (!s.socket || s.socket.readyState !== WebSocket.OPEN) {
      console.log(`[${deck}] Grace period expired — stopping stream`);
      stopFFmpeg(deck);
    }
  }, KEEP_ALIVE_MS);
}

// ─── WebSocket: live broadcast from browser ────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const deck = url.searchParams.get('deck')?.toUpperCase();
  const type = url.searchParams.get('type');

  if (!deck || !DECKS.includes(deck) || type !== 'broadcast') {
    ws.close();
    return;
  }

  const s = state[deck];

  if (s.keepAliveTimer) {
    clearTimeout(s.keepAliveTimer);
    s.keepAliveTimer = null;
    console.log(`[${deck}] DJ reconnected — cancelling stop timer`);
  }

  if (s.socket && s.socket !== ws) {
    try { s.socket.close(); } catch (_) {}
  }

  if (s.ffmpeg) {
    console.log(`[${deck}] Killing old ffmpeg to prepare for fresh WebM stream`);
    try { s.ffmpeg.stdin.end(); } catch (_) {}
    try { s.ffmpeg.kill('SIGTERM'); } catch (_) {}
    s.ffmpeg = null;
    s.isLive = false;
  }

  console.log(`[${deck}] Broadcaster connected — waiting for first data chunk before starting ffmpeg`);
  s.socket = ws;
  s.pendingChunks = [];
  s.ffmpegSpawned = false;

  ws.on('message', (data) => {
    const chunk = Buffer.from(data);

    if (!s.ffmpegSpawned) {
      s.pendingChunks.push(chunk);
      s.ffmpegSpawned = true;
      const ffmpeg = startFFmpegLive(deck);

      if (ffmpeg && ffmpeg.stdin.writable) {
        for (const c of s.pendingChunks) {
          try { ffmpeg.stdin.write(c); } catch (_) {}
        }
        s.pendingChunks = [];
      }
      return;
    }

    if (s.ffmpeg && s.ffmpeg.stdin.writable) {
      try { s.ffmpeg.stdin.write(chunk); } catch (_) {}
    }
  });

  ws.on('close', () => {
    console.log(`[${deck}] Broadcaster disconnected`);
    if (s.socket === ws) {
      s.socket = null;
      s.pendingChunks = [];
      scheduleStopFFmpeg(deck);
    }
  });

  ws.on('error', (err) => {
    console.error(`[${deck}] WS error:`, err.message);
    ws.close();
  });
});

// ─── Library: upload a file (persisted) ───────────────────────────────────────
app.post('/library/upload', upload.single('track'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const info = {
    serverPath: req.file.path,
    serverName: req.file.filename,
    originalName: req.file.originalname,
    size: req.file.size,
  };

  console.log(`[Library] Uploaded: ${req.file.originalname} → ${req.file.filename}`);
  res.json({ ok: true, ...info });
});

// Serve library audio files to the browser (for local deck loading)
app.use('/library/audio', express.static(UPLOAD_DIR, {
  setHeaders: (res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Access-Control-Allow-Origin', '*');
  },
}));

// List all library files on disk
app.get('/library/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).map(name => ({
      serverName: name,
      serverPath: path.join(UPLOAD_DIR, name),
      size: fs.statSync(path.join(UPLOAD_DIR, name)).size,
    }));
    res.json({ ok: true, files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a library file
app.delete('/library/files/:name', (req, res) => {
  const name = req.params.name;
  const filePath = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try {
    fs.unlinkSync(filePath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Track upload for deck (legacy, kept for compatibility) ───────────────────
app.post('/upload/:deck', upload.single('track'), (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const s = state[deck];
  s.trackPath = req.file.path;
  s.trackName = req.file.originalname;

  const kb = Math.round(req.file.size / 1024);
  console.log(`[${deck}] Track uploaded: ${req.file.originalname} (${kb}KB)`);

  const autoplay = req.query.autoplay !== 'false';
  const loop = req.query.loop === 'true';

  if (autoplay) startFFmpegFile(deck, req.file.path, loop);

  res.json({ ok: true, deck, trackName: req.file.originalname, serverName: req.file.filename, autoplay, loop });
});

// ─── Deck control endpoints ────────────────────────────────────────────────────
app.post('/deck/:deck/play', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  if (!s.trackPath || !fs.existsSync(s.trackPath)) return res.status(400).json({ error: 'No track uploaded' });
  const loop = req.body?.loop ?? s.looping;
  startFFmpegFile(deck, s.trackPath, loop);
  res.json({ ok: true, deck, trackName: s.trackName, loop });
});

// Load a specific library file to a deck and play it
app.post('/deck/:deck/load', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { serverName, loop } = req.body;
  if (!serverName) return res.status(400).json({ error: 'serverName required' });
  const filePath = path.join(UPLOAD_DIR, serverName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on server' });
  const s = state[deck];
  s.trackPath = filePath;
  s.trackName = serverName;
  s.mode = null; // reset before play
  startFFmpegFile(deck, filePath, loop || false);
  res.json({ ok: true, deck, serverName, loop: loop || false });
});

app.post('/deck/:deck/stop', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  stopFFmpeg(deck);
  state[deck].playlist = [];
  state[deck].playlistIndex = 0;
  state[deck].trackPath = null;
  state[deck].trackName = null;
  savePersistedState();
  res.json({ ok: true, deck });
});

// ─── Playlist endpoints ────────────────────────────────────────────────────────
app.post('/deck/:deck/playlist', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });

  const { tracks, loop, startIndex } = req.body;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    return res.status(400).json({ error: 'tracks array required' });
  }

  const playlist = tracks.map(t => ({
    id: t.id,
    path: path.join(UPLOAD_DIR, t.serverName),
    name: t.name || t.serverName,
    serverName: t.serverName,
  })).filter(t => {
    const exists = fs.existsSync(t.path);
    if (!exists) console.warn(`[${deck}] Playlist track not found: ${t.path}`);
    return exists;
  });

  if (playlist.length === 0) {
    return res.status(400).json({ error: 'No valid tracks found on server' });
  }

  const s = state[deck];
  s.playlist = playlist;
  s.playlistIndex = startIndex || 0;
  s.playlistLoop = loop || false;
  s.mode = 'playlist';
  savePersistedState();

  playPlaylistTrack(deck);
  res.json({ ok: true, deck, trackCount: playlist.length, loop: s.playlistLoop });
});

app.get('/deck/:deck/playlist', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  res.json({
    mode: s.mode,
    playlist: s.playlist,
    playlistIndex: s.playlistIndex,
    playlistLoop: s.playlistLoop,
    currentTrack: s.playlist[s.playlistIndex] || null,
  });
});

app.post('/deck/:deck/playlist/next', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  if (s.mode !== 'playlist' || !s.playlist.length) return res.status(400).json({ error: 'Not in playlist mode' });
  s.playlistIndex = Math.min(s.playlistIndex + 1, s.playlist.length);
  savePersistedState();
  stopFFmpeg(deck, true);
  s.mode = 'playlist';
  playPlaylistTrack(deck);
  res.json({ ok: true, newIndex: s.playlistIndex });
});

app.post('/deck/:deck/playlist/jump', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { index } = req.body;
  const s = state[deck];
  if (s.mode !== 'playlist' || !s.playlist.length) return res.status(400).json({ error: 'Not in playlist mode' });
  if (typeof index !== 'number' || index < 0 || index >= s.playlist.length) return res.status(400).json({ error: 'Invalid index' });
  s.playlistIndex = index;
  savePersistedState();
  stopFFmpeg(deck, true);
  s.mode = 'playlist';
  playPlaylistTrack(deck);
  res.json({ ok: true, newIndex: s.playlistIndex });
});

// ─── Announcement audio endpoints ────────────────────────────────────────────
app.post('/announcements/upload', uploadAnn.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  console.log(`[Announcements] Uploaded: ${req.file.originalname} → ${req.file.filename}`);
  res.json({ ok: true, serverName: req.file.filename, originalName: req.file.originalname });
});

// Serve announcement audio files
app.use('/announcements/audio', express.static(ANN_DIR, {
  setHeaders: (res) => res.set('Cache-Control', 'public, max-age=3600'),
}));

// Delete announcement audio
app.delete('/announcements/files/:name', (req, res) => {
  const name = req.params.name;
  const filePath = path.join(ANN_DIR, name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  try { fs.unlinkSync(filePath); res.json({ ok: true }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── HLS static files ──────────────────────────────────────────────────────────
app.use('/hls', express.static(HLS_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.ts')) {
      res.set('Content-Type', 'video/mp2t');
      res.set('Cache-Control', 'public, max-age=60');
    }
  },
}));

// ─── Status / health ───────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  const live = {};
  DECKS.forEach(deck => {
    const playlistPath = path.join(HLS_DIR, deck.toLowerCase(), 'stream.m3u8');
    live[deck] = !!(state[deck].ffmpeg) && fs.existsSync(playlistPath);
  });
  res.json({ live });
});

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/deck-info', (req, res) => {
  const info = {};
  DECKS.forEach(deck => {
    const s = state[deck];
    const playlistPath = path.join(HLS_DIR, deck.toLowerCase(), 'stream.m3u8');
    const streaming = !!(s.ffmpeg) && fs.existsSync(playlistPath);
    info[deck] = {
      djConnected: !!(s.socket && s.socket.readyState === WebSocket.OPEN),
      streaming,
      inGracePeriod: !!(s.keepAliveTimer),
      mode: s.mode,
      trackName: s.trackName,
      trackPath: s.trackPath,
      looping: s.looping,
      // Playlist state
      playlistLength: s.playlist.length,
      playlistIndex: s.playlistIndex,
      playlistLoop: s.playlistLoop,
      currentTrack: s.mode === 'playlist' ? (s.playlist[s.playlistIndex] || null) : null,
      playlist: s.playlist,
    };
  });
  res.json(info);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SonicBeat Streaming Server running on port ${PORT}`);
  console.log(`Persistent uploads: ${UPLOAD_DIR}`);
  console.log(`Grace period after DJ disconnect: ${KEEP_ALIVE_MS / 60000} minutes`);
});
