import datetime, json, pathlib, subprocess, sys, time

root = pathlib.Path.cwd()
here = root / 'evidence/graphics-loop/crowd-lod-market-v6'
server = here / 'static-market-gpu-v6-server.py'
log = here / 'market-gpu-v6-server.log'
proc = subprocess.Popen(['/usr/bin/python3', str(server)], cwd=root, stdout=log.open('w'), stderr=subprocess.STDOUT, start_new_session=True)
print(json.dumps({'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'serverPid': proc.pid, 'serverPgid': proc.pid, 'port': 5187, 'maxLifetimeSeconds': 180,
                  'serverSourceSha256': __import__('hashlib').sha256(server.read_bytes()).hexdigest(),
                  'log': str(log)}, indent=2), flush=True)
code = proc.wait()
print(json.dumps({'terminalAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  'serverPid': proc.pid, 'exit': code, 'receipt': str(here / 'market-gpu-v6-server-receipt.json')}, indent=2), flush=True)
raise SystemExit(code)
