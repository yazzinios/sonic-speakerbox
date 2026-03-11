/**
 * SonicBeat API Server — Liquidsoap 2.2.x compatible
 *
 * Ports:
 *   3001  — this Node API
 *   8000  — Icecast (proxied by nginx)
 *   8005  — Liquidsoap harbor (live DJ audio)
 *   1234  — Liquidsoap telnet control
 *
 * FIX v3:
 *  - On startup, auto-calls out_A/B/C/D.start so streams are LIVE from boot
 *  - streaming defaults to true always (not from persisted state)
 *  - ICECAST_HOST uses 127.0.0.1 explicitly
 *  - mksafe() in radio.liq ensures Liquidsoap never disconnects from Icecast
 */
const express    = require('express');
const http       = require('http');
const WebSocket  = require('ws');
const cors       = require('cors');
const multer     = require('multer');
const net        = require('net');
const { spawn }  = require('child_process');
const fs         = require('fs');
const path       = require('path');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, verifyClient: (_, cb) => cb(true) });

const UPLOAD_DIR    = process.env.UPLOAD_DIR || '/data/uploads';
const ANN_DIR       = '/data/announcements';
const STATE_FILE    = '/data/deck-state.json';
const JINGLE_PATH   = process.env.JINGLE_PATH || '/data/jingle.mp3';
const DECKS         = ['A', 'B', 'C', 'D'];

const ICECAST_HOST  = process.env.ICECAST_HOST  || '127.0.0.1';
const ICECAST_PORT  = parseInt(process.env.ICECAST_PORT || '8000');
const SOURCE_PASS   = process.env.ICECAST_SOURCE_PASSWORD || 'sonicbeat_source_2024';
const LIQ_HOST      = process.env.LIQ_HOST      || '127.0.0.1';
const LIQ_TELNET    = parseInt(process.env.LIQ_TELNET_PORT || '1234');
const LIQ_HARBOR    = parseInt(process.env.LIQ_HARBOR_PORT || '8005');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ANN_DIR,    { recursive: true });

// ─── Persistent state ─────────────────────────────────────────────────────────
function loadState() {
  try { if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (e) { console.warn('[State] load error:', e.message); }
  return {};
}
function saveState() {
  try {
    const out = {};
    DECKS.forEach(d => {
      const s = state[d];
      out[d] = {
        mode:          s.mode,
        trackPath:     s.trackPath,
        trackName:     s.trackName,
        looping:       s.looping,
        playlist:      s.playlist,
        playlistIndex: s.playlistIndex,
        playlistLoop:  s.playlistLoop,
        autoDJEnabled: s.autoDJEnabled,
        streaming:     s.streaming,
        paused:        s.paused,
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
    mode:          null,
    trackPath:     s.trackPath     || null,
    trackName:     s.trackName     || null,
    looping:       s.looping       || false,
    playlist:      s.playlist      || [],
    playlistIndex: s.playlistIndex || 0,
    playlistLoop:  s.playlistLoop  || false,
    autoDJEnabled: s.autoDJEnabled !== undefined ? s.autoDJEnabled : false,
    autoDJActive:  false,
    // FIX: streaming is ALWAYS true on boot — Icecast output starts active
    streaming:     true,
    paused:        s.paused || false,
    socket:        null,
    liveProcess:   null,
    liveActive:    false,
  };
});

// ─── Loop watchdog ─────────────────────────────────────────────────────────────
setInterval(async () => {
  for (const deck of DECKS) {
    const s = state[deck];
    if (!s.looping || !s.trackPath || s.paused || s.liveActive) continue;
    if (s.mode !== 'file') continue;
    try {
      const result = await liqCmd(`q_${deck}.length`);
      const queueLen = parseInt(result.trim(), 10);
      if (!isNaN(queueLen) && queueLen === 0) {
        await liqCmd(`q_${deck}.push ${s.trackPath}`);
        console.log(`[${deck}] Loop: re-queued ${s.trackName}`);
      }
    } catch (_) {}
  }
}, 2000);

// ─── Multer ────────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

const annStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ANN_DIR),
  filename:    (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._\- ]/g, '_');
    cb(null, `ann_${Date.now()}_${safe}`);
  },
});
const uploadAnn = multer({ storage: annStorage, limits: { fileSize: 50 * 1024 * 1024 } });

const jingleStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, '/data'),
  filename:    (req, file, cb) => cb(null, 'jingle.mp3'),
});
const uploadJingle = multer({ storage: jingleStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Liquidsoap telnet queue ───────────────────────────────────────────────────
class LiqQueue {
  constructor() { this.q = []; this.busy = false; }
  exec(command) {
    return new Promise(resolve => {
      this.q.push({ command, resolve });
      this.next();
    });
  }
  next() {
    if (this.busy || !this.q.length) return;
    this.busy = true;
    const { command, resolve } = this.q.shift();
    const client = new net.Socket();
    let response = '';
    client.setTimeout(3000);
    const done = (res) => {
      client.destroy();
      resolve(res);
      this.busy = false;
      setTimeout(() => this.next(), 20);
    };
    client.on('error', () => done(''));
    client.on('timeout', () => done(''));
    client.connect(LIQ_TELNET, LIQ_HOST, () => client.write(command + '\r\nexit\r\n'));
    client.on('data', d => response += d.toString());
    client.on('close', () => done(response.trim()));
  }
}
const liqDispatcher = new LiqQueue();
function liqCmd(command) { return liqDispatcher.exec(command); }

// ─── Live broadcast (browser WebM → ffmpeg → Liquidsoap harbor) ───────────────
function startLiveBroadcast(deck) {
  const s = state[deck];
  stopLiveBroadcast(deck);

  const harborUrl = `icecast://source:${SOURCE_PASS}@${LIQ_HOST}:${LIQ_HARBOR}/mic/deck-${deck.toLowerCase()}`;
  console.log(`[${deck}] Starting live broadcast → ${harborUrl}`);

  const ffmpeg = spawn('ffmpeg', [
    '-fflags', '+genpts+igndts',
    '-analyzeduration', '0',
    '-probesize', '32',
    '-f', 'webm', '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ac', '2', '-ar', '44100',
    '-f', 'mp3', harborUrl,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  ffmpeg.stderr.on('data', d => {
    const msg = d.toString();
    if (msg.includes('error') && !msg.includes('deprecated'))
      console.error(`[${deck}] ffmpeg:`, msg.trim().split('\n')[0]);
  });
  ffmpeg.stdin.on('error', e => { if (e.code !== 'EPIPE') console.error(`[${deck}] stdin:`, e.message); });
  ffmpeg.on('close', code => {
    console.log(`[${deck}] ffmpeg exited (${code})`);
    s.liveProcess = null;
    if (s.mode === 'live') { s.mode = null; saveState(); }
  });

  s.liveProcess = ffmpeg;
  s.mode        = 'live';
  s.liveActive  = true;
  saveState();
  return ffmpeg;
}

function stopLiveBroadcast(deck) {
  const s = state[deck];
  if (s.liveProcess) {
    try { s.liveProcess.stdin.end(); }     catch (_) {}
    try { s.liveProcess.kill('SIGTERM'); } catch (_) {}
    s.liveProcess = null;
    s.liveActive  = false;
  }
}

// ─── WebSocket: browser DJ audio ──────────────────────────────────────────────
wss.on('connection', (ws, req) => {
  const url  = new URL(req.url, 'http://localhost');
  const deck = url.searchParams.get('deck')?.toUpperCase();
  const type = url.searchParams.get('type');
  if (!deck || !DECKS.includes(deck) || type !== 'broadcast') { ws.close(); return; }

  const s = state[deck];
  if (s.socket && s.socket !== ws) { try { s.socket.close(); } catch (_) {} }
  s.socket = ws;

  let ffmpegProc    = null;
  let spawned       = false;
  let pendingChunks = [];

  console.log(`[${deck}] DJ connected`);

  ws.on('message', data => {
    const chunk = Buffer.from(data);
    if (!spawned) {
      pendingChunks.push(chunk);
      spawned       = true;
      ffmpegProc    = startLiveBroadcast(deck);
      s.liveProcess = ffmpegProc;
      if (ffmpegProc?.stdin.writable) {
        pendingChunks.forEach(c => { try { ffmpegProc.stdin.write(c); } catch (_) {} });
        pendingChunks = [];
      }
      return;
    }
    if (ffmpegProc?.stdin.writable) try { ffmpegProc.stdin.write(chunk); } catch (_) {}
  });

  ws.on('close', () => {
    console.log(`[${deck}] DJ disconnected`);
    if (s.socket === ws) {
      s.socket = null;
      stopLiveBroadcast(deck);
      s.mode = null;
      saveState();
    }
  });

  ws.on('error', e => { console.error(`[${deck}] WS:`, e.message); ws.close(); });
});

// ─── Library ───────────────────────────────────────────────────────────────────
app.post('/library/upload', upload.single('track'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  console.log(`[Library] Uploaded: ${req.file.filename} — NOT auto-loaded`);
  res.json({ ok: true, serverName: req.file.filename, originalName: req.file.originalname, size: req.file.size });
});

app.use('/library/audio', express.static(UPLOAD_DIR, {
  setHeaders: res => { res.set('Cache-Control', 'public, max-age=3600'); res.set('Access-Control-Allow-Origin', '*'); },
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

// ─── Deck control ──────────────────────────────────────────────────────────────
app.post('/deck/:deck/load', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { serverName, loop } = req.body;
  if (!serverName) return res.status(400).json({ error: 'serverName required' });
  const fp = path.join(UPLOAD_DIR, serverName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });

  const s = state[deck];
  s.trackPath    = fp;
  s.trackName    = serverName;
  s.looping      = loop || false;
  s.mode         = 'file';
  s.autoDJActive = false;
  s.paused       = false;
  saveState();
  console.log(`[${deck}] Loaded (not playing): ${serverName}`);
  res.json({ ok: true, deck, serverName });
});

app.post('/deck/:deck/play', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];

  await liqCmd(`var.set vol_${deck} = 1.`);
  s.paused = false;

  if (s.mode === 'file' && s.trackPath) {
    const qLen   = await liqCmd(`q_${deck}.length`);
    const parsed = parseInt(qLen.trim(), 10);
    const isEmpty = isNaN(parsed) || parsed === 0;
    if (isEmpty) {
      await liqCmd(`q_${deck}.push ${s.trackPath}`);
      console.log(`[${deck}] Playing: ${s.trackName}`);
    } else {
      console.log(`[${deck}] Resuming (queue not empty)`);
    }
  } else if (s.mode === 'playlist' && s.playlist.length > 0) {
    const qLen    = await liqCmd(`q_${deck}.length`);
    const parsed  = parseInt(qLen.trim(), 10);
    const isEmpty = isNaN(parsed) || parsed === 0;
    if (isEmpty) await playPlaylistFromIndex(deck, s.playlistIndex);
  }

  saveState();
  res.json({ ok: true });
});

app.post('/deck/:deck/pause', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  await liqCmd(`var.set vol_${deck} = 0.`);
  state[deck].paused = true;
  saveState();
  res.json({ ok: true, paused: true });
});

app.post('/deck/:deck/stop', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];

  stopLiveBroadcast(deck);
  await liqCmd(`q_${deck}.skip`);
  await liqCmd(`var.set vol_${deck} = 1.`);

  s.paused       = false;
  s.autoDJActive = false;
  if (s.mode === 'playlist') {
    s.playlist      = [];
    s.playlistIndex = 0;
    s.mode          = null;
  }
  // Keep mode='file' and trackPath so DJ can re-press Play

  saveState();
  res.json({ ok: true });
});

app.post('/deck/:deck/skip', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  liqCmd(`q_${deck}.skip`);
  res.json({ ok: true });
});

app.post('/deck/:deck/autodj', (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  state[deck].autoDJEnabled = !!req.body.enabled;
  saveState();
  res.json({ ok: true, autoDJEnabled: state[deck].autoDJEnabled });
});

// FIX: stream/start — calls out_X.start on Liquidsoap
app.post('/deck/:deck/stream/start', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const r = await liqCmd(`out_${deck}.start`);
  console.log(`[${deck}] Stream START → liq: ${r.slice(0,50)}`);
  state[deck].streaming = true;
  saveState();
  res.json({ ok: true, streaming: true });
});

// FIX: stream/stop — calls out_X.stop on Liquidsoap
app.post('/deck/:deck/stream/stop', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const r = await liqCmd(`out_${deck}.stop`);
  console.log(`[${deck}] Stream STOP → liq: ${r.slice(0,50)}`);
  state[deck].streaming = false;
  saveState();
  res.json({ ok: true, streaming: false });
});

// ─── Playlist ──────────────────────────────────────────────────────────────────
app.post('/deck/:deck/playlist', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { tracks, loop, startIndex } = req.body;
  if (!Array.isArray(tracks) || !tracks.length) return res.status(400).json({ error: 'tracks required' });

  const playlist = tracks
    .map(t => ({ id: t.id, path: path.join(UPLOAD_DIR, t.serverName), name: t.name || t.serverName, serverName: t.serverName }))
    .filter(t => fs.existsSync(t.path));
  if (!playlist.length) return res.status(400).json({ error: 'No valid tracks on server' });

  const s = state[deck];
  s.playlist      = playlist;
  s.playlistIndex = startIndex || 0;
  s.playlistLoop  = loop || false;
  s.mode          = 'playlist';
  s.autoDJActive  = false;
  s.paused        = false;
  saveState();
  await playPlaylistFromIndex(deck, startIndex || 0);
  res.json({ ok: true, trackCount: playlist.length });
});

async function playPlaylistFromIndex(deck, index) {
  const s = state[deck];
  if (!s.playlist.length) return;
  await liqCmd(`var.set vol_${deck} = 1.`);
  await liqCmd(`q_${deck}.skip`);
  for (const track of s.playlist.slice(index)) await liqCmd(`q_${deck}.push ${track.path}`);
  if (s.playlistLoop) {
    for (const track of s.playlist.slice(0, index)) await liqCmd(`q_${deck}.push ${track.path}`);
  }
}

app.post('/deck/:deck/playlist/next', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const s = state[deck];
  s.playlistIndex = Math.min(s.playlistIndex + 1, s.playlist.length - 1);
  saveState();
  await liqCmd(`q_${deck}.skip`);
  res.json({ ok: true, newIndex: s.playlistIndex });
});

app.post('/deck/:deck/playlist/jump', async (req, res) => {
  const deck = req.params.deck?.toUpperCase();
  if (!DECKS.includes(deck)) return res.status(400).json({ error: 'Invalid deck' });
  const { index } = req.body;
  const s = state[deck];
  if (typeof index !== 'number' || index < 0 || index >= s.playlist.length)
    return res.status(400).json({ error: 'Invalid index' });
  s.playlistIndex = index;
  saveState();
  await playPlaylistFromIndex(deck, index);
  res.json({ ok: true, newIndex: index });
});

// ─── Jingle ────────────────────────────────────────────────────────────────────
app.post('/jingle/upload', uploadJingle.single('jingle'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  console.log(`[Jingle] Uploaded: ${req.file.filename}`);
  res.json({ ok: true, path: JINGLE_PATH });
});

app.post('/jingle/play', async (req, res) => {
  const { targets } = req.body;
  const targetDecks = resolveTargets(targets);
  const jingleFile  = fs.existsSync(JINGLE_PATH) ? JINGLE_PATH : null;

  if (!jingleFile) {
    const beepPath = '/tmp/jingle_beep.mp3';
    try {
      await new Promise((resolve, reject) => {
        const ff = spawn('ffmpeg', [
          '-y', '-f', 'lavfi',
          '-i', 'sine=frequency=880:duration=0.2',
          '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
          beepPath,
        ]);
        ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg beep failed')));
        ff.on('error', reject);
      });
      for (const d of targetDecks) await liqCmd(`ann_${d}.push ${beepPath}`);
    } catch (e) { console.warn('[Jingle] Beep failed:', e.message); }
    return res.json({ ok: true, used: 'beep', targetDecks, durationMs: 300 });
  }

  for (const d of targetDecks) await liqCmd(`ann_${d}.push ${jingleFile}`);
  const duration = await getAudioDuration(jingleFile);
  console.log(`[Jingle] Playing on ${targetDecks.join(',')} — ${duration}ms`);
  res.json({ ok: true, used: 'custom', targetDecks, durationMs: duration });
});

app.get('/jingle/exists', (req, res) => {
  res.json({ exists: fs.existsSync(JINGLE_PATH), path: JINGLE_PATH });
});

// ─── Ducking ───────────────────────────────────────────────────────────────────
async function duckDecks(decks, volume) {
  for (const d of decks) await liqCmd(`var.set vol_${d} = ${volume}`);
}
async function restoreDecks(decks) {
  await duckDecks(decks, 1);
  decks.forEach(d => { if (state[d]) state[d].paused = false; });
}

function getAudioDuration(filePath) {
  return new Promise(resolve => {
    const ff = spawn('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', filePath]);
    let out = '';
    ff.stdout.on('data', d => out += d);
    ff.on('close', () => {
      try { resolve(parseFloat(JSON.parse(out).format.duration || 5) * 1000); }
      catch { resolve(5000); }
    });
    ff.on('error', () => resolve(5000));
  });
}

// ─── Announcements ─────────────────────────────────────────────────────────────
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

app.post('/announcements/tts', async (req, res) => {
  const { text, voice } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });
  const outPath = path.join(ANN_DIR, `tts_${Date.now()}.mp3`);
  const espeak  = spawn('espeak', ['-v', voice || 'en', '--stdout', text]);
  const ffmpeg  = spawn('ffmpeg', [
    '-f', 'wav', '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2', '-y', outPath,
  ]);
  espeak.stdout.pipe(ffmpeg.stdin);
  ffmpeg.on('close', code => code === 0
    ? res.json({ ok: true, serverName: path.basename(outPath) })
    : res.status(500).json({ error: 'TTS failed' })
  );
  ffmpeg.on('error', e => res.status(500).json({ error: e.message }));
});

const scheduledAnns = new Map();
app.post('/announcements/play', async (req, res) => {
  const { serverName, targets, duckMusic = true } = req.body;
  if (!serverName) return res.status(400).json({ error: 'serverName required' });
  const fp = path.join(ANN_DIR, serverName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  const targetDecks = resolveTargets(targets);
  res.json({ ok: true, targetDecks });
  if (duckMusic) await duckDecks(targetDecks, 0.05);
  for (const d of targetDecks) await liqCmd(`ann_${d}.push ${fp}`);
  if (duckMusic) { const ms = await getAudioDuration(fp); setTimeout(() => restoreDecks(targetDecks), ms + 500); }
});

app.post('/announcements/schedule', (req, res) => {
  const { serverName, targets, playAt, duckMusic = true } = req.body;
  if (!serverName || !playAt) return res.status(400).json({ error: 'serverName and playAt required' });
  const fp = path.join(ANN_DIR, serverName);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  const fireAt = new Date(playAt);
  if (isNaN(fireAt.getTime()) || fireAt <= Date.now()) return res.status(400).json({ error: 'playAt must be future' });
  const id    = `sched_${Date.now()}`;
  const delay = fireAt.getTime() - Date.now();
  const targetDecks = resolveTargets(targets);
  const timer = setTimeout(async () => {
    if (duckMusic) await duckDecks(targetDecks, 0.05);
    for (const d of targetDecks) await liqCmd(`ann_${d}.push ${fp}`);
    if (duckMusic) { const ms = await getAudioDuration(fp); setTimeout(() => restoreDecks(targetDecks), ms + 500); }
    scheduledAnns.delete(id);
  }, delay);
  scheduledAnns.set(id, { id, serverName, targets: targetDecks, playAt: fireAt.toISOString(), timer });
  res.json({ ok: true, id, fireAt: fireAt.toISOString(), delayMs: delay });
});

app.get('/announcements/scheduled', (req, res) => {
  const list = [];
  scheduledAnns.forEach(({ id, serverName, targets, playAt }) => list.push({ id, serverName, targets, playAt }));
  res.json(list);
});

app.delete('/announcements/scheduled/:id', (req, res) => {
  const item = scheduledAnns.get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  clearTimeout(item.timer); scheduledAnns.delete(req.params.id);
  res.json({ ok: true });
});

// ─── Mic on/off ────────────────────────────────────────────────────────────────
app.post('/mic/start', async (req, res) => {
  const targetDecks = resolveTargets(req.body.targets);
  if (!targetDecks.length) return res.status(400).json({ error: 'No valid target decks' });

  let jingleDurationMs = 0;
  const jingleFile = fs.existsSync(JINGLE_PATH) ? JINGLE_PATH : null;
  if (jingleFile) {
    for (const d of targetDecks) await liqCmd(`ann_${d}.push ${jingleFile}`);
    jingleDurationMs = await getAudioDuration(jingleFile);
  }

  setTimeout(async () => {
    await duckDecks(targetDecks, 0.05);
  }, jingleDurationMs);

  res.json({ ok: true, targetDecks, jingleDurationMs });
});

app.post('/mic/stop', async (req, res) => {
  const targetDecks = resolveTargets(req.body.targets);
  await restoreDecks(targetDecks);
  res.json({ ok: true });
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
function resolveTargets(targets) {
  if (!Array.isArray(targets) || targets[0] === 'ALL') return [...DECKS];
  return targets.map(d => d.toUpperCase()).filter(d => DECKS.includes(d));
}

// ─── Health / status ───────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/status', async (req, res) => {
  const live = {};
  for (const deck of DECKS) {
    const r = await liqCmd(`out_${deck}.status`);
    live[deck] = r.includes('on');
  }
  res.json({ live });
});

// ─── Background metadata poller ───────────────────────────────────────────────
const liqCache = {};
DECKS.forEach(d => liqCache[d] = { trackName: null });

setInterval(async () => {
  for (const deck of DECKS) {
    try {
      const meta = await liqCmd(`mix_node_${deck}.last_metadata`);
      const titleMatch = meta.match(/title="([^"]+)"/);
      const fileMatch  = meta.match(/filename="([^"]+)"/);
      if (titleMatch)     liqCache[deck].trackName = titleMatch[1];
      else if (fileMatch) liqCache[deck].trackName = path.basename(fileMatch[1]);
      else                liqCache[deck].trackName = null;
    } catch (_) { liqCache[deck].trackName = null; }
  }
}, 3000);

// ─── Deck info ─────────────────────────────────────────────────────────────────
app.get('/deck-info', (req, res) => {
  const info = {};
  for (const deck of DECKS) {
    const s      = state[deck];
    const cached = liqCache[deck];
    info[deck] = {
      djConnected:    !!(s.socket?.readyState === 1),
      streaming:      s.streaming,
      paused:         s.paused || false,
      mode:           s.liveActive ? 'live' : (s.mode || null),
      trackName:      s.mode === 'autodj' ? cached.trackName : (s.trackName || null),
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
    const response = await fetch(`http://${ICECAST_HOST}:${ICECAST_PORT}/status-json.xsl`);
    res.json(await response.json());
  } catch { res.status(503).json({ error: 'Icecast not reachable' }); }
});

// ─── Server startup ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] SonicBeat v3 on port ${PORT}`);
  console.log(`[API] Liquidsoap telnet → ${LIQ_HOST}:${LIQ_TELNET}`);

  // FIX: On startup, explicitly start all Icecast outputs.
  // In Liquidsoap 2.2 with fallible=true, outputs do NOT auto-connect.
  // We retry until Liquidsoap telnet is available (it takes ~15s to boot).
  let startupAttempts = 0;
  const startupInterval = setInterval(async () => {
    startupAttempts++;
    console.log(`[API] Startup: attempting to start Icecast outputs (attempt ${startupAttempts})...`);
    try {
      // Test if telnet is alive by checking one output status
      const testResult = await liqCmd(`out_A.status`);
      if (!testResult) throw new Error('No response from Liquidsoap');

      console.log(`[API] Liquidsoap is ready — starting all 4 outputs...`);
      for (const deck of DECKS) {
        const result = await liqCmd(`out_${deck}.start`);
        state[deck].streaming = true;
        console.log(`[API] out_${deck}.start → ${result.slice(0,60).trim()}`);
      }
      saveState();
      clearInterval(startupInterval);
      console.log(`[API] ✅ All 4 deck streams are LIVE on Icecast`);
    } catch (err) {
      if (startupAttempts >= 20) {
        console.error(`[API] ❌ Could not start outputs after 20 attempts. Check Liquidsoap logs.`);
        clearInterval(startupInterval);
      }
    }
  }, 3000); // retry every 3s
});
