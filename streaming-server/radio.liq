# ============================================================
# SonicBeat Radio — Resilient Liquidsoap 2.1.x
# ============================================================

set("log.level", 3)
set("log.stdout", true)
set("init.allow_root", true)

# IMPORTANT: Don't crash if playlist directory is initially empty or files are bad
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
upload_dir_env   = environment.get(default="/data/uploads", "UPLOAD_DIR")
upload_dir       = upload_dir_env
harbor_port      = 8005

# ── Dynamic channel constructor ──────────────────────────────────────────────
def make_channel(name, mountpoint) =
  # 1. Harbor input (microphone/live dj)
  mic = input.harbor(
    "/mic/deck-#{string.case(lower=true, name)}",
    port     = harbor_port,
    password = icecast_password,
    buffer   = 0.5,
    max      = 2.0
  )

  # 2. Announcement queue
  announcements = request.queue(id="ann_#{name}")

  # 3. Explicit track queue
  track_q = request.queue(id="q_#{name}")

  # 4. AutoDJ is now controlled by Node.js pushing to q_#{name}
  # We remove the automatic folder playlist to prevent tracks playing on upload.
  
  # Fallback: queue > silence
  music_base = fallback(track_sensitive=false, [track_q, blank(id="blank_#{name}")])

  # Volume control through amplify (for ducking the music during mic/announcements)
  vol = interactive.float("vol_#{name}", 1.)
  music_amp = amplify(vol, music_base)

  # Final mix
  radio_mix = add(id="mix_node_#{name}", [music_amp, announcements, mic])

  # Output to Icecast gracefully (fallible = true ensures liquidsoap doesn't crash if icecast isn't ready)
  output.icecast(
    %mp3(bitrate=128),
    id            = "out_#{name}",
    host          = icecast_host,
    port          = icecast_port,
    password      = icecast_password,
    mount         = mountpoint,
    name          = "SonicBeat Deck #{name}",
    description   = "SonicBeat Radio — Deck #{name} (Isolated v2.3)",
    public        = false,
    fallible      = true,
    radio_mix
  )
end

# Build the 4 decks
make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
