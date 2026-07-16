#!/bin/bash
trap "" SIGHUP SIGTERM
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=256"
while true; do
  npx next dev --turbopack --port 3000 --hostname 0.0.0.0 2>&1
  sleep 2
done
