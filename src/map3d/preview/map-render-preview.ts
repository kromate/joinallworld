import { createMap3D, webglAvailable } from '../map3d.ts';
import type { MapState } from '../map3d.ts';
import type { TimeOfDay } from '../city-build.ts';
import { loadCityPack } from '../regions.ts';
import { loadCityContent } from '../../game/cities/registry.ts';
import '../../city-map.css';
import '../map3d.css';

type CityId = 'lagos' | 'abuja' | 'kano';
type MapInstance = ReturnType<typeof createMap3D>;
const cityNames: Record<CityId, string> = { lagos: 'Lagos', abuja: 'Abuja', kano: 'Kano' };
const fixtureTime: Record<TimeOfDay, number> = {
  day: Date.UTC(2026, 9, 8, 11),
  dusk: Date.UTC(2026, 9, 8, 17),
  night: Date.UTC(2026, 9, 8, 22),
};
const host = document.querySelector<HTMLElement>('#map');
const status = document.querySelector<HTMLElement>('#status');
const citySelect = document.querySelector<HTMLSelectElement>('#city');
const readout = (id: string): HTMLElement => document.querySelector<HTMLElement>(`#${id}`)!;
if (!host || !status || !citySelect) throw new Error('renderer preview page is missing a required control');

let renderer: MapInstance | null = null;
let generation = 0;
let selectedCity: CityId = 'lagos';
let selectedPreset: TimeOfDay = 'day';
let diagnosticsTimer: ReturnType<typeof setInterval> | null = null;
let resizeObserver: ResizeObserver | null = null;
const setStatus = (message: string, kind: 'info' | 'error' = 'info'): void => { status!.textContent = message; status!.dataset.kind = kind; };

function updateDiagnostics(): void {
  const result = renderer?.diagnostics();
  if (!result) {
    readout('actual-preset').textContent = '—'; readout('render-count').textContent = '0';
    readout('triangles').textContent = '—'; readout('calls').textContent = '—'; readout('contents').textContent = '—';
    return;
  }
  readout('actual-preset').textContent = `${result.time} · ${result.reducedMotion ? 'reduced motion' : 'motion on'}`;
  readout('render-count').textContent = String(result.renderCount);
  readout('triangles').textContent = `${result.triangles.toLocaleString()} actual / ${result.cityTriangles.toLocaleString()} city`;
  readout('calls').textContent = String(result.calls);
  const counts = result.counts;
  readout('contents').textContent = `${counts.houses.toLocaleString()} homes · ${counts.towers} towers · ${counts.trees + counts.palms} trees`;
}

function disposeCurrent(): void {
  if (diagnosticsTimer !== null) clearInterval(diagnosticsTimer);
  diagnosticsTimer = null;
  resizeObserver?.disconnect();
  resizeObserver = null;
  renderer?.destroy();
  renderer = null;
  updateDiagnostics();
}

function applyFixture(): void {
  if (!renderer) return;
  const fixtureLocation = 'home';
  const home = Object.keys(renderer.city.pack.homes)[0];
  const state: MapState = { t: fixtureTime[selectedPreset], location: fixtureLocation, activeAction: null, travel: { home } };
  renderer.setState(state);
  renderer.setPlayer({ seed: `renderer-preview-${selectedCity}` });
  renderer.holdTime(selectedPreset);
  renderer.resize();
  setStatus(`${cityNames[selectedCity]} · local fixture at Home · ${selectedPreset} preset. This does not read or alter a player save.`);
  updateDiagnostics();
}

async function mountCity(cityId: CityId): Promise<void> {
  const ticket = ++generation;
  selectedCity = cityId;
  disposeCurrent();
  host!.replaceChildren();
  setStatus(`Loading ${cityNames[cityId]} production city pack…`);
  try {
    if (!webglAvailable()) throw new Error('WebGL is unavailable in this browser; no renderer was mounted.');
    const [pack] = await Promise.all([loadCityPack(cityId), loadCityContent(cityId)]);
    if (ticket !== generation) return;
    if (!pack) throw new Error(`${cityNames[cityId]} has no production city pack.`);
    const next = createMap3D(host!, {
      pack,
      cityId,
      reducedMotion: true,
      onContextLost: () => { if (ticket === generation) setStatus('WebGL context was lost. Reload this preview to mount a fresh renderer.', 'error'); },
    });
    if (ticket !== generation) { next.destroy(); return; }
    renderer = next;
    applyFixture();
    resizeObserver?.disconnect();
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => renderer?.resize()) : null;
    resizeObserver?.observe(host!);
    diagnosticsTimer = setInterval(updateDiagnostics, 500);
  } catch (error) {
    if (ticket !== generation) return;
    disposeCurrent(); host!.replaceChildren();
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
}

citySelect.addEventListener('change', () => {
  const value = citySelect.value;
  if (value === 'lagos' || value === 'abuja' || value === 'kano') void mountCity(value);
});
document.querySelector<HTMLButtonElement>('#whole-city')?.addEventListener('click', () => {
  const button = host!.querySelector<HTMLButtonElement>('[data-m3="fit"]');
  if (button) button.click(); else setStatus('Load a city before using Whole city.', 'error');
});
document.querySelector<HTMLButtonElement>('#find-me')?.addEventListener('click', () => {
  const button = host!.querySelector<HTMLButtonElement>('[data-m3="me"]');
  if (button) button.click(); else setStatus('Load a city before using Find me.', 'error');
});
document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => {
  button.addEventListener('click', () => {
    const preset = button.dataset.preset;
    if (preset !== 'day' && preset !== 'dusk' && preset !== 'night') return;
    selectedPreset = preset;
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    applyFixture();
  });
});
window.addEventListener('pagehide', () => { generation++; resizeObserver?.disconnect(); resizeObserver = null; disposeCurrent(); }, { once: true });
void mountCity(selectedCity);
