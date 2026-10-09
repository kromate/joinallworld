#!/usr/bin/env python3
"""Remote-only actual-body diagnostic, fixed 220 MiB process-group RSS / 20 seconds."""
import hashlib,json,os,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path.cwd();HERE=Path('evidence/graphics-loop/garment-quality-v1/shoulder-topology-v1/office-source-shell-v3');PROBE=HERE/'probe-source-corner-chart.mjs';LIMIT=220*1024*1024;TIMEOUT=20
def main():
 if len(sys.argv)!=3 or sys.argv[1] not in ('man','woman'):raise SystemExit('usage: run-bounded-linux.py man|woman output.json')
 if sys.platform!='linux':raise SystemExit('remote-Linux-only; local Mac execution is prohibited')
 body,out=sys.argv[1],Path(sys.argv[2]);out=out if out.is_absolute() else ROOT/out;out.parent.mkdir(parents=True,exist_ok=True);log=out.with_suffix('.log');receipt=out.with_suffix('.receipt.json')
 if out.exists() or log.exists() or receipt.exists():raise SystemExit('refuse to overwrite output')
 if hashlib.sha256((HERE/'remote-reviewed-v1/snapshot-files.json').read_bytes()).hexdigest()!=os.environ.get('EXPECTED_SNAPSHOT_SHA256'):raise SystemExit('manifest pin mismatch')
 manifest=json.loads((HERE/'remote-reviewed-v1/snapshot-files.json').read_text());before={e['path']:hashlib.sha256((ROOT/e['path']).read_bytes()).hexdigest() for e in manifest['files']}
 if any(before[e['path']]!=e['sha256'] for e in manifest['files']):raise SystemExit('source snapshot mismatch')
 cmd=['node','--max-old-space-size=128','--experimental-strip-types',str(PROBE),body,str(out)];start=time.monotonic();peak=0;status='running';code=None;proc=None
 try:
  with log.open('xb') as f:
   proc=subprocess.Popen(cmd,cwd=ROOT,stdout=f,stderr=subprocess.STDOUT,start_new_session=True);pgid=proc.pid
   while True:
    code=proc.poll()
    if code is not None:status='completed' if peak else 'monitor_error';break
    try:
     listing=subprocess.run(['ps','-e','-o','pid=,pgid=,rss='],capture_output=True,text=True,timeout=2)
     if listing.returncode or not listing.stdout.strip():raise RuntimeError('ps unavailable')
     rss=[int(p[2])*1024 for row in listing.stdout.splitlines() if len(p:=row.split())==3 and int(p[1])==pgid]
     if not rss:raise RuntimeError('no RSS entries for owned process group')
     group=sum(rss);peak=max(peak,group)
    except (OSError,RuntimeError,subprocess.TimeoutExpired,ValueError):
     if proc.poll() is not None:code=proc.returncode;status='completed' if peak else 'monitor_error';break
     status='monitor_error'
     try:os.killpg(pgid,signal.SIGTERM);proc.wait(timeout=1.5)
     except (OSError,subprocess.TimeoutExpired):
      try:os.killpg(pgid,signal.SIGKILL);proc.wait()
      except OSError:pass
     code=proc.returncode;break
    if group>LIMIT:status='memory_limit';os.killpg(pgid,signal.SIGTERM);proc.wait(timeout=1.5);code=proc.returncode;break
    if time.monotonic()-start>TIMEOUT:status='timeout';os.killpg(pgid,signal.SIGTERM);proc.wait(timeout=1.5);code=proc.returncode;break
    time.sleep(.025)
 finally:
  if proc is not None and proc.poll() is None:
   try:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=2)
   except (OSError,subprocess.TimeoutExpired):pass
  after={e['path']:hashlib.sha256((ROOT/e['path']).read_bytes()).hexdigest() for e in manifest['files']}
  if before!=after:status='source_changed'
  record={'body':body,'platform':sys.platform,'status':status,'childExitCode':code,'elapsedSeconds':round(time.monotonic()-start,3),'peakGroupRssBytes':peak,'rssLimitBytes':LIMIT,'timeoutSeconds':TIMEOUT,'sourceHashesBefore':before,'sourceHashesAfter':after,'probeReportExists':out.exists(),'log':str(log),'scope':'owned Linux process group only; no Mac/GPU/phone or visual claim'};receipt.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record,indent=2))
 return 0 if status=='completed' and code==0 and peak<=LIMIT else (125 if status in ('memory_limit','source_changed','monitor_error') else 124 if status=='timeout' else (code or 1))
if __name__=='__main__':raise SystemExit(main())
