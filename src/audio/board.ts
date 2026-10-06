// The sound board: a developer page (open the game with ?sounds) listing every recipe, event, motif and scape with a play
// button, the live voice count and the output peak. It also hands a small handle to the measurements (window.__soundBoard),
// including an offline render of a recipe or scape through the same synth and the same mix.
import { EVENTS, MOTIFS, RECIPES, SCAPES } from './data.ts'
import { Director, type Deps } from './director.ts'
import { SOUND_DEFAULTS } from './settings.ts'

export interface BoardHandle {
  director: Director
  ctx: AudioContext
  /** Largest absolute sample in the last analyser window. */
  peak(): number
  /** Render a recipe, an event or a scape to a mono buffer through a fresh synth. */
  render(kind: 'recipe' | 'scape', id: string, seconds: number, night?: boolean): Promise<Float32Array>
}

function peakOf(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer)
  let peak = 0
  for (let i = 0; i < buffer.length; i++) peak = Math.max(peak, Math.abs(buffer[i] as number))
  return peak
}

export function mountBoard(director: Director, ctx: AudioContext): void {
  const scratch = new Float32Array(director.synth.analyser.fftSize)
  const handle: BoardHandle = {
    director, ctx,
    peak: () => peakOf(director.synth.analyser, scratch),
    async render(kind, id, seconds, night = false) {
      const rate = 44100
      const offline = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate)
      const deps: Deps = { settings: () => SOUND_DEFAULTS, soundOf: () => undefined, kindOf: () => '', now: () => 0, every: () => () => undefined, after: () => () => undefined, live: false }
      const rendered = new Director(offline, deps)
      if (kind === 'recipe') rendered.synth.play(id)
      else { rendered.preview(id, night); rendered.prime(seconds) }
      const done = await offline.startRendering()
      return done.getChannelData(0).slice()
    },
  }
  ;(window as unknown as { __soundBoard: BoardHandle }).__soundBoard = handle

  const root = document.createElement('div')
  root.style.cssText = 'position:fixed;inset:0;z-index:99999;overflow:auto;background:#fff;color:#111;font:13px system-ui;padding:12px'
  const head = document.createElement('p')
  const close = document.createElement('button')
  close.textContent = 'Hide'; close.onclick = () => root.remove()
  root.append(close, head)
  const section = (title: string, ids: readonly string[], run: (id: string) => void): void => {
    const h = document.createElement('h3'); h.textContent = `${title} (${ids.length})`; root.append(h)
    for (const id of ids) { const b = document.createElement('button'); b.textContent = id; b.style.margin = '2px'; b.onclick = () => { void ctx.resume(); run(id) }; root.append(b) }
  }
  section('Events', Object.keys(EVENTS), id => director.play(id))
  section('Recipes', Object.keys(RECIPES), id => director.synth.play(id))
  section('Motifs', Object.keys(MOTIFS), id => director.synth.play(MOTIFS[id] ?? 'motif-neutral'))
  section('Scapes (day)', Object.keys(SCAPES), id => director.preview(id, false))
  section('Scapes (night)', Object.keys(SCAPES), id => director.preview(id, true))
  document.body.append(root)
  setInterval(() => { head.textContent = `voices ${director.synth.count()} · peak ${handle.peak().toFixed(3)} · ${ctx.state}` }, 200)
}
