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
const UPLOAD_DIR = '/tmp/uploads';
const DECKS = ['A', 'B', 'C', 'D'];
const KEEP_ALIVE_MS = 300000; // 5 minutes grace period

// Ensure directories exist
DECKS.forEach(deck => {
  fs.mkdirSync(path.join(HLS_DIR, deck.toLowerCase()), { recursive: true });
});
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer — store uploaded tracks on disk
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const deck = req.params.deck?.toUpperCase();
    const ext = path.extname(file.originalname) || '.mp3';
    cb(null, `deck_${deck}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } }); // 300MB max

// ─── Per-deck state ────────────────────────────────────────────────────────────
const state = {};
DECKS.forEach(deck => {
  state[deck] = {
    ffmpeg: null,           // running ffmpeg process
    socket: null,           // active broadcaster WS
    keepAliveTimer: null,   // grace period timer
    isLive: false,          // has produced at least one .ts segment
    mode: null,             // 'live' | 'file'
    trackPath: null,        // path to uploaded file (for file mode)
    trackName: null,        // display name
    looping: false,         // loop file playback
    pendingChunks: [],      // buffer WebM chunks before ffmpeg is ready on reconnect
    ffmpegReady: false,     // ffmpeg stdin is open and accepting data
  };
});

// ─── ffmpeg helpers ────────────────────────────────────────────────────────────

/**
 * Start ffmpeg in LIVE mode — reads WebM from stdin, outputs HLS.
 */
function startFFmpegLive(deck) {
  const s = state[deck];
  if (s.ffmpeg) return;

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const playlistPath = path.join(outDir, 'stream.m3u8');

  // Clean up old segments so listeners don't get stale data
  try {
    fs.readdirSync(outDir).forEach(f => {
      if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
        fs.unlinkSync(path.join(outDir, f));
      }
    });
  } catch (_) {}

  console.log(`[${deck}] Starting ffmpeg (live mode)...`);

  const ffmpeg = spawn('ffmpeg', [
    '-fflags', '+genpts+igndts',
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
    if (msg.includes('Error') || msg.includes('Invalid data')) {
      console.error(`[ffmpeg ${deck}] ${msg.trim().split('\n')[0]}`);
    }
  });
  ffmpeg.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') console.error(`[${deck}] ffmpeg stdin error:`, err.message);
  });
  ffmpeg.on('close', (code) => {
    console.log(`[${deck}] ffmpeg (live) exited (code ${code})`);
    s.ffmpeg = null;
    s.isLive = false;
    s.ffmpegReady = false;
    s.mode = null;
    // If socket is still connected, they'll reconnect and we'll restart
  });

  s.ffmpeg = ffmpeg;
  s.mode = 'live';
  s.isLive = false;
  s.ffmpegReady = true;
  return ffmpeg;
}

/**
 * Start ffmpeg in FILE mode — reads from uploaded file, outputs HLS.
 * Optionally loops. Keeps playing even when browser is closed.
 */
function startFFmpegFile(deck, filePath, loop = false) {
  const s = state[deck];
  stopFFmpeg(deck); // stop any existing instance first

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const playlistPath = path.join(outDir, 'stream.m3u8');

  // Clean old segments
  try {
    fs.readdirSync(outDir).forEach(f => {
      if (f.endsWith('.ts') || f.endsWith('.m3u8')) {
        fs.unlinkSync(path.join(outDir, f));
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
    playlistPath,
  ];

  const ffmpeg = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  ffmpeg.stdout.on('data', () => {});
  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('.ts')) s.isLive = true;
  });
  ffmpeg.on('close', (code) => {
    console.log(`[${deck}] ffmpeg (file) exited (code ${code})`);
    s.ffmpeg = null;
    s.isLive = false;
    s.mode = null;
  });

  s.ffmpeg = ffmpeg;
  s.mode = 'file';
  s.isLive = false;
  s.looping = loop;
}

function stopFFmpeg(deck) {
  const s = state[deck];
  if (s.ffmpeg) {
    try { s.ffmpeg.stdin.end(); } catch (_) {}
    try { s.ffmpeg.kill('SIGTERM'); } catch (_) {}
    s.ffmpeg = null;
    s.isLive = false;
    s.ffmpegReady = false;
    s.mode = null;
    console.log(`[${deck}] ffmpeg stopped`);
  }
}

function scheduleStopFFmpeg(deck) {
  const s = state[deck];
  if (s.keepAliveTimer) { clearTimeout(s.keepAliveTimer); s.keepAliveTimer = null; }

  // If file mode — keep playing forever, no grace period needed
  if (s.mode === 'file') {
    console.log(`[${deck}] File mode active — stream continues without DJ`);
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

// ─── WebSocket handler (live broadcast from browser) ──────────────────────────
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const deck = url.searchParams.get('deck')?.toUpperCase();
  const type = url.searchParams.get('type');

  if (!deck || !DECKS.includes(deck) || type !== 'broadcast') {
    ws.close();
    return;
  }

  const s = state[deck];

  // Cancel grace period — DJ is back
  if (s.keepAliveTimer) {
    clearTimeout(s.keepAliveTimer);
    s.keepAliveTimer = null;
    console.log(`[${deck}] DJ reconnected — cancelling stop timer`);
  }

  // Close previous socket
  if (s.socket && s.socket !== ws) {
    try { s.socket.close(); } catch (_) {}
  }

  console.log(`[${deck}] Broadcaster connected`);
  s.socket = ws;
  s.pendingChunks = [];
  s.ffmpegReady = false;

  // Always restart ffmpeg for a fresh WebM stream.
  // We BUFFER incoming chunks while ffmpeg is starting, then flush them in order.
  // This ensures ffmpeg gets the WebM header (first chunk) and a clean stream.
  if (s.ffmpeg) {
    console.log(`[${deck}] Restarting ffmpeg for fresh WebM stream...`);
    // Kill old ffmpeg — don't wait for close event, just force it
    try { s.ffmpeg.stdin.end(); } catch (_) {}
    try { s.ffmpeg.kill('SIGTERM'); } catch (_) {}
    s.ffmpeg = null;
    s.isLive = false;
  }

  // Small pause to ensure OS cleans up the old process before spawning new one
  setTimeout(() => {
    if (!s.socket || s.socket.readyState !== WebSocket.OPEN) return;
    startFFmpegLive(deck);

    // Flush any buffered chunks that arrived while ffmpeg was starting
    if (s.pendingChunks.length > 0) {
      console.log(`[${deck}] Flushing ${s.pendingChunks.length} buffered chunks`);
      for (const chunk of s.pendingChunks) {
        if (s.ffmpeg && s.ffmpeg.stdin.writable) {
          try { s.ffmpeg.stdin.write(chunk); } catch (_) {}
        }
      }
      s.pendingChunks = [];
    }
  }, 150);

  ws.on('message', (data) => {
    const chunk = Buffer.from(data);

    if (!s.ffmpegReady || !s.ffmpeg || !s.ffmpeg.stdin.writable) {
      // Buffer up to 50 chunks (~25 seconds at 500ms interval) while ffmpeg starts
      if (s.pendingChunks.length < 50) {
        s.pendingChunks.push(chunk);
      }
      return;
    }

    // Drain pending buffer first
    if (s.pendingChunks.length > 0) {
      for (const c of s.pendingChunks) {
        try { s.ffmpeg.stdin.write(c); } catch (_) {}
      }
      s.pendingChunks = [];
    }

    try { s.ffmpeg.stdin.write(chunk); } catch (_) {}
  });

  ws.on('close', () => {
    console.log(`[${deck}] Broadcaster disconnected`);
    if (s.socket === ws) {
      s.socket = null;
      scheduleStopFFmpeg(deck);
    }
  });

  ws.on('error', (err) => {
    console.error(`[${deck}] WS error:`, err.message);
    ws.close();
  });
});

// ─── Track upload endpoint ─────────────────────────────────────────────────────
// POST /upload/:deck  — upload an MP3/audio file to be played on a deck
// Query: ?loop=true to loop, ?autoplay=true to start immediately
app.post('/upload/:deck', upload.single('track'), (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) {
    return res.status(400).json({ error: 'Invalid deck' });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const s = state[deck];
  s.trackPath = req.file.path;
  s.trackName = req.file.originalname;

  console.log(`[${deck}] Track uploaded: ${req.file.originalname} (${Math.round(req.file.size / 1024)}KB)`);

  const autoplay = req.query.autoplay !== 'false'; // default true
  const loop = req.query.loop === 'true';

  if (autoplay) {
    startFFmpegFile(deck, req.file.path, loop);
  }

  res.json({
    ok: true,
    deck,
    trackName: req.file.originalname,
    filePath: req.file.path,
    autoplay,
    loop,
  });
});

// POST /deck/:deck/play — start playing the uploaded track (or re-play)
app.post('/deck/:deck/play', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  if (!s.trackPath || !fs.existsSync(s.trackPath)) {
    return res.status(400).json({ error: 'No track uploaded for this deck' });
  }
  const loop = req.body?.loop ?? s.looping;
  startFFmpegFile(deck, s.trackPath, loop);
  res.json({ ok: true, deck, trackName: s.trackName, loop });
});

// POST /deck/:deck/stop — stop playback
app.post('/deck/:deck/stop', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!deck || !DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  stopFFmpeg(deck);
  res.json({ ok: true, deck });
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

// ─── Status endpoints ──────────────────────────────────────────────────────────
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
    info[deck] = {
      djConnected: !!(s.socket && s.socket.readyState === WebSocket.OPEN),
      streaming: !!(s.ffmpeg),
      inGracePeriod: !!(s.keepAliveTimer),
      mode: s.mode,           // 'live' | 'file' | null
      trackName: s.trackName, // name of uploaded file (if any)
      looping: s.looping,
    };
  });
  res.json(info);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SonicBeat Streaming Server running on port ${PORT}`);
  console.log(`Grace period after DJ disconnect: ${KEEP_ALIVE_MS / 60000} minutes`);
});
