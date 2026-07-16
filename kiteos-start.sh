#!/bin/bash
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=256"
while true; do
  npx next dev --turbopack --port 3000 --hostname 0.0.0.0 2>&1
  echo "[$(date)] Server exited, restarting in 2s..." >> /tmp/kiteos-restarts.log
  sleep 2
done
