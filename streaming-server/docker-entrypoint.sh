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

# Icecast refuses to run as root — create icecast user if not exists
# and fix ownership of required dirs
if ! id icecast2 >/dev/null 2>&1; then
  adduser --system --group --no-create-home icecast2 || true
fi
chown -R icecast2:icecast2 /var/log/icecast2 /etc/icecast2 2>/dev/null || true

exec /usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf
