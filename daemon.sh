#!/bin/bash
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=256"
while true; do
  NODE_ENV=production node .next/standalone/server.js 2>&1
  sleep 2
done
