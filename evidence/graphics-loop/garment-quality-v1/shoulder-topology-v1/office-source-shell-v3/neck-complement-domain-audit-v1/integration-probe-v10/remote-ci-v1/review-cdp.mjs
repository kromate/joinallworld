import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { closeSync, createReadStream, existsSync, mkdirSync, openSync, readSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { verifySnapshot } from './verify-snapshot.mjs';
import { browserResultPaths } from './browser-result-contract.mjs';
import { pageEvaluationError } from './cdp-exception.mjs';
import { createGlbRequestLifecycle, strictNetworkGateFailure } from './glb-request-lifecycle.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url)),ROOT=path.resolve(HERE,'../../../../../../../..'),DIST=path.join(HERE,'dist');
const RESULT=process.env.RESULT_DIR,PATHS=browserResultPaths(RESULT),OUTPUT=PATHS.output,expected=process.argv[2];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fileSha(file){const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');}
function first4(file){const fd=openSync(file,'r'),b=Buffer.alloc(4);try{return readSync(fd,b,0,4,0)===4?b:null;}finally{closeSync(fd);}}
if(process.platform!=='linux')throw new Error('Remote Linux only');
const snapshot=await verifySnapshot(expected);
if(existsSync(OUTPUT)&&readdirSync(OUTPUT).length)throw new Error('Refusing to overwrite browser artifacts');
mkdirSync(OUTPUT,{recursive:true});
const chromeLauncherPath=await realpath(process.env.CHROME_BIN??''),launcherSha=await fileSha(chromeLauncherPath),sibling=path.join(path.dirname(chromeLauncherPath),'chrome');
const chromePath=existsSync(sibling)&&first4(sibling)?.equals(Buffer.from([0x7f,0x45,0x4c,0x46]))?await realpath(sibling):chromeLauncherPath;
if(!first4(chromePath)?.equals(Buffer.from([0x7f,0x45,0x4c,0x46])))throw new Error('Could not resolve Chrome ELF');
const runtime={node:process.version,platform:process.platform,kernel:os.release(),arch:os.arch(),runnerImage:process.env.ImageOS??null,runnerVersion:process.env.ImageVersion??null,chromeLauncherPath,chromeLauncherSha256:launcherSha,chromePath,chromeVersion:execFileSync(chromeLauncherPath,['--version'],{encoding:'utf8',timeout:3000}).trim(),chromeBinaryVersion:execFileSync(chromePath,['--version'],{encoding:'utf8',timeout:3000}).trim(),chromeSha256:await fileSha(chromePath),manifestSha256:snapshot.manifestSha256,diagnostic:'Exact shipped-GLB fetch/parse vs Three FileLoader; no avatar renderer or mobile-performance claim'};
const stageFile=PATHS.stages,stageStart=Date.now();
function stage(name,details={}){writeFileSync(stageFile,`${JSON.stringify({at:new Date().toISOString(),elapsedMs:Date.now()-stageStart,stage:name,...details})}\n`,{flag:'a'});}
if(existsSync(stageFile))throw new Error('Refusing to overwrite browser stages');
stage('controller-started',{runtime});
const mime=new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.glb','model/gltf-binary'],['.json','application/json']]);
const server=createServer(async(req,res)=>{try{if(!['GET','HEAD'].includes(req.method??'')){res.writeHead(405).end();return;}const url=new URL(req.url??'/','http://127.0.0.1');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}const requestPath=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),file=path.resolve(DIST,`.${requestPath}`),rel=path.relative(DIST,file);if(!rel||rel.startsWith('..')||path.isAbsolute(rel)){res.writeHead(403).end();return;}const data=await readFile(file);res.writeHead(200,{'content-type':mime.get(path.extname(file))??'application/octet-stream','cache-control':'no-store','content-length':data.byteLength});res.end(req.method==='HEAD'?undefined:data);}catch{res.writeHead(404,{'cache-control':'no-store'}).end('not found');}});
let chrome=null,ws=null,profile,chromeLog,serverClosed=false,nextId=0,currentWebsocketUrl;const pending=new Map(),requestUrls=new Map(),lifecycle=createGlbRequestLifecycle(),events={runtimeExceptions:[],consoleErrors:[],failedRequests:[],httpErrors:[]};
function cdp(method,params={}){const id=++nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},8000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});}
function onMessage(data){const m=JSON.parse(data.toString());if(m.id){const item=pending.get(m.id);if(!item)return;clearTimeout(item.timer);pending.delete(m.id);if(m.error)item.reject(new Error(`${m.error.message}: ${JSON.stringify(m.error.data??null)}`));else item.resolve(m.result);return;}if(m.method==='Runtime.exceptionThrown')events.runtimeExceptions.push(m.params.exceptionDetails);if(m.method==='Runtime.consoleAPICalled'&&m.params.type==='error')events.consoleErrors.push(m.params.args?.map(a=>a.value??a.description??'').join(' '));if(m.method==='Network.requestWillBeSent'){requestUrls.set(m.params.requestId,m.params.request.url);lifecycle.onRequest(m.params);}if(m.method==='Network.responseReceived'){lifecycle.onResponse(m.params);if(m.params.response.status>=400)events.httpErrors.push({url:m.params.response.url,status:m.params.response.status});}if(m.method==='Network.dataReceived')lifecycle.onData(m.params);if(m.method==='Network.loadingFinished')lifecycle.onFinished(m.params);if(m.method==='Network.loadingFailed'){lifecycle.onFailed(m.params);events.failedRequests.push({requestId:m.params.requestId,url:requestUrls.get(m.params.requestId)??null,errorText:m.params.errorText,canceled:m.params.canceled});}}
async function evaluate(expression,awaitPromise=false){const r=await cdp('Runtime.evaluate',{expression,awaitPromise,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw pageEvaluationError(r.exceptionDetails);return r.result?.value;}
async function waitFor(predicate,description,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw new Error(`Timed out waiting for ${description}`);}
async function devtoolsPort(){const p=path.join(profile,'DevToolsActivePort');await waitFor(()=>existsSync(p),'Chrome DevToolsActivePort');const port=Number(readFileSync(p,'utf8').trim().split(/\r?\n/)[0]);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid DevTools port');return port;}
async function connect(port){let targets;await waitFor(async()=>{try{const r=await fetch(`http://127.0.0.1:${port}/json/list`);targets=await r.json();return Array.isArray(targets)&&targets.some(t=>t.type==='page'&&t.webSocketDebuggerUrl);}catch{return false;}},'Chrome page target');const target=targets.find(t=>t.type==='page'&&t.webSocketDebuggerUrl);currentWebsocketUrl=target.webSocketDebuggerUrl;ws=new WebSocket(currentWebsocketUrl);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});ws.on('message',onMessage);await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Log.enable');await cdp('Network.enable');await cdp('Network.setCacheDisabled',{cacheDisabled:true});}
async function cleanup(){if(ws?.readyState===WebSocket.OPEN)try{ws.close();}catch{}if(chrome&&chrome.exitCode===null){chrome.kill('SIGTERM');await Promise.race([new Promise(resolve=>chrome.once('exit',resolve)),new Promise(r=>setTimeout(r,1000))]);if(chrome.exitCode===null)chrome.kill('SIGKILL');}if(!serverClosed){serverClosed=true;await new Promise(resolve=>server.close(()=>resolve()));}if(chromeLog!==undefined)closeSync(chromeLog);if(profile)rmSync(profile,{recursive:true,force:true});}
let failure=null,report=null,serverAddress=null;
try{
 if(!existsSync(path.join(DIST,'index.html'))||!existsSync(path.join(DIST,'build-manifest.json')))throw new Error('Static diagnostic bundle missing');
 serverAddress=await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve(server.address()));});if(!serverAddress||typeof serverAddress==='string'||serverAddress.address!=='127.0.0.1')throw new Error('Diagnostic server is not loopback-only');stage('server-ready',{address:serverAddress.address,port:serverAddress.port});
 profile=await mkdtemp(path.join(os.tmpdir(),'glb-loader-diagnostic-'));chromeLog=openSync(path.join(OUTPUT,'chrome.log'),'wx');const args=['--single-process','--in-process-gpu','--no-zygote','--renderer-process-limit=1','--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu-sandbox','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'];
 stage('chrome-before',{chromePath,args:args.filter(a=>a.startsWith('--'))});chrome=spawn(chromePath,args,{stdio:['ignore','ignore',chromeLog],env:{...process.env}});stage('chrome-after',{pid:chrome.pid});
 const port=await devtoolsPort();stage('cdp-port',{port});await connect(port);stage('cdp-connected',{websocketTarget:currentWebsocketUrl});const url=`http://127.0.0.1:${serverAddress.port}/`;stage('navigation-before',{url});await cdp('Page.navigate',{url});stage('navigation-after',{url});await waitFor(async()=>evaluate('Boolean(window.__GLB_ABORT_DIAGNOSTIC__?.run)'),'diagnostic API');stage('api-ready');
 report=await evaluate('window.__GLB_ABORT_DIAGNOSTIC__.run()',true);stage('cases-complete',{caseCount:report?.cases?.length,abortCount:report?.abortControllerCalls?.length});await new Promise(r=>setTimeout(r,150));
 const pendingGlb=lifecycle.pending(),networkFailures=strictNetworkGateFailure(events,pendingGlb);const failedCases=(report?.cases??[]).filter(item=>item.ok!==true);const glbRequests=lifecycle.snapshot();
 const glbGate=glbRequests.filter(x=>/\.glb(?:[?#]|$)/i.test(x.url));if(glbGate.length===0)networkFailures.push('no-glb-requests');
 const final={status:networkFailures.length===0&&failedCases.length===0?'measured':'failed',runtime,apiReport:report,requestLifecycle:glbRequests,pendingGlbRequestIds:pendingGlb,events,failedCases,networkFailures};
 writeFileSync(path.join(OUTPUT,'review-results.json'),`${JSON.stringify(final,null,2)}\n`,{flag:'wx'});stage('result-written',{status:final.status,failedCases:failedCases.length,glbRequestCount:glbGate.length,networkFailures});if(final.status!=='measured')failure=new Error(`Strict GLB diagnostic failed: ${networkFailures.join(',')} ${failedCases.length} failed cases`);
}catch(error){failure=error instanceof Error?error:new Error(String(error));try{stage('controller-error',{error:failure.stack??failure.message,requestLifecycle:lifecycle.snapshot(),events});}catch{}}
finally{await cleanup();}
if(failure){console.error(failure.stack??failure.message);process.exitCode=1;}else console.log(JSON.stringify({status:report?.cases?.length?'measured':'unknown',requestCount:lifecycle.snapshot().length,abortCount:report?.abortControllerCalls?.length??0,artifact:path.join(OUTPUT,'review-results.json')},null,2));
