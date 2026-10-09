/**
 * OWNER: companion
 * THE HOSTED COMPANION: POST /api/companion/ask answers a free-text message with a language model's words — or says "use your own
 * reply" (`via: 'local'`, `text: null`), which the client always handles with its deterministic brain. Nothing the model says can
 * do anything: it can only name buttons from a fixed list, and each is checked here against the stored life (suggest.ts).
 *
 * STORAGE. Nothing of a conversation is stored or logged. The only durable rows are the limiter's two daily keys
 * (`companion:day:<player>` and `companion:day:all`, server/limiter.ts long class). Counters for the operator live in memory
 * and start again with the host.
 */
import { lagosTime } from '../../src/game/clock.ts';
import { sha256Hex } from '../../src/game/util.ts';
import { matchIntent } from '../../src/app/features/companion/intents.ts';
import { validateSuggest } from '../../src/app/features/companion/suggest.ts';
import { characterCity } from '../character.ts';
import { screenText } from '../moderation/text.ts';
import { ask, companionConfig, type ChatMessage, type CompanionConfig, type Usage } from './gateway.ts';
import { buildContext, expandContext, type Built } from './context.ts';
import { amountsIn, checkReply, cleanInput, parseModelReply, MAX_INPUT } from './checks.ts';
import { systemPrompt, wrapPlayerText } from './prompt.ts';
import type { RouteContext, RouteRequest } from '../types.ts';

export const DAY_MS = 86400000;
export const HISTORY_TURNS = 6;
export const MAX_REQUEST_CHARACTERS = 3600;
export const OUTCOMES = ['primary', 'fallback', 'local', 'filtered', 'quota', 'skipped'] as const;
export type Outcome = typeof OUTCOMES[number];
export type Via = 'primary' | 'fallback' | 'local' | 'filtered';
export interface AskAnswer { ok: true; via: Via; text: string | null; suggest: string[]; topic?: string; turnId?: string }

const GENTLE = 'Let’s keep it friendly. Ask me anything about Allworld and I will help.';
const PRIVATE = 'Please keep personal details, links and numbers to yourself. I only need to know about the game.';
const CLIENT_ID = /^\d{1,16}:[0-9a-f-]{36}$/i;
const LOCAL: AskAnswer = { ok: true, via: 'local', text: null, suggest: [] };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** A one-way id for the gateway's `user` field: the same player always maps to the same value, and it cannot be turned back into the player. */
export const gatewayUser = (publicId: string): string => `p_${sha256Hex(`allworld-companion-v1|${publicId}`).slice(0, 32)}`;
const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

interface DayCounts { day: number; requests: number; input: number; output: number; guessed: number; outcomes: Record<Outcome, number> }
const blank = (day: number): DayCounts => ({ day, requests: 0, input: 0, output: 0, guessed: 0, outcomes: { primary: 0, fallback: 0, local: 0, filtered: 0, quota: 0, skipped: 0 } });

const services = new WeakMap<RouteContext, ReturnType<typeof build>>();
export function companionService(ctx: RouteContext) {
  const found = services.get(ctx);
  if (found) return found;
  const made = build(ctx);
  services.set(ctx, made);
  return made;
}

function build(ctx: RouteContext) {
  const total = blank(0);
  let startedAt = 0, today = blank(-1);
  const tests = { runs: 0, ok: 0, failed: 0 };
  const recent = new Map<string, { at: number; answer: Promise<AskAnswer> }>();
  const config = (): CompanionConfig | null => companionConfig((name) => ctx.env(name));
  const day = (): DayCounts => { const d = lagosTime(ctx.now()).day; if (!startedAt) startedAt = ctx.now(); if (today.day !== d) today = blank(d); return today; };
  const count = (outcome: Outcome): void => { total.outcomes[outcome]++; day().outcomes[outcome]++; };
  const tokens = (usage: Usage | null, sent: number, got: number): void => {
    const d = day();
    d.input += usage?.input ?? sent; d.output += usage?.output ?? got; total.input += usage?.input ?? sent; total.output += usage?.output ?? got;
    if (!usage) { d.guessed++; total.guessed++; }
  };
  const answer = (via: Via, text: string | null, suggest: string[] = [], extra: { topic?: string; turnId?: string } = {}): AskAnswer => ({ ok: true, via, text, suggest, ...(extra.topic ? { topic: extra.topic } : {}), ...(extra.turnId ? { turnId: extra.turnId } : {}) });

  /** The earlier turns the client sent, kept only when they are fit: at most six, roles forced, each filtered. */
  function history(raw: unknown, numbers: ReadonlySet<string>): ChatMessage[] {
    if (!Array.isArray(raw)) return [];
    const turns: ChatMessage[] = [];
    for (const item of raw.slice(-HISTORY_TURNS)) {
      if (!record(item)) continue;
      const role = item['role'] === 'assistant' ? 'assistant' : 'user';
      const text = cleanInput(item['text'] ?? item['content']);
      if (!text || screenText(text, { contact: true })) continue;
      if (role === 'assistant') { const shown = checkReply(text, numbers); if (shown) turns.push({ role, content: shown }); }
      else turns.push({ role, content: wrapPlayerText(text) });
    }
    return turns;
  }

  async function run(request: RouteRequest, body: Record<string, unknown>, settings: CompanionConfig): Promise<AskAnswer> {
    const turnId = typeof body['turnId'] === 'string' && /^[\w:.-]{1,64}$/.test(body['turnId']) ? body['turnId'] : undefined;
    const extra = turnId ? { turnId } : {};
    const rephrase = body['rephrase'] === true;
    if (rephrase && !settings.rephrase) { count('skipped'); return answer('local', null, [], extra); }
    const message = cleanInput(rephrase ? body['localText'] : body['message']);
    if (!message) throw ctx.fail(400, 'invalid_message');
    if (!rephrase && typeof body['message'] === 'string' && body['message'].trim().length > 4 * MAX_INPUT) throw ctx.fail(400, 'invalid_message');

    const verdict = screenText(message, { contact: true });
    if (verdict) { count('filtered'); return answer('filtered', verdict.code === 'text_blocked' ? GENTLE : PRIVATE, [], extra); }
    // A player in crisis is answered by the authored reply, never by a model.
    if (!rephrase && matchIntent(message).intent === 'safety') { count('skipped'); return answer('local', null, [], extra); }

    // Read what the game holds, then let go of the store before any outside call.
    const prepared = await ctx.store.read((db) => {
      const session = request.requireSession(db);
      const city = characterCity(session);
      if (!city || !session.cities[city]?.state) throw ctx.fail(409, 'no_life');
      const built = buildContext(db, session, city, message, { now: ctx.now(), online: (id) => ctx.online(id) });
      if (!built) throw ctx.fail(409, 'no_life');
      return { id: session.publicId, built };
    });
    const { id, built } = prepared;

    const current: ChatMessage = { role: 'user', content: wrapPlayerText(message) };
    let spare = MAX_REQUEST_CHARACTERS - systemPrompt(built.sections, rephrase).length - current.content.length;
    if (spare < 0) { count('skipped'); return answer('local', null, [], extra); }

    const requiredNumbers = new Set(built.numbers);
    if (rephrase) for (const amount of amountsIn(message)) requiredNumbers.add(amount);
    const candidates = rephrase ? [] : history(body['history'], requiredNumbers);
    const turns: ChatMessage[] = [];
    for (const turn of candidates.reverse()) {
      if (turn.content.length > spare) break;
      turns.unshift(turn);
      spare -= turn.content.length;
    }
    const packed = expandContext(built, spare);
    const numbers = new Set(packed.numbers);
    if (rephrase) for (const amount of amountsIn(message)) numbers.add(amount);
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt(packed.sections, rephrase) }, ...turns, current];
    if (messages.reduce((length, item) => length + item.content.length, 0) > MAX_REQUEST_CHARACTERS) {
      count('skipped'); return answer('local', null, [], extra);
    }

    // Limits: a minute per player (memory), then a day per player and a day for everybody (stored on the Worker). Refused: no row is written.
    if (!ctx.allow(`companion:burst:${id}`, settings.playerBurst, 60000)
      || (ctx.peek ? !ctx.peek('companion:day:all', settings.dailyRequests) : false)
      || !ctx.allow(`companion:day:${id}`, settings.playerDaily, DAY_MS)
      || !ctx.allow('companion:day:all', settings.dailyRequests, DAY_MS)) { count('quota'); return answer('local', null, [], extra); }

    const sent = estimateTokens(messages.map((item) => item.content).join(' '));
    day().requests++;
    const result = await ask((url, init) => ctx.fetch(url, init), settings, messages, gatewayUser(id));
    for (const attempt of result.attempts) if (attempt.ok) tokens(attempt.usage, sent, estimateTokens(attempt.text)); else tokens(null, sent, 0);
    return finish(result, packed, numbers, rephrase, extra);
  }

  function finish(result: Awaited<ReturnType<typeof ask>>, built: Built, numbers: ReadonlySet<string>, rephrase: boolean, extra: { turnId?: string }): AskAnswer {
    const reply = result.answer.ok ? parseModelReply(result.answer.text) : null;
    const text = reply ? checkReply(reply.text, numbers) : null;
    if (!reply || text === null) { count('local'); return answer('local', null, [], extra); }
    const suggest = rephrase ? [] : validateSuggest(reply.suggest, built.facts);
    count(result.role);
    return answer(result.role, text, suggest, { ...extra, ...(built.intent !== 'unknown' ? { topic: built.intent } : {}) });
  }

  return {
    config,
    /** POST /api/companion/ask. A repeat of the same client id inside two minutes gets the first answer and costs nothing. */
    async ask(request: RouteRequest): Promise<AskAnswer> {
      const body = await request.json();
      const clientId = body['clientId'];
      if (typeof clientId !== 'string' || !CLIENT_ID.test(clientId)) throw ctx.fail(400, 'invalid_client_id');
      const settings = config();
      if (!settings) return LOCAL;
      const key = `${request.secret ?? ''}|${clientId}`, nowMs = ctx.now();
      for (const [name, item] of recent) if (nowMs - item.at > 120000 || recent.size > 300) recent.delete(name);
      const again = recent.get(key);
      if (again) return again.answer;
      const pending = run(request, body, settings);
      recent.set(key, { at: nowMs, answer: pending });
      pending.catch(() => { recent.delete(key); });
      return pending;
    },
    /**
     * POST /api/mod/companion-test: ONE tiny real request through the same client and fallback logic. Answers only a class of error,
     * never the gateway's words. Counted apart from players' requests.
     */
    async selfTest(): Promise<{ ok: true; model: string; ms: number; usedFallback: boolean; primaryError?: string } | { ok: false; error: 'off' | 'auth' | 'model_not_found' | 'timeout' | 'other'; ms: number }> {
      const settings = config();
      if (!settings) return { ok: false, error: 'off', ms: 0 };
      const began = performance.now();
      const messages: ChatMessage[] = [{ role: 'system', content: 'Reply with the single word ok.' }, { role: 'user', content: 'ok?' }];
      const result = await ask((url, init) => ctx.fetch(url, init), { ...settings, maxOutputTokens: 16 }, messages, gatewayUser('self-test'));
      const ms = Math.round(performance.now() - began);
      const kind = (why: string): 'auth' | 'model_not_found' | 'timeout' | 'other' => (why === 'auth' ? 'auth' : why === 'model' ? 'model_not_found' : why === 'timeout' ? 'timeout' : 'other');
      tests.runs++;
      const first = result.attempts[0];
      if (result.answer.ok) { tests.ok++; return { ok: true, model: result.answer.model, ms, usedFallback: result.role === 'fallback', ...(first && !first.ok ? { primaryError: kind(first.why) } : {}) }; }
      tests.failed++;
      return { ok: false, error: kind(result.answer.why), ms };
    },
    /** The `companion` object of GET /api/mod/overview. */
    overview() {
      const settings = config(), d = day();
      const rate = settings ? { input: settings.priceInPerM, output: settings.priceOutPerM } : { input: 0, output: 0 };
      const cost = (counts: DayCounts): number => Math.round((counts.input * rate.input + counts.output * rate.output)) / 1e6;
      return {
        enabled: settings !== null, rephrase: settings?.rephrase ?? false,
        models: settings ? { primary: settings.model, fallback: settings.fallbackModel } : null,
        limits: settings ? { daily: settings.dailyRequests, perPlayerDaily: settings.playerDaily, perPlayerBurst: settings.playerBurst } : null,
        today: { lagosDay: d.day, requests: d.requests, outcomes: { ...d.outcomes }, tokens: { input: d.input, output: d.output, fromUsage: d.requests - d.guessed >= 0 ? Math.max(0, d.requests - d.guessed) : 0, estimatedRequests: d.guessed }, estimatedCostUsd: cost(d) },
        sinceStart: { at: startedAt, outcomes: { ...total.outcomes }, tokens: { input: total.input, output: total.output } },
        selfTests: { ...tests },
        prices: { inputPerMillionUsd: rate.input, outputPerMillionUsd: rate.output, estimate: true },
      };
    },
  };
}
