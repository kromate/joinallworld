/**
 * TEST SUPPORT for the agent tests: a real server with accounts on (the sign-in provider is the stand-in of server/accounts/test-tokens.ts),
 * signed-in owners, and a plain MCP client. Nothing in the running game imports this file.
 */
import type { TestContext } from 'node:test';
import { fixture } from '../test-fixture.ts';
import type { FixtureOptions } from '../test-fixture.ts';
import { claimsFor, fakeProvider, makeKey, signToken } from '../accounts/test-tokens.ts';
import type { SignInResponse } from '../../src/types/account.ts';

export const PROJECT = 'allworld-test-project';
export const OPERATOR = 'operator-token-for-agent-tests-0123456789';
export const HOUR = 3600000;
export type Json = Record<string, unknown>;
export interface Owner { id: string; cookie: string; subject: string }

export async function world(t: TestContext, options: FixtureOptions = {}, outside?: { match: (url: string) => boolean; fetch: (url: string, init?: object) => Promise<unknown> }) {
  const key = await makeKey('agent-key-1'), provider = fakeProvider([key]);
  const f = await fixture(t, {
    fetch: (url, init) => (outside?.match(url) ? outside.fetch(url, init as object) as Promise<Response> : provider.fetch(url, init as { body?: unknown })), log: () => {}, moderatorToken: OPERATOR, ...options,
    env: { ACCOUNTS_FIREBASE_PROJECT_ID: PROJECT, ACCOUNTS_FIREBASE_API_KEY: 'test-web-api-key-0000000000000000000000', NEW_SESSIONS_PER_ADDRESS: '1000', ...options.env },
  });
  /** A browser call: same origin, with the cookie. */
  const call = (path: string, body?: unknown, cookie?: string | null, headers: Record<string, string> = {}): Promise<Response> => fetch(f.base + path, {
    method: body !== undefined && body !== null ? 'POST' : 'GET', headers: { Origin: f.base, ...(body !== undefined && body !== null ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body !== undefined && body !== null ? { body: JSON.stringify(body) } : {}) });
  const json = async (path: string, body?: unknown, cookie?: string | null): Promise<Json & { status: number }> => { const r = await call(path, body, cookie); return { ...(await r.json() as Json), status: r.status }; };
  let minted = 0;
  const token = (subject: string): Promise<string> => signToken(key, claimsFor(PROJECT, f.now(), { subject, email: `${subject.toLowerCase()}@example.com`, n: ++minted }));
  const csrf = async (cookie: string): Promise<string | null> => ((await (await call('/api/account', null, cookie)).json()) as { csrf: string | null }).csrf;
  /** A signed-in browser's POST, with the anti-forgery token the account routes want. */
  const post = async (path: string, body: Json, cookie: string): Promise<Json & { status: number }> => json(path, { ...body, csrf: await csrf(cookie) }, cookie);
  /** A guest with a played life in Lagos. */
  async function guest(name: string) { const device = await f.device(name); await f.request('/api/life?city=lagos', null, device.cookie); return device; }
  /** An account made the way a guest makes one: signs up with a played life. It is older than a day when `old` is set (the age an agent key needs). */
  async function owner(subject: string, name: string, old = true): Promise<Owner> {
    const g = await guest(name);
    const response = await call('/api/account/sign-in', { idToken: await token(subject), csrf: await csrf(g.cookie) }, g.cookie);
    const body = await response.json() as SignInResponse;
    if (response.status !== 200) throw new Error(`sign-in answered ${response.status}: ${JSON.stringify(body)}`);
    const cookie = (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    await f.acceptSharingTerms(cookie);
    if (old) f.advance(25 * HOUR);
    return { id: g.id, cookie, subject };
  }
  /** Make an agent key; the answer carries it once. */
  const makeAgentKey = (who: Owner, body: Json = { mode: 'own', name: 'Test agent' }) => post('/api/agents/keys', body, who.cookie) as Promise<Json & { status: number; key: string; id: string }>;
  /** One raw MCP request, as a program makes it: a bearer key, no cookie, no Origin. */
  async function mcp(key: string | null, method: string, params?: Json, extra: { id?: number | null; headers?: Record<string, string>; raw?: string; challenge?: boolean } = {}): Promise<{ status: number; json: Json; headers: Headers }> {
    const id = extra.id === undefined ? 1 : extra.id;
    // No key: the sign-up surface at /mcp?signup=1, unless the test is about the sign-in challenge a plain /mcp gives.
    const response = await fetch(f.base + (key === null && extra.challenge !== true ? '/mcp?signup=1' : '/mcp'), { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra.headers },
      body: extra.raw ?? JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method, ...(params ? { params } : {}) }) });
    const text = await response.text();
    return { status: response.status, json: text ? JSON.parse(text) as Json : {}, headers: response.headers };
  }
  /** One tool call: what the tool answered (its structured content), and whether it was an error. */
  async function tool(key: string, name: string, args: Json = {}): Promise<{ ok: boolean; data: Json; status: number; rpc: Json }> {
    const answer = await mcp(key, 'tools/call', { name, arguments: args });
    const result = (answer.json.result ?? {}) as Json;
    return { ok: result.isError === false, data: (result.structuredContent ?? {}) as Json, status: answer.status, rpc: answer.json };
  }
  /** An agent with no key signs itself up (create_agent_account): the key, the claim link and token it was given. */
  async function signup(name: string, extra: Json = {}, headers: Record<string, string> = {}): Promise<{ ok: boolean; data: Json; status: number; key: string; claim: string }> {
    const answer = await mcp(null, 'tools/call', { name: 'create_agent_account', arguments: { name, ...extra } }, { headers });
    const data = (((answer.json.result ?? {}) as Json).structuredContent ?? {}) as Json;
    return { ok: data.ok === true, data, status: answer.status, key: String(data.key ?? ''), claim: String(data.claimToken ?? '') };
  }
  const stored = <T>(read: (db: Parameters<Parameters<typeof f.server.store.read>[0]>[0]) => T): Promise<T> => f.server.store.read(read) as Promise<T>;
  const change = <T>(write: (db: Parameters<Parameters<typeof f.server.store.transact>[0]>[0]) => T): Promise<T> => f.server.store.transact(write) as Promise<T>;
  /** The account behind an owner and the character it plays, read from the store. */
  const accountOf = (who: Owner) => stored((db) => { const a = Object.values(db.accounts ?? {}).find((item) => item.publicId === who.id); return { account: a?.id ?? '', publicId: who.id }; });
  /** Mark an account as phone-checked (what an agent character needs), the way an operator would. */
  async function checkPhone(who: Owner): Promise<void> {
    const { account } = await accountOf(who);
    await change((db) => { const trust = (db.trust ??= { v: 1, players: {}, reviewed: {}, reports: [], seq: 0 }) as { players: Record<string, unknown> }; trust.players[who.id] = { tier: 'phone', by: 'admin', at: f.now(), admin: 'test', account }; });
  }
  return { f, call, json, post, guest, owner, makeAgentKey, mcp, signup, tool, stored, change, accountOf, checkPhone, token, csrf };
}
/** The stored agent keys of a document, as plain records a test may read and change. */
export const agentKeys = (db: object): Record<string, unknown>[] => Object.values((db as { agents?: { keys?: Record<string, unknown> } }).agents?.keys ?? {}) as Record<string, unknown>[];
export type World = Awaited<ReturnType<typeof world>>;
