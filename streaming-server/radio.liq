# ============================================================
# SonicBeat Radio — Resilient Liquidsoap 2.1.x
# ============================================================

set("log.level", 3)
set("log.stdout", true)

# IMPORTANT: Don't crash if playlist directory is initially empty or files are bad
set("request.grace_time", 2.)

# ── Telnet Control Server ────────────────────────────────────────────────────
set("server.telnet", true)
set("server.telnet.bind_addr", "0.0.0.0")
set("server.telnet.port", 1234)

# ── Environment Variables ────────────────────────────────────────────────────
icecast_host     = getenv("ICECAST_HOST")
icecast_port_str = getenv("ICECAST_PORT")
icecast_port     = if icecast_port_str == "" then 8000 else int_of_string(icecast_port_str) end
icecast_password = getenv("ICECAST_SOURCE_PASSWORD")
upload_dir_env   = getenv("UPLOAD_DIR")
upload_dir       = if upload_dir_env == "" then "/data/uploads" else upload_dir_env end
harbor_port      = 8005

# ── Dynamic channel constructor ──────────────────────────────────────────────
def make_channel(name, mountpoint) =
  # 1. Harbor input (microphone/live dj)
  mic = input.harbor(
    "/mic/deck-#{string.lowercase(name)}",
    port     = harbor_port,
    password = icecast_password,
    buffer   = 0.5,
    max      = 2.0
  )

  # 2. Announcement queue
  announcements = request.queue(id="ann_#{name}")

  # 3. Explicit track queue
  track_q = request.queue(id="q_#{name}")

  # 4. AutoDJ (random files from upload dir)
  autodj = playlist(
    id     = "autodj_#{name}",
    mode   = "random",
    reload = 10,
    upload_dir
  )

  # Fallback: queue > autodj > silence
  music_base = fallback(track_sensitive=false, [track_q, autodj, blank(id="blank_#{name}")])

  # Volume control through amplify (for ducking the music during mic/announcements)
  vol = interactive.float("vol_#{name}", 1.)
  music_amp = amplify(vol, music_base)

  # Final mix
  radio = add(id="mix_#{name}", [music_amp, announcements, mic])

  # Output to Icecast gracefully (fallible = true ensures liquidsoap doesn't crash if icecast isn't ready)
  output.icecast(
    %mp3(bitrate=128),
    id            = "out_#{name}",
    host          = icecast_host,
    port          = icecast_port,
    password      = icecast_password,
    mount         = mountpoint,
    name          = "SonicBeat Deck #{name}",
    description   = "SonicBeat Radio — Deck #{name}",
    public        = false,
    fallible      = true,
    restart       = true,
    restart_delay = 3,
    radio
  )
end

# Build the 4 decks
make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
