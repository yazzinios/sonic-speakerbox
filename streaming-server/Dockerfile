FROM node:20-alpine

# Install ffmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json .
RUN npm install

COPY server.js .

RUN mkdir -p /tmp/hls

EXPOSE 3001

CMD ["node", "server.js"]
