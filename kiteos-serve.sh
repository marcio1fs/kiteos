#!/bin/bash
# KiteOS Server - Auto-restart daemon with env protection
trap "" SIGHUP SIGTERM

cd /home/z/my-project

# Fix .env if needed
bash ensure-env.sh

# Start server
while true; do
  npx next dev -p 3000 --hostname 0.0.0.0 2>&1
  echo "[$(date)] Server exited, restarting in 2s..." >> /tmp/kiteos-restarts.log
  sleep 2
done
