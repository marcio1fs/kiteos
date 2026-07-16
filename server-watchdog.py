#!/usr/bin/env python3
"""
KiteOS Server Watchdog - monitors and restarts the Node.js server.
Designed to be started as a persistent daemon via the ZAI service or cron.

Usage:
  python3 /home/z/my-project/server-watchdog.py &
"""
import subprocess
import os
import time
import signal
import sys
import json

PIDFILE = "/tmp/kiteos-node.pid"
WATCHDOG_PIDFILE = "/tmp/kiteos-watchdog.pid"
LOGFILE = "/tmp/kiteos-watchdog.log"
SERVER_DIR = "/home/z/my-project/.next/standalone"
ENV_FILE = "/home/z/my-project/.env"

def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with open(LOGFILE, 'a') as f:
            f.write(line + "\n")
    except:
        pass

def ensure_env():
    """Make sure .env has JWT_SECRET"""
    try:
        with open(ENV_FILE, 'r') as f:
            content = f.read()
        changed = False
        if "JWT_SECRET" not in content:
            content += "\nJWT_SECRET=k1te0s-s3cur3-jwt-pr0duct10n-2024-z-s3cr3t-k3y\n"
            changed = True
        if "NEXTAUTH_SECRET" not in content:
            content += "NEXTAUTH_SECRET=k1te0s-s3cur3-nextauth-2024-z-s3cr3t-k3y\n"
            changed = True
        if changed:
            with open(ENV_FILE, 'w') as f:
                f.write(content)
            log("Updated .env with JWT_SECRET/NEXTAUTH_SECRET")
    except Exception as e:
        log(f"Error updating .env: {e}")

def is_server_running():
    """Check if the Node.js server is running and responding"""
    # Check PID file
    try:
        with open(PIDFILE, 'r') as f:
            pid = int(f.read().strip())
        # Check if process exists
        os.kill(pid, 0)
        # Check if it responds to HTTP
        import urllib.request
        try:
            req = urllib.request.Request('http://localhost:3000/', method='GET')
            urllib.request.urlopen(req, timeout=5)
            return True
        except:
            return False
    except:
        return False

def start_server():
    """Start the Node.js server"""
    env = os.environ.copy()
    env["PORT"] = "3000"
    env["HOSTNAME"] = "0.0.0.0"
    env["NODE_ENV"] = "production"

    log("Starting Node.js server...")
    try:
        proc = subprocess.Popen(
            ["node", "server.js"],
            cwd=SERVER_DIR,
            env=env,
            stdout=open('/tmp/kiteos-server-stdout.log', 'w'),
            stderr=subprocess.STDOUT,
            preexec_fn=os.setpgrp,
            close_fds=True
        )
        with open(PIDFILE, 'w') as f:
            f.write(str(proc.pid))
        log(f"Server started with PID {proc.pid}")
        return proc.pid
    except Exception as e:
        log(f"Error starting server: {e}")
        return None

def cleanup(signum=None, frame=None):
    log("Watchdog shutting down...")
    try:
        os.remove(WATCHDOG_PIDFILE)
    except:
        pass
    sys.exit(0)

def main():
    signal.signal(signal.SIGTERM, cleanup)
    signal.signal(signal.SIGINT, cleanup)

    # Write watchdog PID
    with open(WATCHDOG_PIDFILE, 'w') as f:
        f.write(str(os.getpid()))

    ensure_env()
    log("KiteOS Server Watchdog starting...")

    # Check if server is already running
    if is_server_running():
        log("Server is already running")
    else:
        start_server()
        time.sleep(3)
        if is_server_running():
            log("Server started successfully")
        else:
            log("Server failed to start")

    # Main monitoring loop
    check_interval = 10  # seconds between checks
    while True:
        time.sleep(check_interval)
        if not is_server_running():
            log("Server is down! Restarting...")
            # Kill any lingering node processes on port 3000
            try:
                subprocess.run(["fuser", "-k", "3000/tcp"], capture_output=True, timeout=5)
            except:
                pass
            time.sleep(2)
            ensure_env()
            start_server()
            time.sleep(5)
            if is_server_running():
                log("Server restarted successfully")
            else:
                log("Server restart failed, will retry next cycle")

if __name__ == "__main__":
    main()
