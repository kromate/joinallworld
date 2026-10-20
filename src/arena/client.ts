/**
 * OWNER: games (real-time)
 * The browser's socket for real-time game rooms (server/ws/arena.ts). It is game-blind: it opens /socket, forwards `arena-*`
 * frames to the screen that owns it, answers the Worker's heartbeat, and re-opens with a bounded back-off while the screen
 * is open. On every (re)connection the screen is told (`open`), and asks for its room again with `arena-join`: the seat is
 * kept on the server, so a dropped connection picks the game up where it is.
 *
 * It opens its OWN socket (one more connection only while a room is on screen) so that the tables client and the social
 * client stay as they are. It is fetched with the first game, never with the startup bundle.
 *
 * INPUT BUDGET. The host allows 600 frames a minute per player (10 a second on average) and closes the socket beyond it, so a
 * game must send inputs when they CHANGE, never per frame. `InputPipe` below coalesces them: at most one frame per
 * `minGapMs`, presses are never lost (they are OR-ed into the next frame), and a hard ceiling keeps a long burst under the limit.
 */
import { onWake, reconnectDelay, STABLE_CONNECTION_MS } from '../reconnect.ts'
import type { ArenaServerFrame, ArenaStateFrame } from '../types/arena.ts'

/** The refusals of stakes and backing (src/arena/stakes.ts, the table stakes' own codes): said to the player like the room's own. */
const STAKE_CODES = new Set(['adults_only', 'already_backed', 'backers_full', 'backing_closed', 'insufficient_funds', 'invalid_seat', 'invalid_stake', 'not_ready', 'pair_day_cap', 'player_day_cap', 'stake_exceeds_work', 'stake_refused', 'work_first'])

export type ArenaConnection = 'connecting' | 'open' | 'closed'
export interface ArenaListener {
  open(): void
  state(frame: ArenaStateFrame): void
  snap(room: string, k: number, s: unknown, acks?: number[]): void
  /** A refusal (`code` is the machine code, `reason` the sentence for the player). */
  error(code: string, reason: string): void
  connection(status: ArenaConnection): void
}
export interface ArenaClient {
  send(type: string, body?: Record<string, unknown>): boolean
  /** Open (or re-open) the socket. */
  connect(): void
  /** Close for good: no more reconnects. */
  close(): void
  status(): ArenaConnection
}

const MAX_ATTEMPTS = 8

export function createArenaClient(listener: ArenaListener): ArenaClient {
  let ws: WebSocket | null = null, attempts = 0, timer: ReturnType<typeof setTimeout> | null = null, done = false, joinedAt: number | null = null
  let status: ArenaConnection = 'closed'
  const set = (next: ArenaConnection): void => { status = next; listener.connection(next) }

  function connect(): void {
    if (ws || done) return
    set('connecting')
    const socket = ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/socket`)
    socket.onopen = () => { if (ws !== socket) return; joinedAt = Date.now(); set('open'); listener.open() }
    socket.onmessage = (event: MessageEvent<string>) => {
      if (ws !== socket) return
      let frame: { type?: string; [field: string]: unknown }
      try { frame = JSON.parse(event.data) as typeof frame } catch { return }
      switch (frame.type) {
        case 'heartbeat': if (socket.readyState === 1) socket.send('{"type":"heartbeat-ack"}'); break
        case 'arena-state': listener.state(frame as unknown as ArenaStateFrame); break
        case 'arena-snap': { const f = frame as unknown as Extract<ArenaServerFrame, { type: 'arena-snap' }>; listener.snap(f.room, f.k, f.s, f.a); break }
        case 'error': if (typeof frame.code === 'string' && (/^(arena_|invalid_arena)/.test(frame.code) || STAKE_CODES.has(frame.code))) listener.error(frame.code, typeof frame.reason === 'string' ? frame.reason : 'That could not be done.'); else if (frame.code === 'join_required') listener.error('arena_unavailable', 'Live games are not available on this server right now.'); else if (frame.code === 'rate_limited') listener.error('rate_limited', 'You are sending too fast. Reconnecting.'); break
        default: break
      }
    }
    socket.onclose = () => {
      if (ws !== socket) return
      if (joinedAt !== null && Date.now() - joinedAt >= STABLE_CONNECTION_MS) attempts = 0
      joinedAt = null; ws = null
      set('closed')
      if (!done && attempts < MAX_ATTEMPTS && !timer) timer = setTimeout(() => { timer = null; attempts += 1; connect() }, reconnectDelay(attempts, 400, 6000))
    }
    socket.onerror = () => {}
  }
  // The network is back, or the tab is shown again: connect now instead of waiting out the pause (or the give-up).
  const stopWake = onWake(() => { if (!ws && !done) { attempts = 0; if (timer) { clearTimeout(timer); timer = null } connect() } })
  return {
    connect,
    status: () => status,
    send(type, body = {}) {
      if (ws?.readyState !== 1) return false
      ws.send(JSON.stringify({ type, ...body }))
      return true
    },
    close() {
      done = true
      stopWake()
      if (timer) { clearTimeout(timer); timer = null }
      const old = ws; ws = null
      try { old?.close() } catch { /* already closed */ }
      status = 'closed'
    },
  }
}

/**
 * Turns "what the player holds / just pressed" into as few frames as the budget allows. Pure apart from the injected
 * clock and sender, so it is tested without a browser. `held` is what is down now; `press(bits)` is a tap.
 */
export interface InputPipeOptions { send(held: number, pressed: number): void; now(): number; minGapMs?: number; resendMs?: number; maxPerWindow?: number; windowMs?: number }
export class InputPipe {
  private held = 0
  private sentHeld = 0
  private pending = 0
  private lastSend = -Infinity
  private dirty = false
  private readonly log: number[] = []
  private readonly opt: Required<InputPipeOptions>
  constructor(options: InputPipeOptions) {
    this.opt = { minGapMs: 60, resendMs: 500, maxPerWindow: 70, windowMs: 10000, ...options }
  }
  /** Replace what is held (movement, block). */
  hold(mask: number): void { if (mask !== this.held) { this.held = mask; this.dirty = true } }
  /** A tap (jump, punch, kick): never dropped, merged with other taps waiting. */
  press(bits: number): void { this.pending |= bits; this.dirty = true }
  /** Call often (every animation frame, or a timer): sends when something changed and the gap allows, or re-sends held buttons now and then. */
  flush(): boolean {
    const t = this.opt.now()
    const stale = this.held !== 0 && t - this.lastSend >= this.opt.resendMs
    if (!this.dirty && !stale) return false
    while (this.log.length && t - (this.log[0] as number) > this.opt.windowMs) this.log.shift()
    const over = this.log.length >= this.opt.maxPerWindow
    // Over the ceiling the gap widens (taps still merge into the next frame, none is lost) and a mere re-send is skipped, so a
    // player mashing buttons for a minute stays well under the host's 600 frames a minute.
    if (t - this.lastSend < (over ? this.opt.minGapMs * 2.5 : this.opt.minGapMs)) return false
    if (over && !this.dirty) return false
    this.opt.send(this.held, this.pending)
    this.sentHeld = this.held; this.pending = 0; this.dirty = false; this.lastSend = t
    this.log.push(t)
    return true
  }
  /** Let go of everything (the window lost focus, the game ended). */
  reset(): void { this.held = 0; this.pending = 0; this.dirty = this.sentHeld !== 0 }
}
