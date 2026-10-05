import { useApp } from './state/app.ts'

/** Explicit developer diagnostics; loaded only when requested in the page URL. */
export function installDiagnostics(): void {
  const { game, scene, panels, shell, community } = useApp()
  const panel = document.createElement('aside')
  panel.style.cssText = 'position:fixed;left:10px;bottom:90px;z-index:60;background:white;color:black;padding:8px;max-width:340px;font:12px monospace'
  const button = document.createElement('button'); button.textContent = 'Read renderer diagnostics'
  const output = document.createElement('pre'); output.id = 'render-diagnostics'
  const read = (): Record<string, unknown> => ({ ...(scene.venue.value ? scene.venue.value.diagnostics() : { renderCount: 0, scene: 'not loaded yet' }), map: scene.city.value ? scene.city.value.diagnostics() : 'not loaded yet', visibility: document.visibilityState, shell: 'vue', lazyPanelsWaiting: panels.filter((item) => 'pending' in item && item.pending).map((item) => item.id) })
  button.onclick = () => { output.textContent = JSON.stringify(read(), null, 2) }
  Object.assign(window, { __jaw: { get map() { return scene.city.value }, get client() { return game.client }, get mode() { return game.mode.value }, get venue() { return scene.venue.value }, get shell() { return shell }, get community() { return community }, read } })
  panel.append(button, output); document.body.append(panel)
}
