/**
 * A realistic LEGACY store: the `social`, `growth`, `civic` and `business` collections of N registered players, as the
 * game wrote them before collections were kept per entry (docs/STORAGE.md). Shapes follow server/types.ts; the numbers
 * (friends, conversation lengths, who has a shop, an e-mail contact, a pending gift …) follow what the game's limits and
 * its first weeks of play produce. Deterministic from a seed. Used by the migration tests and the capacity bench; never by the server.
 */

export interface LegacySeedOptions {
  players: number
  seed?: number
  /** The server time everything is written relative to. */
  now?: number
  /**
   * `typical`: what a few weeks of play leave per registered player (about 2 KB of `social`). `heavy`: five times the friends,
   * long histories and many full 200-message conversations, for the worst a store may hold.
   */
  profile?: 'typical' | 'heavy'
}
export interface LegacyCollections { social: Record<string, unknown>; growth: Record<string, unknown>; civic: Record<string, unknown>; business: Record<string, unknown> }
export interface LegacySeed { collections: LegacyCollections; ids: string[]; founder: string }

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WORDS = ['how far', 'wetin dey', 'see you at the park', 'omo', 'I dey come', 'abeg', 'e don do', 'lol', 'sharp sharp', 'thank you', 'good morning', 'let us meet at the library', 'did you see the match', 'pay me my money', 'I am at the market now'];
const EMOJI = ['\u{1F600}', '\u{1F44D}', '\u{1F469}‍\u{1F4BB}', '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}', '\u{1F1F3}\u{1F1EC}', '❤️', '\u{1F44D}\u{1F3FD}'];
const NAMES = ['Ada', 'Bola', 'Chidi', 'Dayo', 'Emeka', 'Funmi', 'Gbenga', 'Hauwa', 'Ife', 'Jide', 'Kemi', 'Lanre', 'Mide', 'Ngozi', 'Ola', 'Peju', 'Qudus', 'Rita', 'Sade', 'Tunde'];

export function legacySeed({ players: count, seed = 1, now = 1_790_000_000_000, profile = 'typical' }: LegacySeedOptions): LegacySeed {
  const heavy = profile === 'heavy', fullShare = heavy ? 0.08 : 0.01, friendsMean = heavy ? 5 : 1.2, chatShare = heavy ? 1 : 0.5;
  const random = rng(seed), int = (n: number): number => Math.floor(random() * n), pick = <T>(list: readonly T[]): T => list[int(list.length)] as T;
  const hex = (n: number): string => { let out = ''; while (out.length < n) out += Math.floor(random() * 16).toString(16); return out; };
  const uuid = (): string => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
  const DAY = 86_400_000;
  const ids: string[] = [], founder = uuid(); ids.push(founder);
  for (let i = 1; i < count; i += 1) ids.push(uuid());
  const name = (i: number): string => `${pick(NAMES)} ${NAMES[i % NAMES.length]}${i}`;
  const text = (): string => `${pick(WORDS)}${random() < 0.3 ? ` ${pick(EMOJI)}` : ''}${random() < 0.2 ? ` ${pick(WORDS)}` : ''}`;

  const players: Record<string, Record<string, unknown>> = {}, convs: Record<string, Record<string, unknown>> = {}, pending: Record<string, unknown[]> = {}, houses: Record<string, unknown> = {};
  const record = (id: string, i: number): Record<string, unknown> => ({
    name: i === 0 ? 'Founder' : name(i), first: now - int(60) * DAY, seen: now - Math.floor(random() ** 2 * 44 * DAY), friends: {}, in: {}, out: {}, blocked: {}, convs: {}, updates: [], reports: [], baeIn: {}, bae: null, visiting: null,
    recv: { day: 0, amount: 0 }, chats: { day: 0, count: 0 },
  });
  ids.forEach((id, i) => { players[id] = record(id, i); });
  let seq = 1, convNumber = 0;
  const link = (a: string, b: string): void => { const since = now - int(40) * DAY; (players[a] as { friends: Record<string, number> }).friends[b] = since; (players[b] as { friends: Record<string, number> }).friends[a] = since; };
  const message = (conv: { members: string[] }, n: number, at: number): Record<string, unknown> => {
    const from = pick(conv.members), line: Record<string, unknown> = { seq: n, from, body: text(), at: at + n * 60_000 };
    const r = random();
    if (r < 0.2) line['cid'] = uuid();
    if (n > 3 && r > 0.95) line['re'] = { seq: n - 1, from: pick(conv.members), text: text().slice(0, 40) };
    if (r > 0.97) line['rx'] = { [pick(conv.members)]: pick(EMOJI) };
    if (r > 0.995) line['gift'] = { n: 500 + int(5) * 500 };
    return line;
  };
  const makeConv = (kind: 'dm' | 'group', members: string[], full: boolean): string => {
    convNumber += 1;
    const id = kind === 'dm' ? [...members].sort().join(':') : `g${convNumber}`;
    const created = now - int(40) * DAY, length = full ? 200 : random() < 0.7 ? int(10) : 10 + int(50);
    const conv: { id: string; kind: string; members: string[]; seq: number; created: number; messages: Record<string, unknown>[]; name?: string; owner?: string; creator?: string } = { id, kind, members, seq: 0, created, messages: [] };
    if (kind === 'group') { conv.name = `${pick(NAMES)} crew ${EMOJI[2]}`; conv.owner = members[0] as string; conv.creator = members[0] as string; }
    for (let n = 1; n <= length; n += 1) conv.messages.push(message(conv, n, created));
    conv.seq = length;
    for (const member of members) (players[member] as { convs: Record<string, { read: number; mute?: true; pin?: true }> }).convs[id] = { read: Math.max(0, length - int(5)), ...(random() < 0.05 ? { mute: true as const } : {}), ...(random() < 0.03 ? { pin: true as const } : {}) };
    convs[id] = conv;
    return id;
  };
  // Friendships: each player befriends a handful of others (a few hubs have many); the founder holds the automatic friendship with everyone on their side.
  ids.forEach((id, i) => {
    if (i === 0) return;
    const friends = Math.min(30, Math.floor(-Math.log(1 - random()) * friendsMean));
    for (let k = 0; k < friends; k += 1) {
      const other = ids[1 + int(count - 1)] as string;
      if (other === id || (players[id] as { friends: Record<string, number> }).friends[other] !== undefined) continue;
      link(id, other);
      if (random() < chatShare && !convs[[id, other].sort().join(':')]) makeConv('dm', [id, other].sort(), random() < fullShare);
    }
    const mine = players[id] as { friends: Record<string, number>; founder?: { id: string; at: number }; invite?: { by: string; at: number } };
    mine.friends[founder] = mine.first; mine.founder = { id: founder, at: mine.first };
    if (random() < 0.15) { const by = ids[1 + int(count - 1)] as string; if (by !== id) mine.invite = { by, at: mine.first }; }
  });
  for (let g = 0; g < Math.floor(count / (heavy ? 15 : 60)); g += 1) {
    const size = 5 + int(8), members = new Set<string>();
    while (members.size < Math.min(size, count)) members.add(ids[1 + int(count - 1)] as string);
    makeConv('group', [...members], random() < 0.3);
  }
  // Updates, blocks, requests, pending gifts, houses.
  ids.forEach((id, i) => {
    const p = players[id] as { updates: unknown[]; blocked: Record<string, number>; in: Record<string, number>; out: Record<string, number> };
    const n = i === 0 ? 0 : int(heavy ? 14 : 5);
    for (let k = 0; k < n; k += 1) p.updates.push({ id: seq++, kind: pick(['friend-accepted', 'message', 'gift', 'invite-joined']), text: `${pick(NAMES)} ${pick(WORDS)}`, at: now - int(40) * DAY, read: random() < 0.7, data: { from: ids[int(count)] } });
    if (random() < 0.03) p.blocked[ids[int(count)] as string] = now - int(20) * DAY;
    if (random() < 0.05) p.in[ids[int(count)] as string] = now - int(5) * DAY;
    if (random() < 0.05) p.out[ids[int(count)] as string] = now - int(5) * DAY;
    if (i > 0 && random() < 0.01) pending[id] = Array.from({ length: 1 + int(3) }, (_, k) => ({ n: seq++, at: now - int(6) * DAY, cityId: 'lagos', keep: true, payload: { op: 'transfer-in', from: ids[int(count)], name: 'A friend', amount: 1000 + k * 500 } }));
    if (i > 0 && random() < 0.002) houses[id] = { knocks: {}, guests: { [ids[int(count)] as string]: { since: now - 60_000, expires: now + 600_000, cityId: 'lagos' } } };
  });
  const social = { players, convs, houses, pending, reports: Array.from({ length: Math.min(200, Math.floor(count / 50)) }, (_, k) => ({ id: `R-${k + 1}`, by: ids[int(count)], about: ids[int(count)], aboutName: 'Someone', reason: 'spam', text: 'repeated links', at: now - int(30) * DAY, status: 'received', evidence: ['spam link', 'spam link again'] })), seq, sweptAt: now - 1000, founder: { account: 'fb:founder', id: founder }, pings: {}, pingJoins: {} };

  const gp: Record<string, unknown> = {}, shares: Record<string, unknown> = {}, comeback: Record<string, unknown> = {}, contacts: Record<string, unknown> = {}, push: Record<string, unknown> = {};
  const lives: Record<string, unknown> = {};
  ids.forEach((id, i) => {
    const seen = (players[id] as { seen: number }).seen;
    gp[id] = { seen, devices: [hex(13)], ref: random() < 0.15 ? { by: ids[int(count)], code: hex(8), at: seen - DAY, welcomed: true, counted: random() < 0.5 } : null, invited: {}, counted: 0, owed: [], shares: { day: 0, n: 0 },
      consent: random() < 0.2 ? { age: 'adult', push: random() < 0.5, email: random() < 0.5, at: seen - DAY } : null, table: null, wins: [] };
    if (random() < 0.1) shares[hex(10)] = { by: id, kind: 'missions', at: now - int(20) * DAY, facts: { kind: 'missions', name: name(i), district: 'Surulere', city: 'lagos', done: 3, total: 5 }, opened: int(5), joined: int(2) };
    if (random() < 0.15) {
      contacts[id] = { email: `player${i}@example.com`, confirmed: true, nonce: hex(16), at: seen - DAY, confirmedAt: seen - DAY, welcomed: true, confirms: [], sends: [], periods: {}, preview: null };
      comeback[id] = { on: true, legacy: false, pausedUntil: 0, types: { away: true, week: true, joined: true, nudge: true, ping: true }, sent: Array.from({ length: int(8) }, (_, k) => ({ at: seen - k * DAY, type: 'away' })), last: { away: seen - 3 * DAY }, away: {}, keys: [hex(12)], waitingAt: 0, nudgeAt: 0, nudges: [], next: now + int(7) * DAY, suppressedDay: 0 };
    }
    if (random() < 0.08) push[id] = { subs: [{ endpoint: `https://push.example/${hex(60)}`, p256dh: hex(87), auth: hex(22), at: seen - DAY }], sends: [], periods: {} };
    if (random() < 0.6) lives[id] = { first: Math.floor((now - int(30) * DAY) / DAY), last: Math.floor((now - int(5) * DAY) / DAY), steps: int(512) };
  });
  const growth = { salt: hex(32), players: gp, shares, metrics: { days: { [String(Math.floor(now / DAY))]: { active: count } }, cohorts: {}, lives }, tables: {}, sweptAt: now - 1000, contacts, push, comeback, comebackStats: {}, outreach: { off: {}, log: [], sent: {}, previews: [] } };

  const cities: Record<string, unknown> = {};
  for (const [cityId, share] of [['lagos', 0.7], ['ibadan', 0.25], ['abuja', 0.05]] as const) {
    const residents: Record<string, unknown> = {};
    ids.forEach((id, i) => { if (random() < share) residents[id] = { name: (players[id] as { name: string }).name, house: random() < 0.5 ? 'own' : `d${int(12)}`, since: now - int(40) * DAY, lastSeen: (players[id] as { seen: number }).seen, day: Math.floor(now / DAY) - int(10), cash: int(500000), week: 2900, earned: int(20000), gems: int(5), claims: int(3) }; void i; });
    const voters = Object.keys(residents).filter(() => random() < 0.2), week = 2900;
    const candidates = Object.fromEntries(voters.slice(0, 5).map((id) => [id, { name: (players[id] as { name: string }).name, slogan: 'Vote for roads', at: now - DAY }]));
    cities[cityId] = { seq: 3, visits: Object.keys(residents).length * 4, prunedAt: now - 1000, residents, gov: { elections: { [String(week)]: { candidates, votes: Object.fromEntries(voters.map((id) => [id, Object.keys(candidates)[int(Math.max(1, Object.keys(candidates).length))] ?? ''])), addr: {}, capLogged: {} } }, announcements: [] }, ads: { billboard: {}, sea: {} }, hunt: { found: 30, claims: 4, byDay: { [String(Math.floor(now / DAY))]: 3 } }, radio: { queues: {}, daily: {} } };
  }
  const civic = { v: 1, prefs: Object.fromEntries(ids.filter(() => random() < 0.02).map((id) => [id, { richList: true }])), salt: hex(32), cities };

  const shops: Record<string, unknown> = {};
  ids.forEach((id, i) => { if (i > 0 && random() < 0.03) shops[id] = { by: { id, name: (players[id] as { name: string }).name }, city: 'lagos', venue: pick(['market', 'campus-market', 'palms']), type: pick(['kiosk', 'tailor', 'barber']), name: `${pick(NAMES)}'s stall`, colour: '#aa5500', icon: '\u{1F6D2}', status: random() < 0.15 ? 'closed' : 'open', openedAt: now - 10 * DAY, at: now - int(3) * DAY, paidUntil: now + 3 * DAY, owed: 0, ...(random() < 0.1 ? { closedAt: now - int(20) * DAY } : {}), stock: { bread: 10, soap: 4 }, prices: { bread: 200, soap: 350 }, part: { bread: 0.2 }, till: int(5000), sold: int(40), rep: 40, ratings: { n: 3, sum: 12 }, upgrades: [], log: [] }; });
  const business = { v: 1, shops, reports: [], seq: 0 };
  return { collections: { social, growth, civic, business }, ids, founder };
}
