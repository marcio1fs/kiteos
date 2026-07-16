#!/bin/bash
cd /home/z/my-project/.next/standalone
cp /home/z/my-project/.env .env 2>/dev/null
while true; do
  echo "Starting server..."
  NODE_ENV=production node server.js
  echo "Server crashed, restarting in 3s..."
  sleep 3
done
