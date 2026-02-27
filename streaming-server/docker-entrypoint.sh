#!/bin/sh
set -e

export ICECAST_HOST=${ICECAST_HOST:-localhost}
export ICECAST_PORT=${ICECAST_PORT:-8000}
export ICECAST_SOURCE_PASSWORD=${ICECAST_SOURCE_PASSWORD:-sonicbeat_source}
export ICECAST_ADMIN_PASSWORD=${ICECAST_ADMIN_PASSWORD:-sonicbeat_admin}
export UPLOAD_DIR=${UPLOAD_DIR:-/data/uploads}

# Generate icecast config
envsubst '${ICECAST_HOST} ${ICECAST_SOURCE_PASSWORD} ${ICECAST_ADMIN_PASSWORD}' \
  < /app/icecast.xml.template \
  > /etc/icecast2/icecast.xml

chown icecast2:icecast2 /etc/icecast2/icecast.xml

echo "[Entrypoint] Icecast config written"
mkdir -p "${UPLOAD_DIR}" /data/announcements

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
