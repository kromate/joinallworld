import json, os, signal, subprocess, sys, time
from pathlib import Path

log_path, receipt_path, *command = sys.argv[1:]
assert command and not Path(log_path).exists() and not Path(receipt_path).exists()
started = time.monotonic()
peak = 0
status = 'running'
process = None
try:
    with Path(log_path).open('xb') as log:
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        while process.poll() is None:
            rows = subprocess.check_output(['ps', '-axo', 'pid=,pgid=,rss='], text=True, timeout=2)
            rss = sum(int(p[2]) * 1024 for row in rows.splitlines()
                      if len(p := row.split()) == 3 and int(p[1]) == process.pid)
            peak = max(peak, rss)
            if rss > 2 * 1024 * 1024 * 1024 or time.monotonic() - started > 120:
                status = 'resource-limit'
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=1.5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=2)
                break
            time.sleep(.025)
        if status == 'running':
            status = 'completed'
finally:
    if process and process.poll() is None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait(timeout=2)
    report = {'status': status, 'exitCode': process.returncode if process else None,
              'peakGroupRssBytes': peak, 'elapsedSeconds': round(time.monotonic() - started, 3),
              'limits': {'rssBytes': 2 * 1024 * 1024 * 1024, 'seconds': 120}, 'command': command}
    Path(receipt_path).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    print(Path(log_path).read_text())
raise SystemExit(0 if status == 'completed' and process.returncode == 0 else 1)
