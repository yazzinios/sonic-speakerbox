const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const HLS_DIR = '/tmp/hls';
const DECKS = ['A', 'B', 'C', 'D'];

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
  };
});

function startFFmpeg(deck) {
  const s = state[deck];
  if (s.ffmpeg) return s.ffmpeg;

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const playlistPath = path.join(outDir, 'stream.m3u8');

  console.log(`[${deck}] Starting ffmpeg...`);

  const ffmpeg = spawn('ffmpeg', [
    '-fflags', '+genpts+igndts',  // fix timestamp issues on reconnect
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
    '-y',  // overwrite output files
    playlistPath
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  ffmpeg.stdout.on('data', () => {});

  ffmpeg.stderr.on('data', (data) => {
    const msg = data.toString();
    // Only log errors not routine info
    if (msg.includes('Error') || msg.includes('error') || msg.includes('Invalid')) {
      console.error(`[ffmpeg ${deck}] ${msg.trim()}`);
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

    // If socket still connected, restart ffmpeg
    if (s.socket && s.socket.readyState === WebSocket.OPEN && !s.restarting) {
      s.restarting = true;
      console.log(`[${deck}] Restarting ffmpeg in 1s...`);
      setTimeout(() => {
        s.restarting = false;
        if (s.socket && s.socket.readyState === WebSocket.OPEN) {
          s.ffmpeg = startFFmpeg(deck);
        }
      }, 1000);
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
    console.log(`[${deck}] ffmpeg stopped`);
  }
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

  // Close previous socket if any
  if (s.socket && s.socket !== ws) {
    console.log(`[${deck}] Replacing old broadcaster connection`);
    s.socket.close();
  }

  console.log(`[${deck}] Broadcaster connected`);
  s.socket = ws;

  // Start fresh ffmpeg
  stopFFmpeg(deck);
  const ffmpeg = startFFmpeg(deck);

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
      stopFFmpeg(deck);
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
    live[deck] = !!(state[deck].socket) && fs.existsSync(playlistPath);
  });
  res.json({ live });
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SonicBeat Streaming Server running on port ${PORT}`);
});
