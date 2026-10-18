# Builds the SPA and writes the static output to the /out bind mount at container start.
# This image is not meant to run as a long-lived server itself — see
# deploy/self-hosted/docker-compose.yml, where Caddy serves the files this writes out and
# this container exits immediately after (service_completed_successfully).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Vite inlines VITE_* vars into the bundle at build time, so the self-hoster's public domain
# must be known before this RUN, not at container start.
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN npm run build

FROM alpine:3.20
COPY --from=build /app/dist /app-dist
CMD ["sh", "-c", "rm -rf /out/* && cp -r /app-dist/. /out/"]
