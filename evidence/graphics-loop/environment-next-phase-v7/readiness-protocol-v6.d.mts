export type ReadinessHost = {
  location?: string | null
  avatarRendering?: string
  canonicalBodyEligible?: boolean
  renderCount?: number
}
export type HomeWitness = Readonly<{
  hostGeneration: number
  entryId: number
  identityKey: string
  renderCount: number
}>
export function createReadinessEpoch(): Readonly<{
  begin(): number
  cancel(): number
  owns(id: number): boolean
  finish(id: number): boolean
}>
export function observeCurrentHomeBody(input: {
  currentPlace: string
  currentHostGeneration: number
  entry: { id: number; hostGeneration: number; renderCount: number }
  currentEntryId: number
  identityKey: string
  expectedIdentityKey: string
  host: ReadinessHost | null
}): { accepted: boolean; reasons: string[]; witness: HomeWitness | null }
export function homeReadiness(input: {
  validatedBody: { hostGeneration: number; bodyGeneration: number; identityKey: string } | null
  currentBodyGeneration: number
  hostGeneration: number
  entry: { id: number; hostGeneration: number; renderCount: number }
  currentEntryId: number
  currentPlace: string
  identityKey: string
  host: ReadinessHost | null | undefined
}): { ready: boolean; reasons: string[]; hostGeneration: number; entryId: number; bodyGeneration: number | null; renderCount: number | null; identityKey: string }
export function walkRequestRecord(id: number, accepted: boolean, dx: number, dz: number, at: string | number, before: { x: number; z: number } | null, context?: Record<string, unknown>): Readonly<{
  id: number
  accepted: boolean
  dx: number
  dz: number
  at: string | number
  before: Readonly<{ x: number; z: number }> | null
  context: Readonly<Record<string, unknown>>
}>
