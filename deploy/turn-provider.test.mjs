import test from 'node:test'; import assert from 'node:assert/strict';
import { relayTestAuthorized, mintCloudflareIce } from './turn-provider.js';
const env = { TURN_KEY_ID:'a'.repeat(32), TURN_API_TOKEN:'synthetic-token', TURN_TEST_PUBLIC_IDS:'one,two' };
test('relay allowlist fails closed and permits at most two configured testers',()=>{ assert.equal(relayTestAuthorized(env,'one'),true); assert.equal(relayTestAuthorized(env,'stranger'),false); assert.equal(relayTestAuthorized({},'one'),false); assert.equal(relayTestAuthorized({...env,TURN_TEST_PUBLIC_IDS:'one,two,three'},'one'),false); });
test('provider targets only official endpoint with bounded TTL; returns no API token',async()=>{
 const result=await mintCloudflareIce(env,{now:()=>1000,fetchImpl:async(url,options)=>{assert.equal(url,`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`);assert.equal(options.redirect,'manual');assert.deepEqual(JSON.parse(options.body),{ttl:600});return new Response(JSON.stringify({iceServers:[{urls:'turn:turn.cloudflare.com',username:'synthetic',credential:'temporary'}]}),{status:201});}});
 assert.equal(result.expiresAt,601000);assert.equal(JSON.stringify(result).includes(env.TURN_API_TOKEN),false);
});
test('provider errors never forward response bodies or credential-bearing errors',async()=>{ for(const response of [new Response('private upstream detail',{status:403}),new Response('x'.repeat(65537),{status:201})]) await assert.rejects(()=>mintCloudflareIce(env,{fetchImpl:async()=>response}),/^Error: voice_config_unavailable$/); });
