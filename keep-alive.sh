#!/bin/sh
while true; do
  cd /home/z/my-project
  PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js 2>&1
  echo "Server crashed at $(date), restarting in 2s..." >&2
  sleep 2
done
