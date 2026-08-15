#!/bin/bash
# KiteOS Server - Auto-restart daemon with env protection
cd /home/z/my-project

# Fix .env if needed
bash ensure-env.sh

# Start server
while true; do
  NODE_ENV=production node .next/standalone/server.js 2>&1
  echo "[$(date)] Server exited, restarting in 2s..." >> /tmp/kiteos-restarts.log
  sleep 2
done
