#!/bin/bash
cd /home/z/my-project/.next/standalone
while true; do
  NODE_ENV=production node --max-old-space-size=512 server.js 2>&1
  EXIT=$?
  echo "[$(date)] Server exited with code $EXIT, restarting in 3s..."
  sleep 3
done
