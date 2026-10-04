// What the HUD says, worked out from the view. Pure, so it is tested without a browser.
import type { PanelView } from '../../types/panel.ts'
import type { LinkState } from '../../types/client.ts'

export type MoodTone = 'good' | 'neutral' | 'warn' | 'bad'
export interface HudMood { word: string; icon: string; tone: MoodTone; score: number }
/** The mood word in the HUD and the Sim header: the character system's five words, else the core label. */
export function moodOf(view: Pick<PanelView, 'onboarding' | 'needs'>): HudMood {
  const mood = view.onboarding?.mood
  if (mood?.word) return mood
  const core = view.needs.mood
  return { word: core.label, icon: core.icon, tone: core.score < 25 ? 'bad' : core.score < 45 ? 'warn' : 'good', score: core.score }
}

export interface LinkNotice { title: string; text: string; actions: { label: string; run: 'new-life' | 'reconnect'; primary: boolean }[] }
export interface LinkWording {
  /** The top bar's short label. */
  pill: string
  icon: string
  tone: 'wait' | 'off'
  /** The line in the More menu. */
  menu: string
  /** Opens the session panel with this reason instead of reconnecting. */
  gate?: 'new' | 'expired'
  /** Shown under the top bar for as long as the game cannot be played. */
  notice?: LinkNotice
}
/**
 * Each connection state has its own truthful wording: "Offline" / "No internet" is said only when
 * this device has no network. 'online' has no entry: connected is the normal case.
 */
export const LINKS: Readonly<Record<Exclude<LinkState, 'online'>, LinkWording>> = {
  connecting: { pill: 'Connecting…', icon: 'refresh', tone: 'wait', menu: 'Connecting…' },
  new: { pill: 'Not started', icon: 'person', tone: 'wait', menu: 'Choose a nickname to start', gate: 'new' },
  expired: { pill: 'Saved life not found', icon: 'cloud-off', tone: 'off', menu: 'Saved life not found · read-only', gate: 'expired',
    notice: { title: 'This device’s saved life is no longer on this server',
      text: 'The server is up, but it has no record of the life this browser remembers: its data was reset, or the session ran out. What you see is the copy kept on this device, read-only.',
      actions: [{ label: 'Start a new life', run: 'new-life', primary: true }, { label: 'Try again', run: 'reconnect', primary: false }] } },
  offline: { pill: 'No internet', icon: 'cloud-off', tone: 'off', menu: 'No internet · read-only',
    notice: { title: 'You are offline', text: 'This device has no internet connection. You are looking at the last saved copy; nothing changes until you are back online.', actions: [{ label: 'Try again', run: 'reconnect', primary: true }] } },
  unreachable: { pill: 'Server unreachable', icon: 'cloud-off', tone: 'off', menu: 'Server unreachable · read-only',
    notice: { title: 'The game server is not answering', text: 'Your device is online, but the server could not be reached. Your life is safe there; this is the last copy kept on this device, read-only.', actions: [{ label: 'Try again', run: 'reconnect', primary: true }] } },
}
/** The wording for the view's connection state, or null when connected. */
export function linkWording(view: Pick<PanelView, 'connected' | 'link'>): LinkWording | null {
  if (view.connected) return null
  return view.link === 'online' ? LINKS.unreachable : LINKS[view.link] ?? LINKS.unreachable
}

export type SavedPill =
  | { kind: 'status'; tone: 'ok' | 'saving' | 'unsaved'; icon: string; text: string; title: string }
  | { kind: 'button'; wait: boolean; icon: string; text: string; title: string; gate?: 'new' | 'expired' }
/** The saved indicator in the top bar: saved, saving, not saving, or why the game is not connected (then it is a button). */
export function savedPill(view: Pick<PanelView, 'connected' | 'link' | 'net' | 'storage'>, saving: number): SavedPill {
  const net = view.net?.text ?? '', link = linkWording(view)
  if (link) {
    if (link.tone === 'wait' && !link.gate) return { kind: 'status', tone: 'saving', icon: link.icon, text: link.pill, title: net }
    return { kind: 'button', wait: link.tone === 'wait', icon: link.icon, text: link.pill, title: net, gate: link.gate }
  }
  if (view.storage) return { kind: 'status', tone: 'unsaved', icon: 'error', text: 'Not saving', title: view.storage.reason }
  if (saving > 0) return { kind: 'status', tone: 'saving', icon: 'refresh', text: 'Saving…', title: 'Sending your action to the server' }
  return { kind: 'status', tone: 'ok', icon: 'good', text: 'Saved', title: net || 'Progress saved on the server' }
}
/** The notice under the top bar, or null: a connection problem, else the server saying it cannot save. */
export function hudNotice(view: Pick<PanelView, 'connected' | 'link' | 'storage'>): (LinkNotice & { storage: boolean }) | null {
  const link = linkWording(view)
  if (link?.notice) return { ...link.notice, storage: false }
  if (!link && view.storage) return { title: 'The server cannot save right now', text: `${view.storage.reason} You are still connected; nothing new is kept until it can save again.`, actions: [{ label: 'Check again', run: 'reconnect', primary: true }], storage: true }
  return null
}

/** The wallet line that floats under the balance when it changes: the amount, and its reason when the newest ledger line is that change. */
export function cashDelta(change: number, newest: { amount: number; reason: string } | undefined, money: (value: number) => string): string {
  return `${change > 0 ? '+' : '−'}${money(Math.abs(change))}${newest && newest.amount === change ? ` · ${newest.reason}` : ''}`
}
/** A gain, or a sharp drop, of a need is highlighted once; the slow decay is not. */
export function needFlash(before: number | undefined, value: number): 'up' | 'down' | null {
  if (before === undefined) return null
  if (value - before >= 1) return 'up'
  return before - value >= 3 ? 'down' : null
}
