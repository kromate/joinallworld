// Development fixture for voice-test.html: the community controller with a synthetic audio source
// instead of the microphone, drawn by the same panel the game uses. Served by `npm run dev` only.
// No microphone is used: Join voice sends a quiet generated tone, and only after an explicit tap.
import { createApp, h, shallowRef } from 'vue'
import CommunityPanel from './app/features/community/CommunityPanel.vue'
import { createCommunity } from './community.ts'
import type { CommunityController, CommunityState } from './types/community.ts'

interface Source { context: AudioContext; analyser: AnalyserNode; track: MediaStreamTrack; samples: Float32Array<ArrayBuffer> }
const sources: Source[] = []
let denyOnce = false
const text = (selector: string): HTMLElement => document.querySelector<HTMLElement>(selector)!

const session = await fetch('/api/session').then((response) => (response.ok ? response.json() as Promise<{ session?: { id?: string } }> : null))
if (session?.session) {
  const identity = document.createElement('p')
  identity.id = 'fixture-public-id'; identity.textContent = `Public test session: ${session.session.id}`
  document.querySelector('main')!.prepend(identity)
}
text('#deny-once').onclick = () => { denyOnce = true; text('#fixture-status').textContent = 'Next test capture will reject with NotAllowedError. This simulates denial without requesting a microphone.' }

const state = shallowRef<CommunityState | null>(null)
let controller: CommunityController | null = null
controller = await createCommunity({
  diagnostics: true,
  iceTransportPolicy: new URLSearchParams(location.search).get('relay') === '1' ? 'relay' : 'all',
  onChange: (next) => { state.value = next },
  onPeerStats: () => {
    text('#fixture-source').textContent = JSON.stringify(sources.map(({ context, analyser, track, samples }) => {
      analyser.getFloatTimeDomainData(samples)
      return { contextState: context.state, currentTime: context.currentTime, trackEnabled: track.enabled, trackState: track.readyState, sourceRms: Math.sqrt(samples.reduce((n, v) => n + v * v, 0) / samples.length) }
    }), null, 2)
  },
  audioStreamFactory: async () => {
    if (denyOnce) { denyOnce = false; throw new DOMException('Synthetic capture denied', 'NotAllowedError') }
    const context = new AudioContext(); await context.resume()
    const oscillator = context.createOscillator(), gain = context.createGain(), destination = context.createMediaStreamDestination(), analyser = context.createAnalyser()
    oscillator.frequency.value = 440; gain.gain.value = 0.05; oscillator.connect(gain); gain.connect(destination); gain.connect(analyser); oscillator.start()
    const track = destination.stream.getAudioTracks()[0]!, stop = track.stop.bind(track)
    sources.push({ context, analyser, track, samples: new Float32Array(analyser.fftSize) })
    track.stop = () => { stop(); oscillator.stop(); void context.close() }
    return destination.stream
  },
})
state.value = controller.state
createApp({ render: () => h(CommunityPanel, { store: { state, controller: () => controller } }) }).mount('#test-community')
window.addEventListener('pagehide', () => { controller?.destroy(); for (const { context } of sources) if (context.state !== 'closed') void context.close() })
