import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { oldCharacterLanding } from './legacy-bridge.ts';

const scopeKey = 'nw:guest:' + JSON.stringify(['https://logical-ins-pillow-ref.trycloudflare.com','953074f15b9d05cfb72cc8024b2186653d5ff16b21fd005604f803abe019436c','cli-953074f15b9d05cfb72cc8024b2186653d5ff16b21fd005604f803abe019436c','test']);
type Call = [string, RequestInit & { body: string }];
interface Element { style: Record<string, string>; disabled?: boolean; textContent?: string; click: () => unknown; addEventListener(_: string, fn: () => unknown): void }
async function fixture(next: string) {
  const response = oldCharacterLanding(); const html = await response.text();
  const elements = new Map<string, Element>(); const calls: Call[] = []; let navigated: string | undefined;
  const token = 'gst_' + 'a'.repeat(43);
  const document = { getElementById(id: string) { if (!elements.has(id)) elements.set(id, { style: {}, click: () => undefined, addEventListener(_: string, fn: () => unknown) { this.click = fn; } }); return elements.get(id); } };
  vm.runInNewContext((html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/) as RegExpMatchArray)[1] as string, { document, URL, AbortSignal, localStorage: { getItem(key: string) { assert.equal(key, scopeKey); return token; } }, location: { assign(value: string) { navigated = value; } }, fetch: async (...args: [string, RequestInit & { body: string }]) => { calls.push(args); return { ok:true, json: async()=>({next}) }; } });
  await (elements.get('move') as Element).click();
  return {response,elements,calls,navigated,token};
}
test('bridge uses exact old scope, target, no referrer and strict transfer URL', async()=> {
  const f=await fixture('https://v1.joinallworld.com/#transfer=gtx_'+'b'.repeat(43));
  assert.equal((f.calls[0] as Call)[0],'https://v1.joinallworld.com/world/guest-transfer/start');
  assert.deepEqual(JSON.parse((f.calls[0] as Call)[1].body),{token:f.token});
  assert.equal((f.calls[0] as Call)[1].credentials,'omit'); assert.equal((f.calls[0] as Call)[1].redirect,'error');
  assert.equal(f.response.headers.get('referrer-policy'),'no-referrer'); assert.ok(f.navigated);
});
test('bridge refuses arbitrary next origin/path/query and retains local guest state',async()=> {
  for(const next of ['https://evil.test/#transfer=gtx_'+'b'.repeat(43),'https://v1.joinallworld.com/other#transfer=gtx_'+'b'.repeat(43),'https://v1.joinallworld.com/?token=leak#transfer=gtx_'+'b'.repeat(43)]) {
    const f=await fixture(next); assert.equal(f.navigated,undefined); assert.equal((f.elements.get('move') as Element).disabled,false); assert.match((f.elements.get('status') as Element).textContent as string,/still kept/);
  }
});
