/** The hosted companion's routes (server/routes/companion.ts, moderation.ts). The shapes are kept loose on purpose: the client reads them defensively. */
import type { HostErrorCode, JsonBodyErrorCode, Ok } from './protocol.ts'

export interface CompanionAskBody { message: string; clientId: string; turnId?: string; history?: { role: 'user' | 'assistant'; text: string }[]; rephrase?: boolean; localText?: string }
/** `via: 'local'` with no text: use the built-in answer. */
export interface CompanionAskResponse { via: 'primary' | 'fallback' | 'local' | 'filtered'; text: string | null; suggest: string[]; topic?: string }
export interface CompanionTestResponse { ok: boolean; model?: string; ms?: number; usedFallback?: boolean; error?: string }
export interface CompanionHttpRoutes {
  'POST /api/companion/ask': { body: CompanionAskBody; response: Ok<CompanionAskResponse>; errors: HostErrorCode | JsonBodyErrorCode | 'invalid_message' | 'session_required' | 'onboarding_required' }
  'POST /api/mod/companion-test': { body: Record<string, never>; response: CompanionTestResponse; errors: HostErrorCode | JsonBodyErrorCode | 'rate_limited' | 'moderator_required' }
}
