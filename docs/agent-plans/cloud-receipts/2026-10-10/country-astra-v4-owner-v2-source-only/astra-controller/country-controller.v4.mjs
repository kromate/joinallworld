#!/usr/bin/env node
// SOURCE PREPARED ONLY. Running --run requires an independently approved, hash-bound
// WORLD/Integration receipt. --driver is an owned child, never a public launch path.
// All browser writes are ordinary input/navigation. WORLD alone supplies funding,
// protected-state comparisons and exactly one SIGWINCH via the private mailbox.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, closeSync, fstatSync, readSync, readdirSync, lstatSync, mkdirSync, chmodSync, realpathSync, constants } from 'node:fs';
import { open as openAsync } from 'node:fs/promises';
import { spawn, fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { lookup } from 'node:dns/promises';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'file:///workspace/joinallworld/node_modules/ws/wrapper.mjs';

const SELF = fileURLToPath(import.meta.url), DIR = dirname(SELF);
const BASE = '/workspace/remote-verification';
const SOURCE = BASE + '/repositories/coordinator-c1-third-five-sourcecheck';
const PACKAGE = BASE + '/artifacts/c12-independent-repro-20261010';
const TOOLING = BASE + '/tools/c12-browser-stage-94079eed/world/tooling';
const HELPER = TOOLING + '/serve-sealed-africa.mjs';
const POLICY = BASE + '/execution-policy.json';
const OPERATOR = '/root/country_browser_astra';
const SHA = x => createHash('sha256').update(x).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const mono = () => Number(process.hrtime.bigint() / 1_000_000n);
let born = mono() - process.uptime() * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const execFileAsync = promisify(execFile);
const liveChild = c => Boolean(c && c.exitCode===null && c.signalCode===null);
const check = (ok, code) => { if (!ok) throw new Error(code); };
const named = s => typeof s==='string' && s.length>2 && s.length<=256 && !/unknown|placeholder|pending|[<>]/i.test(s);
const PIN = Object.freeze({
  source: 'c12b8ebd83cd301475fb1d7bf9e143af260d6621',
  package: '28e4f93df5e608b63d3d862173b03b418d70c141803de7f69a6ed836ffb5030d',
  helper: '55f38b91528966dbb43dfc80274471de11fb010b2bc3dc66b9b4f2712d619f56',
  policy: 'af748ece4eccbb2a9dfc7ad9901a13b3d06d4afc1ef497c53bf140d74a51b5ef',
  contractCommit: '711aac363b4f3315e8a236a9d1acd5b0d52b7b2a',
});
const CAP = Object.freeze({ total:900000, ready:120000, stage:720, newAction:780000,
  reserve:60000, rss:4294967296, sample:250, maxSampleGap:500, http:20000,
  cdp:10000, screenshot:15000, png:2097152, pngCount:32, pngTotal:50331648,
  observations:16777216, protocol:3145728, mailbox:65536 });
const ACTORS = Object.freeze([
  { key:'A', name:'Cloud Astra A', fareTotal:1762000, cities:[
    {iso:'eg',country:'Egypt',id:'cairo',name:'Cairo',fare:334000},
    {iso:'ma',country:'Morocco',id:'rabat',name:'Rabat',fare:279000},
    {iso:'rw',country:'Rwanda',id:'kigali',name:'Kigali',fare:268000}]},
  { key:'B', name:'Cloud Astra B', fareTotal:1196000, cities:[
    {iso:'ug',country:'Uganda',id:'kampala',name:'Kampala',fare:285000},
    {iso:'zm',country:'Zambia',id:'lusaka',name:'Lusaka',fare:313000}]}]);

function boundedFile(path, max, privateFile = false) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    check(st.isFile() && st.size <= max, 'file-bound');
    if (privateFile) check(st.uid === process.getuid() && (st.mode & 0o777) === 0o600, 'private-file-mode');
    const bytes = Buffer.alloc(st.size + 1), n = readSync(fd, bytes, 0, bytes.length, 0);
    check(n === st.size, 'file-changed');
    return bytes.subarray(0,n);
  } finally { closeSync(fd); }
}
async function fileDigest(path,max){
  check(mono()<born+CAP.ready,'pin-read-readiness-expired');
  const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),Math.max(1,born+CAP.ready-mono()));
  const handle=await openAsync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const st=await handle.stat();check(st.isFile()&&st.size<=max,'pin-file-bound');const hash=createHash('sha256');let size=0;
    for await(const bytes of handle.createReadStream({autoClose:false,highWaterMark:1048576,signal:abort.signal})){size+=bytes.length;check(size<=max,'pin-read-bound');hash.update(bytes);}
    check(size===st.size,'pin-file-changed');return hash.digest('hex');
  }finally{clearTimeout(timer);await handle.close();}
}
function privateJson(path, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  check(bytes.length <= CAP.mailbox, 'mailbox-output-bound');
  writeFileSync(path, bytes, {flag:'wx',mode:0o600});
}
function jsonFile(path, max = CAP.mailbox) { return JSON.parse(boundedFile(path,max,true)); }
function quota() {
  const p = JSON.parse(boundedFile(POLICY,16384));
  check(Date.now()-Date.parse(p.observed_at_utc)>=0 && Date.now()-Date.parse(p.observed_at_utc)<=60000,'quota-observation-stale');
  check(p.latest_remaining_percent > 4 && p.allow_new_heavy === true, 'quota-stop');
  return p.latest_remaining_percent;
}
function proc(pid) {
  try {
    const s = readFileSync('/proc/' + pid + '/stat','utf8');
    const f = s.slice(s.lastIndexOf(')')+2).split(' ');
    const status = readFileSync('/proc/' + pid + '/status','utf8');
    return {pid:Number(pid),state:f[0],ppid:Number(f[1]),pgid:Number(f[2]),start:f[19],
      rss:Number(status.match(/^VmRSS:\s+(\d+) kB$/m)?.[1] ?? 0)*1024};
  } catch (e) { if (e.code === 'ENOENT' || e.code === 'ESRCH') return null; throw e; }
}
function processTable() { return readdirSync('/proc').filter(p=>/^\d+$/.test(p)).map(proc).filter(Boolean); }
const processOwners=new Map();
function linuxBirthMono(p){
  check(process.platform==='linux' && process.arch==='x64','linux-x64-process-birth-required');
  const aux=readFileSync('/proc/self/auxv');let ticks;
  for(let offset=0;offset+16<=aux.length;offset+=16)if(aux.readBigUInt64LE(offset)===17n)ticks=Number(aux.readBigUInt64LE(offset+8));
  check(ticks>0,'linux-clock-ticks-unavailable');
  const before=mono(),up=Number(readFileSync('/proc/uptime','utf8').split(' ')[0]);
  // /proc uptime and task birth use the boot clock. Convert the elapsed age to
  // the monotonic clock; include two ticks for quantization/read uncertainty.
  return before-(up-Number(p.start)/ticks)*1000-2000/ticks;
}
function ownedRows(roots, remembered) {
  const all = processTable(), owned = new Map(),wanted=new Set(roots.map(r=>r.pid));
  for (const p of all) {
    const exact=roots.find(r=>r.pid===p.pid&&r.start===p.start);
    if(exact)owned.set(p.pid,exact.pid);
    else if(remembered.get(p.pid)===p.start&&wanted.has(processOwners.get(p.pid)))owned.set(p.pid,processOwners.get(p.pid));
    // A process group is only considered ours while the birth identity of its
    // recorded root is still live, or this member was previously recorded.
    const group=roots.find(r=>p.pgid===r.pid&&all.some(a=>a.pid===r.pid&&a.start===r.start));
    if(group)owned.set(p.pid,group.pid);
  }
  let added = true;
  while (added) { added=false; for (const p of all) if (!owned.has(p.pid) && owned.has(p.ppid)) {owned.set(p.pid,owned.get(p.ppid));added=true;} }
  const rows = all.filter(p=>owned.has(p.pid));
  for (const p of rows) {remembered.set(p.pid,p.start);processOwners.set(p.pid,owned.get(p.pid));}
  return rows;
}
function signalOwned(root, signal, remembered) {
  const current = proc(root.pid);
  if (current?.start === root.start && current.pgid === root.pid) {
    try { process.kill(-root.pid,signal); } catch(e) { if(e.code!=='ESRCH') throw e; }
  }
  // Orphans/changed groups are killed by exact recorded PID + Linux birth tick,
  // never by an unproved stale PGID that could have been reused.
  for (const p of ownedRows([root],remembered)) if (p.pid !== process.pid) {
    if (remembered.get(p.pid) === proc(p.pid)?.start) try { process.kill(p.pid,signal); } catch(e) {if(e.code!=='ESRCH')throw e;}
  }
}
function argsOf(argv) {
  check(argv.length===5 && argv[0]==='--run' && argv[1]==='--review' && argv[3]==='--review-sha256' && HASH.test(argv[4]),'explicit-review-cli-required');
  return {path:argv[2],hash:argv[4]};
}
async function verifyReview(argv) {
  const a = argsOf(argv), bytes = boundedFile(a.path,CAP.mailbox,true);
  check(SHA(bytes)===a.hash,'review-receipt-hash');
  const r = JSON.parse(bytes), codeHash = SHA(boundedFile(SELF,262144));
  check(r.schema===1 && r.approved===true && r.launchAuthorized===true,'launch-review-required');
  check(r.scope==='c12-five-country-browser-acceptance' && r.operatorId===OPERATOR,'operator-review-scope');
  check(r.reviewedControllerSha256===codeHash,'reviewed-controller-bytes');
  check(r.contractCommit===PIN.contractCommit && r.source===PIN.source && r.packageDigest===PIN.package,'reviewed-source-package-contract');
  check(r.stageHelperSha256===PIN.helper && r.capabilityPolicySha256===PIN.policy,'reviewed-tooling');
  check(r.worldOwnerDelegatesExactStageLaunch===true && named(r.worldOwnerId),'world-stage-owner-required');
  check(named(r.integrationReviewerId) && named(r.astraReviewerId),'named-reviewers-required');
  check(HASH.test(r.ownerHelperSha256)&&r.ownerHelperPath===BASE+'/worker-results/c1-third-five/astra-owner-helper/world-owner-mailbox.v2.mjs','reviewed-owner-helper-required');
  check(r.emergencyOwnedGroupCleanupReviewed===true && r.privateOwnerMailboxReviewed===true,'cleanup-mailbox-review-required');
  check(Date.now()-Date.parse(r.approvedAt) >= 0 && Date.now()-Date.parse(r.approvedAt)<300000,'fresh-explicit-review-required');
  assert.deepEqual(r.caps,CAP); assert.deepEqual(r.actorFareTotals,[1762000,1196000]);
  check(named(r.leases?.heavy) && named(r.leases?.server) && named(r.leases?.browser) && r.leases?.ownerId===r.worldOwnerId,'actual-owner-leases-required');
  check(HASH.test(r.selectedSourcePinsSha256),'source-pins-review');
  check(r.quotaObservationMaxAgeMs===60000&&r.worldOwnerMaintainsLiveQuota===true,'live-quota-owner-required');
  const pinsBytes = boundedFile(join(DIR,'selected-source-pins.v4.json'),262144);
  check(SHA(pinsBytes)===r.selectedSourcePinsSha256,'source-pins-bytes');
  const pins=JSON.parse(pinsBytes);
  for (const [path, pin] of Object.entries(pins.files)) check(await fileDigest(path,pin.maxBytes)===pin.sha256,'selected-source-pin-mismatch');
  const git = async(...a) => (await execFileAsync('git',['-C',SOURCE,...a],{encoding:'utf8',timeout:5000,maxBuffer:1048576})).stdout.trim();
  check(await git('rev-parse','HEAD')===PIN.source && await git('status','--porcelain','--untracked-files=no')==='','clean-game-source-required');
  // Existing capability receipt pins the installed binary/version; do not run a
  // second browser process just to obtain --version during the live phase.
  check(r.chromiumVersion==='151.0.7922.173','chromium151-required');
  check(Number(process.versions.node.split('.')[0])>=24,'node24-required');
  quota();
  return {...r,reviewSha256:a.hash,controllerSha256:codeHash};
}

async function supervisor(argv) {
  const mine=proc(process.pid);
  check(mine?.pgid===process.pid,'launch-with-setsid-required');
  const watchdog=proc(Number(process.env.ASTRA_WATCHDOG_PID));
  check(process.send&&watchdog&&watchdog.start===process.env.ASTRA_WATCHDOG_START&&mine.ppid===watchdog.pid,'independent-watchdog-required');
  born=linuxBirthMono(watchdog);
  const earlyRemembered=new Map([[mine.pid,mine.start]]);
  let earlyPrevious=mono(),earlyPeak=mine.rss,earlyFailure=null;
  const earlySample=()=>{try{const now=mono();if(now-earlyPrevious>CAP.maxSampleGap)earlyFailure='preflight-sample-gap';earlyPrevious=now;const rss=ownedRows([mine],earlyRemembered).reduce((n,p)=>n+p.rss,0);earlyPeak=Math.max(earlyPeak,rss);if(rss>CAP.rss)earlyFailure='preflight-rss-bound';}catch{earlyFailure='preflight-sampler-failed';}};
  const earlyTimer=setInterval(earlySample,CAP.sample);
  let review;
  try{review=await verifyReview(argv);earlySample();check(!earlyFailure,earlyFailure);}finally{clearInterval(earlyTimer);}
  check(mono()-born<CAP.ready,'review-consumed-bootstrap-budget');
  const runDir=BASE+'/private/country-astra-'+randomUUID();
  mkdirSync(runDir,{recursive:true,mode:0o700});chmodSync(runDir,0o700);
  check(realpathSync(runDir)===runDir,'canonical-private-run-directory');
  process.send?.({type:'owner-context',runDir,ownerHelperSha256:review.ownerHelperSha256,ownerHelperPath:review.ownerHelperPath});
  const profile=join(runDir,'chromium-profile');mkdirSync(profile,{mode:0o700});
  const control=join(runDir,'stage-control.json');
  const roots=[mine], remembered=earlyRemembered;
  let stage, browser, driver, stageInfo, stageExit=null,deadlineStopObserved=false,stageStderrTail='',stageStdoutTail='',stopCode=null, peak=earlyPeak, previous=earlyPrevious;
  let rawBytes=0, publicBytes=0, outputBytes=0, stageDeadline=null, actionDeadline=null;
  let driverDone=false, driverResult=null, uiReady=false, sampling=false, cleanupFailed=false, emergency=false,resourceAbortAt=null;
  const events=[];
  const log=(event,fields={})=>{
    const row={event,elapsedMs:Math.round(mono()-born),...fields};
    const n=Buffer.byteLength(JSON.stringify(row)); publicBytes+=n;
    check(rawBytes+publicBytes+outputBytes<=CAP.observations,'aggregate-log-bound'); events.push(row);
  };
  const stop=code=>{if(/rss|sample|log-bound/.test(code))process.send?.({type:'resource-failure',code}); if(!stopCode) {stopCode=code;if(driver?.connected)driver.send({type:'stop',code,abort:/rss|sample-gap|log-bound/.test(code)});} };
  const children=[];
  const start=(role,command,args,ipc=false)=>{
    quota();check(mono()-born<CAP.ready,'bootstrap-timeout-before-launch');
    const c=ipc?fork(command,args,{detached:true,stdio:['ignore','pipe','pipe','ipc'],execArgv:['--max-old-space-size=256']}):spawn(command,args,{detached:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_OPTIONS:'--max-old-space-size=768'}});
    const r=proc(c.pid);check(r && r.pgid===c.pid,'owned-process-group-not-established');roots.push(r);remembered.set(r.pid,r.start);children.push({role,c,r});
    for(const stream of [c.stdout,c.stderr]) stream.on('data',b=>{rawBytes+=b.length;if(rawBytes+publicBytes+outputBytes>CAP.observations)stop('aggregate-log-bound');});
    c.on('error',()=>stop(role+'-spawn-failed'));
    log('owned-process',{role,pid:r.pid,pgid:r.pgid,startTicks:r.start});
    return c;
  };
  const monitor=setInterval(()=>{
    if(sampling) {stop('rss-sampler-overlap');return;} sampling=true;
    try {
      const now=mono(),gap=now-previous;previous=now;
      if(gap>CAP.maxSampleGap)stop('rss-sample-gap-exceeded');
      process.send?.({type:'output-bytes',bytes:rawBytes+publicBytes+outputBytes});
      const rss=ownedRows(roots,remembered).reduce((n,p)=>n+p.rss,0);peak=Math.max(peak,rss);
      if(rss>CAP.rss){stop('aggregate-rss-exceeded');resourceAbortAt??=now;
        if(now-resourceAbortAt>=1000){emergency=true;cleanupFailed=true;for(const {r} of children)signalOwned(r,'SIGKILL',remembered);}}
      if(!uiReady && now-born>=CAP.ready)stop('bootstrap-readiness-timeout');
      if(actionDeadline!==null && now>=actionDeadline)stop('last-new-action-deadline');
      try{quota();}catch{stop('quota-stop');}
      if(now-born>=CAP.total-10000){ emergency=true;cleanupFailed=true;stop('emergency-deadline-cleanup');for(const {r} of children)signalOwned(r,'SIGKILL',remembered);}
    } catch {stop('rss-monitor-failed');} finally {sampling=false;}
  },CAP.sample);
  try {
    log('review-verified',{controllerSha256:review.controllerSha256,reviewSha256:review.reviewSha256,operatorId:OPERATOR,leases:review.leases,t0MonoMs:born,t0Basis:'Linux owned PID birth including setsid exec; two clock ticks conservatively reserved',absoluteDeadlineMonoMs:born+CAP.total});
    privateJson(join(runDir,'review.json'),review);
    const stageArgs=['--experimental-strip-types',HELPER,'--source',SOURCE,'--package',PACKAGE,'--sha',PIN.source,'--tools',SOURCE+'/deploy/tooling','--control',control,'--stage-helper-sha256',PIN.helper,'--stage-capability-policy-sha256',PIN.policy,'--interactive-teaching-starts','0','--seconds','720','--retain-store'];
    assert.deepEqual(review.stageArguments,stageArgs.map(a=>a===control?'<fresh-private-stage-control>':a));
    stage=start('stage',process.execPath,stageArgs);
    stage.on('exit',(code,signal)=>{stageExit={code,signal,monoMs:mono()};});
    stage.stderr.on('data',b=>{stageStderrTail=(stageStderrTail+b.toString('utf8')).slice(-1024);if(stageStderrTail.includes('Sealed Africa stage stopping on deadline.'))deadlineStopObserved=true;});
    stage.stdout.on('data',b=>{
      stageStdoutTail+=b.toString('utf8');if(Buffer.byteLength(stageStdoutTail)>16384){stop('stage-output-line-bound');stageStdoutTail='';return;}
      for(let cut;(cut=stageStdoutTail.indexOf('\n'))>=0;){const line=stageStdoutTail.slice(0,cut);stageStdoutTail=stageStdoutTail.slice(cut+1);let value;try{value=JSON.parse(line);}catch{continue;}
        if(value.event==='restart'){
          if(value.count!==1||value.sourceSha!==PIN.source||value.packageDigest!==PIN.package||value.stageUrl!==stageInfo?.origin||value.storeReused!==true){stop('stage-restart-evidence-mismatch');continue;}
          try{privateJson(join(runDir,'stage-restart-observation.json'),{event:'restart',count:value.count,sourceSha:value.sourceSha,packageDigest:value.packageDigest,stageUrl:value.stageUrl,storeReused:value.storeReused,stageHelperSha256:value.stageHelperSha256,stageCapabilityPolicySha256:value.stageCapabilityPolicySha256,elapsedMs:mono()-born});}catch{stop('duplicate-or-unwritable-restart-observation');}
        }
      }
    });
    while(!stageInfo && mono()-born<CAP.ready && !stopCode) {
      if(!liveChild(stage))throw new Error('stage-bootstrap-exited');
      try {
        const c=jsonFile(control,16384);
        check(c.ownerChildPid===stage.pid && c.stageStatus==='running' && c.sourceSha===PIN.source && c.packageDigest===PIN.package,'stage-control-identity');
        check(c.stageHelperSha256===PIN.helper && c.stageCapabilityPolicySha256===PIN.policy,'stage-control-tool-pins');
        const u=new URL(c.stageUrl);check(u.protocol==='http:' && u.hostname==='127.0.0.1' && Number(u.port)>0,'stage-loopback-origin');
        const remaining=Date.parse(c.deadline)-Date.now();check(remaining>0 && remaining<=CAP.stage*1000,'stage-deadline-bound');
        stageDeadline=mono()+remaining;actionDeadline=Math.min(stageDeadline-CAP.reserve,born+CAP.newAction);
        stageInfo={origin:u.origin,deadline:c.deadline,storeId:c.storeId,port:c.port,stagePid:stage.pid};
      }catch(e){if(e.code!=='ENOENT')throw e;}
      if(!stageInfo)await sleep(100);
    }
    check(stageInfo && !stopCode,'stage-not-ready');
    const browserArgs=['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--disable-component-update','--no-first-run','--no-default-browser-check','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=390,844','about:blank'];
    assert.deepEqual(review.chromiumArguments,browserArgs.map(a=>a.startsWith('--user-data-dir=')?'--user-data-dir=<fresh-private-profile>':a));
    browser=start('browser','/usr/bin/chromium',browserArgs);
    let port;
    while(!port && mono()-born<CAP.ready && !stopCode) {
      try {port=Number(boundedFile(join(profile,'DevToolsActivePort'),4096).toString().split('\n')[0]);check(port>0&&port<65536,'cdp-port');}catch(e){if(e.code!=='ENOENT')throw e;}
      if(!port)await sleep(100);
    }
    check(port && !stopCode,'browser-not-ready');
    log('before-browser-action',{stageDeadline:stageInfo.deadline,actionDeadlineMonoMs:actionDeadline,initialAggregateRss:ownedRows(roots,remembered).reduce((n,p)=>n+p.rss,0),stagePid:stage.pid,browserPid:browser.pid,packageDigest:PIN.package,source:PIN.source});
    privateJson(join(runDir,'pre-ui-provenance.json'),{reviewSha256:review.reviewSha256,controllerSha256:review.controllerSha256,leases:review.leases,processes:[watchdog,...roots].map(({pid,pgid,start})=>({pid,pgid,startTicks:start})),t0MonoMs:born,phaseDeadlineMonoMs:born+CAP.total,stageDeadline:stageInfo.deadline,actionDeadlineMonoMs:actionDeadline,peakRssBytes:peak});
    driver=start('ui-driver',SELF,['--driver'],true);
    driver.on('message',m=>{
      if(m?.type==='screenshot-deadline'||m?.type==='screenshot-finished')process.send?.(m);
      if(m?.type==='ready'){uiReady=true;process.send?.({type:'ready'});}
      if(m?.type==='bytes') {outputBytes=m.bytes;if(rawBytes+publicBytes+outputBytes>CAP.observations)stop('aggregate-log-bound');}
      if(m?.type==='done'){driverDone=true;driverResult=m.result;}
    });
    const liveProvenance={controllerSha256:review.controllerSha256,reviewSha256:review.reviewSha256,leases:review.leases,roots:[watchdog,...roots].map(({pid,pgid,start})=>({pid,pgid,startTicks:start})),initialAggregateRss:ownedRows(roots,remembered).reduce((n,p)=>n+p.rss,0),t0MonoMs:born,phaseDeadlineMonoMs:born+CAP.total,stageDeadline:stageInfo.deadline,actionDeadlineMonoMs:actionDeadline};
    privateJson(join(runDir,'all-owned-processes-before-ui.json'),liveProvenance);
    driver.send({type:'init',runDir,profile,cdpPort:port,stage:stageInfo,t0:born,actionDeadline,review,liveProvenance});
    while(liveChild(stage) && mono()-born<CAP.total-10000){
      if(!liveChild(driver) && !driverDone)stop('driver-exited-without-terminal-receipt');
      if(stopCode && driver.connected)driver.send({type:'stop',code:stopCode});
      await sleep(250);
    }
    if(stage.exitCode!==0) {cleanupFailed=true;stop('stage-not-cleanly-expired');}
  } catch(e) {
    stop(/^[a-z0-9-]+$/.test(e.message)?e.message:'controller-failure');
    // Do not claim SIGTERM/HUP is graceful; let a bootstrapped helper's own
    // deadline dispose it. A startup failure still receives the full hard bound.
    while(liveChild(stage) && mono()-born<CAP.total-10000)await sleep(250);
  } finally {
    stop('terminal-cleanup');
    if(liveChild(driver)) {
      if(driver.connected)driver.send({type:'dispose'});
      const until=Math.min(mono()+10000,born+CAP.total-6000);
      while(liveChild(driver) && mono()<until)await sleep(100);
    }
    if(liveChild(browser)) {
      // Browser.close is requested by the driver first. A still-live browser
      // receives an explicitly recorded emergency owned-group kill.
      cleanupFailed=true;emergency=true;
    }
    for(const {c,r} of children)if(liveChild(c)){signalOwned(r,'SIGKILL',remembered);emergency=true;cleanupFailed=true;}
    const until=born+CAP.total-1000;
    let left=ownedRows(roots,remembered).filter(p=>p.pid!==process.pid);
    while(left.length && mono()<until){await sleep(100);left=ownedRows(roots,remembered).filter(p=>p.pid!==process.pid);}
    clearInterval(monitor);
    let cp=null;
    try {const c=jsonFile(control,16384);check(c.sourceSha===PIN.source&&c.packageDigest===PIN.package&&c.ownerChildPid===stage?.pid,'terminal-control-identity');cp={stageStatus:c.stageStatus,restartCount:c.restartCount,deadline:c.deadline,ownerChildPid:c.ownerChildPid,storeRetained:Boolean(c.storagePath),sameStore:c.storeId===stageInfo?.storeId};}catch{}
    const natural=Boolean(stageInfo && stageExit && stageExit.monoMs>=stageDeadline && stageExit.code===0 && stageExit.signal===null && deadlineStopObserved && cp?.stageStatus==='stopped' && cp.sameStore);
    const allGone=left.length===0;
    const complete=driverResult?.completedCities?.length===5 && driverResult?.restartVerified===true && driverDone;
    const accepted=complete && natural && allGone && !cleanupFailed && !emergency && (!stopCode || stopCode==='last-new-action-deadline' || stopCode==='terminal-cleanup');
    const receipt={status:accepted?'JOURNEY_COMPLETE_OWNER_FINALIZATION_PENDING':'PARTIAL',controllerSha256:review.controllerSha256,reviewSha256:review.reviewSha256,operatorId:OPERATOR,backendModelIdExposed:false,requestedModel:'gpt-6-astra',requestedReasoning:'high',source:PIN.source,packageDigest:PIN.package,stopCode,completedCities:driverResult?.completedCities??[],incompleteCities:driverResult?.incompleteCities??[],unvisitedCities:driverResult?.unvisitedCities??ACTORS.flatMap(a=>a.cities.map(c=>c.id)),elapsedMs:Math.round(mono()-born),peakRssBytes:peak,rawDiscardedBytes:rawBytes,publicObservationBytes:publicBytes+outputBytes,outputs:driverResult?.outputs??null,naturalStageExpiry:natural,stageCheckpoint:cp,emergencyCleanup:emergency,cleanupFailed:cleanupFailed||!allGone,ownedChildProcessesAbsent:allGone,controllerExitStillRequiresOwnerProof:true,leaseReleaseEligible:false,ownerFinalizationRequired:'After this controller exits, independently prove controller birth identity and every recorded owned PID/group absent; only then release all three leases.',events};
    privateJson(join(runDir,'terminal-receipt.json'),receipt);
    process.stdout.write(JSON.stringify({status:receipt.status,privateReceipt:join(runDir,'terminal-receipt.json'),controllerSha256:review.controllerSha256,leaseReleaseEligible:false})+'\n');
    process.exitCode=accepted?0:2;
  }
}

class Cdp {
  constructor(ws){this.ws=ws;this.next=0;this.pending=new Map();this.closed=false;
    ws.on('message',b=>{if(b.length>CAP.protocol){this.close();return;}let m;try{m=JSON.parse(b);}catch{this.close();return;}if(m.method){this.onEvent?.(m.method,m.params);return;}const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(new Error('cdp-command-failed')):p.resolve(m.result??{});});
    ws.on('close',()=>this.rejectAll());ws.on('error',()=>this.rejectAll());
  }
  rejectAll(){this.closed=true;for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('cdp-connection-closed'));}this.pending.clear();}
  call(method,params={},ms=CAP.cdp){ms=Math.min(ms,CAP.cdp);check(!this.closed,'cdp-closed');const id=++this.next;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);this.close();reject(new Error('cdp-command-timeout'));},ms);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}),e=>{if(e){clearTimeout(timer);this.pending.delete(id);reject(new Error('cdp-send-failed'));}});});}
  close(){this.rejectAll();this.ws.terminate();}
  static async connect(url){const u=new URL(url);check(u.protocol==='ws:' && u.hostname==='127.0.0.1','cdp-loopback');const ws=new WebSocket(url,{maxPayload:CAP.protocol,handshakeTimeout:CAP.cdp});await new Promise((resolve,reject)=>{const t=setTimeout(()=>{ws.terminate();reject(new Error('cdp-connect-timeout'));},CAP.cdp);ws.once('open',()=>{clearTimeout(t);resolve();});ws.once('error',()=>{clearTimeout(t);reject(new Error('cdp-connect-failed'));});});return new Cdp(ws);}
}
async function httpJson(url){const u=new URL(url);check(u.protocol==='http:' && u.hostname==='127.0.0.1','http-loopback');const c=new AbortController(),timer=setTimeout(()=>c.abort(),CAP.http);let response;
  try{response=await fetch(url,{signal:c.signal,redirect:'error'});check(response.ok,'http-response');let n=0;const parts=[];for await(const b of response.body){n+=b.length;check(n<=CAP.protocol,'http-body-bound');parts.push(b);}return JSON.parse(Buffer.concat(parts));}
  finally{clearTimeout(timer);c.abort();if(response?.body&&!response.bodyUsed)await response.body.cancel().catch(()=>{});}
}

async function uiDriver(init){
  const {runDir,stage,t0,actionDeadline,review,cdpPort}=init;
  check(SHA(boundedFile(SELF,262144))===review.controllerSha256,'driver-controller-bytes-changed');
  let stopped=false,disposing=false,cdp,browserCdp,privateBytes=0,pngBytes=0,pngCount=0,restartVerified=false;
  const requests=new Map(),documents=new Map(),sessionRequests=new Map(),guestIdentities=new Map(),normalActivities=[];let identityReads=Promise.resolve(),identityReadFailure=false;let failedMutation=false,requestTimeout=false;
  let activeCity=null,actor=null,homeHeading=null;const completed=[],attempted=new Set(),observations=[];
  process.on('message',m=>{if(m?.type==='stop'){stopped=true;if(m.abort){disposing=true;if(cdp&&!cdp.closed)void cdp.call('Page.stopLoading').catch(()=>{});}}if(m?.type==='dispose'){stopped=true;disposing=true;}});
  const allowed=(needed=0)=>{check(!stopped && mono()+needed<actionDeadline,'no-new-browser-action');quota();};
  const observe=(label,value)=>{const row={label,elapsedMs:Math.round(mono()-t0),value};privateBytes+=Buffer.byteLength(JSON.stringify(row));check(privateBytes<=CAP.observations-65536,'observation-bound');observations.push(row);process.send?.({type:'bytes',bytes:privateBytes});return value;};
  const evaluate=async(expression)=>{const r=await cdp.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});check(!r.exceptionDetails,'visible-dom-evaluation');return r.result?.value;};
  const visibleFn=`e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'&&!e.closest('[hidden]')}`;
  const elements=async(selector)=>evaluate(`(()=>{const vis=${visibleFn};return [...document.querySelectorAll(${JSON.stringify(selector)})].filter(vis).map(e=>{const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,h=document.elementFromPoint(x,y);return {text:(e.innerText||'').trim(),aria:e.getAttribute('aria-label'),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',x,y,width:r.width,height:r.height,hit:!!h&&(h===e||e.contains(h)),focused:document.activeElement===e,value:e.value??null}})})()`);
  const unique=async(selector,text=null)=>{const rows=(await elements(selector)).filter(e=>text===null||e.text===text||e.aria===text);check(rows.length===1,'visible-selector-not-unique');check(!rows[0].disabled&&rows[0].hit,'disabled-or-occluded-control');return rows[0];};
  const reveal=async(selector,text=null)=>{
    // Ordinary wheel input may reveal an offscreen control. No hidden control,
    // disabled target, occluded center or ambiguous selector is force-clicked.
    for(let n=0;n<8;n++){
      const rows=(await elements(selector)).filter(e=>text===null||e.text===text||e.aria===text);check(rows.length===1&&!rows[0].disabled,'unavailable-scroll-target');if(rows[0].hit)return;
      const s=await evaluate(`(()=>{const text=${JSON.stringify(text)},rows=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(${visibleFn}).filter(e=>text===null||(e.innerText||'').trim()===text||e.getAttribute('aria-label')===text);if(rows.length!==1)return null;const e=rows[0],r=e.getBoundingClientRect();let p=e.parentElement;while(p&&!(p.scrollHeight>p.clientHeight+1&&/auto|scroll/.test(getComputedStyle(p).overflowY)))p=p.parentElement;const b=p?p.getBoundingClientRect():{left:0,top:0,right:innerWidth,bottom:innerHeight};const top=Math.max(0,b.top),bottom=Math.min(innerHeight,b.bottom);if(r.top>=top&&r.bottom<=bottom)return null;return {x:Math.max(1,Math.min(innerWidth-1,(Math.max(0,b.left)+Math.min(innerWidth,b.right))/2)),y:Math.max(1,Math.min(innerHeight-1,(top+bottom)/2)),deltaY:r.top<top?-250:250}})()`);
      check(s,'occluded-control-not-scrollable');allowed();await cdp.call('Input.dispatchMouseEvent',{type:'mouseWheel',...s,deltaX:0});await sleep(150);
    }throw new Error('ordinary-scroll-did-not-reveal-target');
  };
  const settled=async()=>{const until=mono()+CAP.http;while([...requests.values()].some(r=>r.mutation)&&mono()<until)await sleep(50);check(!requestTimeout&&!failedMutation&&![...requests.values()].some(r=>r.mutation),'previous-action-request-not-settled');};
  const click=async(selector,text=null)=>{allowed();await settled();await reveal(selector,text);const e=await unique(selector,text);observe('hit-target',{selector,text:e.text,aria:e.aria,width:e.width,height:e.height,hit:e.hit});await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:e.x,y:e.y});allowed();await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:e.x,y:e.y,button:'left',clickCount:1});await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:e.x,y:e.y,button:'left',clickCount:1});return e;};
  const key=async(key,code,modifiers=0)=>{allowed();await cdp.call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await cdp.call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
  const fill=async(selector,value)=>{await click(selector);await key('a','KeyA',2);allowed();await cdp.call('Input.insertText',{text:value});};
  const waitFor=async(expression,predicate,ms=CAP.http)=>{const until=Math.min(mono()+ms,t0+CAP.total-15000);while(mono()<until){check(!disposing,'resource-abort-during-ui');const v=await evaluate(expression);if(predicate(v)){await settled();return v;}check(!requestTimeout,'browser-http-timeout');await sleep(200);}throw new Error('visible-state-timeout');};
  const snap=async(label)=>observe(label,await evaluate(`(()=>({origin:location.origin,city:document.querySelector('.map-levels-cur span')?.innerText||null,atlasCity:document.querySelector('.atlas-back[data-atlas-city]')?.dataset.atlasCity||null,wallet:document.querySelector('.hud-cash')?.getAttribute('aria-label')||null,venue:document.querySelector('[aria-label="Current venue"]')?.innerText?.slice(0,1600)||null,trip:[...document.querySelectorAll('[aria-label^="Travelling to "]')].filter(${visibleFn}).map(e=>({label:e.getAttribute('aria-label'),text:e.innerText.slice(0,1000)})),progress:document.querySelector('[aria-label="Current activity"]')?.innerText?.slice(0,1600)||null,alerts:[...document.querySelectorAll('[role="alert"],[role="status"]')].filter(${visibleFn}).map(e=>e.innerText.slice(0,500)).slice(0,16)}))()`));
  const wallet=async()=>{const t=await evaluate(`document.querySelector('.hud-cash')?.getAttribute('aria-label')||''`);const m=t.match(/^Wallet ₦([\d,]+)\./);check(m,'visible-wallet-unavailable');return Number(m[1].replaceAll(',',''));};
  const owner=async(kind,payload,ms=30000)=>{
    allowed();const id=randomUUID(),request={schema:1,id,kind,operatorId:OPERATOR,controllerSha256:review.controllerSha256,reviewSha256:review.reviewSha256,actor:actor?.key??null,...(actor?{guestPublicId:guestIdentities.get(actor.key)?.publicId}:{}),stage:{pid:stage.stagePid,port:stage.port,storeId:stage.storeId,deadline:stage.deadline},...payload};
    privateJson(join(runDir,id+'.request.json'),request);
    const requestBytes=boundedFile(join(runDir,id+'.request.json'),CAP.mailbox,true),requestHash=SHA(requestBytes);privateBytes+=requestBytes.length;check(privateBytes<=CAP.observations-65536,'owner-request-output-bound');process.send?.({type:'bytes',bytes:privateBytes});
    const until=Math.min(mono()+ms,actionDeadline);
    while(mono()<until&&!stopped){try{const bytes=boundedFile(join(runDir,id+'.response.json'),CAP.mailbox,true),r=JSON.parse(bytes);privateBytes+=bytes.length;check(privateBytes<=CAP.observations-65536,'owner-response-output-bound');process.send?.({type:'bytes',bytes:privateBytes});check(r.requestId===id&&r.requestSha256===requestHash&&r.ownerId===review.worldOwnerId&&r.verified===true,'owner-receipt-binding');return r;}catch(e){if(e.code!=='ENOENT')throw e;}await sleep(200);}throw new Error('owner-receipt-timeout');
  };
  const navigate=async(origin)=>{allowed();check([stage.origin,stage.origin.replace('127.0.0.1','localhost')].includes(origin),'approved-actor-origin');documents.delete(origin);await cdp.call('Page.navigate',{url:origin+'/'});await waitFor('location.origin',v=>v===origin);await waitFor('document.readyState',v=>v==='complete');const actual=documents.get(origin);check(actual&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(actual.remoteIPAddress)&&actual.remotePort===stage.port&&actual.status===200,'actual-browser-origin-resolution');observe('browser-origin-resolution',actual);};
  const viewport=async(width)=>{allowed();await cdp.call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await sleep(100);};
  const screenshot=async(label)=>{const screenshotUntil=mono()+CAP.screenshot,screenshotToken=randomUUID();process.send?.({type:'screenshot-deadline',token:screenshotToken,deadline:screenshotUntil});try{allowed();check(pngCount<CAP.pngCount,'png-count');const r=await cdp.call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false},CAP.cdp);check(typeof r.data==='string'&&r.data.length<=Math.ceil(CAP.png/3)*4,'png-encoded-bound');const bytes=Buffer.from(r.data,'base64');check(bytes.length<=CAP.png&&pngBytes+bytes.length<=CAP.pngTotal,'png-byte-bound');check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'png-format');const name=String(++pngCount).padStart(2,'0')+'-'+label+'.png';writeFileSync(join(runDir,name),bytes,{flag:'wx',mode:0o600});pngBytes+=bytes.length;check(mono()<=screenshotUntil,'screenshot-end-to-end-timeout');observe('actual-png',{file:name,sha256:SHA(bytes),bytes:bytes.length});}finally{process.send?.({type:'screenshot-finished',token:screenshotToken});}};
  const focusEvidence=async()=>{await key('Tab','Tab');return observe('focus-and-hit-targets',await evaluate(`(()=>{const a=document.activeElement,cs=a?getComputedStyle(a):null,controls=[...document.querySelectorAll('button,input,select,a[href]')].filter(${visibleFn}).slice(0,256);return {focus:a?{tag:a.tagName,label:a.getAttribute('aria-label'),text:(a.innerText||'').slice(0,160),outline:cs.outline,outlineOffset:cs.outlineOffset}:null,targets:controls.map(e=>{const r=e.getBoundingClientRect(),h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {tag:e.tagName,label:e.getAttribute('aria-label'),text:(e.innerText||'').slice(0,120),width:r.width,height:r.height,disabled:!!e.disabled,hit:!!h&&(h===e||e.contains(h))}}),iframes:[...document.querySelectorAll('iframe')].filter(${visibleFn}).map(e=>{const r=e.getBoundingClientRect();return {title:e.title,x:r.x,y:r.y,width:r.width,height:r.height}})}})()`));};
  const map=async()=>{if((await elements('.map-levels-cur,[data-atlas-levels]')).length)return;await click('button[aria-label="Open map"]');await waitFor('!!document.querySelector(".map-levels-cur,[data-atlas-levels]")',Boolean);};
  const level=async(n)=>{await map();if((await elements('.map-levels-cur')).length){await click('.map-levels-cur');await click('[data-map-level="world"]');}await waitFor('!!document.querySelector("[data-atlas-levels]")',Boolean);if(!(await elements('[data-atlas-level="'+n+'"]')).length)await click('[data-atlas-levels]');await click('[data-atlas-level="'+n+'"]');};
  const select=async(city,home=false)=>{
    await level(home?2:1);
    if(!(await elements('[data-atlas-search]')).length)await click('[data-atlas-list]');
    await fill('[data-atlas-search]',home?'Lagos':city.country);
    const sel=home?'[data-atlas-pick="state:lagos"]':'[data-atlas-pick="country:'+city.iso+'"]';
    await waitFor(`document.querySelector(${JSON.stringify(sel)})!==null`,Boolean);await click(sel);
    if(home && (await elements('[data-atlas-inspect-city="lagos"]')).length)await click('[data-atlas-inspect-city="lagos"]');
    const section='section[aria-label="Travel to '+city.name+'"]';
    await waitFor(`document.querySelector(${JSON.stringify(section)})?.innerText||''`,v=>v.includes('Go to '+city.name));
    observe('selected-playable-card',{country:home?'Nigeria':city.country,city:city.name,section:await evaluate(`document.querySelector(${JSON.stringify(section)})?.innerText`)});
    return section;
  };
  const travel=async(city,home=false)=>{
    allowed(45000);const beforeCash=await wallet(),section=await select(city,home),sel=section+' [data-atlas-go="'+city.id+':air"]';
    const e=await unique(sel);const fare='₦'+city.fare.toLocaleString('en-NG');check(e.text.includes(fare)&&e.aria?.includes('20 seconds'),'flight-quote-mismatch');
    observe('flight-quoted',{actor:actor.key,city:city.id,fare:city.fare,seconds:20,home});
    const startedAt=mono();await click(sel);
    const confirm=section+' [data-atlas-sure]';
    if((await elements(confirm)).length){const c=await unique(confirm);check(c.text==='Pay '+fare+' and go','fare-confirmation-mismatch');await click(confirm);}
    const trip=`[role="group"][aria-label="Travelling to ${city.name}"]`;
    await waitFor(`document.querySelector(${JSON.stringify(trip)})?.innerText||''`,v=>typeof v==='string'&&v.length>0);
    await snap('flight-started-'+city.id);await sleep(1000);await snap('flight-natural-progress-'+city.id);
    await waitFor(`(()=>({trip:!!document.querySelector(${JSON.stringify(trip)}),city:document.querySelector('.atlas-back[data-atlas-city]')?.dataset.atlasCity||null,mapCity:document.querySelector('.map-levels-cur span')?.innerText||null}))()`,v=>!v.trip&&(v.city===city.id||v.mapCity===city.name),45000);
    check(mono()-startedAt>=19500,'arrival-too-early-for-natural-flight');
    const afterCash=await wallet();check(beforeCash-afterCash===city.fare,'flight-wallet-delta');
    activeCity=city.id;await snap('arrived-'+city.id);
  };
  const enterOwnedHome=async(city)=>{
    allowed(45000);await click('[data-nav="home"]');await waitFor(`!!document.querySelector('.map-card [aria-label="How to travel"]')||document.querySelector('[aria-label="Current venue"] .life-venue-heading p')?.innerText.includes('Private')`,Boolean);let localFare=0,seconds=0;
    // Home navigation shows the actual home scene if already there, otherwise
    // its ordinary travel card. Ownership panels never count as arrival.
    if((await elements('.map-card [aria-label="How to travel"] button')).length){
      const modes=(await elements('.map-card [aria-label="How to travel"] button')).filter(x=>!x.disabled).map(x=>{const m=x.aria?.match(/^(.+), (Free|₦[\d,]+), (\d+) seconds(?:,.*)?$/);return m?{aria:x.aria,fare:m[2]==='Free'?0:Number(m[2].slice(1).replaceAll(',','')),seconds:Number(m[3])}:null;}).filter(x=>x&&x.seconds>0&&x.seconds<=30).sort((a,b)=>a.fare-b.fare||a.seconds-b.seconds);
      check(modes.length>0,'no-bounded-visible-home-route');const chosen=modes[0];check(modes.filter(x=>x.aria===chosen.aria).length===1,'ambiguous-home-route');
      await click('.map-card [aria-label="How to travel"] button',chosen.aria);const before=await wallet(),start=mono();await click('.map-card .map-go');
      await waitFor(`!!document.querySelector('[role="group"][aria-label^="Travelling to "]')`,Boolean);
      await snap('local-home-trip-started');await waitFor(`!!document.querySelector('[role="group"][aria-label^="Travelling to "]')`,v=>!v,(chosen.seconds+15)*1000);
      check(mono()-start>=chosen.seconds*1000-500,'local-home-trip-too-fast');localFare=before-await wallet();check(localFare===chosen.fare,'local-home-fare-mismatch');seconds=chosen.seconds;await click('[data-nav="home"]');
    }
    await waitFor(`document.querySelector('[aria-label="Current venue"] h1')?.innerText||null`,v=>v===homeHeading);
    const line=await evaluate(`document.querySelector('[aria-label="Current venue"] .life-venue-heading p')?.innerText||""`);check(line.includes('Private'),'rendered-private-home-required');
    await snap('actual-owned-home-arrival-'+city.id);await screenshot(city.id+'-owned-home');return {localFare,seconds,renderedHomeHeading:homeHeading,renderedPrivateHome:true};
  };
  const onboard=async()=>{
    await waitFor('document.querySelector("[data-cr-root]")?.getAttribute("data-mode")',v=>v==='new');
    await fill('[data-qs-name]',actor.name);
    for(const current of ['who','look','spirit','home','ready']){
      await waitFor('document.querySelector("[data-cr-root]")?.getAttribute("data-step")',v=>v===current);
      if(current==='home'){
        const states=await elements('[aria-label="State"] button');if(states.some(x=>x.text==='Lagos'))await click('[aria-label="State"] button','Lagos');
        const cities=await elements('[aria-label="City"] button');if(cities.some(x=>x.text==='Lagos'))await click('[aria-label="City"] button','Lagos');
        await fill('[data-key="area:search"]','Ikeja');
        await click('[data-lga]');
        const house=await evaluate('document.querySelector("[data-cr-house]")?.innerText||""');check(house.includes('Ikeja'),'onboarding-home-mismatch');
      }
      const next=(await elements('[data-key="next"]')).length?'[data-key="next"]':'[data-key="primary"]';
      await click(next);
    }
    // New-mode runSettle awaits each server action and closes the creator.
    // Its "Your character has moved in" screen exists only in settle mode.
    await waitFor(`![...document.querySelectorAll('[data-cr-root]')].some(${visibleFn})&&!!document.querySelector('.hud-cash')`,Boolean,30000);
    activeCity='lagos';await click('[data-nav="home"]');homeHeading=await waitFor(`document.querySelector('[aria-label="Current venue"] h1')?.innerText||null`,v=>typeof v==='string'&&v.includes('Ikeja'));await snap('fresh-home-onboarding');
  };
  const activity=async(city)=>{
    if((await elements('.atlas-back[data-atlas-city="'+city.id+'"]')).length)await click('.atlas-back[data-atlas-city="'+city.id+'"]');
    await key('Escape','Escape');
    const expand=await elements('button[aria-label="Show activities"]');if(expand.length)await click('button[aria-label="Show activities"]');
    await waitFor('document.querySelectorAll(".life-actions button.life-action").length',v=>v>0);
    const choices=await evaluate(`(()=>{const vis=${visibleFn};return [...document.querySelectorAll('.life-actions button.life-action')].filter(e=>vis(e)&&!e.disabled&&e.getAttribute('aria-busy')!=='true').map(e=>({aria:e.getAttribute('aria-label'),label:e.querySelector('.life-action-title')?.innerText,price:e.querySelector('.life-action-meta strong')?.innerText,seconds:Number(e.querySelector('.life-action-meta')?.innerText.match(/(\\d+)s/)?.[1]||0)})).filter(x=>x.seconds>0&&x.seconds<=20&&x.price==='Free').sort((a,b)=>a.seconds-b.seconds||a.label.localeCompare(b.label))})()`);
    check(choices.length>0,'no-visible-short-free-local-activity');const chosen=choices[0];
    check(choices.filter(x=>x.aria===chosen.aria).length===1,'ambiguous-local-activity');allowed(chosen.seconds*1000+20000);
    observe('local-activity-quote',{city:city.id,...chosen});const before=await wallet(),start=mono(),requestOffset=normalActivities.length;
    await click('.life-actions button.life-action',chosen.aria);
    await waitFor('document.querySelector("[aria-label=\"Current activity\"] strong")?.innerText||null',v=>v===chosen.label);
    await snap('activity-started');await waitFor('!!document.querySelector("[aria-label=\"Current activity\"]")',v=>v===false,(chosen.seconds+20)*1000);
    check(mono()-start>=chosen.seconds*1000-500,'activity-finished-too-early');
    const after=await wallet();check(after===before,'free-activity-wallet-delta');
    const sent=normalActivities.slice(requestOffset).filter(x=>x.origin===(actor.key==='A'?stage.origin:stage.origin.replace('127.0.0.1','localhost'))&&x.body.cityId===city.id);const ids=new Set(sent.map(x=>x.body.actionId));check(ids.size===1&&sent.every(x=>JSON.stringify(x.body)===JSON.stringify(sent[0].body)),'one-normal-activity-request-required');const result=await owner('verify-local-activity-result',{actionRequest:sent[0].body,city:city.id,label:chosen.label,displayedCost:0,displayedSeconds:chosen.seconds,beforeCash:before,afterCash:after,required:'Actual normal action completed once, success/result and protected-state deltas read from owner-side baseline; no direct action or save writes.'});
    check(result.actionSucceeded===true&&result.completedOnce===true&&result.cost===0&&result.seconds===chosen.seconds&&HASH.test(result.resultSha256),'local-activity-result-evidence');
    await snap('activity-completed');
  };
  try {
    check(mono()-t0<CAP.ready,'driver-bootstrap-expired');
    const resolved=await lookup('localhost');check(['127.0.0.1','::1'].includes(resolved.address),'localhost-resolution');
    const version=await httpJson('http://127.0.0.1:'+cdpPort+'/json/version');browserCdp=await Cdp.connect(version.webSocketDebuggerUrl);
    const targets=await httpJson('http://127.0.0.1:'+cdpPort+'/json/list'),pages=targets.filter(t=>t.type==='page');check(pages.length===1&&pages[0].url==='about:blank','one-owned-fresh-game-tab');cdp=await Cdp.connect(pages[0].webSocketDebuggerUrl);
    cdp.onEvent=(method,p)=>{
      if(method==='Network.requestWillBeSent' && /^https?:/.test(p.request.url) && p.type!=='WebSocket'){
        const old=requests.get(p.requestId);if(old)clearTimeout(old.timer);
        const mutation=!['GET','HEAD','OPTIONS'].includes(p.request.method);
        try{const u=new URL(p.request.url);if(actor&&u.origin===(actor.key==='A'?stage.origin:stage.origin.replace('127.0.0.1','localhost'))){if(u.pathname==='/api/session'&&p.request.method==='POST'){check(sessionRequests.size<8,'session-witness-count-bound');sessionRequests.set(p.requestId,{actor:actor.key,origin:u.origin,method:'POST',url:u.origin+'/api/session',status:null});}if(u.pathname==='/api/action'&&p.request.method==='POST'&&typeof p.request.postData==='string'&&p.request.postData.length<=4096){const b=JSON.parse(p.request.postData);if(b.type==='activity'){check(normalActivities.length<32,'normal-activity-request-bound');normalActivities.push({origin:u.origin,body:b});}}}}catch{identityReadFailure=true;}
        const timer=setTimeout(()=>{requestTimeout=true;stopped=true;void cdp.call('Page.stopLoading').catch(()=>{});},CAP.http);
        requests.set(p.requestId,{mutation,timer});
      }
      if(method==='Network.responseReceived'&&sessionRequests.has(p.requestId)){const held=sessionRequests.get(p.requestId);held.status=p.response.status;held.remoteIPAddress=p.response.remoteIPAddress;held.remotePort=p.response.remotePort;}
      if(method==='Network.responseReceived' && p.type==='Document'){
        try{const u=new URL(p.response.url);documents.set(u.origin,{origin:u.origin,remoteIPAddress:p.response.remoteIPAddress,remotePort:p.response.remotePort,status:p.response.status});}catch{}
      }
      if(method==='Network.responseReceived' && requests.get(p.requestId)?.mutation && p.response.status>=400)failedMutation=true;
      if(method==='Network.loadingFinished'||method==='Network.loadingFailed'){
        if(method==='Network.loadingFinished'&&sessionRequests.has(p.requestId)){const observed=sessionRequests.get(p.requestId);sessionRequests.delete(p.requestId);identityReads=identityReads.then(async()=>{check(observed.status===200&&observed.remotePort===stage.port&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(observed.remoteIPAddress),'normal-session-response-origin');const result=await cdp.call('Network.getResponseBody',{requestId:p.requestId});check(!result.base64Encoded&&typeof result.body==='string'&&Buffer.byteLength(result.body)<=4096,'normal-session-response-bound');const body=JSON.parse(result.body),pub=body.session;check(typeof pub?.id==='string'&&/^[0-9a-f-]{36}$/i.test(pub.id)&&pub.name==='Cloud Astra '+observed.actor,'actual-browser-guest-identity');const prior=guestIdentities.get(observed.actor);check(!prior||prior.publicId===pub.id,'browser-guest-identity-changed');guestIdentities.set(observed.actor,{publicId:pub.id,name:pub.name,origin:observed.origin,method:observed.method,url:observed.url,status:200,responseSha256:SHA(result.body)});}).catch(()=>{identityReadFailure=true;});}
        const r=requests.get(p.requestId);if(r){if(method==='Network.loadingFailed'&&r.mutation)failedMutation=true;clearTimeout(r.timer);requests.delete(p.requestId);}
      }
    };
    await cdp.call('Page.enable');await cdp.call('Runtime.enable');await cdp.call('Network.enable');
    const origins=[stage.origin,stage.origin.replace('127.0.0.1','localhost')];
    const empty=await cdp.call('Network.getCookies',{urls:origins.map(x=>x+'/')});check(empty.cookies.length===0,'fresh-profile-cookie-proof');
    const publication=await owner('publish-live-pre-ui-provenance',{provenance:init.liveProvenance,origins,localhostResolved:resolved.address,cookiesBeforeOnboarding:0,ownedPageCount:pages.length,required:'Publish safe exact source/controller/package/review bindings, actual lease/process handles, deadlines and initial aggregate RSS before first UI action. No private control, profile, cookie, store ID or actor state in the public receipt.'},20000);
    check(publication.published===true&&named(publication.publicationReference),'pre-ui-publication-required');
    const originProofs=[];for(const origin of origins){await navigate(origin);const cookies=await cdp.call('Network.getCookies',{urls:origins.map(x=>x+'/')});check(cookies.cookies.length===0,'pre-onboarding-origin-cookie-leak');originProofs.push(documents.get(origin));}
    await navigate(origins[0]);const returnedCookies=await cdp.call('Network.getCookies',{urls:origins.map(x=>x+'/')});check(returnedCookies.cookies.length===0,'return-a-pre-onboarding-cookie-leak');observe('both-origins-before-onboarding',{originProofs,normalReturnToA:true,cookies:0});
    check(mono()-t0<CAP.ready,'readiness-deadline');process.send?.({type:'ready'});observe('origin-cookie-preflight',{origins,localhostResolved:resolved.address,cookiesBeforeOnboarding:0,ownedPageCount:pages.length,publicationReference:publication.publicationReference});
    for(const [index,a] of ACTORS.entries()){
      actor=a;allowed(120000);await viewport(390);await navigate(origins[index]);
      if(index===1){const cookieB=await cdp.call('Network.getCookies',{urls:[origins[1]+'/']});check(!cookieB.cookies.some(c=>/^(?:sid|__Host-sid)$/.test(c.name)),'cross-origin-session-leak');}
      await onboard();await identityReads;check(!identityReadFailure&&guestIdentities.has(a.key),'browser-onboarding-public-id-required');if(index===1)check(guestIdentities.get('A').publicId!==guestIdentities.get('B').publicId,'distinct-actual-guest-public-ids');const startCash=await wallet();
      const baseline=await owner('capture-baseline-and-fund-once',{guestIdentityEvidence:guestIdentities.get(a.key),name:a.name,onboardingCash:startCash,homeCity:'lagos',homeArea:'Ikeja',amount:2000000,required:'Persist ONE root-authorized intent before POST /api/admin/players/:id/act. Replay identical clientId and payload only. Preserve private identity/home/ownership/inventory and original ledger/receipt prefixes. Do not issue another intent after ambiguity.'});
      check(baseline.onboardingCash===startCash&&baseline.amount===2000000&&baseline.duplicate===true&&baseline.creditEffects===1&&baseline.walletEffects===1&&baseline.receiptEffects===1&&baseline.auditEffects===1&&baseline.replayBalanceDelta===0&&baseline.fundedCash===startCash+2000000&&HASH.test(baseline.protectedBaselineSha256)&&HASH.test(baseline.intentSha256),'once-only-funding-evidence');
      await navigate(origins[index]);await waitFor('document.querySelector(".hud-cash")?.getAttribute("aria-label")||""',v=>v.includes('₦'+baseline.fundedCash.toLocaleString('en-NG')));
      if(index===0){const aCookies=await cdp.call('Network.getCookies',{urls:[origins[0]+'/']}),bCookies=await cdp.call('Network.getCookies',{urls:[origins[1]+'/']});check(aCookies.cookies.some(c=>/^(?:sid|__Host-sid)$/.test(c.name))&&!bCookies.cookies.some(c=>/^(?:sid|__Host-sid)$/.test(c.name)),'actor-cookie-isolation');observe('cookie-isolation',{actorASessionPresent:true,actorBSessionAbsent:true});}
      for(const city of a.cities){
        allowed(110000);attempted.add(city.id);await travel(city);await activity(city);
        await map();for(const width of [320,390]){await viewport(width);await focusEvidence();await screenshot(city.id+'-'+width);await snap(city.id+'-map-'+width);}
        await travel({id:'lagos',name:'Lagos',fare:city.fare},true);
        const homeArrival=await enterOwnedHome(city);const cash=await wallet();const checkpoint=await owner('verify-city-home-checkpoint',{city:city.id,homeCity:'lagos',cash,...homeArrival,baselineSha256:baseline.protectedBaselineSha256,required:'Compare protected identity/home/ownership/inventory and original ledger/receipt prefixes; reconcile only actual fares/local-activity/wallet/location deltas.'});
        check(checkpoint.protectedStatePreserved===true&&checkpoint.prefixesPreserved===true&&checkpoint.cash===cash&&checkpoint.roundTripFare===city.fare*2&&checkpoint.actualCity==='lagos'&&checkpoint.actualLocation==='home'&&checkpoint.ownedHome===true&&checkpoint.localHomeFare===homeArrival.localFare,'home-checkpoint-evidence');
        completed.push(city.id);observe('city-home-complete',{city:city.id,roundTripFare:city.fare*2,localHomeFare:homeArrival.localFare,renderedHome:true,cash});
        if(!restartVerified){const r=await owner('one-exact-sigwinch-restart',{completedCity:city.id,cash,required:'WORLD performs exactly ONE SIGWINCH on recorded helper PID; same SQLite store/port; no timer renewal. Reply only after actual restart count 1 and readiness. No INT/TERM/HUP.'});check(r.signal==='SIGWINCH'&&r.restartCount===1&&r.sameStore===true&&r.port===stage.port&&r.deadline===stage.deadline,'exact-restart-evidence');await navigate(origins[index]);await waitFor('!!document.querySelector(".hud-cash")',Boolean);check(await wallet()===cash,'reconnect-wallet');const saved=await owner('verify-reloaded-state',{cash,baselineSha256:baseline.protectedBaselineSha256,required:'Actual saved identity/home/wallet/receipt and original protected prefixes after browser reload.'});check(saved.identityHomeWalletReceiptPreserved===true&&saved.prefixesPreserved===true,'saved-reconnect-evidence');restartVerified=true;await snap('same-store-reconnect');}
      }
    }
  } catch(e) {observe('partial-gap',{code:/^[a-z0-9-]+$/.test(e.message)?e.message:'unclassified-ui-failure',actor:actor?.key??null,city:activeCity});}
  finally {
    // Restoring emulation/closing our tab is cleanup, never a new gameplay action.
    try{if(cdp&&!cdp.closed)await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});}catch{}
    try{if(browserCdp&&!browserCdp.closed)await browserCdp.call('Browser.close');}catch{}
    cdp?.close();browserCdp?.close();
    for(const r of requests.values())clearTimeout(r.timer);requests.clear();
    const all=ACTORS.flatMap(a=>a.cities.map(c=>c.id));
    const result={completedCities:completed,incompleteCities:all.filter(c=>attempted.has(c)&&!completed.includes(c)),unvisitedCities:all.filter(c=>!attempted.has(c)),restartVerified,outputs:{pngCount,pngBytes,observationBytes:privateBytes},activeCity,actor:actor?.key??null};
    const bytes=Buffer.from(JSON.stringify({result,observations})+'\n');check(bytes.length<=CAP.observations,'observations-file-bound');writeFileSync(join(runDir,'private-ui-observations.json'),bytes,{flag:'wx',mode:0o600});
    process.send?.({type:'done',result});process.disconnect?.();
  }
}


// The public --run entry remains outside the potentially blocked controller
// event loop. It starts before preflight and tracks PID birth/group identities.
async function independentWatchdog(argv){
  argsOf(argv);const mine=proc(process.pid);check(mine?.pgid===mine.pid,'watchdog-setsid-required');born=linuxBirthMono(mine);
  const privateRoot=BASE+'/private';mkdirSync(privateRoot,{recursive:true,mode:0o700});
  const evidence=join(privateRoot,'astra-watchdog-'+randomUUID());mkdirSync(evidence,{mode:0o700});
  const roots=[mine],remembered=new Map([[mine.pid,mine.start]]);let ready=false,last=mono(),peak=mine.rss,bytes=0,failure=null,ownerContext=null,ownerRegistered=false,reportedOutput=0,screenshotOperation=null,screenshotTimer=null;
  const c=fork(SELF,['--supervisor',...argv],{detached:true,stdio:['ignore','pipe','pipe','ipc'],execArgv:['--max-old-space-size=256'],env:{...process.env,ASTRA_WATCHDOG_PID:String(mine.pid),ASTRA_WATCHDOG_START:mine.start}});
  const child=proc(c.pid);check(child&&child.pgid===child.pid,'watchdog-child-group');roots.push(child);
  const record=()=>({schema:1,status:'PARTIAL',failure,t0MonoMs:born,phaseDeadlineMonoMs:born+CAP.total,peakRssBytes:peak,producerOutputBytes:bytes,roots:roots.map(({pid,pgid,start})=>({pid,pgid,startTicks:start})),remembered:[...remembered].map(([pid,startTicks])=>({pid,startTicks})),emergencyCleanup:true,leaseReleaseEligible:false});
  privateJson(join(evidence,'launch.json'),{t0MonoMs:born,roots:record().roots});
  for(const stream of [c.stdout,c.stderr])stream.on('data',b=>{bytes+=b.length;if(bytes>CAP.observations)failure??='producer-output-bound';});
  c.on('message',m=>{if(m?.type==='ready')ready=true;if(m?.type==='owner-context')ownerContext=m;if(m?.type==='resource-failure')failure??='controller-resource-failure';if(m?.type==='output-bytes')reportedOutput=Math.max(reportedOutput,m.bytes);if(m?.type==='screenshot-deadline'){if(screenshotOperation||typeof m.token!=='string'||!Number.isFinite(m.deadline)||m.deadline>mono()+CAP.screenshot){failure??='invalid-screenshot-budget';return;}screenshotOperation=m;screenshotTimer=setTimeout(()=>{failure??='screenshot-end-to-end-15s';try{privateJson(join(evidence,'screenshot-emergency.json'),record());}catch{}for(const root of roots.slice(1))signalOwned(root,'SIGKILL',remembered);},Math.max(1,m.deadline-mono()));}if(m?.type==='screenshot-finished'){if(!screenshotOperation||screenshotOperation.token!==m.token){failure??='screenshot-operation-binding';return;}if(mono()>screenshotOperation.deadline)failure??='screenshot-end-to-end-15s';clearTimeout(screenshotTimer);screenshotOperation=null;}});c.on('error',()=>{failure??='controller-spawn-failure';});
  try{while(liveChild(c)){
    if(ownerContext&&!ownerRegistered){try{const o=jsonFile(join(ownerContext.runDir,'owner-registration.json'));const p=proc(o.pid);check(p&&p.start===o.startTicks&&o.ownerHelperSha256===ownerContext.ownerHelperSha256&&o.ownerHelperPath===ownerContext.ownerHelperPath,'owner-registration-binding');check(readFileSync('/proc/'+o.pid+'/cmdline','utf8').split('\0').includes(o.ownerHelperPath),'actual-owner-helper-command');check(SHA(boundedFile(o.ownerHelperPath,262144))===o.ownerHelperSha256,'actual-owner-helper-source');roots.push(p);remembered.set(p.pid,p.start);privateJson(join(ownerContext.runDir,'owner-watchdog-ack.json'),{pid:p.pid,startTicks:p.start,ownerHelperSha256:o.ownerHelperSha256});ownerRegistered=true;}catch(e){if(e.code!=='ENOENT')throw e;}}
    if(ownerRegistered){const budget=jsonFile(join(ownerContext.runDir,'owner-budget.json'));check(Number.isSafeInteger(budget.bytes)&&budget.bytes>=0,'owner-budget-shape');if(reportedOutput+budget.bytes>CAP.observations)failure??='aggregate-controller-owner-output-bound';}
    const now=mono();if(now-last>CAP.maxSampleGap)failure??='independent-sample-gap';last=now;
    const rows=ownedRows(roots,remembered),rss=rows.reduce((n,p)=>n+p.rss,0);peak=Math.max(peak,rss);
    if(rss>CAP.rss)failure??='aggregate-rss-bound';if(!ready&&now-born>=CAP.ready)failure??='readiness-120s';if(now-born>=CAP.total-10000)failure??='overall-emergency-890s';
    if(failure){privateJson(join(evidence,'emergency.json'),record());for(const root of roots.slice(1))signalOwned(root,'SIGKILL',remembered);break;}
    await sleep(CAP.sample);
  }}catch(e){failure??=/^[a-z0-9-]+$/.test(e.message)?e.message:'watchdog-monitor-failure';try{privateJson(join(evidence,'emergency.json'),record());}catch{}for(const root of roots.slice(1))signalOwned(root,'SIGKILL',remembered);}
  clearTimeout(screenshotTimer);
  let left=ownedRows(roots,remembered).filter(p=>p.pid!==mine.pid&&p.state!=='Z');
  while(left.length&&mono()<born+CAP.total-500){for(const p of left)if(proc(p.pid)?.start===p.start)try{process.kill(p.pid,'SIGKILL');}catch{}await sleep(100);left=ownedRows(roots,remembered).filter(p=>p.pid!==mine.pid&&p.state!=='Z');}
  privateJson(join(evidence,'terminal.json'),{...record(),emergencyCleanup:Boolean(failure||left.length),ownedDescendantsAbsent:left.length===0,controllerExitCode:c.exitCode,controllerExitSignal:c.signalCode});
  process.stdout.write(JSON.stringify({watchdogEvidence:evidence,status:failure?'PARTIAL':'OWNER_FINALIZATION_REQUIRED',leaseReleaseEligible:false})+'\n');process.exitCode=failure||left.length?2:c.exitCode??2;
}

if(process.argv[2]==='--driver'){
  check(process.send && process.connected && process.argv.length===3,'driver-requires-owned-ipc');
  const init=await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('driver-init-timeout')),5000);process.once('message',m=>{clearTimeout(t);check(m?.type==='init','driver-init');resolve(m);});});
  await uiDriver(init);
}else if(process.argv[2]==='--supervisor'){
  try{await supervisor(process.argv.slice(3));}catch{process.stderr.write('Launch refused: exact review, source pins, quota, capabilities or ownership failed. No UI acceptance claimed.\n');process.exitCode=2;}
}else if(process.argv[2]==='--run'){
  try{await independentWatchdog(process.argv.slice(2));}catch{process.stderr.write('Independent launch watchdog refused. No acceptance claimed.\n');process.exitCode=2;}
}else{
  process.stderr.write('SOURCE ONLY. Syntax check: node --check '+SELF+' . Execution requires explicit independently reviewed --run --review PRIVATE_JSON --review-sha256 EXACT_SHA under setsid.\n');process.exitCode=2;
}
