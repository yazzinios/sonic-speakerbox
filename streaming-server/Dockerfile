# ============================================================
# SonicBeat Streaming Server
# ============================================================
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# ── 1. Base system deps (no liquidsoap from apt — not in bookworm) ────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    icecast2 \
    ffmpeg \
    supervisor \
    curl \
    wget \
    gnupg \
    gettext-base \
    espeak \
    procps \
    libev4 \
    libmp3lame0 \
    libopus0 \
    libvorbis0a \
    libvorbisenc2 \
    libavcodec60 \
    libavformat60 \
    libswresample4 \
    && rm -rf /var/lib/apt/lists/*

# ── 2. Node.js 20 LTS via NodeSource ─────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# ── 3. Liquidsoap 2.2.5 — official .deb from Savonet releases ────────────────
RUN ARCH=$(dpkg --print-architecture) \
    && wget -q "https://github.com/savonet/liquidsoap/releases/download/v2.2.5/liquidsoap_2.2.5-debian-bookworm-1_${ARCH}.deb" \
         -O /tmp/liquidsoap.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/liquidsoap.deb \
    && rm /tmp/liquidsoap.deb \
    && rm -rf /var/lib/apt/lists/*

# ── 4. Icecast system user ────────────────────────────────────────────────────
RUN addgroup --system icecast2 2>/dev/null || true && \
    adduser --system --ingroup icecast2 --no-create-home icecast2 2>/dev/null || true

WORKDIR /app

COPY package.json .
RUN npm install

COPY server.js .
COPY radio.liq .
COPY settings.liq .
COPY icecast.xml.template .
COPY supervisord.conf /etc/supervisor/conf.d/sonicbeat.conf

# ── 5. Runtime directories and permissions ────────────────────────────────────
RUN mkdir -p /data/uploads /data/announcements /tmp/hls \
    && mkdir -p /var/log/supervisor \
    && mkdir -p /var/log/icecast2 \
    && chown -R icecast2:icecast2 /var/log/icecast2 \
    && chmod 777 /data/uploads \
    && chmod 777 /data/announcements

EXPOSE 3001 8000 8005

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
