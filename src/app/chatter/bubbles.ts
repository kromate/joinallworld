// Speech bubbles over two regulars in the venue scene. The scene draws a name tag (a DOM node, `.scene-tag[data-tag="npc:<id>"]`) over
// every regular and moves it each frame; a bubble follows the tag it belongs to instead of asking the scene for anything, so the scene
// host is untouched. Text is set with textContent only. Every bubble carries the NPC word (src/ui/npc-mark.ts), and a beta line says so.
import { npcTitle } from '../../ui/npc-mark.ts'

const STYLE_ID = 'chatter-style'
const CSS = `
.chatter-bubble{position:absolute;z-index:2;transform:translate(-50%,calc(-100% - 22px));max-width:min(220px,60vw);padding:6px 10px;border-radius:14px;background:rgba(255,255,255,.96);color:#1d2a26;box-shadow:0 2px 8px rgba(0,0,0,.3);font:600 13px/1.3 var(--font,system-ui,sans-serif);pointer-events:none;animation:chatter-in .22s ease-out}
.chatter-bubble[hidden]{display:none}
.chatter-bubble small{display:block;margin-bottom:1px;font:700 10px/1.2 var(--font,system-ui,sans-serif);letter-spacing:.03em;color:#4a5560}
@keyframes chatter-in{from{opacity:0;transform:translate(-50%,calc(-100% - 12px))}to{opacity:1}}
@media (prefers-reduced-motion:reduce){.chatter-bubble{animation:none}}
`

/** How long a bubble stays up. */
export const BUBBLE_MS = 5_500

interface Live { node: HTMLElement; tag: HTMLElement | null; npcId: string; timer: ReturnType<typeof setTimeout> | null }
const live = new Set<Live>()
let frame = 0

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}

/** The scene's tag node of this regular, or null when the scene is not drawing them. */
export function tagOf(npcId: string): HTMLElement | null {
  for (const node of document.querySelectorAll<HTMLElement>('.scene-tags [data-tag]')) if (node.dataset.tag === `npc:${npcId}`) return node
  return null
}

function place(): void {
  for (const item of live) {
    if (!item.tag?.isConnected) item.tag = tagOf(item.npcId)
    const tag = item.tag
    const hidden = !tag || tag.hidden || !tag.style.left
    item.node.hidden = hidden
    if (tag && !hidden) { item.node.style.left = tag.style.left; item.node.style.top = tag.style.top }
  }
}

function follow(): void {
  frame = 0
  place()
  if (live.size) frame = globalThis.requestAnimationFrame(follow)
}

function drop(item: Live): void {
  if (item.timer !== null) globalThis.clearTimeout(item.timer)
  item.node.remove()
  live.delete(item)
}

/** Show one regular's line over their tag. False when the scene is not drawing that regular (nothing is shown then). */
export function say(npcId: string, name: string, text: string, beta: boolean, ms: number = BUBBLE_MS): boolean {
  const tag = tagOf(npcId)
  const layer = tag?.parentElement?.parentElement
  if (!tag || !layer) return false
  ensureStyle()
  const node = document.createElement('div')
  node.className = 'chatter-bubble'
  node.setAttribute('aria-hidden', 'true')
  node.dataset.chatter = npcId
  const who = document.createElement('small')
  who.textContent = beta ? `${npcTitle(name)} · beta` : npcTitle(name)
  const words = document.createElement('span')
  words.textContent = text
  node.append(who, words)
  // One bubble per regular: a new line replaces their last.
  for (const item of [...live]) if (item.npcId === npcId) drop(item)
  layer.appendChild(node)
  const item: Live = { node, tag, npcId, timer: null }
  item.timer = globalThis.setTimeout(() => { drop(item) }, ms)
  live.add(item)
  place()
  if (!frame) frame = globalThis.requestAnimationFrame(follow)
  return true
}

/** Take every bubble down (the player left the venue). */
export function clearBubbles(): void {
  for (const item of [...live]) drop(item)
  if (frame) { globalThis.cancelAnimationFrame(frame); frame = 0 }
}
