#!/bin/sh
set -e
# `_` = accept any Host (удобно при заходе по публичному IP); иначе: "example.com 1.2.3.4"
export NGINX_SERVER_NAMES="${NGINX_SERVER_NAMES:-_}"
export NGINX_LISTEN_PORT="${NGINX_LISTEN_PORT:-80}"
export NGINX_SSL_LISTEN_PORT="${NGINX_SSL_LISTEN_PORT:-443}"
export SSL_CERTIFICATE_PATH="${SSL_CERTIFICATE_PATH:-/etc/nginx/certs/fullchain.pem}"
export SSL_CERTIFICATE_KEY_PATH="${SSL_CERTIFICATE_KEY_PATH:-/etc/nginx/certs/privkey.pem}"
if [ "${ENABLE_NGINX_SSL:-0}" = "1" ]; then
  envsubst '${NGINX_SERVER_NAMES} ${NGINX_LISTEN_PORT} ${NGINX_SSL_LISTEN_PORT} ${SSL_CERTIFICATE_PATH} ${SSL_CERTIFICATE_KEY_PATH}' \
    < /tmp/nginx-ssl.conf.template > /etc/nginx/conf.d/default.conf
else
  envsubst '${NGINX_SERVER_NAMES} ${NGINX_LISTEN_PORT}' < /tmp/nginx.conf.template > /etc/nginx/conf.d/default.conf
fi
exec "$@"
