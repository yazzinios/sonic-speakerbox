const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const HLS_DIR = '/tmp/hls';
const DECKS = ['A', 'B', 'C', 'D'];

// How long (ms) to keep ffmpeg alive after DJ disconnects
// This keeps the stream alive for listeners while DJ is away / refreshes page
const KEEP_ALIVE_MS = 300000; // 5 minutes — gives DJ time to reload and reconnect

// Ensure HLS directories exist for each deck
DECKS.forEach(deck => {
  fs.mkdirSync(path.join(HLS_DIR, deck.toLowerCase()), { recursive: true });
});

// Track state per deck
const state = {};
DECKS.forEach(deck => {
  state[deck] = {
    ffmpeg: null,
    socket: null,
    restarting: false,
    keepAliveTimer: null,   // timer to stop ffmpeg after disconnect
    isLive: false,          // true while ffmpeg is running and has a valid playlist
  };
});

function startFFmpeg(deck) {
  const s = state[deck];
  if (s.ffmpeg) return s.ffmpeg;

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const playlistPath = path.join(outDir, 'stream.m3u8');

  console.log(`[${deck}] Starting ffmpeg...`);

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
    playlistPath
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  ffmpeg.stdout.on('data', () => {});

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
      console.error(`[ffmpeg ${deck}] ${msg.trim()}`);
    }
    // Track when segments are written — means stream is live
    if (msg.includes('.ts')) {
      s.isLive = true;
    }
  });

  ffmpeg.stdin.on('error', (err) => {
    if (err.code !== 'EPIPE') {
      console.error(`[${deck}] ffmpeg stdin error:`, err.message);
    }
  });

  ffmpeg.on('close', (code) => {
    console.log(`[${deck}] ffmpeg exited (code ${code})`);
    s.ffmpeg = null;
    s.isLive = false;

    // If socket still connected, restart ffmpeg immediately
    if (s.socket && s.socket.readyState === WebSocket.OPEN && !s.restarting) {
      s.restarting = true;
      console.log(`[${deck}] Restarting ffmpeg in 500ms...`);
      setTimeout(() => {
        s.restarting = false;
        if (s.socket && s.socket.readyState === WebSocket.OPEN) {
          s.ffmpeg = startFFmpeg(deck);
        }
      }, 500);
    }
  });

  s.ffmpeg = ffmpeg;
  return ffmpeg;
}

function stopFFmpeg(deck) {
  const s = state[deck];
  if (s.ffmpeg) {
    try { s.ffmpeg.stdin.end(); } catch (_) {}
    try { s.ffmpeg.kill('SIGTERM'); } catch (_) {}
    s.ffmpeg = null;
    s.isLive = false;
    console.log(`[${deck}] ffmpeg stopped`);
  }
}

// Schedule ffmpeg stop after grace period (keeps stream alive for listeners)
function scheduleStopFFmpeg(deck) {
  const s = state[deck];
  // Clear any existing keep-alive timer
  if (s.keepAliveTimer) {
    clearTimeout(s.keepAliveTimer);
    s.keepAliveTimer = null;
  }
  const minutes = KEEP_ALIVE_MS / 60000;
  console.log(`[${deck}] DJ disconnected — keeping stream alive for ${minutes} minutes`);
  s.keepAliveTimer = setTimeout(() => {
    s.keepAliveTimer = null;
    // Only stop if DJ hasn't reconnected
    if (!s.socket || s.socket.readyState !== WebSocket.OPEN) {
      console.log(`[${deck}] Grace period expired — stopping stream`);
      stopFFmpeg(deck);
    }
  }, KEEP_ALIVE_MS);
}

// WebSocket handler
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const deck = url.searchParams.get('deck')?.toUpperCase();
  const type = url.searchParams.get('type');

  if (!deck || !DECKS.includes(deck) || type !== 'broadcast') {
    ws.close();
    return;
  }

  const s = state[deck];

  // Cancel any pending stop timer — DJ is back!
  if (s.keepAliveTimer) {
    clearTimeout(s.keepAliveTimer);
    s.keepAliveTimer = null;
    console.log(`[${deck}] DJ reconnected — cancelling stop timer`);
  }

  // Close previous socket if any
  if (s.socket && s.socket !== ws) {
    console.log(`[${deck}] Replacing old broadcaster connection`);
    try { s.socket.close(); } catch (_) {}
  }

  console.log(`[${deck}] Broadcaster connected`);
  s.socket = ws;

  // Always restart ffmpeg fresh on new connection — the browser sends a fresh
  // WebM stream with a new header, so ffmpeg MUST be restarted to parse it.
  // The old HLS segments remain on disk so listeners get a seamless ~2s gap at most.
  if (s.ffmpeg) {
    console.log(`[${deck}] Restarting ffmpeg for fresh WebM stream from reconnected broadcaster`);
    stopFFmpeg(deck);
    // Brief pause to let ffmpeg fully exit before spawning new instance
    setTimeout(() => {
      if (s.socket && s.socket.readyState === WebSocket.OPEN) {
        startFFmpeg(deck);
      }
    }, 300);
  } else {
    startFFmpeg(deck);
  }

  ws.on('message', (data) => {
    if (s.ffmpeg && s.ffmpeg.stdin.writable) {
      try {
        s.ffmpeg.stdin.write(Buffer.from(data));
      } catch (err) {
        // ignore write errors — ffmpeg may be restarting
      }
    }
  });

  ws.on('close', () => {
    console.log(`[${deck}] Broadcaster disconnected`);
    if (s.socket === ws) {
      s.socket = null;
      // Don't stop immediately — schedule a grace period stop
      scheduleStopFFmpeg(deck);
    }
  });

  ws.on('error', (err) => {
    console.error(`[${deck}] WS error:`, err.message);
    ws.close();
  });
});

// Serve HLS files
app.use('/hls', express.static(HLS_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (filePath.endsWith('.ts')) {
      res.set('Content-Type', 'video/mp2t');
      res.set('Cache-Control', 'public, max-age=60');
    }
  }
}));

// Status: which decks are live
app.get('/status', (req, res) => {
  const live = {};
  DECKS.forEach(deck => {
    const playlistPath = path.join(HLS_DIR, deck.toLowerCase(), 'stream.m3u8');
    // A deck is "live" if:
    //  - ffmpeg is still running (including grace period after disconnect)
    //  - AND the playlist file exists
    const hasPlaylist = fs.existsSync(playlistPath);
    const isStreaming = !!(state[deck].ffmpeg) && hasPlaylist;
    live[deck] = isStreaming;
  });
  res.json({ live });
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

// Deck info endpoint — includes whether DJ is actively connected vs grace-period
app.get('/deck-info', (req, res) => {
  const info = {};
  DECKS.forEach(deck => {
    info[deck] = {
      djConnected: !!(state[deck].socket && state[deck].socket.readyState === WebSocket.OPEN),
      streaming: !!(state[deck].ffmpeg),
      inGracePeriod: !!(state[deck].keepAliveTimer),
    };
  });
  res.json(info);
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SonicBeat Streaming Server running on port ${PORT}`);
  console.log(`Grace period after DJ disconnect: ${KEEP_ALIVE_MS / 60000} minutes`);
});
