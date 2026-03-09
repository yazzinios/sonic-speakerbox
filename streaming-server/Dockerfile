# ============================================================
# SonicBeat Streaming Server
# ============================================================
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install all required dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    icecast2 \
    liquidsoap \
    liquidsoap-plugin-lame \
    ffmpeg \
    supervisor \
    nodejs \
    npm \
    curl \
    gettext-base \
    espeak \
    wget \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Icecast system user
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

# Ensure dirs exist and set permissions
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
