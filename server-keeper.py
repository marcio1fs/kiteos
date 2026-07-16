#!/usr/bin/env python3
"""
KiteOS Server Keeper - keeps the Node.js production server running.
Writes PID to /tmp/kiteos-node.pid for external monitoring.
"""
import subprocess
import os
import time
import signal
import sys

PIDFILE = "/tmp/kiteos-node.pid"
LOGFILE = "/tmp/kiteos-server.log"
SERVER_DIR = "/home/z/my-project/.next/standalone"

def ensure_env():
    """Make sure .env has JWT_SECRET"""
    env_path = "/home/z/my-project/.env"
    with open(env_path, 'r') as f:
        content = f.read()
    if "JWT_SECRET" not in content:
        with open(env_path, 'a') as f:
            f.write("\nJWT_SECRET=k1te0s-s3cur3-jwt-pr0duct10n-2024-z-s3cr3t-k3y\n")
    if "NEXTAUTH_SECRET" not in content:
        with open(env_path, 'a') as f:
            f.write("NEXTAUTH_SECRET=k1te0s-s3cur3-nextauth-2024-z-s3cr3t-k3y\n")

def log(msg):
    ts = time.strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with open(LOGFILE, 'a') as f:
            f.write(line + "\n")
    except:
        pass

def cleanup(signum=None, frame=None):
    log("Keeper received signal, cleaning up...")
    try:
        os.remove(PIDFILE)
    except:
        pass
    sys.exit(0)

signal.signal(signal.SIGTERM, cleanup)
signal.signal(signal.SIGINT, cleanup)

def main():
    ensure_env()
    log("KiteOS Server Keeper starting...")

    env = os.environ.copy()
    env["PORT"] = "3000"
    env["HOSTNAME"] = "0.0.0.0"
    env["NODE_ENV"] = "production"

    while True:
        log("Starting Node.js server...")
        try:
            proc = subprocess.Popen(
                ["node", "server.js"],
                cwd=SERVER_DIR,
                env=env,
                stdout=open(LOGFILE, 'a'),
                stderr=subprocess.STDOUT,
                preexec_fn=os.setsid
            )
            with open(PIDFILE, 'w') as f:
                f.write(str(proc.pid))
            log(f"Server started with PID {proc.pid}")

            retcode = proc.wait()
            log(f"Server exited with code {retcode}")
        except Exception as e:
            log(f"Error starting server: {e}")

        try:
            os.remove(PIDFILE)
        except:
            pass

        log("Restarting in 3 seconds...")
        time.sleep(3)

if __name__ == "__main__":
    main()
