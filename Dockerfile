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

# Write nginx config at build time using a heredoc so it's always fresh
RUN printf 'server {\n\
    listen 80;\n\
    server_name _;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    resolver 127.0.0.11 valid=30s ipv6=off;\n\
\n\
    location / {\n\
        try_files $uri $uri/ /index.html;\n\
    }\n\
\n\
    location /hls/ {\n\
        set $hls http://hls-server:3001;\n\
        proxy_pass $hls/hls/;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
        add_header Cache-Control no-cache;\n\
        add_header Access-Control-Allow-Origin *;\n\
    }\n\
\n\
    location /status {\n\
        set $hls http://hls-server:3001;\n\
        proxy_pass $hls/status;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Host $host;\n\
        add_header Access-Control-Allow-Origin *;\n\
    }\n\
\n\
    location /ws {\n\
        set $hls http://hls-server:3001;\n\
        proxy_pass $hls;\n\
        proxy_http_version 1.1;\n\
        proxy_set_header Upgrade $http_upgrade;\n\
        proxy_set_header Connection "upgrade";\n\
        proxy_set_header Host $host;\n\
        proxy_read_timeout 3600s;\n\
        proxy_send_timeout 3600s;\n\
    }\n\
\n\
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {\n\
        expires 1y;\n\
        add_header Cache-Control "public, immutable";\n\
    }\n\
}\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
