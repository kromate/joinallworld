#!/usr/bin/env python3
"""Remote-only immutable static build and headless-browser run with separate fixed process-group caps."""
import hashlib,json,os,signal,subprocess,sys,time
from pathlib import Path
ROOT=Path.cwd();HERE=Path('evidence/graphics-loop/garment-quality-v1/shoulder-topology-v1/office-source-shell-v3/gpu-reviewed-v3/remote-ci-v5')
MANIFEST=HERE/'snapshot-files.json';VERIFY=HERE/'verify-snapshot.mjs';BUILD=HERE/'bundle.mjs';BROWSER=HERE/'review-cdp.mjs'
BUDGETS={'build':(220*1024*1024,25),'browser':(1280*1024*1024,60)}
def sha(data):return hashlib.sha256(data).hexdigest()
def frozen(expected):
 raw=MANIFEST.read_bytes()
 if sha(raw)!=expected:raise RuntimeError('snapshot manifest hash mismatch')
 doc=json.loads(raw)
 if doc.get('schema')!='allworld-office-source-corner-chart-gpu-appearance-replay-v5' or len(doc.get('files',[]))!=36:raise RuntimeError('unexpected/incomplete snapshot manifest')
 out={}
 for e in doc['files']:
  p=Path(e['path']);target=(ROOT/p).resolve();
  if p.is_absolute() or '..' in p.parts or target!=ROOT/p or target.is_symlink() or not target.is_file():raise RuntimeError('unsafe snapshot path '+str(p))
  got=sha(target.read_bytes());out[e['path']]=got
  if got!=e['sha256']:raise RuntimeError('snapshot input mismatch '+e['path'])
 return out
def process_witness(rows,pgid):
 out=[]
 for row in rows:
  if len(row)>=5 and int(row[1])==pgid:
   out.append({'pid':int(row[0]),'rssBytes':int(row[2])*1024,'state':row[3],'command':row[4]})
 return sorted(out,key=lambda item:(item['command'],item['pid']))
def kill_group(pgid,proc):
 def remaining():
  result=subprocess.run(['ps','-e','-o','pid=,pgid=,rss=,stat=,comm='],capture_output=True,text=True,timeout=2)
  if result.returncode or not result.stdout.strip():raise RuntimeError('cleanup process scan unavailable')
  return process_witness([row.split() for row in result.stdout.splitlines()],pgid)
 for sig,wait in ((signal.SIGTERM,1.5),(signal.SIGKILL,2)):
  try:os.killpg(pgid,sig)
  except ProcessLookupError:pass
  try:proc.wait(timeout=wait)
  except subprocess.TimeoutExpired:pass
  deadline=time.monotonic()+wait
  try:
   while time.monotonic()<deadline:
    if not remaining():return True
    time.sleep(.025)
  except Exception:return False
 try:return not remaining()
 except Exception:return False
def main():
 if len(sys.argv)!=3 or sys.argv[1] not in BUDGETS:raise SystemExit('usage: run-bounded-linux.py build|browser expected-manifest-sha256')
 if sys.platform!='linux':raise SystemExit('remote Linux only; do not execute on the local workstation')
 mode,expected=sys.argv[1:];limit,timeout=BUDGETS[mode];runid=os.environ.get('GITHUB_RUN_ID')
 if not runid or not runid.isdigit():raise SystemExit('GITHUB_RUN_ID required for unique artifacts')
 before=frozen(expected);base=ROOT/HERE/'remote-results'/runid;base.mkdir(parents=True,exist_ok=True)
 log=base/f'{mode}.log';receipt=base/f'{mode}.receipt.json'
 if log.exists() or receipt.exists():raise SystemExit('refusing to overwrite existing run artifacts')
 env={**os.environ,'EXPECTED_SNAPSHOT_SHA256':expected,'RESULT_DIR':str(base.resolve())}
 if mode=='build':cmd=['node','--max-old-space-size=96',str(ROOT/BUILD),expected]
 else:cmd=['node','--max-old-space-size=96',str(ROOT/BROWSER),expected]
 started=time.monotonic();peak=0;status='running';code=None;proc=None;pgid=None;monitorSamples=0;peakProcessWitness=[];stopProcessWitness=[];emptySince=None;zeroRssGrace=1.25;cleanupVerified=False
 try:
  with log.open('xb') as stream:
   proc=subprocess.Popen(cmd,cwd=ROOT,env=env,stdout=stream,stderr=subprocess.STDOUT,start_new_session=True);pgid=proc.pid
   while True:
    code=proc.poll()
    if code is not None:
     if peak==0:status='monitor_error'
     else:status='completed'
     break
    try:
     listing=subprocess.run(['ps','-e','-o','pid=,pgid=,rss=,stat=,comm='],capture_output=True,text=True,timeout=2)
     if listing.returncode or not listing.stdout.strip():raise RuntimeError('ps unavailable')
     rows=[row.split() for row in listing.stdout.splitlines()]
     owned=[row for row in rows if len(row)>=5 and int(row[1])==pgid]
     live=[row for row in owned if not row[3].startswith('Z') and int(row[2])>0]
     group=sum(int(row[2])*1024 for row in live)
     monitorSamples+=1
     if group<=0:
      if emptySince is None:emptySince=time.monotonic()
      if proc.poll() is not None and peak>0:
       code=proc.returncode;status='completed';break
      if time.monotonic()-emptySince>zeroRssGrace:
       status='monitor_error';stopProcessWitness=process_witness(rows,pgid);kill_group(pgid,proc);code=proc.returncode;break
      time.sleep(.025);continue
     emptySince=None
     if group>peak:peak=group;peakProcessWitness=process_witness(rows,pgid)
    except (OSError,RuntimeError,subprocess.TimeoutExpired,ValueError):
     # A ps failure can race with process exit; only a prior positive sample
     # permits accepting the child's actual terminal status.
     if proc.poll() is not None and peak>0:
      code=proc.returncode;status='completed';break
     status='monitor_error';kill_group(pgid,proc);code=proc.returncode;break
    if group>limit:
     status='memory_limit';stopProcessWitness=process_witness(rows,pgid);kill_group(pgid,proc);code=proc.returncode;break
    if time.monotonic()-started>timeout:
     status='timeout';stopProcessWitness=process_witness(rows,pgid);kill_group(pgid,proc);code=proc.returncode;break
    time.sleep(.025)
 finally:
  if proc is not None and pgid is not None:
   cleanupVerified=kill_group(pgid,proc)
  try:after=frozen(expected)
  except Exception as exc:after={'verificationError':str(exc)};status='source_changed'
  unchanged=before==after
  if not unchanged:status='source_changed'
  if not cleanupVerified:status='cleanup_error'
  record={'cleanupVerified':cleanupVerified,'mode':mode,'status':status,'childExitCode':code,'elapsedSeconds':round(time.monotonic()-started,3),'peakProcessGroupRssBytes':peak,'rssLimitBytes':limit,'wallLimitSeconds':timeout,'monitorSamples':monitorSamples,'peakProcessWitness':peakProcessWitness,'stopProcessWitness':stopProcessWitness,'processGroupId':pgid,'sourceHashesBefore':before,'sourceHashesAfter':after,'sourceUnchanged':unchanged,'expectedSnapshotSha256':expected,'artifactDir':str(base),'log':str(log)}
  receipt.write_text(json.dumps(record,indent=2)+'\n')
  print(json.dumps(record,indent=2))
 ok=status=='completed' and code==0 and peak<=limit and unchanged and cleanupVerified
 return 0 if ok else (125 if status in ('memory_limit','source_changed','monitor_error','cleanup_error') else 124 if status=='timeout' else (code or 1))
if __name__=='__main__':raise SystemExit(main())
