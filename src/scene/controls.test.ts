// The on-screen controls: place() puts the one-time hint below the HUD rows (hintTop), not only below the top bar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneControls } from './controls.ts';

/** Just enough of a document for createSceneControls: elements that record their style variables. */
function fakeDocument() {
  const makeElement = (): Record<string, unknown> & { vars: Map<string, string> } => {
    const vars = new Map<string, string>();
    const element: Record<string, unknown> & { vars: Map<string, string> } = {
      vars, hidden: false, dataset: {}, firstElementChild: null,
      style: { setProperty: (name: string, value: string) => vars.set(name, value) },
      classList: { toggle() {}, contains: () => false },
      addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
      querySelector: () => makeElement(),
    };
    return element;
  };
  return { createElement: makeElement, getElementById: () => ({}), head: { appendChild() {} } };
}

test('place() keeps the hint below the HUD rows when hintTop is given', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: fakeDocument(), configurable: true, writable: true });
  try {
    const container = { appendChild(element: unknown) { (this as { child?: unknown }).child = element; } } as unknown as HTMLElement;
    const controls = createSceneControls(container);
    assert.ok(controls);
    const vars = (controls.root as unknown as { vars: Map<string, string> }).vars;
    controls.place({ top: 48, bottom: 0, wide: false });
    assert.equal(vars.get('--sc-top'), '56px');
    assert.equal(vars.get('--sc-hint-top'), '56px', 'without hintTop the hint sits where it always did');
    controls.place({ top: 48, bottom: 0, wide: false, hintTop: 100 });
    assert.equal(vars.get('--sc-top'), '56px', 'the buttons do not move');
    assert.equal(vars.get('--sc-hint-top'), '108px', 'the hint moves below the HUD rows');
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original); else delete (globalThis as { document?: unknown }).document;
  }
});
