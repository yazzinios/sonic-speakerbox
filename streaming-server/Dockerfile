# ============================================================
# SonicBeat Streaming Server
# Runs 3 services: Icecast2 + Liquidsoap + Node.js API
# ============================================================
FROM debian:bookworm-slim

# Install everything in one layer
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

WORKDIR /app

# Install Node dependencies
COPY package.json .
RUN npm install

# Copy app files
COPY server.js .
COPY radio.liq .
COPY icecast.xml.template .
COPY supervisord.conf /etc/supervisor/conf.d/sonicbeat.conf

# Create data directories
RUN mkdir -p /data/uploads /data/announcements /tmp/hls \
    && mkdir -p /var/log/supervisor \
    && mkdir -p /var/log/icecast2

# Expose ports
# 3001 = Node API (proxied by nginx as /api/)
# 8000 = Icecast (proxied by nginx as /stream/)
# 8005 = Liquidsoap harbor (internal only)
# 1234 = Liquidsoap telnet (internal only)
EXPOSE 3001 8000

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
