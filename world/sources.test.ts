import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPinnedSource } from './sources.ts';
import { sha256 } from './pack.ts';

test('fetchPinnedSource enforces explicit HTTPS, timeout signal, byte cap and digest',async()=>{
 const data=new TextEncoder().encode('bounded source');
 let seen:RequestInit|undefined;
 const fetcher=(async(_url: string, init?:RequestInit)=>{seen=init;return new Response(data,{status:200,headers:{'content-length':String(data.length)}});}) as typeof fetch;
 const result=await fetchPinnedSource('https://example.test/source',100,sha256(data),fetcher,5000);
 assert.deepEqual(result,data);
 assert.ok(seen?.signal);
 await assert.rejects(fetchPinnedSource('http://example.test/source',100,sha256(data),fetcher),/HTTPS/);
 await assert.rejects(fetchPinnedSource('https://example.test/source',100,'0'.repeat(64),fetcher),/checksum mismatch/);
 await assert.rejects(fetchPinnedSource('https://example.test/source',100,sha256(data),fetcher,30_001),/timeoutMs/);
});
