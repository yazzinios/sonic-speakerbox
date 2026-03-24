/**
 * SonicBeat API Server — Liquidsoap 2.2.5
 *
 * v5:   REAL-TIME telnet — persistent connection, no reconnect per command
 *       Pause/Play/Stop now respond in <10ms instead of 200-500ms
 * v5.1: FIX streaming default → false (button no longer shows ON AIR on boot)
 *       FIX play endpoint notifies UI 800ms after push so state reflects quickly
 *       FIX stop/pause also broadcast state update after command completes
 */
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const cors      = require('cors');
const multer    = require('multer');
const net       = require('net');
const { spawn } = require('child_process');
const fs        = require('fs');
const path      = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, verifyClient: (_, cb) => cb(true) });

const UPLOAD_DIR  = process.env.UPLOAD_DIR || '/data/uploads';
const ANN_DIR     = '/data/announcements';
const STATE_FILE  = '/data/deck-state.json';
const JINGLE_PATH = process.env.JINGLE_PATH || '/data/jingle.mp3';
const DECKS       = ['A', 'B', 'C', 'D'];

const ICECAST_HOST = process.env.ICECAST_HOST || '127.0.0.1';
const ICECAST_PORT = parseInt(process.env.ICECAST_PORT || '8000');
const SOURCE_PASS  = process.env.ICECAST_SOURCE_PASSWORD || 'sonicbeat_source_2024';
const LIQ_HOST     = process.env.LIQ_HOST || '127.0.0.1';
const LIQ_TELNET   = parseInt(process.env.LIQ_TELNET_PORT || '1234');
const LIQ_HARBOR   = parseInt(process.env.LIQ_HARBOR_PORT || '8005');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ANN_DIR,    { recursive: true });

// ─── State ────────────────────────────────────────────────────────────────────
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE))
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (e) { console.warn('[State] load error:', e.message); }
  return {};
}

function saveState() {
  try {
    const out = {};
    DECKS.forEach(d => {
      const s = state[d];
      out[d] = {
        mode: s.mode, trackPath: s.trackPath, trackName: s.trackName,
        looping: s.looping, playlist: s.playlist, playlistIndex: s.playlistIndex,
        playlistLoop: s.playlistLoop, autoDJEnabled: s.autoDJEnabled,
        streaming: s.streaming, paused: s.paused,
      };
    });
    fs.writeFileSync(STATE_FILE, JSON.stringify(out, null, 2));
  } catch (e) { console.warn('[State] save error:', e.message); }
}

const persisted = loadState();
const state = {};
DECKS.forEach(d => {
  const s = persisted[d] || {};
  state[d] = {
    mode:          s.mode          || null,
    trackPath:     s.trackPath     || null,
    trackName:     s.trackName     || null,
    looping:       s.looping       || false,
    playlist:      s.playlist      || [],
    playlistIndex: s.playlistIndex || 0,
    playlistLoop:  s.playlistLoop  || false,
    autoDJEnabled: s.autoDJEnabled !== undefined ? s.autoDJEnabled : false,
    autoDJActive:  false,
    streaming:     s.streaming !== undefined ? s.streaming : false,  // FIX: was true — button showed ON AIR on fresh boot
    paused:        s.paused || false,
    socket:        null,
    liveProcess:   null,
    liveActive:    false,
  };
});

// ─── Liquidsoap persistent telnet connection ──────────────────────────────────
//
// REAL-TIME FIX: Instead of opening a new TCP socket per command (200-500ms),
// we keep ONE persistent connection to Liquidsoap telnet.
// Commands are sent instantly over the open socket — response in <10ms.
//
// Protocol: Liquidsoap telnet uses a simple newline-delimited request/response.
// We send one command at a time and wait for "END\r\n" or "Bye!" to know it's done.
//
class LiqPersistent {
  constructor(host, port) {
    this.host       = host;
    this.port       = port;
    this.socket     = null;
    this.connected  = false;
    this.queue      = [];          // pending { cmd, resolve, reject, timer }
    this.current    = null;        // currently executing item
    this.buf        = '';
    this._reconnectTimer = null;
    this._connect();
  }

  _connect() {
    if (this.socket) {
      try { this.socket.destroy(); } catch (_) {}
      this.socket = null;
    }
    this.connected = false;
    this.buf = '';

    const sock = new net.Socket();
    this.socket = sock;
    sock.setKeepAlive(true, 5000);
    sock.setTimeout(0); // no idle timeout — we want it to stay open

    sock.connect(this.port, this.host, () => {
      this.connected = true;
      console.log(`[Liq] Persistent telnet connected to ${this.host}:${this.port}`);
      this._flush();
    });

    sock.on('data', (data) => {
      this.buf += data.toString();
      this._tryResolve();
    });

    sock.on('error', (err) => {
      console.warn(`[Liq] Telnet error: ${err.message} — reconnecting in 2s`);
      this._scheduleReconnect();
    });

    sock.on('close', () => {
      if (this.connected) {
        console.warn('[Liq] Telnet connection closed — reconnecting in 2s');
      }
      this.connected = false;
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return;
    // Fail the current pending command immediately so the API doesn't hang
    if (this.current) {
      clearTimeout(this.current.timer);
      this.current.resolve('');
      this.current = null;
    }
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, 2000);
  }

  _flush() {
    // If nothing is currently running and we have commands queued, send next one
    if (!this.connected || this.current || !this.queue.length) return;
    const item = this.queue.shift();
    this.current = item;
    this.buf = '';
    // Liquidsoap telnet: send command + newline
    // We do NOT send "exit" — we keep the connection open
    try {
      this.socket.write(item.cmd + '\n');
    } catch (e) {
      item.resolve('');
      this.current = null;
      this._scheduleReconnect();
    }
  }

  _tryResolve() {
    if (!this.current) return;
    // Liquidsoap ends each response with "END\r\n" or just "\n" for simple commands
    // We detect end of response by looking for "END" on its own line
    if (this.buf.includes('\nEND') || this.buf.endsWith('END\n') || this.buf.endsWith('END\r\n')) {
      const response = this.buf.replace(/\r?\nEND\r?\n?$/, '').trim();
      clearTimeout(this.current.timer);
      this.current.resolve(response);
      this.current = null;
      this.buf = '';
      // Small yield before next command to avoid overwhelming Liquidsoap
      setImmediate(() => this._flush());
    }
  }

  exec(cmd) {
    return new Promise((resolve) => {
      // Timeout per-command: if Liquidsoap doesn't respond in 3s, give up
      const timer = setTimeout(() => {
        if (this.current?.cmd === cmd) {
          console.warn(`[Liq] Command timeout: ${cmd}`);
          this.current = null;
          this.buf = '';
          resolve('');
          this._flush();
        }
      }, 3000);

      this.queue.push({ cmd, resolve, timer });
      this._flush();
    });
  }
}

// Single global persistent connection
const liq = new LiqPersistent(LIQ_HOST, LIQ_TELNET);
const liqCmd = (cmd) => liq.exec(cmd);

// ─── Loop watchdog ────────────────────────────────────────────────────────────
setInterval(async () => {
  for (const deck of DECKS) {
    const s = state[deck];
    if (!s.looping || !s.trackPath || s.paused || s.liveActive || s.mode !== 'file') continue;
    try {
      const r   = await liqCmd(`q_${deck}.length`);
      const len = parseInt(r.trim(), 10);
      if (!isNaN(len) && len === 0) {
        await liqCmd(`q_${deck}.push ${s.trackPath}`);
        console.log(`[${deck}] Loop: re-queued`);
      }
    } catch (_) {}
  }
}, 2500);

// ─── Multer ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, UPLOAD_DIR),
  filename:    (_, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_')}`),
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const annStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, ANN_DIR),
  filename:    (_, file, cb) => cb(null, `ann_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_')}`),
});
const uploadAnn = multer({ storage: annStorage, limits: { fileSize: 50 * 1024 * 1024 } });

const jingleStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, '/data'),
  filename:    (_, __, cb) => cb(null, 'jingle.mp3'),
});
const uploadJingle = multer({ storage: jingleStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Live broadcast ───────────────────────────────────────────────────────────
function startLiveBroadcast(deck) {
  const s = state[deck];
  stopLiveBroadcast(deck);
  const url = `icecast://source:${SOURCE_PASS}@${LIQ_HOST}:${LIQ_HARBOR}/mic/deck-${deck.toLowerCase()}`;
  console.log(`[${deck}] Live → ${url}`);
  const ff = spawn('ffmpeg', [
    '-fflags', '+genpts+igndts', '-analyzeduration', '0', '-probesize', '32',
    '-f', 'webm', '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2', '-ar', '44100',
    '-f', 'mp3', url,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  ff.stderr.on('data', d => { const m = d.toString(); if (m.includes('error') && !m.includes('deprecated')) console.error(`[${deck}] ffmpeg: ${m.trim().split('\n')[0]}`); });
  ff.stdin.on('error', e => { if (e.code !== 'EPIPE') console.error(`[${deck}] stdin:`, e.message); });
  ff.on('close', code => { console.log(`[${deck}] ffmpeg closed (${code})`); s.liveProcess = null; if (s.mode === 'live') { s.mode = null; saveState(); } });
  s.liveProcess = ff; s.mode = 'live'; s.liveActive = true;
  saveState(); return ff;
}

function stopLiveBroadcast(deck) {
  const s = state[deck];
  if (!s.liveProcess) return;
  try { s.liveProcess.stdin.end(); }    catch (_) {}
  try { s.liveProcess.kill('SIGTERM'); } catch (_) {}
  s.liveProcess = null; s.liveActive = false;
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url  = new URL(req.url, 'http://x');
  const deck = url.searchParams.get('deck')?.toUpperCase();
  const type = url.searchParams.get('type');

  // FIX: 'monitor' connections are read-only listeners for real-time state push
  // They receive broadcastDeckState() messages and send nothing back.
  if (type === 'monitor') {
    // Just keep the connection open — broadcastDeckState() will push to it
    ws.on('error', () => ws.close());
    return;
  }

  if (!deck || !DECKS.includes(deck) || type !== 'broadcast') { ws.close(); return; }
  const s = state[deck];
  if (s.socket && s.socket !== ws) { try { s.socket.close(); } catch (_) {} }
  s.socket = ws;
  let ff = null, spawned = false, pending = [];
  console.log(`[${deck}] DJ connected`);
  ws.on('message', data => {
    const chunk = Buffer.from(data);
    if (!spawned) {
      pending.push(chunk); spawned = true;
      ff = startLiveBroadcast(deck); s.liveProcess = ff;
      if (ff?.stdin.writable) { pending.forEach(c => { try { ff.stdin.write(c); } catch (_) {} }); pending = []; }
      return;
    }
    if (ff?.stdin.writable) try { ff.stdin.write(chunk); } catch (_) {}
  });
  ws.on('close', () => { console.log(`[${deck}] DJ disconnected`); if (s.socket === ws) { s.socket = null; stopLiveBroadcast(deck); s.mode = null; saveState(); } });
  ws.on('error', e => { console.error(`[${deck}] WS:`, e.message); ws.close(); });
});

// ─── Library ──────────────────────────────────────────────────────────────────
app.post('/library/upload', upload.single('track'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  console.log(`[Library] Stored: ${req.file.filename}`);
  res.json({ ok: true, serverName: req.file.filename, originalName: req.file.originalname, size: req.file.size });
});
app.use('/library/audio', express.static(UPLOAD_DIR, {
  setHeaders: r => { r.set('Cache-Control', 'public, max-age=3600'); r.set('Access-Control-Allow-Origin', '*'); },
}));
app.get('/library/files', (req, res) => {
  try {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => /\.(mp3|wav|ogg|flac|aac|m4a)$/i.test(f))
      .map(n => ({ serverName: n, size: fs.statSync(path.join(UPLOAD_DIR, n)).size }));
    res.json({ ok: true, files });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/library/files/:name', (req, res) => {
  const fp = path.join(UPLOAD_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(fp); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
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
  s.trackPath = fp; s.trackName = serverName;
  s.looping = !!loop; s.mode = 'file'; s.autoDJActive = false; s.paused = false;
  saveState();
  res.json({ ok: true, deck, serverName });
});

app.post('/deck/:deck/play', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  s.paused = false;
  // FIX: auto-enable streaming when user hits play so stream goes live immediately
  s.streaming = true;
  // Respond immediately so UI feels instant
  res.json({ ok: true });
  await liqCmd(`var.set vol_${deck} = 1.`);
  if (s.mode === 'file' && s.trackPath) {
    const r = await liqCmd(`q_${deck}.length`);
    if (isNaN(parseInt(r.trim(), 10)) || parseInt(r.trim(), 10) === 0) {
      await liqCmd(`q_${deck}.push ${s.trackPath}`);
    }
  } else if (s.mode === 'playlist' && s.playlist.length) {
    const r = await liqCmd(`q_${deck}.length`);
    if (isNaN(parseInt(r.trim(), 10)) || parseInt(r.trim(), 10) === 0) await playPlaylistFromIndex(deck, s.playlistIndex);
  }
  saveState();
  // FIX: broadcast state to all WS clients after Liquidsoap has had time to prepare
  // so the UI transitions from "loaded" to "playing" without waiting for next poll
  broadcastDeckState();
  setTimeout(broadcastDeckState, 800);
  setTimeout(broadcastDeckState, 1800);
});

app.post('/deck/:deck/pause', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  state[deck].paused = true;
  res.json({ ok: true, paused: true });
  await liqCmd(`var.set vol_${deck} = 0.`);
  saveState();
  broadcastDeckState();
});

app.post('/deck/:deck/stop', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  s.paused = false; s.autoDJActive = false;
  if (s.mode === 'playlist') { s.playlist = []; s.playlistIndex = 0; s.mode = null; }
  res.json({ ok: true });
  stopLiveBroadcast(deck);
  await liqCmd(`q_${deck}.skip`);
  await liqCmd(`var.set vol_${deck} = 1.`);
  saveState();
  broadcastDeckState();
});

app.post('/deck/:deck/skip', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  res.json({ ok: true });
  liqCmd(`q_${deck}.skip`);
});

app.post('/deck/:deck/autodj', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  state[deck].autoDJEnabled = !!req.body.enabled;
  res.json({ ok: true });
  saveState();
});

app.post('/deck/:deck/stream/start', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  state[deck].streaming = true;
  res.json({ ok: true, streaming: true });
  if (!state[deck].paused) await liqCmd(`var.set vol_${deck} = 1.`);
  saveState();
});

app.post('/deck/:deck/stream/stop', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  state[deck].streaming = false; state[deck].paused = false;
  res.json({ ok: true, streaming: false });
  await liqCmd(`var.set vol_${deck} = 0.`);
  saveState();
});

// ─── Playlist ─────────────────────────────────────────────────────────────────
app.post('/deck/:deck/playlist', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { tracks, loop, startIndex } = req.body;
  if (!Array.isArray(tracks) || !tracks.length) return res.status(400).json({ error: 'tracks required' });
  const playlist = tracks
    .map(t => ({ id: t.id, path: path.join(UPLOAD_DIR, t.serverName), name: t.name || t.serverName, serverName: t.serverName }))
    .filter(t => fs.existsSync(t.path));
  if (!playlist.length) return res.status(400).json({ error: 'No valid tracks' });
  const s = state[deck];
  s.playlist = playlist; s.playlistIndex = startIndex || 0;
  s.playlistLoop = !!loop; s.mode = 'playlist'; s.autoDJActive = false; s.paused = false;
  saveState();
  await playPlaylistFromIndex(deck, startIndex || 0);
  res.json({ ok: true, trackCount: playlist.length });
});

async function playPlaylistFromIndex(deck, index) {
  const s = state[deck];
  if (!s.playlist.length) return;
  await liqCmd(`var.set vol_${deck} = 1.`);
  await liqCmd(`q_${deck}.skip`);
  for (const t of s.playlist.slice(index)) await liqCmd(`q_${deck}.push ${t.path}`);
  if (s.playlistLoop) for (const t of s.playlist.slice(0, index)) await liqCmd(`q_${deck}.push ${t.path}`);
}

app.post('/deck/:deck/playlist/next', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  s.playlistIndex = Math.min(s.playlistIndex + 1, s.playlist.length - 1);
  res.json({ ok: true, newIndex: s.playlistIndex });
  await liqCmd(`q_${deck}.skip`);
  saveState();
});

app.post('/deck/:deck/playlist/jump', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { index } = req.body;
  const s = state[deck];
  if (typeof index !== 'number' || index < 0 || index >= s.playlist.length)
    return res.status(400).json({ error: 'Invalid index' });
  s.playlistIndex = index;
  res.json({ ok: true, newIndex: index });
  await playPlaylistFromIndex(deck, index);
  saveState();
});

// ─── Jingle ───────────────────────────────────────────────────────────────────
app.post('/jingle/upload', uploadJingle.single('jingle'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ ok: true });
});
app.get('/jingle/exists', (req, res) => res.json({ exists: fs.existsSync(JINGLE_PATH) }));
app.post('/jingle/play', async (req, res) => {
  const tDecks = resolveTargets(req.body?.targets);
  let durationMs = 500;
  if (fs.existsSync(JINGLE_PATH)) {
    for (const d of tDecks) await liqCmd(`ann_${d}.push ${JINGLE_PATH}`);
    durationMs = await getAudioDuration(JINGLE_PATH);
  }
  res.json({ ok: true, durationMs, targetDecks: tDecks });
});

// ─── Ducking ──────────────────────────────────────────────────────────────────
async function duck(decks, vol)  { for (const d of decks) await liqCmd(`var.set vol_${d} = ${vol}`); }
async function unduck(decks)     { for (const d of decks) { if (state[d]?.streaming !== false) await liqCmd(`var.set vol_${d} = 1.`); if (state[d]) state[d].paused = false; } }

function getAudioDuration(fp) {
  return new Promise(resolve => {
    const p = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', fp]);
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('close', () => { try { resolve(parseFloat(JSON.parse(out).format.duration) * 1000); } catch { resolve(3000); } });
    p.on('error', () => resolve(3000));
  });
}

// ─── Announcements ────────────────────────────────────────────────────────────
app.post('/announcements/upload', uploadAnn.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ ok: true, serverName: req.file.filename });
});
app.use('/announcements/audio', express.static(ANN_DIR));
app.delete('/announcements/files/:name', (req, res) => {
  const fp = path.join(ANN_DIR, req.params.name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(fp); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/announcements/tts', async (req, res) => {
  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const out = path.join(ANN_DIR, `tts_${Date.now()}.mp3`);
  const es  = spawn('espeak', ['-v', voice || 'en', '--stdout', text]);
  const ff  = spawn('ffmpeg', ['-f', 'wav', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-y', out]);
  es.stdout.pipe(ff.stdin);
  ff.on('close', c => c === 0 ? res.json({ ok: true, serverName: path.basename(out) }) : res.status(500).json({ error: 'TTS failed' }));
  ff.on('error', e => res.status(500).json({ error: e.message }));
});
const scheduledAnns = new Map();
app.post('/announcements/play', async (req, res) => {
  const { serverName, targets, duckMusic = true } = req.body;
  if (!serverName) return res.status(400).json({ error: 'serverName required' });
  const fp = path.join(ANN_DIR, serverName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  const tDecks = resolveTargets(targets);
  res.json({ ok: true, targetDecks: tDecks });
  if (duckMusic) await duck(tDecks, 0.05);
  for (const d of tDecks) await liqCmd(`ann_${d}.push ${fp}`);
  if (duckMusic) { const ms = await getAudioDuration(fp); setTimeout(() => unduck(tDecks), ms + 500); }
});
app.post('/announcements/schedule', (req, res) => {
  const { serverName, targets, playAt, duckMusic = true } = req.body;
  if (!serverName || !playAt) return res.status(400).json({ error: 'serverName and playAt required' });
  const fp = path.join(ANN_DIR, serverName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'Not found' });
  const fireAt = new Date(playAt);
  if (isNaN(fireAt) || fireAt <= Date.now()) return res.status(400).json({ error: 'playAt must be future' });
  const id = `sched_${Date.now()}`;
  const tDecks = resolveTargets(targets);
  const timer = setTimeout(async () => {
    if (duckMusic) await duck(tDecks, 0.05);
    for (const d of tDecks) await liqCmd(`ann_${d}.push ${fp}`);
    if (duckMusic) { const ms = await getAudioDuration(fp); setTimeout(() => unduck(tDecks), ms + 500); }
    scheduledAnns.delete(id);
  }, fireAt.getTime() - Date.now());
  scheduledAnns.set(id, { id, serverName, targets: tDecks, playAt: fireAt.toISOString(), timer });
  res.json({ ok: true, id, fireAt: fireAt.toISOString() });
});
app.get('/announcements/scheduled', (req, res) => {
  const list = []; scheduledAnns.forEach(({ id, serverName, targets, playAt }) => list.push({ id, serverName, targets, playAt })); res.json(list);
});
app.delete('/announcements/scheduled/:id', (req, res) => {
  const item = scheduledAnns.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  clearTimeout(item.timer); scheduledAnns.delete(req.params.id); res.json({ ok: true });
});

// ─── Mic ──────────────────────────────────────────────────────────────────────
app.post('/mic/start', async (req, res) => {
  const tDecks = resolveTargets(req.body?.targets);
  let jingleMs = 0;
  if (fs.existsSync(JINGLE_PATH)) {
    for (const d of tDecks) await liqCmd(`ann_${d}.push ${JINGLE_PATH}`);
    jingleMs = await getAudioDuration(JINGLE_PATH);
  }
  res.json({ ok: true, targetDecks: tDecks, jingleDurationMs: jingleMs });
  setTimeout(() => duck(tDecks, 0.05), jingleMs);
});
app.post('/mic/stop', async (req, res) => {
  const tDecks = resolveTargets(req.body?.targets);
  res.json({ ok: true });
  await unduck(tDecks);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resolveTargets(targets) {
  if (!Array.isArray(targets) || targets[0] === 'ALL') return [...DECKS];
  return targets.map(d => d.toUpperCase()).filter(d => DECKS.includes(d));
}

// ─── broadcastDeckState: push /deck-info to all connected WS clients ─────────
// Called after play/pause/stop so the UI updates instantly instead of waiting
// for the next 2-second poll cycle.
function broadcastDeckState() {
  if (wss.clients.size === 0) return;
  const info = {};
  for (const deck of DECKS) {
    const s = state[deck];
    info[deck] = {
      djConnected:    !!(s.socket?.readyState === 1),
      streaming:      s.streaming,
      paused:         s.paused,
      mode:           s.liveActive ? 'live' : (s.mode || null),
      trackName:      s.mode === 'autodj' ? liqCache[deck].trackName : (s.trackName || null),
      trackPath:      s.trackPath,
      looping:        s.looping,
      playlistLength: s.playlist.length,
      playlistIndex:  s.playlistIndex,
      playlistLoop:   s.playlistLoop,
      currentTrack:   s.mode === 'playlist' ? (s.playlist[s.playlistIndex] || null) : null,
      playlist:       s.playlist,
      autoDJEnabled:  s.autoDJEnabled,
      autoDJActive:   !s.liveActive,
    };
  }
  const msg = JSON.stringify({ type: 'deck-state', data: info });
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch (_) {}
    }
  });
}

// ─── Health / status ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true, liqConnected: liq.connected }));
app.get('/status', async (req, res) => {
  const live = {};
  for (const deck of DECKS) {
    try { const r = await liqCmd(`out_${deck}.status`); live[deck] = r.toLowerCase().includes('on') || r.includes('connected'); }
    catch { live[deck] = false; }
  }
  res.json({ live });
});

// ─── Metadata poller ──────────────────────────────────────────────────────────
const liqCache = {};
DECKS.forEach(d => liqCache[d] = { trackName: null });
setInterval(async () => {
  for (const deck of DECKS) {
    try {
      const meta = await liqCmd(`mix_node_${deck}.last_metadata`);
      const tm = meta.match(/title="([^"]+)"/);
      const fm = meta.match(/filename="([^"]+)"/);
      liqCache[deck].trackName = tm ? tm[1] : fm ? path.basename(fm[1]) : null;
    } catch { liqCache[deck].trackName = null; }
  }
}, 3000);

// ─── Deck info ────────────────────────────────────────────────────────────────
app.get('/deck-info', (req, res) => {
  const info = {};
  for (const deck of DECKS) {
    const s = state[deck];
    info[deck] = {
      djConnected:    !!(s.socket?.readyState === 1),
      streaming:      s.streaming,
      paused:         s.paused,
      mode:           s.liveActive ? 'live' : (s.mode || null),
      trackName:      s.mode === 'autodj' ? liqCache[deck].trackName : (s.trackName || null),
      trackPath:      s.trackPath,
      looping:        s.looping,
      playlistLength: s.playlist.length,
      playlistIndex:  s.playlistIndex,
      playlistLoop:   s.playlistLoop,
      currentTrack:   s.mode === 'playlist' ? (s.playlist[s.playlistIndex] || null) : null,
      playlist:       s.playlist,
      autoDJEnabled:  s.autoDJEnabled,
      autoDJActive:   !s.liveActive,
      streamUrl:      `http://${req.hostname}:8000/deck-${deck.toLowerCase()}`,
    };
  }
  res.json(info);
});

app.get('/icecast-status', async (req, res) => {
  try {
    const r = await fetch(`http://${ICECAST_HOST}:${ICECAST_PORT}/status-json.xsl`);
    res.json(await r.json());
  } catch { res.status(503).json({ error: 'Icecast unreachable' }); }
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] SonicBeat v5 — real-time telnet on :${PORT}`);
  console.log(`[API] Persistent telnet → ${LIQ_HOST}:${LIQ_TELNET}`);
});
