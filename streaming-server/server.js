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
  const dir = path.join(HLS_DIR, deck.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
});

// Track active ffmpeg processes per deck
const ffmpegProcesses = {};
const broadcasterSockets = {};

// Start ffmpeg HLS process for a deck
function startFFmpeg(deck) {
  if (ffmpegProcesses[deck]) return;

  const outDir = path.join(HLS_DIR, deck.toLowerCase());
  const playlistPath = path.join(outDir, 'stream.m3u8');

  console.log(`[${deck}] Starting ffmpeg HLS...`);

  const ffmpeg = spawn('ffmpeg', [
    '-re',
    '-f', 'webm',           // input format from MediaRecorder
    '-i', 'pipe:0',         // read from stdin
    '-c:a', 'aac',          // encode to AAC
    '-b:a', '128k',         // 128kbps
    '-ac', '2',             // stereo
    '-ar', '44100',         // sample rate
    '-f', 'hls',            // output HLS
    '-hls_time', '2',       // 2 second segments
    '-hls_list_size', '10', // keep last 10 segments
    '-hls_flags', 'delete_segments+append_list',
    '-hls_segment_filename', path.join(outDir, 'seg%03d.ts'),
    playlistPath
  ]);

  ffmpeg.stderr.on('data', (data) => {
    // console.log(`[ffmpeg ${deck}] ${data}`);
  });

  ffmpeg.on('close', (code) => {
    console.log(`[${deck}] ffmpeg exited with code ${code}`);
    delete ffmpegProcesses[deck];
  });

  ffmpegProcesses[deck] = ffmpeg;
  return ffmpeg;
}

// Stop ffmpeg for a deck
function stopFFmpeg(deck) {
  if (ffmpegProcesses[deck]) {
    ffmpegProcesses[deck].kill('SIGTERM');
    delete ffmpegProcesses[deck];
    console.log(`[${deck}] ffmpeg stopped`);
  }
}

// WebSocket: DJ broadcaster connects and sends audio chunks
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost`);
  const deck = url.searchParams.get('deck')?.toUpperCase();
  const type = url.searchParams.get('type'); // 'broadcast'

  if (!deck || !DECKS.includes(deck) || type !== 'broadcast') {
    ws.close();
    return;
  }

  console.log(`[${deck}] Broadcaster connected`);
  broadcasterSockets[deck] = ws;

  const ffmpeg = startFFmpeg(deck);

  ws.on('message', (data) => {
    if (ffmpeg && ffmpeg.stdin.writable) {
      ffmpeg.stdin.write(data);
    }
  });

  ws.on('close', () => {
    console.log(`[${deck}] Broadcaster disconnected`);
    delete broadcasterSockets[deck];
    stopFFmpeg(deck);
  });

  ws.on('error', (err) => {
    console.error(`[${deck}] WebSocket error:`, err);
    stopFFmpeg(deck);
  });
});

// Serve HLS files to listeners
app.use('/hls', express.static(HLS_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.m3u8')) {
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache, no-store');
    } else if (filePath.endsWith('.ts')) {
      res.set('Content-Type', 'video/mp2t');
      res.set('Cache-Control', 'public, max-age=60');
    }
  }
}));

// Status endpoint — which decks are currently live
app.get('/status', (req, res) => {
  const live = {};
  DECKS.forEach(deck => {
    const playlistPath = path.join(HLS_DIR, deck.toLowerCase(), 'stream.m3u8');
    live[deck] = !!broadcasterSockets[deck] && fs.existsSync(playlistPath);
  });
  res.json({ live });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SonicBeat Streaming Server running on port ${PORT}`);
});
