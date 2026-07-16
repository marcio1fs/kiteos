#!/bin/bash
cd /home/z/my-project
export NODE_OPTIONS="--max-old-space-size=256"

# Start dev server in background
npx next dev --turbopack --port 3000 --hostname 0.0.0.0 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to be ready
sleep 5

# Keep-alive loop
while kill -0 $SERVER_PID 2>/dev/null; do
  curl -s -o /dev/null http://localhost:3000/ 2>/dev/null
  sleep 2
done

echo "Server died, restarting in 3s..."
sleep 3
exec "$0"
