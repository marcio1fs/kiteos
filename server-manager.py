import subprocess, os, time, signal, sys

log = open('/tmp/kiteos-manager.log', 'w')
def log_msg(msg):
    log.write(f"{time.strftime('%H:%M:%S')} {msg}\n")
    log.flush()

log_msg("Server manager starting")

while True:
    try:
        proc = subprocess.Popen(
            ['node', '.next/standalone/server.js'],
            cwd='/home/z/my-project',
            env={**os.environ, 'PORT': '3000', 'HOSTNAME': '0.0.0.0'},
            stdout=open('/tmp/kiteos-stdout.log', 'w'),
            stderr=subprocess.STDOUT,
            preexec_fn=os.setsid
        )
        log_msg(f"Node started with PID {proc.pid}")
        
        # Wait for it to die
        while proc.poll() is None:
            time.sleep(1)
        
        log_msg(f"Node exited with code {proc.returncode}, restarting in 2s...")
        time.sleep(2)
    except Exception as e:
        log_msg(f"Error: {e}")
        time.sleep(5)
