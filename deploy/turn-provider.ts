export interface TurnEnv { TURN_KEY_ID?: string; TURN_API_TOKEN?: string; TURN_TEST_PUBLIC_IDS?: string }
export interface IceResult { iceServers: unknown; expiresAt: number }
export interface IceOptions { fetchImpl?: (url: string, init: RequestInit) => Promise<Response>; now?: () => number }

export const TURN_TTL_SECONDS = 600;
export const TURN_DAILY_MINT_LIMIT = 8;
export function relayTestAuthorized(env: TurnEnv, publicId: string): boolean {
  const ids = (env.TURN_TEST_PUBLIC_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  return ids.length > 0 && ids.length <= 2 && ids.includes(publicId);
}
export async function mintCloudflareIce(env: TurnEnv, { fetchImpl = fetch, now = Date.now }: IceOptions = {}): Promise<IceResult> {
  if (!/^[a-zA-Z0-9_-]{16,128}$/.test(env.TURN_KEY_ID || '') || typeof env.TURN_API_TOKEN !== 'string' || !env.TURN_API_TOKEN) throw Error('voice_config_unavailable');
  const startedAt = now();
  try {
    const response = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${env.TURN_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });
    if (response.status !== 201) throw Error();
    if (!response.body) throw Error(); const reader = response.body.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); throw Error(); } chunks.push(value); }
    const bytes = new Uint8Array(size); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    const value = JSON.parse(new TextDecoder().decode(bytes)) as { iceServers: unknown };
    return { iceServers: value.iceServers, expiresAt: startedAt + TURN_TTL_SECONDS * 1000 };
  } catch { throw Error('voice_config_unavailable'); }
}
