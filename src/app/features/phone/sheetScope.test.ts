// The key of the sheet's body (SheetHost): an open sheet is rebuilt when the identity or the city under it really
// changes, but the character creator is not torn down by the session its own Play creates. Rendered with a bare
// renderer (no DOM) so that mounting and unmounting are counted for real.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRenderer, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { DEFAULT_LOOK } from '../../../game/content/traits.ts'
import { loadAllCityRules } from '../../../game/cities/registry.ts'
import { settlePlan } from '../start/creatorModel.ts'
import { cr } from '../start/creatorState.ts'
import { scopeSwitched, useSheetScope } from './phoneModel.ts'
await loadAllCityRules()

interface Node { children: Node[]; text?: string }
const parents = new WeakMap<Node, Node>()
const { createApp } = createRenderer<Node, Node>({
  createElement: () => ({ children: [] }), createText: (text) => ({ children: [], text }), createComment: (text) => ({ children: [], text }),
  setText: () => {}, setElementText: () => {}, patchProp: () => {},
  insert: (child, parent, anchor) => { parents.set(child, parent); parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, child) },
  remove: (child) => { const parent = parents.get(child); if (parent) parent.children.splice(parent.children.indexOf(child), 1) },
  parentNode: (node) => parents.get(node) ?? null, nextSibling: (node) => { const parent = parents.get(node); return parent?.children[parent.children.indexOf(node) + 1] ?? null },
})

const events = new EventTarget()
function rig() {
  const session = ref<string | null>(null)
  const city = ref('lagos')
  const sent: string[] = []
  const log = { mounted: 0, unmounted: 0 }
  // Stands in for CreatorApp: listens for the shell's "life exists" answer once mounted and then sends the rest.
  const Creator = defineComponent({ setup() {
    const onDone = (event: Event): void => {
      if ((event as CustomEvent<{ ok: boolean }>).detail.ok !== true) return
      const plan = settlePlan({ saved: { step: 1, look: DEFAULT_LOOK, traits: [], dream: null, lottery: null }, draft: { look: cr.draft!.look, traits: cr.draft!.traits, dream: cr.draft!.dream, area: cr.draft!.area }, stay: false })
      for (const action of plan ?? []) sent.push(action.type)
    }
    onMounted(() => { log.mounted += 1; events.addEventListener('done', onDone) })
    onBeforeUnmount(() => { log.unmounted += 1; events.removeEventListener('done', onDone) })
    return () => h('div')
  } })
  const Host = defineComponent({ setup() { const scope = useSheetScope(session, city); return () => h(Creator, { key: scope.value }) } })
  createApp(Host).mount({ children: [] })
  return { session, city, sent, log }
}

test('the creator survives the session its own Play creates and still sends the rest of the choices', async () => {
  cr.draft = { look: { ...DEFAULT_LOOK }, name: 'Ada', traits: ['bold', 'kind'] as never, dream: 'wealth' as never, area: { lga: 'ikeja', via: 'manual' }, spiritChosen: true }
  const { session, city, sent, log } = rig()
  await nextTick()
  assert.equal(log.mounted, 1)
  city.value = 'abuja' // the city the life will be born in, chosen while there is no session
  session.value = 'session-1' // Play answered
  await nextTick()
  events.dispatchEvent(new CustomEvent('done', { detail: { ok: true } }))
  assert.deepEqual([log.mounted, log.unmounted], [1, 0])
  assert.deepEqual(sent, ['onboarding.traits', 'onboarding.dream', 'onboarding.lottery', 'onboarding.home'])
})

test('a real identity or city switch still rebuilds an open sheet', async () => {
  const { session, city, log } = rig()
  session.value = 'a'; await nextTick()
  assert.equal(log.unmounted, 0)
  session.value = 'b'; await nextTick() // signed in as someone else
  assert.equal(log.unmounted, 1)
  city.value = 'abuja'; await nextTick() // travelled
  assert.equal(log.unmounted, 2)
  session.value = null; await nextTick() // signed out
  assert.equal(log.unmounted, 3)
  session.value = 'c'; await nextTick() // the next guest arrives: nothing left to protect
  assert.equal(log.unmounted, 3)
})

test('which transitions switch', () => {
  assert.equal(scopeSwitched({ session: null, city: 'lagos' }, { session: 'a', city: 'lagos' }), false)
  assert.equal(scopeSwitched({ session: null, city: 'lagos' }, { session: null, city: 'abuja' }), false)
  assert.equal(scopeSwitched({ session: null, city: 'lagos' }, { session: 'a', city: 'abuja' }), false)
  assert.equal(scopeSwitched({ session: 'a', city: 'lagos' }, { session: 'a', city: 'lagos' }), false)
  assert.equal(scopeSwitched({ session: 'a', city: 'lagos' }, { session: 'b', city: 'lagos' }), true)
  assert.equal(scopeSwitched({ session: 'a', city: 'lagos' }, { session: null, city: 'lagos' }), true)
  assert.equal(scopeSwitched({ session: 'a', city: 'lagos' }, { session: 'a', city: 'abuja' }), true)
})
