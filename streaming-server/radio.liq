# SonicBeat Radio - Liquidsoap 2.x compatible
%include "settings.liq"

icecast_host = getenv("ICECAST_HOST")
icecast_port = int_of_string(getenv("ICECAST_PORT"))
icecast_password = getenv("ICECAST_SOURCE_PASSWORD")
upload_dir = getenv("UPLOAD_DIR")

def make_channel(name, mountpoint) =
  # AutoDJ: shuffle all files in uploads dir
  autodj = playlist(
    id="autodj_#{name}",
    mode="random",
    reload=30,
    upload_dir
  )

  # Silence fallback when library is empty
  safe = fallback(
    id="safe_#{name}",
    track_sensitive=false,
    [autodj, blank()]
  )

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
    safe
  )
end

make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
