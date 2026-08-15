#!/bin/bash
# KiteOS Server Daemon - keeps the server alive

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}

# Ensure .env has JWT_SECRET
if ! grep -q "JWT_SECRET" /home/z/my-project/.env; then
  echo "JWT_SECRET=$(generate_secret)" >> /home/z/my-project/.env
fi
if ! grep -q "NEXTAUTH_SECRET" /home/z/my-project/.env; then
  echo "NEXTAUTH_SECRET=$(generate_secret)" >> /home/z/my-project/.env
fi

cd /home/z/my-project/.next/standalone
export PORT=3000
export HOSTNAME=0.0.0.0
export NODE_ENV=production

while true; do
  echo "[$(date)] Starting KiteOS server..." >> /tmp/kiteos-daemon.log
  node server.js >> /tmp/kiteos-daemon.log 2>&1
  EXIT_CODE=$?
  echo "[$(date)] Server exited with code $EXIT_CODE, restarting in 3s..." >> /tmp/kiteos-daemon.log
  sleep 3
done
