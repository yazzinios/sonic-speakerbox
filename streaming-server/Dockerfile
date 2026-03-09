# ============================================================
# SonicBeat Streaming Server — resilient build
# ============================================================
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV TZ=UTC

# ── 1. Retry-safe apt config ──────────────────────────────────────────────────
RUN echo 'Acquire::Retries "5";' > /etc/apt/apt.conf.d/80retries \
    && echo 'Acquire::http::Timeout "30";' >> /etc/apt/apt.conf.d/80retries \
    && echo 'Acquire::https::Timeout "30";' >> /etc/apt/apt.conf.d/80retries

# ── 2. Base system deps ───────────────────────────────────────────────────────
RUN apt-get update -o Acquire::CompressionTypes::Order::=gz \
    && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       wget \
       gnupg \
       gettext-base \
       supervisor \
       ffmpeg \
       icecast2 \
       espeak \
       procps \
       libev4 \
       libmp3lame0 \
       libopus0 \
       libvorbis0a \
       libvorbisenc2 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── 3. Node.js 20 LTS ─────────────────────────────────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── 4. Liquidsoap 2.2.5 via Savonet .deb (ubuntu jammy) ──────────────────────
RUN ARCH=$(dpkg --print-architecture) \
    && wget --tries=5 --timeout=60 -q \
       "https://github.com/savonet/liquidsoap/releases/download/v2.2.5/liquidsoap_2.2.5-ubuntu-jammy-1_${ARCH}.deb" \
       -O /tmp/liquidsoap.deb \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/liquidsoap.deb \
    && rm /tmp/liquidsoap.deb \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── 5. Icecast system user ────────────────────────────────────────────────────
RUN addgroup --system icecast2 2>/dev/null || true \
    && adduser --system --ingroup icecast2 --no-create-home icecast2 2>/dev/null || true

# ── 6. App ────────────────────────────────────────────────────────────────────
WORKDIR /app

COPY package.json .
RUN npm install

COPY server.js .
COPY radio.liq .
COPY settings.liq .
COPY icecast.xml.template .
COPY supervisord.conf /etc/supervisor/conf.d/sonicbeat.conf

# ── 7. Runtime dirs ───────────────────────────────────────────────────────────
RUN mkdir -p /data/uploads /data/announcements /tmp/hls \
    && mkdir -p /var/log/supervisor \
    && mkdir -p /var/log/icecast2 \
    && chown -R icecast2:icecast2 /var/log/icecast2 \
    && chmod 777 /data/uploads /data/announcements

EXPOSE 3001 8000 8005

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
