#!/bin/sh
set -e

# Generate icecast config from template with env vars substituted
export ICECAST_HOST=${ICECAST_HOST:-localhost}
export ICECAST_PORT=${ICECAST_PORT:-8000}
export ICECAST_SOURCE_PASSWORD=${ICECAST_SOURCE_PASSWORD:-sonicbeat_source}
export ICECAST_ADMIN_PASSWORD=${ICECAST_ADMIN_PASSWORD:-sonicbeat_admin}
export UPLOAD_DIR=${UPLOAD_DIR:-/data/uploads}

envsubst '${ICECAST_HOST} ${ICECAST_SOURCE_PASSWORD} ${ICECAST_ADMIN_PASSWORD}' \
  < /app/icecast.xml.template \
  > /etc/icecast2/icecast.xml

echo "[Entrypoint] Icecast config written"
echo "[Entrypoint] Source password: ${ICECAST_SOURCE_PASSWORD}"
echo "[Entrypoint] Upload dir: ${UPLOAD_DIR}"

mkdir -p "${UPLOAD_DIR}" /data/announcements

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
