import './register-dependencies.mjs';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const {createServer:createGameServer}=await import('../../../server/server.js');
const {createServer:createViteServer}=await import('vite');
const threeRoot=dirname(fileURLToPath(import.meta.resolve('three')));
const game=await createGameServer({dataDir:resolve(root,'src/models/.cache/integration-state'),buildId:'models-integration'});
game.listen(3402,'127.0.0.1');await once(game,'listening');
// Cookies are scoped by host, not port. Keep this preview's guest identity separate.
function previewProxy(proxy){
  const request=(proxyReq,req)=>{const cookies=String(req.headers.cookie||'').split(';').map(c=>c.trim()).filter(c=>c&&!c.startsWith('sid=')).map(c=>c.startsWith('models_sid=')?'sid='+c.slice(11):c);proxyReq.setHeader('cookie',cookies.join('; '));};
  proxy.on('proxyReq',request);proxy.on('proxyReqWs',request);
  proxy.on('proxyRes',response=>{const cookies=response.headers['set-cookie'];if(cookies)response.headers['set-cookie']=cookies.map(c=>c.replace(/^sid=/,'models_sid='));});
}
const vite=await createViteServer({configFile:false,root,cacheDir:resolve(root,'src/models/.cache/game-vite'),resolve:{alias:[
  {find:/^three\/addons\//,replacement:resolve(threeRoot,'../examples/jsm')+'/'},
  {find:/^three$/,replacement:resolve(threeRoot,'three.module.js')},
]},server:{host:'127.0.0.1',port:3401,strictPort:true,watch:{ignored:['**/src/models/.cache/**','**/src/models/evidence/**']},fs:{allow:[root,resolve(threeRoot,'..')]},proxy:{'/api':{target:'http://127.0.0.1:3402',configure:previewProxy},'/socket':{target:'ws://127.0.0.1:3402',ws:true,configure:previewProxy}}}});
await vite.listen();console.log('Integrated game: http://127.0.0.1:3401/');
let closing=false;
async function close(){if(closing)return;closing=true;await vite.close();for(const socket of game.wss.clients)socket.terminate();game.closeAllConnections();await new Promise(r=>game.close(r));await game.store.close();}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>close().then(()=>process.exit(0)));
