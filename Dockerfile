# ---- Build Stage ----
FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

ARG VITE_SUPABASE_PROJECT_ID=iaedzkkysscmzsqccftn
ARG VITE_SUPABASE_PUBLISHABLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhZWR6a2t5c3NjbXpzcWNjZnRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwMTkzNjEsImV4cCI6MjA4NzU5NTM2MX0.-sxVzHBLlSvofDvN73_0KkfT5Hc8waoeEKP7AdlYWps
ARG VITE_SUPABASE_URL=https://iaedzkkysscmzsqccftn.supabase.co

ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL

RUN npm run build

# ---- Production Stage ----
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    resolver 127.0.0.11 valid=30s ipv6=off;\n\
\n\
    # Node.js REST API\n\
    location /api/ {\n\
        set $backend http://radio-server:3001;\n\
        proxy_pass $backend/;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        proxy_read_timeout 300s;\n\
        proxy_send_timeout 300s;\n\
        client_max_body_size 512m;\n\
        add_header Access-Control-Allow-Origin * always;\n\
        add_header Access-Control-Allow-Methods "GET, POST, DELETE, OPTIONS" always;\n\
        add_header Access-Control-Allow-Headers "Content-Type" always;\n\
        if ($request_method = OPTIONS) { return 204; }\n\
    }\n\
\n\
    # Icecast streams — /stream/deck-a etc.\n\
    location /stream/ {\n\
        set $icecast http://radio-server:8000;\n\
        proxy_pass $icecast/;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
        proxy_set_header X-Real-IP $remote_addr;\n\
        # Critical for audio streaming — disable buffering\n\
        proxy_buffering off;\n\
        proxy_cache off;\n\
        add_header Cache-Control no-cache;\n\
        add_header Access-Control-Allow-Origin * always;\n\
    }\n\
\n\
    # Icecast admin panel (optional)\n\
    location /icecast/ {\n\
        set $icecast http://radio-server:8000;\n\
        proxy_pass $icecast/;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
    }\n\
\n\
    # WebSocket for live DJ broadcast\n\
    location /ws {\n\
        set $backend http://radio-server:3001;\n\
        proxy_pass $backend;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Upgrade $http_upgrade;\n\
        proxy_set_header Connection "upgrade";\n\
        proxy_set_header Host $host;\n\
        proxy_read_timeout 3600s;\n\
        proxy_send_timeout 3600s;\n\
    }\n\
\n\
    # React SPA\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
\n\
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
