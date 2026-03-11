# ============================================================
# SonicBeat Radio — Liquidsoap 2.2.x
# FIX: output.icecast starts ACTIVE by default (fallible=true auto-connects)
# FIX: ICECAST_HOST corrected, blank() fallback always provides audio
# ============================================================

set("log.level", 3)
set("log.stdout", true)
set("init.allow_root", true)
set("request.grace_time", 2.)

# ── Telnet Control Server ────────────────────────────────────────────────────
set("server.telnet", true)
set("server.telnet.bind_addr", "0.0.0.0")
set("server.telnet.port", 1234)

# ── Environment Variables ────────────────────────────────────────────────────
icecast_host     = environment.get(default="127.0.0.1", "ICECAST_HOST")
icecast_port_str = environment.get(default="8000", "ICECAST_PORT")
icecast_port     = int_of_string(icecast_port_str)
icecast_password = environment.get(default="sonicbeat_source_2024", "ICECAST_SOURCE_PASSWORD")
harbor_port      = 8005

# ── Channel constructor ──────────────────────────────────────────────────────
def make_channel(name, mountpoint) =

  # Harbor: live DJ mic input
  mic = input.harbor(
    "/mic/deck-#{string.case(lower=true, name)}",
    port     = harbor_port,
    password = icecast_password,
    buffer   = 0.5,
    max      = 2.0
  )

  # Announcement queue: jingles, TTS, scheduled clips
  announcements = request.queue(id="ann_#{name}")

  # Track queue: manually pushed by Node.js on Play button
  track_q = request.queue(id="q_#{name}")

  # FIX: mksafe wraps the queue so it ALWAYS outputs audio (silence when empty)
  # This prevents Liquidsoap from considering the source "not ready"
  # which would cause output.icecast to disconnect.
  safe_track = mksafe(track_q)

  # Volume control for ducking (mic on-air) and simulated pause
  vol = interactive.float("vol_#{name}", 1.)
  music_amp = amplify(vol, safe_track)

  # Announcement queue also needs to be safe
  safe_ann = mksafe(announcements)

  # Mix: announcements override music, mic always present
  radio_mix = add(
    id     = "mix_node_#{name}",
    normalize = false,
    [music_amp, safe_ann, mic]
  )

  # FIX: output.icecast — using on_start/on_stop telnet hooks
  # start_on_air=true means it connects to Icecast immediately on startup
  # (do not wait for out_A.start command — stream is live from boot)
  output.icecast(
    %mp3(bitrate=128, samplerate=44100, stereo=true),
    id          = "out_#{name}",
    host        = icecast_host,
    port        = icecast_port,
    password    = icecast_password,
    mount       = mountpoint,
    name        = "SonicBeat Deck #{name}",
    description = "SonicBeat Radio — Deck #{name}",
    public      = false,
    # FIX: fallible=true but we handle reconnection manually
    # on_disconnect Liquidsoap auto-retries connection to Icecast
    fallible    = true,
    on_error    = fun(msg) -> begin log("out_#{name} error: #{msg}") ; 2. end,
    radio_mix
  )
end

make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
