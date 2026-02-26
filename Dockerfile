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

# Use the nginx.conf from the repo (editable without rebuilding image internals)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
