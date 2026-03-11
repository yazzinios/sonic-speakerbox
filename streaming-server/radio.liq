# ============================================================
# SonicBeat Radio — Liquidsoap 2.2.5
# FIXED: on_error syntax, mksafe, output auto-connect on boot
# ============================================================

set("log.level", 3)
set("log.stdout", true)
set("init.allow_root", true)
set("request.grace_time", 2.)

# ── Telnet ───────────────────────────────────────────────────────────────────
set("server.telnet", true)
set("server.telnet.bind_addr", "0.0.0.0")
set("server.telnet.port", 1234)

# ── Env vars ─────────────────────────────────────────────────────────────────
icecast_host     = environment.get(default="127.0.0.1", "ICECAST_HOST")
icecast_port_str = environment.get(default="8000",      "ICECAST_PORT")
icecast_port     = int_of_string(icecast_port_str)
icecast_password = environment.get(default="sonicbeat_source_2024", "ICECAST_SOURCE_PASSWORD")
harbor_port      = 8005

# ── Per-deck channel ─────────────────────────────────────────────────────────
def make_channel(name, mountpoint) =

  # Harbor: live DJ mic / browser audio
  mic = input.harbor(
    "/mic/deck-#{string.case(lower=true, name)}",
    port     = harbor_port,
    password = icecast_password,
    buffer   = 0.5,
    max      = 2.0
  )

  # Announcement queue (jingles, TTS, scheduled clips)
  announcements = request.queue(id="ann_#{name}")

  # Track queue (pushed by Node.js on Play button)
  track_q = request.queue(id="q_#{name}")

  # mksafe: wraps queue so it always outputs silence when empty.
  # Without this, Liquidsoap considers the source "unavailable" and
  # output.icecast disconnects from Icecast entirely.
  safe_track = mksafe(track_q)
  safe_ann   = mksafe(announcements)

  # Volume control: ducking (mic on-air = 0.05) and simulated pause (= 0.0)
  vol       = interactive.float("vol_#{name}", 1.)
  music_amp = amplify(vol, safe_track)

  # Final mix — normalize=false prevents unexpected volume jumps
  radio_mix = add(
    id        = "mix_node_#{name}",
    normalize = false,
    [music_amp, safe_ann, mic]
  )

  # Icecast output
  # fallible=false: Liquidsoap will KEEP retrying to connect to Icecast
  # automatically on boot and after any disconnection.
  # This is the most reliable option — no manual out_X.start needed.
  output.icecast(
    %mp3(bitrate=128, samplerate=44100, stereo=true),
    id          = "out_#{name}",
    host        = icecast_host,
    port        = icecast_port,
    password    = icecast_password,
    mount       = mountpoint,
    name        = "SonicBeat Deck #{name}",
    description = "SonicBeat Radio Deck #{name}",
    public      = false,
    fallible    = false,
    radio_mix
  )
end

make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
