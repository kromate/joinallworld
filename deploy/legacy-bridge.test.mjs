import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { oldCharacterLanding } from './legacy-bridge.js';

const scopeKey = 'nw:guest:' + JSON.stringify(['https://logical-ins-pillow-ref.trycloudflare.com','953074f15b9d05cfb72cc8024b2186653d5ff16b21fd005604f803abe019436c','cli-953074f15b9d05cfb72cc8024b2186653d5ff16b21fd005604f803abe019436c','test']);
async function fixture(next) {
  const response = oldCharacterLanding(); const html = await response.text();
  const elements = new Map(); const calls = []; let navigated;
  const token = 'gst_' + 'a'.repeat(43);
  const document = { getElementById(id) { if (!elements.has(id)) elements.set(id, { style: {}, addEventListener(_, fn) { this.click = fn; } }); return elements.get(id); } };
  vm.runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { document, URL, AbortSignal, localStorage: { getItem(key) { assert.equal(key, scopeKey); return token; } }, location: { assign(value) { navigated = value; } }, fetch: async (...args) => { calls.push(args); return { ok:true, json: async()=>({next}) }; } });
  await elements.get('move').click();
  return {response,elements,calls,navigated,token};
}
test('bridge uses exact old scope, target, no referrer and strict transfer URL', async()=> {
  const f=await fixture('https://v1.joinallworld.com/#transfer=gtx_'+'b'.repeat(43));
  assert.equal(f.calls[0][0],'https://v1.joinallworld.com/world/guest-transfer/start');
  assert.deepEqual(JSON.parse(f.calls[0][1].body),{token:f.token});
  assert.equal(f.calls[0][1].credentials,'omit'); assert.equal(f.calls[0][1].redirect,'error');
  assert.equal(f.response.headers.get('referrer-policy'),'no-referrer'); assert.ok(f.navigated);
});
test('bridge refuses arbitrary next origin/path/query and retains local guest state',async()=> {
  for(const next of ['https://evil.test/#transfer=gtx_'+'b'.repeat(43),'https://v1.joinallworld.com/other#transfer=gtx_'+'b'.repeat(43),'https://v1.joinallworld.com/?token=leak#transfer=gtx_'+'b'.repeat(43)]) {
    const f=await fixture(next); assert.equal(f.navigated,undefined); assert.equal(f.elements.get('move').disabled,false); assert.match(f.elements.get('status').textContent,/still kept/);
  }
});
