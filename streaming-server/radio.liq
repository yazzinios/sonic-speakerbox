# ============================================================
# SonicBeat Radio — Resilient Liquidsoap 2.1.x
# v2: No auto-play, loop support, jingle via announcement queue
# ============================================================

set("log.level", 3)
set("log.stdout", true)
set("init.allow_root", true)

# Don't crash if files are bad or missing
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

  # 1. Harbor input — live DJ mic/broadcast via WebSocket → ffmpeg → harbor
  mic = input.harbor(
    "/mic/deck-#{string.case(lower=true, name)}",
    port     = harbor_port,
    password = icecast_password,
    buffer   = 0.5,
    max      = 2.0
  )

  # 2. Announcement queue — used for jingles, TTS, scheduled announcements
  #    Jingle is pushed here by /jingle/play so listeners hear it through the stream
  announcements = request.queue(id="ann_#{name}")

  # 3. Explicit track queue — DJ pushes tracks here manually via Play button
  #    Node.js also uses q_#{name}.length to detect when a track ends (for loop)
  track_q = request.queue(id="q_#{name}")

  # 4. Silence fallback — plays when queue is empty (no AutoDJ folder)
  #    This intentionally does NOT auto-load tracks from the upload folder.
  #    The DJ must explicitly press Play to load a track.
  music_base = fallback(
    track_sensitive=false,
    [track_q, blank(id="blank_#{name}")]
  )

  # 5. Volume control — used for:
  #    - Ducking music to 5% when mic is ON AIR
  #    - Simulating pause (set to 0)
  #    - Restoring to 100% after mic goes OFF AIR
  vol = interactive.float("vol_#{name}", 1.)
  music_amp = amplify(vol, music_base)

  # 6. Final mix — priority order: announcements/jingle > music > silence
  #    mic is always mixed in (at 0 gain when not connected)
  radio_mix = add(
    id="mix_node_#{name}",
    [music_amp, announcements, mic]
  )

  # 7. Icecast output — fallible=true means it won't crash if Icecast is down
  #    out_#{name}.start / out_#{name}.stop controlled via telnet
  output.icecast(
    %mp3(bitrate=128),
    id          = "out_#{name}",
    host        = icecast_host,
    port        = icecast_port,
    password    = icecast_password,
    mount       = mountpoint,
    name        = "SonicBeat Deck #{name}",
    description = "SonicBeat Radio — Deck #{name} (v2)",
    public      = false,
    fallible    = true,
    radio_mix
  )
end

# ── Build 4 isolated deck channels ───────────────────────────────────────────
# Each deck is completely independent:
#   - Separate Icecast mount (/deck-a, /deck-b, /deck-c, /deck-d)
#   - Separate track queue (q_A, q_B, q_C, q_D)
#   - Separate volume control (vol_A, vol_B, vol_C, vol_D)
#   - Separate announcement queue (ann_A, ann_B, ann_C, ann_D)
#   - Separate harbor input for live mic (deck-a, deck-b, deck-c, deck-d)
make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
