import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual socket receive handler; only browser globals, CSS and HTTP are fixtures.
test('first incoming DM adopts an open provisional chat, marks read and keeps retries unique', async t => {
  const names = ['window', 'location', 'WebSocket'];
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  t.after(() => {
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  globalThis.window = { addEventListener() {} };
  globalThis.location = { protocol: 'https:', host: 'test.invalid', pathname: '/', search: '' };
  class Socket {
    static OPEN = 1;
    static instances = [];
    constructor() { this.readyState = 1; Socket.instances.push(this); }
    send() {}
    receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  globalThis.WebSocket = Socket;
  const source = (await readFile(new URL('./social-client.js', import.meta.url), 'utf8'))
    .replace("import './social.css';", '')
    .replace(/from '(\.{1,2}\/[^']+)'/g, (whole, path) => `from ${JSON.stringify(new URL(path, import.meta.url).href)}`);
  const client = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const { S, outbox, threadView } = client;
  const conv = { id: 'dm.receiver.sender', with: 'sender', name: 'Sender', unread: 1 };
  const first = { seq: 1, clientId: 'first-id', body: 'First message', from: { id: 'sender', name: 'Sender' } };
  const reply = { seq: 2, clientId: 'reply-id', body: 'Reply waiting for acknowledgement', from: { id: 'receiver' } };
  const requests = [], toasts = [];
  S.me = { me: { id: 'receiver' }, conversations: [] };
  S.openConv = 'to:sender';
  outbox.add('to:sender', reply.body, reply.clientId, 1);
  client.start({
    view: () => ({ connected: true, cityId: 'lagos' }), refresh() {}, toast: text => toasts.push(text),
    async fetchJson(path, options) {
      requests.push({ path, method: options?.method });
      if (path.endsWith('/read')) return { ok: true, conv: { ...conv, unread: 0 } };
      return { ok: true, conv: { ...conv, unread: 0 }, messages: [first, reply] };
    },
  });
  const ws = Socket.instances[0];
  ws.receive({ type: 'dm', conv, message: first });
  assert.equal(S.openConv, conv.id, 'an already open new chat must display the first incoming message');
  assert.equal(outbox.get(reply.clientId).key, conv.id, 'a pending reply follows the real conversation');
  assert.deepEqual(threadView(S.openConv).map(message => message.body), [first.body, reply.body]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(S.me.conversations[0].unread, 0);
  assert.equal(requests.filter(request => request.path.endsWith('/read')).length, 1);
  assert.deepEqual(toasts, [], 'the visible conversation is read, not announced as a different chat');

  ws.receive({ type: 'dm', conv, message: first });
  ws.receive({ type: 'dm', conv, message: reply });
  assert.deepEqual(threadView(conv.id).map(message => message.seq), [1, 2], 'duplicate pushes and the pending echo do not double a message');
  assert.equal(outbox.size(), 0);
  await client.openThread(conv.id);
  assert.deepEqual(threadView(conv.id).map(message => message.seq), [1, 2], 'history refresh merges without duplication');

  const readsBefore = requests.filter(request => request.path.endsWith('/read')).length;
  S.openConv = 'to:another-person';
  ws.receive({ type: 'dm', conv, message: { ...first, seq: 3 } });
  assert.equal(S.openConv, 'to:another-person', 'a message from someone else must not steal the open chat');
  ws.receive({ type: 'dm', conv: { id: 'group.one', name: 'Group' }, message: first });
  assert.equal(S.openConv, 'to:another-person', 'group messages do not adopt a provisional direct chat');
  assert.equal(requests.filter(request => request.path.endsWith('/read')).length, readsBefore, 'background messages remain unread');
});
