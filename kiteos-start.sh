#!/bin/bash
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=256"
while true; do
  NODE_ENV=production node .next/standalone/server.js 2>&1
  echo "[$(date)] Server exited, restarting in 2s..." >> /tmp/kiteos-restarts.log
  sleep 2
done
