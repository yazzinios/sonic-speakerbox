# SonicBeat Radio - Liquidsoap 2.x compatible
%include "/app/settings.liq"

# Read env vars with safe defaults to prevent fatal errors
icecast_host = getenv("ICECAST_HOST")
icecast_port_str = getenv("ICECAST_PORT")
icecast_port = if icecast_port_str == "" then 8000 else int_of_string(icecast_port_str) end
icecast_password = getenv("ICECAST_SOURCE_PASSWORD")
upload_dir_env = getenv("UPLOAD_DIR")
upload_dir = if upload_dir_env == "" then "/data/uploads" else upload_dir_env end
harbor_port = 8005

def make_channel(name, mountpoint) =
  # 1. Harbor Input: Microphone injection only
  mic = input.harbor(
    "/mic/deck-#{string.case.lower(name)}",
    port=harbor_port,
    password=icecast_password
  )

  # 2. Announcement Queue
  announcements = request.queue(id="ann_#{name}")

  # 3. Dedicated Track Queue (for explicit Loads)
  track_q = request.queue(id="q_#{name}")

  # 4. AutoDJ: shuffle all files in uploads dir
  autodj = playlist(
    id="autodj_#{name}",
    mode="random",
    reload=30,
    upload_dir
  )

  # 5. Music Path: Track Queue -> AutoDJ -> silence
  music_base = fallback(track_sensitive=false, [track_q, autodj, blank()])
  music_amp = amplify(id="amp_music_#{name}", 1., music_base)

  # 6. Final Mix
  radio = add([music_amp, announcements, mic])

  # 7. Output to Icecast — restart on connection error
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
    on_error=fun(_) -> 5.,
    radio
  )
end

make_channel("A", "deck-a")
make_channel("B", "deck-b")
make_channel("C", "deck-c")
make_channel("D", "deck-d")
