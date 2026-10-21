export const SHARING_TERMS_VERSION = '2026-10-20'
export interface SharingAcceptance { version: string; at: number; minimumAge: 13 }

export function sharingSocketAction(type: string, enabled?: unknown): boolean {
  return type === 'chat' || type === 'dm-send' || type === 'call-invite' || type === 'call-accept'
    || type === 'live-start' || type === 'live-join' || (type === 'voice-state' && enabled === true)
}
