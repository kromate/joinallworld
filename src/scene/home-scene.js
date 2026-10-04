/**
 * OWNER: home
 * The home interior. Same builder contract as src/scene/venue-scenes.js:
 *   buildHomeScene(kit, venue) → { group, background, camera?, update?(state) → boolean }
 * The host calls update(state) after every accepted server state while the player is at
 * home; rebuild furniture from state there and return true when something changed so the
 * host draws one frame. Placement keys arrive as `jaw:key` window events (see src/ui/keys.js).
 * Static scene: no requestAnimationFrame, timers or per-frame work.
 *
 * Ported starter interior (replace freely): a fixed bedroom, kitchen, bathroom and lounge.
 */
export function buildHomeScene(kit) {
  const { THREE, box, round, mesh, crownGeometry } = kit;
  const group = new THREE.Group();
  // Open walls keep the compact room readable from the overhead camera.
  box(0, -0.22, 0, 18, 0.4, 17, '#a8987d', group);
  box(0, 2.25, -8.3, 18, 4.5, 0.25, '#d2c8ac', group);
  box(-8.85, 2.25, 0, 0.25, 4.5, 17, '#c1c8b3', group);
  box(-2.8, 0.025, 0.5, 7.1, 0.05, 8.2, '#7e9b91', group);
  box(-4.8, 0.43, -0.9, 3.7, 0.7, 5.7, '#796654', group);
  box(-4.8, 0.9, -0.9, 3.55, 0.32, 5.5, '#ebe5d7', group);
  box(-4.8, 1.12, 0.2, 3.58, 0.13, 3.35, '#af938a', group);
  box(-4.8, 1.3, -3.8, 3.8, 1.5, 0.23, '#786754', group);
  for (const x of [-5.7, -3.9]) box(x, 1.15, -2.8, 1.35, 0.2, 0.85, '#f3ead8', group);
  box(-7.4, 0.8, -2.5, 1.2, 1.5, 1.2, '#998168', group);
  round(-7.4, 1.82, -2.5, 0.08, 0.52, '#637269', group);
  round(-7.4, 2.2, -2.5, 0.43, 0.37, '#efcf8f', group, true);
  const bedsideLight = new THREE.PointLight('#ffe0ab', 12, 10, 1.6);
  bedsideLight.position.set(-7.4, 2.2, -2.5);
  group.add(bedsideLight);
  for (const x of [2, 4, 6]) {
    box(x, 0.85, -6.8, 1.95, 1.65, 2, '#8c9b83', group);
    box(x, 1.75, -6.8, 2, 0.16, 2.1, '#ddd5bd', group);
    box(x, 0.9, -5.76, 0.55, 0.09, 0.05, '#d6cfb7', group);
  }
  round(2, 1.87, -6.8, 0.5, 0.09, '#819394', group);
  round(2, 2.15, -7.5, 0.045, 0.55, '#b6c3bb', group);
  box(4, 1.87, -6.8, 1.25, 0.08, 1.3, '#414b49', group);
  for (const x of [3.65, 4.35]) for (const z of [-7.15, -6.45]) round(x, 1.93, z, 0.19, 0.04, '#738077', group);
  box(7.75, 1.7, -6.7, 1.5, 3.3, 1.8, '#aac3bf', group);
  box(7.75, 2.35, -5.76, 1.34, 0.04, 0.06, '#789b94', group);
  box(8.25, 1.9, -5.74, 0.06, 0.75, 0.08, '#dfebe0', group);
  box(4, 3.35, -8.08, 2.8, 1.3, 0.15, '#7f927e', group);
  box(4, 3.35, -7.98, 2.3, 0.85, 0.06, '#dac79d', group);
  box(-3.8, 0.025, -6.7, 5.7, 0.05, 2.9, '#b7c6bc', group);
  box(-0.7, 1.15, -6.7, 0.15, 2.3, 3, '#d4d5c3', group);
  box(-5.4, 0.8, -7.65, 1.1, 1.35, 0.45, '#e5e7d9', group);
  round(-5.4, 0.42, -6.9, 0.55, 0.8, '#e7ebdf', group);
  round(-5.4, 0.87, -6.8, 0.6, 0.12, '#f4f4e8', group);
  box(-2.4, 1.15, -7.5, 1.2, 0.2, 1, '#dce3d5', group);
  box(-2.4, 2.45, -8.08, 1.3, 1.45, 0.08, '#9ab4b4', group);
  box(3.8, 0.6, 1.4, 4.4, 0.9, 1.9, '#b19c7d', group);
  box(3.8, 1.15, 0.6, 4.4, 1.4, 0.35, '#a38a70', group);
  for (const x of [1.7, 5.9]) box(x, 0.95, 1.4, 0.3, 1.2, 2, '#a38a70', group);
  round(3.8, 0.65, 4.2, 1.1, 0.16, '#d8c9ab', group);
  round(3.8, 0.32, 4.2, 0.16, 0.6, '#796d58', group);
  round(7.2, 0.5, 4.5, 0.6, 0.8, '#b99477', group);
  mesh(crownGeometry, 7.2, 1.75, 4.5, 0.7, 1.35, 0.7, '#6d9273', group);
  return { group, background: '#879b8a', camera: { landscape: [11, 16, 20], portrait: [11, 19, 24] } };
}
