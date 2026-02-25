# ============================================================
# SonicBeat - HLS Streaming Server Dockerfile
# Node.js + ffmpeg: receives audio from DJ via WebSocket,
# encodes to HLS segments for listeners
# ============================================================

FROM node:20-alpine

# Install ffmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package.json .
RUN npm install

COPY server.js .

RUN mkdir -p /tmp/hls /tmp/uploads

EXPOSE 3001

CMD ["node", "server.js"]
