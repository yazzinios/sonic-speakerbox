# ============================================================
# SonicBeat Radio - Liquidsoap Script
# 4 independent channels (A/B/C/D)
# Each channel: AutoDJ shuffle -> live DJ override -> Icecast
# ============================================================

settings.log.level.set(3)
settings.log.file.set("")
settings.init.daemon.set(false)

icecast_host = getenv("ICECAST_HOST")
icecast_port = int_of_string(getenv("ICECAST_PORT"))
icecast_password = getenv("ICECAST_SOURCE_PASSWORD")
upload_dir = getenv("UPLOAD_DIR")

# Telnet server so Node.js API can send commands (skip, status, etc.)
settings.server.telnet.set(true)
settings.server.telnet.bind_addr.set("0.0.0.0")
settings.server.telnet.port.set(1234)

# Silence fallback when library is empty
silence = blank(id="silence")

def make_channel(name, mountpoint) =
  # AutoDJ: shuffle all files in uploads dir, reload every 30 tracks
  autodj = playlist(
    id="autodj_#{name}",
    mode="randomize",
    reload=30,
    reload_mode="rounds",
    upload_dir
  )

  # Live input: DJ pushes audio via HTTP to /live/deck-a (etc.) on port 8005
  live = input.harbor(
    id="live_#{name}",
    "live/deck-#{string.lowercase(name)}",
    port=8005,
    auth=fun(~address, ~login, ~password) -> password == icecast_password
  )

  # Priority stack: live > autodj > silence
  radio = fallback(
    id="radio_#{name}",
    track_sensitive=false,
    [live, autodj, silence]
  )

  radio = normalize(id="norm_#{name}", radio)

  output.icecast(
    %mp3(bitrate=128, stereo=true),
    id="out_#{name}",
    host=icecast_host,
    port=icecast_port,
    password=icecast_password,
    mount=mountpoint,
    name="SonicBeat Deck #{name}",
    description="SonicBeat Radio - Channel #{name}",
    public=true,
    radio
  )
end

make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
