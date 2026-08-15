#!/bin/bash
cd /home/z/my-project
while true; do
  echo "[$(date)] Starting Next.js dev server..."
  NODE_ENV=production node .next/standalone/server.js 2>&1
  echo "[$(date)] Server died, restarting in 5s..."
  sleep 5
done
