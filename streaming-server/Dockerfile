# ============================================================
# SonicBeat Streaming Server
# Based on official Liquidsoap image (includes ffmpeg)
# Adds: Icecast2 + Node.js API
# ============================================================
FROM savonet/liquidsoap:v2.2.5

USER root

# Install Icecast2, Node.js, supervisor
RUN apt-get update && apt-get install -y --no-install-recommends \
    icecast2 \
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

EXPOSE 3001 8000

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

CMD ["/docker-entrypoint.sh"]
