# ============================================================
# SonicBeat Streaming Server
# Runs: Icecast2 + Liquidsoap + Node.js API via supervisor
# ============================================================
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Install all dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    icecast2 \
    liquidsoap \
    ffmpeg \
    supervisor \
    nodejs \
    npm \
    curl \
    gettext-base \
    && rm -rf /var/lib/apt/lists/*

# Create icecast user/group so icecast2 doesn't refuse to start
RUN addgroup --system icecast2 || true && \
    adduser --system --ingroup icecast2 --no-create-home icecast2 || true

WORKDIR /app

COPY package.json .
RUN npm install

COPY server.js .
COPY radio.liq .
COPY settings.liq .
COPY icecast.xml.template .
COPY supervisord.conf /etc/supervisor/conf.d/sonicbeat.conf

RUN mkdir -p /data/uploads /data/announcements /tmp/hls \
    && mkdir -p /var/log/supervisor \
    && mkdir -p /var/log/icecast2 \
    && chown -R icecast2:icecast2 /var/log/icecast2

EXPOSE 3001 8000

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
