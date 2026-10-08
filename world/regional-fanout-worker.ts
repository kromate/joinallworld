import { parentPort, workerData } from 'node:worker_threads';
import { compileRegionalFanout } from './regional-fanout.ts';
import type { RegionalFanoutRequest } from './regional-fanout-types.ts';

interface Input { request: RegionalFanoutRequest; parent: ArrayBuffer }
const input=workerData as Input;
function transferable(bytes:Uint8Array):ArrayBuffer{
  if(bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength&&bytes.buffer instanceof ArrayBuffer)return bytes.buffer;
  const copy=new Uint8Array(bytes.byteLength);copy.set(bytes);return copy.buffer;
}
try{
  const product=compileRegionalFanout(input.request,new Uint8Array(input.parent));
  const index=transferable(product.indexBytes),inputs=product.inputs.map(item=>({ref:item.ref,bytes:transferable(item.bytes)}));
  const transfer=[index,...inputs.map(item=>item.bytes)];
  parentPort?.postMessage({ok:true,index:product.index,indexBytes:new Uint8Array(index),indexHash:product.indexHash,inputs:inputs.map(item=>({ref:item.ref,bytes:new Uint8Array(item.bytes)})),logicalBytes:product.logicalBytes},transfer);
}catch(error){parentPort?.postMessage({ok:false,error:(error instanceof Error?error.message:String(error)).replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,2000)});}
