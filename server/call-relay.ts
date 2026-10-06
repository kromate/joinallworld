/**
 * OWNER: social
 * The relay for one-to-one calls: short-lived connection-relay credentials, made per call for each side that asks, within
 * limits that bound what the provider can be asked to do. Portable: no Node imports; both hosts build one from their
 * own settings (server/server.ts, deploy/cloudflare-worker.ts) and hand it to the call service as `ctx.callRelay`.
 *
 * SETTINGS (all optional except the first two; a number that is missing or not a whole number uses its default)
 *   TURN_KEY_ID, TURN_API_TOKEN   the provider's key. Without both, the relay is OFF: calls get STUN only.
 *   CALL_RELAY_PER_PLAYER_DAY     credentials one player may be given in a UTC day          (default 30)
 *   CALL_RELAY_PER_ADDRESS_HOUR   credentials one network address may be given in an hour   (default 120)
 *   CALL_RELAY_DAILY_CEILING      credentials this host gives out in a UTC day, all players (default 3000)
 * A call asks once per side (twice more for a restart of the connection), so a call costs two credentials. A refused
 * request is not an error for the call: it goes on with STUN only and the caller is told the relay was `limited`.
 * A credential lasts CALL_RELAY_TTL_SECONDS; the API token never leaves the server.
 */
export type RelayState = 'on' | 'off' | 'limited' | 'error'
export interface RelayServer { urls: string | string[]; username?: string; credential?: string }
export type RelayIssue = { relay: 'on'; iceServers: RelayServer[]; expiresAt: number } | { relay: Exclude<RelayState, 'on'> }
export interface RelayLimits { perPlayerPerDay: number; perAddressPerHour: number; dailyCeiling: number }
export const RELAY_DEFAULTS: Readonly<RelayLimits> = { perPlayerPerDay: 30, perAddressPerHour: 120, dailyCeiling: 3000 };
export const CALL_RELAY_TTL_SECONDS = 3600;
const SETTING_NAMES = { perPlayerPerDay: 'CALL_RELAY_PER_PLAYER_DAY', perAddressPerHour: 'CALL_RELAY_PER_ADDRESS_HOUR', dailyCeiling: 'CALL_RELAY_DAILY_CEILING' } as const;

export interface CallRelay {
  /** Both provider settings are present. */
  readonly configured: boolean
  readonly limits: RelayLimits
  issue(player: string, address: string): Promise<RelayIssue>
  /** Credentials given out in the current UTC day (including ones the provider failed to make: they were asked for). */
  mintsToday(): number
}
export interface RelayBudget { used(day: string): number; add(day: string): void }
export interface RelayOptions {
  read(name: string): string | undefined
  now(): number
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  /** Where the daily count is kept; memory when absent. */
  budget?: RelayBudget
}

/** The limits from the settings: whole numbers from 0 up, else the defaults. */
export function relayLimits(read: (name: string) => string | undefined): RelayLimits {
  const pick = (key: keyof RelayLimits): number => { const raw = (read(SETTING_NAMES[key]) ?? '').trim(); return /^\d{1,9}$/.test(raw) ? Number(raw) : RELAY_DEFAULTS[key]; };
  return { perPlayerPerDay: pick('perPlayerPerDay'), perAddressPerHour: pick('perAddressPerHour'), dailyCeiling: pick('dailyCeiling') };
}

/** Ask the provider for short-lived relay servers. Any failure is the one error `voice_config_unavailable`; no body is passed on. */
export async function mintIceServers(settings: { TURN_KEY_ID?: string; TURN_API_TOKEN?: string }, ttl: number, { fetchImpl = fetch, now = Date.now }: { fetchImpl?: (url: string, init: RequestInit) => Promise<Response>; now?: () => number } = {}): Promise<{ iceServers: unknown; expiresAt: number }> {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(settings.TURN_KEY_ID || '') || typeof settings.TURN_API_TOKEN !== 'string' || !settings.TURN_API_TOKEN) throw Error('voice_config_unavailable');
  const startedAt = now();
  try {
    const response = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${settings.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${settings.TURN_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl }),
    });
    if (response.status !== 201 || !response.body) throw Error();
    const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); throw Error(); } chunks.push(value); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes)) as { iceServers: unknown };
    return { iceServers: value.iceServers, expiresAt: startedAt + ttl * 1000 };
  } catch { throw Error('voice_config_unavailable'); }
}

/** The relay servers as the browser may use them: at most 8 entries, each with at most 8 plain stun/turn addresses. Anything else is refused. */
export function cleanRelayServers(value: unknown): RelayServer[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 8) return null;
  const out: RelayServer[] = [];
  let turn = false;
  for (const item of value) {
    const entry: { urls?: unknown; username?: unknown; credential?: unknown } = item && typeof item === 'object' ? item : {};
    const urls: unknown = typeof entry.urls === 'string' ? [entry.urls] : entry.urls;
    if (!Array.isArray(urls) || !urls.length || urls.length > 8 || urls.some(url => typeof url !== 'string' || url.length > 512 || !/^(stun|stuns|turn|turns):[^\s]+$/.test(url))) return null;
    const list = urls as string[];
    if (list.some(url => /^turns?:/.test(url))) {
      if (typeof entry.username !== 'string' || !entry.username || entry.username.length > 512 || typeof entry.credential !== 'string' || !entry.credential || entry.credential.length > 4096) return null;
      turn = true;
      out.push({ urls: [...list], username: entry.username, credential: entry.credential });
    } else out.push({ urls: [...list] });
  }
  return turn ? out : null;
}

export function createCallRelay(options: RelayOptions): CallRelay {
  const { read, now } = options;
  const keyId = (read('TURN_KEY_ID') ?? '').trim(), token = read('TURN_API_TOKEN') ?? '';
  const configured = /^[a-zA-Z0-9_-]{16,128}$/.test(keyId) && token.length > 0;
  const limits = relayLimits(read);
  const day = (): string => new Date(now()).toISOString().slice(0, 10);
  let memoryDay = '', memoryCount = 0;
  const budget: RelayBudget = options.budget ?? {
    used: (key) => (key === memoryDay ? memoryCount : 0),
    add: (key) => { if (key !== memoryDay) { memoryDay = key; memoryCount = 0; } memoryCount++; },
  };
  const perPlayer = new Map<string, { day: string; count: number }>();
  const perAddress = new Map<string, { hour: number; count: number }>();
  const trim = <K, V>(map: Map<K, V>): void => { if (map.size > 20000) map.clear(); };
  return {
    configured, limits,
    mintsToday: () => budget.used(day()),
    async issue(player, address) {
      if (!configured) return { relay: 'off' };
      const today = day(), hour = Math.floor(now() / 3600000);
      const mine = perPlayer.get(player), theirs = perAddress.get(address);
      const playerCount = mine && mine.day === today ? mine.count : 0, addressCount = theirs && theirs.hour === hour ? theirs.count : 0;
      if (playerCount >= limits.perPlayerPerDay || addressCount >= limits.perAddressPerHour || budget.used(today) >= limits.dailyCeiling) return { relay: 'limited' };
      // Counted before the provider is asked: a failed request is still a request, so cost stays bounded.
      trim(perPlayer); trim(perAddress);
      perPlayer.set(player, { day: today, count: playerCount + 1 });
      perAddress.set(address, { hour, count: addressCount + 1 });
      budget.add(today);
      try {
        const minted = await mintIceServers({ TURN_KEY_ID: keyId, TURN_API_TOKEN: token }, CALL_RELAY_TTL_SECONDS, { ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}), now });
        const servers = cleanRelayServers(minted.iceServers);
        return servers ? { relay: 'on', iceServers: servers, expiresAt: minted.expiresAt } : { relay: 'error' };
      } catch { return { relay: 'error' }; }
    },
  };
}
