# SonicBeat Radio - Liquidsoap 2.x compatible
%include "settings.liq"

icecast_host = getenv("ICECAST_HOST")
icecast_port = int_of_string(getenv("ICECAST_PORT"))
icecast_password = getenv("ICECAST_SOURCE_PASSWORD")
upload_dir = getenv("UPLOAD_DIR")
harbor_port = int_of_string(optional.get(default="8005", getenv("LIQ_HARBOR_PORT")))

def make_channel(name, mountpoint) =
  # 1. Harbor Input: Only for Microphone injection now
  mic = input.harbor(
    "mic/deck-#{string.case.lower(name)}",
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

  # 5. Main Music Path: prioritize Track Queue -> AutoDJ
  #    We wrap it in an amplifier so Node.js can mute/unmute it (Play/Pause)
  music_base = fallback(track_sensitive=false, [track_q, autodj, blank()])
  music_amp = amplify(id="amp_music_#{name}", 1., music_base)

  # 6. Final Mix
  #    We add the microphone and announcements over the music.
  #    Liquidsoap handles overlapping automatically (it just sums the audio).
  radio = add([music_amp, announcements, mic])

  # 7. Output to Icecast
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
