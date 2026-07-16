#!/bin/bash
# Ensure JWT_SECRET and other critical env vars are in .env
# The container's /start.sh overwrites .env with only DATABASE_URL
# This script adds back the missing variables

ENV_FILE="/home/z/my-project/.env"

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}

# Check if JWT_SECRET exists in .env
if ! grep -q "^JWT_SECRET=" "$ENV_FILE" 2>/dev/null; then
  echo "JWT_SECRET=$(generate_secret)" >> "$ENV_FILE"
  echo "[$(date)] Added JWT_SECRET to .env" >> /tmp/env-fix.log
fi

if ! grep -q "^NEXTAUTH_SECRET=" "$ENV_FILE" 2>/dev/null; then
  echo "NEXTAUTH_SECRET=$(generate_secret)" >> "$ENV_FILE"
  echo "[$(date)] Added NEXTAUTH_SECRET to .env" >> /tmp/env-fix.log
fi
