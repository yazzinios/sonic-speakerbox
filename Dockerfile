# ---- Build Stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# ENV variables for build
ARG VITE_SUPABASE_PROJECT_ID=iaedzkkysscmzsqccftn
ARG VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_8Kz-I1-eCI0y1boM0mhqVw_NXJf4dqa
ARG VITE_SUPABASE_URL=https://iaedzkkysscmzsqccftn.supabase.co

ENV VITE_SUPABASE_PROJECT_ID=$VITE_SUPABASE_PROJECT_ID
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL

RUN npm run build

# ---- Production Stage ----
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
