# SonicBeat Radio - Liquidsoap 2.x compatible
%include "settings.liq"

icecast_host = getenv("ICECAST_HOST")
icecast_port = int_of_string(getenv("ICECAST_PORT"))
icecast_password = getenv("ICECAST_SOURCE_PASSWORD")
upload_dir = getenv("UPLOAD_DIR")
harbor_port = int_of_string(optional.get(default="8005", getenv("LIQ_HARBOR_PORT")))

def make_channel(name, mountpoint) =
  # 1. Harbor Input (receives live broadcast from server.js/ffmpeg)
  # Mounts: live/deck-a, live/deck-b, etc.
  live = input.harbor(
    "live/deck-#{string.case.lower(name)}",
    port=harbor_port,
    password=icecast_password
  )

  # 2. AutoDJ: shuffle all files in uploads dir
  autodj = playlist(
    id="autodj_#{name}",
    mode="random",
    reload=30,
    upload_dir
  )

  # 3. Combine with Fallback
  # Prioritize live broadcast, then AutoDJ, then silence
  radio = fallback(
    id="radio_#{name}",
    track_sensitive=false,
    [live, autodj, blank()]
  )

  # 4. Output to Icecast
  output.icecast(
    %mp3(bitrate=128, stereo=true),
    id="out_#{name}",
    host=icecast_host,
    port=icecast_port,
    password=icecast_password,
    mount=mountpoint,
    name="SonicBeat Deck #{name}",
    description="SonicBeat Radio - Channel #{name}",
    public=false,
    radio
  )
end

make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
