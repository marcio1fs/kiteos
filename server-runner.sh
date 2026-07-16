#!/bin/bash
cd /home/z/my-project
while true; do
  echo "[$(date)] Starting Next.js dev server..."
  npx next dev --port 3000 --hostname 0.0.0.0 2>&1
  echo "[$(date)] Server died, restarting in 5s..."
  sleep 5
done
