import { mintIceServers } from '../server/call-relay.ts';
export interface TurnEnv { TURN_KEY_ID?: string; TURN_API_TOKEN?: string; TURN_TEST_PUBLIC_IDS?: string }
export interface IceResult { iceServers: unknown; expiresAt: number }
export interface IceOptions { fetchImpl?: (url: string, init: RequestInit) => Promise<Response>; now?: () => number }

/** The bounded room-voice test (GET /api/voice-config). One-to-one calls do not use it: server/call-relay.ts. */
export const TURN_TTL_SECONDS = 600;
export const TURN_DAILY_MINT_LIMIT = 8;
export function relayTestAuthorized(env: TurnEnv, publicId: string): boolean {
  const ids = (env.TURN_TEST_PUBLIC_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  return ids.length > 0 && ids.length <= 2 && ids.includes(publicId);
}
export function mintCloudflareIce(env: TurnEnv, options: IceOptions = {}): Promise<IceResult> {
  return mintIceServers(env, TURN_TTL_SECONDS, options);
}
