/**
 * OWNER: scenes
 * Food and nightlife venues: buka, club (and its speakeasy variant), viewing centre, music
 * shrine and mall. Scene definition format: see venues-outdoor.js.
 */
import { GLOW, GLASS } from './build.js';
import {
  room, table, chair, stool, bench, sofa, counter, speaker, screen, plant, shelf, kiosk, crate, laptop, rug, bottles, pot,
  ropeLine, stringLights, door, sign, landmark, extra,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, LEAF, WARM,
} from './props.js';

const PI = Math.PI, HALF = Math.PI / 2;

const buka = {
  mood: 'indoor', accent: '#e0822f',
  build(b, { accent }) {
    room(b, { floor: '#b3936a', wall: '#dcb875', side: '#cfa765', trim: '#8a5a34' });
    b.box(0, 1.1, -9.94, 24, 1.4, 0.06, '#b5673a');
    b.box(-11.94, 1.1, 0, 0.06, 1.4, 20, '#b5673a');
    // Counter with the day's pots
    counter(b, 0.6, -7, { w: 11, d: 1.2, color: '#8a5a34', top: '#d9b780', stripe: accent });
    [['#4a3a2e', false], ['#4f7a3a', false], ['#d9a441', true], ['#b8402a', false], ['#f0e6c8', true]].forEach(([food, lid], i) => {
      pot(b, -3.6 + i * 2.1, 1.35, -7, { food, lid, r: 0.5 });
      if (!lid) b.box(-3.3 + i * 2.1, 2.15, -7.1, 0.05, 0.6, 0.05, METAL, { rz: -0.4 });
    });
    for (let i = 0; i < 4; i++) b.cyl(-4.6 + i * 0.26, 1.42, -6.6, 0.16, 0.05 + i * 0.02, WHITE, { seg: 8 });
    // Menu board
    b.box(0.6, 4, -9.72, 6.4, 1.9, 0.12, '#2f3a36');
    sign(b, 0.6, 4.45, -9.64, 'AMALA', { size: 0.5, color: '#f4e6b8' });
    for (let i = 0; i < 4; i++) { b.quad(-0.6 + (i % 2) * 2.6, 3.75 - Math.floor(i / 2) * 0.4, -9.65, 1.6, 0.12, '#d9d2b8'); b.quad(0.5 + (i % 2) * 2.6, 3.75 - Math.floor(i / 2) * 0.4, -9.65, 0.4, 0.12, accent); }
    extra(b, 'buka-mama', 0.2, -8.5, 0, 'work', { look: { body: 'woman', outfit: 'owambe', fabric: 'ankara', hair: 'gele', outfitColor: 'orange', bottomsColor: 'green' } });
    extra(b, 'buka-server', 3.6, -8.5, -0.2, 'stand', { look: { body: 'woman', outfit: 'casual', hair: 'braids' } });
    // Mama's kitchen corner: firewood stove, mortar, shelf
    const kx = -9.4, kz = -7;
    for (let i = 0; i < 3; i++) b.ico(kx + Math.sin(i * 2.1) * 0.6, 0.25, kz + Math.cos(i * 2.1) * 0.6, 0.3, 0.3, 0.3, '#6f6a62');
    for (let i = 0; i < 3; i++) b.cyl(kx, 0.16, kz, 0.08, 1.5, '#5a3d28', { seg: 5, rz: HALF, ry: i * 1.05 });
    b.cone(kx, 0.45, kz, 0.3, 0.5, '#ff9a3c', { seg: 6, ...GLOW });
    pot(b, kx, 0.55, kz, { r: 0.7, food: '#4f7a3a', color: '#2f3237' });
    b.light(kx + 0.6, 1.6, kz + 0.8, '#ff9a4a', 16, 8);
    b.cyl(-9.8, 0.4, -3.6, 0.42, 0.8, '#7a5a3c', { seg: 8, top: 1.25 });
    b.cyl(-9.6, 1.2, -3.6, 0.07, 1.7, WOOD_LIGHT, { seg: 5, rz: 0.2 });
    shelf(b, -11.6, -1, { ry: HALF, w: 3, h: 2.6, rows: 2, per: 5, items: ['#d9d2b8', '#b06a4a', '#e9e2cf', '#c9a14a'], y: 0 });
    b.cyl(-7.2, 0.3, -8.6, 0.6, 0.6, '#3f72c4', { seg: 9, top: 1.15 }); b.cyl(-7.2, 0.62, -8.6, 0.64, 0.04, '#9fd0e6', { seg: 9 });
    // Long tables and benches
    [-4.4, 1.2, 6.8].forEach((x, i) => {
      table(b, x, 1, { w: 5.2, d: 1.1, ry: HALF, color: '#a67c4a' });
      bench(b, x - 1.05, 1, { w: 5, ry: HALF }); bench(b, x + 1.05, 1, { w: 5, ry: HALF });
      for (let p = 0; p < 3; p++) {
        b.cyl(x + (p % 2 ? 0.2 : -0.2), 1.08, -0.6 + p * 1.6, 0.24, 0.05, WHITE, { seg: 8 });
        b.ico(x + (p % 2 ? 0.2 : -0.2), 1.16, -0.6 + p * 1.6, 0.16, 0.08, 0.16, ['#4a3a2e', '#d9a441', '#b8402a'][(p + i) % 3]);
      }
      b.cyl(x, 1.2, 1.9, 0.07, 0.3, ['#5f9a62', '#a14b3c', '#c9973f'][i], { seg: 5, top: 0.5 });
    });
    extra(b, 'buka-eater-1', -5.45, 0.2, HALF, 'sit'); extra(b, 'buka-eater-2', -3.35, 1.8, -HALF, 'sit');
    extra(b, 'buka-eater-3', 7.85, -0.6, -HALF, 'sit'); extra(b, 'buka-eater-4', 0.15, 2.4, HALF, 'sit');
    extra(b, 'buka-queue', -2.4, -4.6, PI - 0.2, 'stand');
    // Wash bowl station
    const wx = 10.2, wz = 6.4;
    table(b, wx, wz, { w: 1.4, d: 1.2, h: 0.9, color: METAL, leg: METAL_DARK });
    b.cyl(wx, 1.05, wz, 0.5, 0.3, '#3f72c4', { seg: 10, top: 1.3 }); b.cyl(wx, 1.2, wz, 0.56, 0.03, '#9fd0e6', { seg: 10 });
    b.cyl(wx + 0.9, 0.35, wz + 0.2, 0.34, 0.7, '#c9423a', { seg: 8, top: 1.15 });
    b.ball(wx + 0.1, 0.36, wz + 1.2, 0.3, 0.34, 0.3, '#8b9096', { seg: 7 }); b.cyl(wx + 0.38, 0.5, wz + 1.2, 0.05, 0.4, '#8b9096', { seg: 4, rz: -0.9 });
    b.box(wx, 1.9, wz - 0.75, 1.4, 0.06, 0.06, METAL); b.box(wx - 0.3, 1.55, wz - 0.75, 0.5, 0.7, 0.04, '#e9e2cf');
    for (const side of [-1, 1]) b.box(wx + side * 0.68, 1, wz - 0.75, 0.06, 2, 0.06, METAL);
    // Fridge, radio, light
    b.box(9.6, 1.5, -9, 1.6, 3, 1.4, '#c9423a'); b.quad(9.6, 1.7, -8.29, 1.3, 2.2, '#cfeaf2', GLOW);
    for (let row = 0; row < 3; row++) bottles(b, 9.6, 0.8 + row * 0.7, -8.25, { n: 4, gap: 0.3, colors: ['#8a2a4a', '#3d6a3a', '#c9973f'] });
    b.box(6, 2.9, -9.6, 1.6, 0.08, 0.5, WOOD); b.box(6, 3.2, -9.6, 1, 0.5, 0.36, '#3a3f46');
    for (const dx of [-0.28, 0.28]) b.cyl(6 + dx, 3.2, -9.41, 0.14, 0.03, '#8b9096', { seg: 7, rx: HALF });
    b.cyl(6.4, 3.75, -9.6, 0.015, 0.7, METAL, { seg: 4, rz: -0.4 });
    b.box(1, 5, 1, 0.04, 1, 0.04, BLACK); b.ball(1, 4.4, 1, 0.2, 0.24, 0.2, WARM, { seg: 6, ...GLOW }); b.light(1, 4.2, 1, '#ffd9a0', 22, 14);
    return {
      spots: [
        landmark('counter', /counter|buka|order|eat|food|amala|jollof|buy|zobo/, 1.4, -5, PI),
        landmark('kitchen', /kitchen|mama|cook|learn|help|work|job/, -7.6, -5.2, -2.3, { act: { pose: 'work' } }),
        landmark('wash', /wash|bowl|hand|water|clean/, 8.6, 6.4, HALF, { act: { pose: 'work' } }),
        landmark('table', /table|sit|bench|seat|dine|gist/, 4, 3.4, -HALF, { act: { pose: 'sit', x: 2.25, z: -0.4, ry: -HALF, seat: 0.6 } }),
        landmark('people', /people|crowd|meet/, 3.6, 6.6, 0),
      ],
      crowd: [[1.4, 7.4, 0.4], [5.6, 6, -0.5], [-1.6, 6.2, 2.4], [-4.4, -4.4, PI], [4.6, -4.6, PI - 0.3], [-7.6, 5.4, 1.2], [7.4, 4.6, 0.6], [-1.6, -3.6, 2.8], [-9.4, 2.6, HALF], [9.6, 2.4, -1.2], [-6.6, 7.6, 0.8], [6.6, 8.4, -0.3]],
    };
  },
};

const club = {
  mood: 'club', accent: '#c794fa',
  build(b, { variant, accent }) {
    const speakeasy = variant === 'speakeasy';
    room(b, { floor: '#2b2536', wall: speakeasy ? '#3d2f3a' : '#2f2947', side: speakeasy ? '#372a35' : '#2a2540', trim: '#5a4a6a', base: '#1c1826' });
    // Dance floor
    b.box(1.6, 0.09, 1.2, 8.4, 0.08, 6.8, '#1c1826');
    const tiles = ['#7a3fd0', '#d04f9a', '#3f8fd0', '#f2b84a'];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 5; col++) {
      const lit = (row + col) % 2 === 0;
      b.box(-1.6 + col * 1.6, 0.14, -1.2 + row * 1.6, 1.5, 0.04, 1.5, lit ? tiles[(row * 2 + col) % 4] : '#2a2440', lit ? GLOW : undefined);
    }
    b.cyl(1.6, 5.6, 1.2, 0.02, 1.2, METAL, { seg: 4 }); b.ball(1.6, 4.9, 1.2, 0.5, 0.5, 0.5, '#e6e6f2', { seg: 8 });
    b.light(1.6, 4.2, 1.2, accent, 55, 20);
    // DJ booth and sound
    b.box(1.6, 0.3, -7.8, 7, 0.6, 3.4, '#1f1b2a');
    b.box(1.6, 1.25, -6.7, 4.4, 1.3, 0.8, '#2a2440');
    b.box(1.6, 1.3, -6.28, 4.2, 0.16, 0.04, accent, GLOW); b.box(1.6, 0.9, -6.28, 4.2, 0.08, 0.04, '#3f8fd0', GLOW);
    for (const dx of [-1.2, 1.2]) b.cyl(1.6 + dx, 1.94, -6.7, 0.42, 0.06, '#15151a', { seg: 10 });
    b.box(1.6, 1.96, -6.7, 0.8, 0.1, 0.6, '#3a3f46'); laptop(b, 1.6, 1.9, -7.2, { lit: '#d9a0ff' });
    extra(b, 'club-dj', 1.6, -7.6, 0, 'work', { y: 0.6, look: { outfit: 'hoodie', outfitColor: 'violet', body: 'man' } });
    speaker(b, -2.9, -8.2, { h: 3.4, w: 1.4 }); speaker(b, 6.1, -8.2, { h: 3.4, w: 1.4 });
    const bars = [1.2, 2.2, 1.6, 2.8, 2, 3, 1.8, 2.6, 1.4];
    bars.forEach((h, i) => b.quad(-0.8 + i * 0.6, 3.3 + h / 2, -9.7, 0.44, h, tiles[i % 4], GLOW));
    // Bar along the left wall
    counter(b, -8.6, 2, { w: 8, d: 1, ry: HALF, color: '#3a2f3d', top: '#d9b46a', stripe: accent });
    b.box(-11.5, 1.9, 2, 0.5, 3, 7.6, '#241d2c');
    for (const y of [1.5, 2.3, 3.1]) { b.box(-11.2, y, 2, 0.5, 0.06, 7.4, '#d9b46a', GLOW); bottles(b, -11.15, y + 0.03, 2, { n: 13, gap: 0.54, ry: HALF, colors: ['#8fe0b0', '#ffc46a', '#ff8f7a', '#bfe3ff'] }); }
    sign(b, -11.7, 4.5, 2, 'BAR', { size: 0.7, color: '#ff8fd0', ry: HALF, lit: true });
    for (const z of [-0.6, 1.2, 3, 4.8]) stool(b, -7.3, z, { h: 0.85, color: '#d9b46a' });
    extra(b, 'club-barman', -9.8, 1.4, HALF, 'work', { look: { outfit: 'office', outfitColor: 'cream' } });
    extra(b, 'club-bar-guest', -7.3, 3, -HALF, 'sit', { seat: 0.85 });
    b.light(-8.4, 3.2, 2, '#ff8fd0', 22, 10);
    // Lounge
    sofa(b, 9.4, 3.6, { w: 4.4, ry: -HALF, color: '#5a2f4a', cushion: '#7a3f62' });
    sofa(b, 7.2, 7.4, { w: 4, ry: PI, color: '#5a2f4a', cushion: '#7a3f62' });
    table(b, 7.2, 4.4, { w: 1.8, d: 1.4, h: 0.55, color: '#1c1826', leg: '#d9b46a' });
    b.cyl(7.2, 0.72, 4.4, 0.24, 0.3, '#cfd6dc', { seg: 7, top: 1.2 }); b.cyl(7.2, 1, 4.4, 0.08, 0.5, '#f2c84a', { seg: 5, top: 0.4, ...GLOW });
    b.cyl(6.7, 0.66, 4.8, 0.06, 0.14, '#ffcf8a', { seg: 5, ...GLOW });
    extra(b, 'club-lounge', 9.3, 2.8, -HALF, 'sit', { seat: 0.69, look: { outfit: 'owambe', body: 'woman', fabric: 'asooke' } });
    ropeLine(b, [[5.2, 6.4], [5.2, 2.6], [7, 1]]);
    // Entrance: a bookcase that swings open, or a neon doorway
    if (speakeasy) {
      for (const x of [-10.2, -4.2]) shelf(b, x, -9.6, { w: 2.9, h: 4.2, rows: 4, per: 5 });
      b.box(-7.2, 2.2, -9.7, 2.6, 4.4, 0.1, '#1a1410');
      b.quad(-7.2, 2.1, -9.64, 2.2, 4, '#ffb866', GLOW);
      b.at(-5.9, 0, -9.5, -1.05, () => shelf(b, -1.45, 0, { w: 2.9, h: 4.2, rows: 4, per: 5 }));
      // Reading nook
      sofa(b, -9.6, -6.6, { w: 1.6, ry: 0.5, color: '#6a4a3a', cushion: '#8a6248' });
      table(b, -7.8, -5.6, { round: true, w: 0.9, h: 0.75, color: WOOD_DARK });
      b.cyl(-7.8, 0.92, -5.6, 0.05, 0.3, '#f4ecd8', { seg: 5 }); b.cone(-7.8, 1.15, -5.6, 0.05, 0.16, '#ffcf6a', { seg: 4, ...GLOW });
      b.box(-7.5, 0.8, -5.5, 0.4, 0.06, 0.3, '#8a3b22');
      extra(b, 'club-reader', -9.5, -6.5, 0.5, 'sit', { seat: 0.69 });
      rug(b, -8.6, -5.8, 3.4, 2.6, '#5a2f2a', { border: '#c9a14a' });
    } else {
      b.box(-7.2, 2.3, -9.7, 3, 4.6, 0.1, '#15121d');
      for (const dx of [-1.6, 1.6]) b.box(-7.2 + dx, 2.3, -9.62, 0.14, 4.6, 0.08, '#ff5fb0', GLOW);
      b.box(-7.2, 4.66, -9.62, 3.34, 0.14, 0.08, '#ff5fb0', GLOW);
      sign(b, -7.2, 5.1, -9.66, 'CLUB', { size: 0.5, color: '#7fe0ff', lit: true });
      ropeLine(b, [[-9, -7.6], [-7.2, -7], [-5.4, -7.6]]);
      extra(b, 'club-bouncer', -9.4, -8.6, 0.4, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', hair: 'bald' } });
      for (const z of [-6.6, -5.2]) { table(b, -9.8, z + 0.7, { round: true, w: 1, h: 1.3, color: '#2a2440', leg: '#d9b46a' }); }
    }
    // Dancers
    extra(b, 'club-dancer-1', 0, -0.4, 0.5, 'dance'); extra(b, 'club-dancer-2', 3.2, 0.4, -0.6, 'dance', { look: { outfit: 'owambe', body: 'woman' } });
    extra(b, 'club-dancer-3', 4.2, 2.8, 3.4, 'wave'); extra(b, 'club-dancer-4', -0.6, 3.2, 2.4, 'dance');
    plant(b, 10.6, -8.6, { s: 1.3, pot: '#2a2440' });
    return {
      spots: [
        landmark('bookcase', /bookcase|secret|book|read|candle|entrance|door|bouncer|queue/, -7.2, -7.4, PI),
        landmark('lounge', /lounge|sofa|chill|vip|table|bottle|gold|selfie/, 6.2, 5.8, 0.6, { act: { pose: 'sit', x: 7.9, z: 7.3, ry: PI, seat: 0.69 } }),
        landmark('bar', /bar|cocktail|drink|crew|shot/, -6.2, 1.2, -HALF),
        landmark('dancefloor', /dance|floor/, 1.6, 2.2, 0, { act: { pose: 'dance' } }),
        landmark('dj', /dj|shout|booth|music|deck/, 1.6, -4.8, PI),
        landmark('people', /people|crowd|meet/, 5.2, -3.6, 0),
      ],
      crowd: [[3.6, -2.2, 0.4], [6.8, -2.6, -0.5], [-2.4, 1.6, 1.2], [2.6, 4.2, 2.8], [-4.4, -3.4, 2.4], [0.6, 6.6, 0.2], [-5.4, 5.6, 1.6], [9.4, -4.6, -1], [-3, 6.8, 0.8], [4.4, 7.8, -0.2], [-5.6, -1.2, 1.6], [8.6, -0.8, -1.2]],
    };
  },
};

const viewing = {
  mood: 'indoor', accent: '#f2c14e',
  build(b, { accent }) {
    room(b, { floor: '#a39c8f', wall: '#3f5d80', side: '#38557a', trim: '#2a3f5a' });
    b.box(0, 5.2, -9.94, 24, 0.5, 0.06, accent);
    // The big screen: a football pitch with players and a score strip
    screen(b, 0, 3.2, -9.7, { w: 9.6, h: 4.2, color: '#3f9a4f' });
    for (let i = 0; i < 6; i++) if (i % 2) b.quad(-4 + i * 1.6, 3.05, -9.62, 1.6, 3.5, '#4aa85a', GLOW);
    b.quad(0, 3.05, -9.61, 0.06, 3.5, WHITE, GLOW);
    b.cyl(0, 3.05, -9.62, 0.7, 0.02, '#dff4e0', { seg: 14, rx: HALF, open: true, ...GLOW });
    for (const side of [-1, 1]) { b.quad(side * 4.2, 3.05, -9.61, 0.06, 1.8, WHITE, GLOW); b.quad(side * 4.5, 3.95, -9.61, 0.6, 0.06, WHITE, GLOW); b.quad(side * 4.5, 2.15, -9.61, 0.6, 0.06, WHITE, GLOW); }
    [[-3, 3.6, 0], [-1.6, 2.4, 0], [-0.6, 3.9, 0], [1, 2.9, 1], [2.4, 3.8, 1], [3.2, 2.2, 1], [-2.4, 2.9, 1], [1.8, 2.1, 0]].forEach(([x, y, team]) => b.quad(x, y, -9.6, 0.2, 0.3, team ? '#ff5a4a' : '#5aa0ff', GLOW));
    b.quad(0.2, 3.2, -9.6, 0.12, 0.12, WHITE, GLOW);
    b.quad(0, 5.02, -9.62, 3, 0.44, '#1c2430', GLOW); sign(b, 0, 5.02, -9.63, '2 - 1', { size: 0.28, color: '#ffe07a', lit: true });
    speaker(b, -6.4, -9, { h: 2.4, w: 1.1 }); speaker(b, 6.4, -9, { h: 2.4, w: 1.1 });
    b.light(0, 3.4, -6.4, '#bfe8c8', 24, 12);
    // Benches
    const rows = [-4.4, -2.2, 0, 2.2, 4.4];
    rows.forEach((z, i) => { for (const x of [-3, 3]) bench(b, x, z, { w: 4.8, ry: PI, color: i % 2 ? WOOD : WOOD_LIGHT }); });
    extra(b, 'view-fan-1', -4.4, -4.4, PI, 'sit'); extra(b, 'view-fan-2', -1.6, -2.2, PI, 'sit'); extra(b, 'view-fan-3', 2.2, -4.4, PI, 'sit');
    extra(b, 'view-fan-4', 4.2, 0, PI, 'sit'); extra(b, 'view-fan-5', -3.4, 2.2, PI, 'sit'); extra(b, 'view-fan-6', 3, -2.9, PI, 'dance');
    extra(b, 'view-fan-7', 1.6, 2.2, PI, 'sit');
    // Snacks kiosk on the left, cooler
    kiosk(b, -10.6, 1.4, { ry: HALF, color: '#d9a441', roof: '#2a3f5a', fascia: '#f4e6b8', text: 'SNACKS', w: 3.4 });
    extra(b, 'view-snacks', -11, 1.4, HALF, 'work');
    b.box(-9.4, 0.5, 5.4, 1.6, 1, 1, '#3f72c4'); b.box(-9.4, 1.04, 5.4, 1.66, 0.1, 1.06, WHITE);
    crate(b, -9.6, 0, 7, { fill: '#a14b3c' }); crate(b, -9.6, 0.42, 7, { fill: '#c9973f' });
    // Betting corner
    table(b, 9.4, -6.6, { w: 2.6, d: 1.1 });
    b.box(9.4, 0.6, -6.02, 2.6, 0.9, 0.03, '#2f8f55');
    b.box(9.4, 3, -9.72, 3.4, 2.2, 0.1, '#1c2430');
    sign(b, 9.4, 3.75, -9.64, 'BET', { size: 0.34, color: '#7fe08a', lit: true });
    for (let i = 0; i < 4; i++) { b.quad(8.9, 3.2 - i * 0.32, -9.65, 1.6, 0.14, '#cfd6dc'); b.quad(10.5, 3.2 - i * 0.32, -9.65, 0.5, 0.14, accent, GLOW); }
    extra(b, 'view-bookie', 9.4, -7.6, 0, 'sit', { seat: 0.6 }); stool(b, 9.4, -7.6);
    // Gate table, fan, bunting
    table(b, 9.4, 7.4, { w: 1.4, d: 0.9, h: 0.9 }); stool(b, 10.4, 7.4);
    b.box(9.4, 1, 7.4, 0.5, 0.2, 0.36, METAL_DARK);
    extra(b, 'view-gate', 10.4, 7.4, -HALF, 'sit');
    b.cyl(-6.6, 1.1, -7.6, 0.05, 2.2, METAL, { seg: 5 }); b.cyl(-6.6, 2.3, -7.5, 0.5, 0.12, '#cfd6dc', { seg: 10, rx: HALF });
    stringLights(b, [-11.7, 5, -9.4], [-11.7, 5, 0], { n: 10, sag: 0.5, colors: ['#ff5a4a', '#5aa0ff', '#ffe07a'] });
    stringLights(b, [-11.7, 5, 0], [-11.7, 5, 9.4], { n: 10, sag: 0.5, colors: ['#ff5a4a', '#5aa0ff', '#ffe07a'] });
    return {
      spots: [
        landmark('benches', /bench|screen|front|match|watch|football|game|row|seat|cheer/, 0, -6.4, PI, { act: { pose: 'sit', x: -1.6, z: -4.4, ry: PI, seat: 0.6 } }),
        landmark('snacks', /snack|drink|food|suya|kiosk|beer|malt|buy/, -7.8, 1.4, -HALF),
        landmark('betting', /bet|predict|odds|stake|slip|win/, 9.4, -4.8, PI),
        landmark('gate', /gate|ticket|entry|pay|door|work|job/, 8, 7.4, HALF),
        landmark('banter', /banter|argue|analysis|pundit|stand|back|gist/, 7.6, 2, -HALF - 0.4, { act: { pose: 'wave' } }),
        landmark('people', /people|crowd|meet/, 0, 7.4, PI),
      ],
      crowd: [[1.8, 6.8, PI], [-2, 7.2, PI], [3.8, 8, PI + 0.3], [-4.4, 6.6, PI - 0.3], [7.4, 4, -HALF], [8.4, 0.2, -HALF], [-6.8, 4.6, 2.2], [6.8, -3.4, -2], [-6.6, -3.4, 2], [0, -6.6, PI], [-7.4, -6, 2.4], [5.6, 6.4, 2.8]],
    };
  },
};

function drumKit(b, x, y, z) {
  b.at(x, y, z, 0, () => {
    b.cyl(0, 0.5, 0.2, 0.5, 0.5, '#c9423a', { seg: 10, rx: HALF });
    b.cyl(0, 0.5, 0.46, 0.46, 0.02, '#f0e6c8', { seg: 10, rx: HALF });
    for (const [dx, h] of [[-0.75, 0.8], [0.75, 0.75]]) { b.cyl(dx, h, 0.1, 0.26, 0.2, '#c9423a', { seg: 8 }); b.cyl(dx, h + 0.11, 0.1, 0.25, 0.02, '#f0e6c8', { seg: 8 }); b.cyl(dx, h / 2, 0.1, 0.03, h, METAL, { seg: 4 }); }
    for (const dx of [-1.1, 1.1]) { b.cyl(dx, 0.7, -0.3, 0.02, 1.4, METAL, { seg: 4 }); b.cyl(dx, 1.42, -0.3, 0.34, 0.02, '#d9b24c', { seg: 9 }); }
  });
}
function micStand(b, x, y, z) {
  b.cyl(x, y + 0.75, z, 0.02, 1.5, BLACK, { seg: 4 }); b.cyl(x, y + 0.03, z, 0.18, 0.05, BLACK, { seg: 6 });
  b.ball(x, y + 1.56, z + 0.05, 0.06, 0.09, 0.06, '#8b9096', { seg: 5 });
}

const shrine = {
  mood: 'club', accent: '#f2c14e',
  build(b, { accent }) {
    room(b, { floor: '#4f3d32', wall: '#5a2a26', side: '#472420', trim: '#2a1a16', base: '#241a16', h: 6 });
    // Mural blocks on the back wall
    const mural = ['#d9a441', '#2f8f55', '#c9423a', '#1c1614'];
    for (let i = 0; i < 12; i++) b.quad(-11 + i * 2, 5.2, -9.96 + 0.17, 1.9, 0.9, mural[i % 4]);
    b.cyl(0, 3.9, -9.74, 1.5, 0.06, accent, { seg: 14, rx: HALF, ...GLOW });
    for (let i = 0; i < 8; i++) b.box(Math.sin(i * PI / 4) * 2.1, 3.9 + Math.cos(i * PI / 4) * 2.1, -9.74, 0.2, 0.7, 0.05, accent, { rz: -i * PI / 4, ...GLOW });
    // Stage with a truss and lights
    b.box(0, 0.6, -7, 16, 1.2, 5.4, '#3a2a22'); b.box(0, 1.22, -7, 15.6, 0.05, 5, '#6a4a34');
    for (const x of [-7.6, 7.6]) for (const z of [-9.2, -4.8]) b.box(x, 3.5, z, 0.22, 4.6, 0.22, METAL_DARK);
    b.box(0, 5.8, -4.8, 15.6, 0.22, 0.22, METAL_DARK); b.box(0, 5.8, -9.2, 15.6, 0.22, 0.22, METAL_DARK);
    for (const x of [-7.6, 7.6]) b.box(x, 5.8, -7, 0.22, 0.22, 4.6, METAL_DARK);
    ['#ff5a4a', '#ffd34d', '#58d68a', '#ff5a4a', '#ffd34d', '#58d68a'].forEach((color, i) => {
      b.cyl(-6 + i * 2.4, 5.5, -4.8, 0.2, 0.36, '#1c1614', { seg: 6, top: 0.6 });
      b.cyl(-6 + i * 2.4, 5.3, -4.8, 0.19, 0.04, color, { seg: 6, ...GLOW });
    });
    b.light(-4, 4.8, -5.4, '#ff6a5a', 40, 14); b.light(4, 4.8, -5.4, '#ffd36a', 40, 14);
    drumKit(b, 0.4, 1.24, -8.2);
    extra(b, 'shrine-drums', 0.4, -8.9, 0, 'sit', { y: 1.24, seat: 0.6 }); stool(b, 0.4, -8.9, { h: 0.6, color: BLACK });
    table(b, -4.6, -7.8, { w: 2.2, d: 0.7, h: 1.05, color: '#1c1614', leg: METAL_DARK });
    b.at(0, 1.24, 0, 0, () => {
      b.box(-4.6, 1.12, -7.8, 2, 0.12, 0.6, WHITE); for (let i = 0; i < 6; i++) b.box(-5.4 + i * 0.32, 1.19, -7.86, 0.12, 0.02, 0.36, BLACK);
      for (const dx of [0, 0.8]) { b.cyl(4.6 + dx, 0.55, -7.6, 0.3, 1.1, '#a67c4a', { seg: 8, top: 1.3 }); b.cyl(4.6 + dx, 1.11, -7.6, 0.39, 0.03, '#f0e6c8', { seg: 8 }); }
    });
    extra(b, 'shrine-keys', -4.6, -8.6, 0, 'work', { y: 1.24 });
    extra(b, 'shrine-conga', 5, -8.4, 0, 'work', { y: 1.24 });
    extra(b, 'shrine-singer', 2.2, -5.4, 0.1, 'dance', { y: 1.24, look: { body: 'man', outfit: 'chill', fabric: 'ankara', outfitColor: 'gold', hair: 'lowcut' } });
    for (const x of [-1.8, 2.2, 5.6]) micStand(b, x, 1.24, -4.9);
    for (const side of [-1, 1]) { speaker(b, side * 9.8, -3.4, { h: 1.9, w: 1.5, ry: -side * 0.3 }); speaker(b, side * 9.8, -3.4, { h: 1.6, w: 1.3, y: 1.9, ry: -side * 0.3 }); }
    // Floor: painted ring, barrel tables, dancers
    b.disc(0, 0.07, 2, 4.2, '#6a4a34', { seg: 18 }); b.disc(0, 0.08, 2, 3.4, '#4f3d32', { seg: 18 });
    [[-5.4, 5.2], [5.2, 4.4], [0.6, 7.4]].forEach(([x, z], i) => {
      b.cyl(x, 0.55, z, 0.5, 1.1, ['#2f6f8f', '#a8323a', '#2f8f55'][i], { seg: 9 }); b.cyl(x, 1.12, z, 0.56, 0.06, '#8a8478', { seg: 9 });
      bottles(b, x, 1.15, z, { n: 3, gap: 0.22 });
    });
    extra(b, 'shrine-fan-1', -1.6, 1.2, PI - 0.2, 'dance'); extra(b, 'shrine-fan-2', 1.8, 2.6, PI + 0.3, 'dance');
    extra(b, 'shrine-fan-3', 4.4, 5.2, PI + 0.6, 'wave'); extra(b, 'shrine-fan-4', -4.4, 4.6, 2.2, 'stand');
    // Bar on the left, suya grill on the right
    counter(b, -9.6, 3.6, { w: 5.6, d: 1, ry: HALF, color: '#6a4a34', top: '#d9b46a', stripe: '#2f8f55' });
    b.box(-11.5, 1.6, 3.6, 0.4, 2.4, 5.4, '#2a1a16');
    for (const y of [1.6, 2.4]) { b.box(-11.25, y, 3.6, 0.4, 0.06, 5.2, WOOD); bottles(b, -11.2, y + 0.03, 3.6, { n: 9, gap: 0.55, ry: HALF, lit: true, colors: ['#8fe0b0', '#ffc46a', '#ff8f7a'] }); }
    sign(b, -11.72, 3.9, 3.6, 'BAR', { size: 0.6, color: '#ffd34d', ry: HALF, lit: true });
    for (const z of [2, 5.2]) b.cyl(-9.6, 1.62, z, 0.3, 0.5, '#d9d2b8', { seg: 8, rz: HALF });
    extra(b, 'shrine-barman', -10.6, 3.2, HALF, 'work');
    b.at(10, 0, 4.6, -HALF, () => {
      table(b, 0, 0, { w: 2.4, d: 1, h: 1, color: METAL_DARK, leg: METAL_DARK });
      b.box(0, 1.08, 0, 2.2, 0.12, 0.8, '#1c1614'); b.box(0, 1.15, 0, 2, 0.02, 0.6, '#ff7a3c', GLOW);
      for (let i = 0; i < 5; i++) b.box(-0.8 + i * 0.4, 1.19, 0, 0.1, 0.05, 0.7, '#8a4a2a');
      b.box(0, 2.6, -0.2, 2.8, 0.1, 1.6, '#c9423a'); for (const sx of [-1.3, 1.3]) b.box(sx, 1.3, -0.9, 0.08, 2.6, 0.08, WOOD_DARK);
    });
    extra(b, 'shrine-suya', 11, 4.6, -HALF, 'work');
    b.light(0, 4.6, 3, '#ffb070', 26, 14);
    return {
      spots: [
        landmark('stage', /stage|perform|play|sing|band|gig|shift|work|job|mic/, -1.8, -5.6, 0, { y: 1.24, act: { pose: 'dance' } }),
        landmark('floor', /dance|floor|yabis|listen|watch|vibe|show|concert/, 0, 0.6, PI, { act: { pose: 'dance' } }),
        landmark('bar', /bar|drink|palm|beer|stout/, -7.4, 3.6, -HALF),
        landmark('grill', /suya|grill|food|pepper|eat|smoke/, 8.2, 4.6, HALF),
        landmark('backstage', /backstage|rehears|learn|lesson|meet the|legend/, 6.8, -6.4, PI + 0.5, { y: 1.24 }),
        landmark('people', /people|crowd|meet/, 3, 7.6, PI),
      ],
      crowd: [[1.2, 4.6, PI], [-2.2, 3.6, PI - 0.3], [3.4, 1.4, PI + 0.4], [-3.6, 0.6, 2.6], [-0.6, 6.2, PI], [5.6, 7.4, -2.6], [-3.2, 7.4, 2.8], [6.6, 1.6, -2.2], [-6.6, 0.6, 2.2], [-6.8, 7, 1.8], [2.4, 9, PI], [7.8, 8.6, -2.6]],
    };
  },
};

function shopfront(b, x, w, { fascia, text, window: tint, items }) {
  b.at(x, 0, -9.7, 0, () => {
    b.box(0, 4.3, 0.7, w, 1, 1.5, fascia);
    sign(b, 0, 4.3, 1.47, text, { size: 0.44, color: WHITE, lit: true });
    b.box(0, 1.9, -0.05, w, 3.8, 0.12, tint);
    b.box(-w * 0.14, 0.2, 0.7, w * 0.62, 0.4, 1.3, '#e9e4d8');
    b.box(-w * 0.14, 2.1, 1.36, w * 0.62, 3.4, 0.06, '#dfeef2', GLASS);
    b.box(w * 0.34, 1.75, 0.1, w * 0.2, 3.4, 0.08, '#3a3f46');
    b.quad(w * 0.34, 1.75, 0.15, w * 0.16, 3.1, '#ffe9c0', GLOW);
    for (const side of [-1, 1]) b.box(side * w / 2, 2.4, 0.7, 0.3, 4.8, 1.5, '#e9e4d8');
    b.at(0, 0.4, 1.15, 0, () => items(b, -w * 0.14, w * 0.62));
  });
}
function mannequin(b, x, z, color) {
  b.cyl(x, 0.05, z, 0.3, 0.1, METAL, { seg: 7 }); b.cyl(x, 0.6, z, 0.04, 1, METAL, { seg: 4 });
  b.box(x, 1.6, z, 0.56, 1.1, 0.3, color); b.ball(x, 2.4, z, 0.2, 0.24, 0.2, '#e9e4d8', { seg: 6 });
}

const mall = {
  mood: 'indoor', accent: '#e9614b',
  build(b, { accent }) {
    room(b, { floor: '#e6e0d2', wall: '#d9d4c6', side: '#cfc9ba', trim: '#b5ae9c', h: 6 });
    for (let i = 0; i < 5; i++) b.box(-9.6 + i * 4.8, 0.055, 0, 0.12, 0.02, 20, '#cfc7b4');
    for (let i = 0; i < 4; i++) b.box(0, 0.055, -7.2 + i * 4.8, 24, 0.02, 0.12, '#cfc7b4');
    // Shopfronts along the back
    shopfront(b, -8, 6.6, { fascia: '#c9423a', text: 'MODA', window: '#f2d9d0', items: (bb, cx) => { mannequin(bb, cx - 1.1, -0.5, '#dd6fa0'); mannequin(bb, cx, -0.5, '#3f72c4'); mannequin(bb, cx + 1.1, -0.5, '#d6a83a'); } });
    shopfront(b, -1.2, 6.6, { fascia: '#243a66', text: 'TECH', window: '#d0e4f2', items: (bb, cx) => { bb.box(cx, 0.5, -0.5, 3.4, 1, 0.7, WHITE); for (let i = 0; i < 4; i++) bb.quad(cx - 1.2 + i * 0.8, 1.4, -0.3, 0.5, 0.7, ['#9fd8ff', '#b8f0c8', '#ffd58a', '#f2a6c8'][i], { ...GLOW, rx: -0.2 }); } });
    shopfront(b, 5.6, 6.6, { fascia: '#2f8f55', text: 'BOOKS', window: '#dff0d9', items: (bb, cx) => shelf(bb, cx, -0.6, { w: 3.6, h: 2.6, rows: 3, per: 8 }) });
    // Escalator to a mezzanine at the back right
    b.box(10.4, 3.1, -8.6, 3, 0.3, 2.6, '#cfc9ba'); b.box(10.4, 3.75, -7.34, 3, 1, 0.06, '#bfe3ef', GLASS);
    b.at(10.4, 0, -2.6, 0, () => {
      b.box(0, 1.5, -1.6, 1.6, 0.5, 7.4, '#5a6068', { rx: 0.43 });
      for (let i = 0; i < 9; i++) b.box(0, 0.36 + i * 0.33, 1.2 - i * 0.72, 1.2, 0.08, 0.5, '#8b9096');
      for (const side of [-1, 1]) b.box(side * 0.78, 2.15, -1.6, 0.06, 0.8, 7.4, '#bfe3ef', { rx: 0.43, ...GLASS });
    });
    // Cinema on the left wall
    b.at(-11.7, 0, -1, HALF, () => {
      b.box(0, 4.5, 0.6, 8.4, 1.3, 1.5, '#3a1f2a');
      sign(b, 0, 4.5, 1.37, 'CINEMA', { size: 0.6, color: '#ffe07a', lit: true });
      for (let i = 0; i < 14; i++) { b.box(-3.9 + i * 0.6, 3.92, 1.36, 0.16, 0.16, 0.06, i % 2 ? '#ffe07a' : '#ff8f7a', GLOW); b.box(-3.9 + i * 0.6, 5.08, 1.36, 0.16, 0.16, 0.06, i % 2 ? '#ff8f7a' : '#ffe07a', GLOW); }
      b.box(0, 1.7, 0.12, 3.4, 3.4, 0.1, '#1c1418');
      for (const side of [-1, 1]) { b.box(side * 0.85, 1.65, 0.2, 1.5, 3.2, 0.08, '#5a2f3a'); b.quad(side * 0.85, 2.3, 0.25, 0.9, 1, '#2a1a22'); b.box(side * 0.3, 1.6, 0.27, 0.08, 0.7, 0.06, '#d6a83a'); }
      [['#f2a03c', '#3a1f2a'], ['#3f8fd0', '#f4f1e4'], ['#58a06a', '#f2d24a']].forEach(([one, two], i) => {
        const px = [-3.2, 2.6, 3.9][i];
        b.box(px, 2.2, 0.14, 1.1, 1.7, 0.08, '#d6a83a'); b.quad(px, 2.2, 0.19, 0.94, 1.54, one, GLOW); b.quad(px, 1.9, 0.2, 0.5, 0.5, two, GLOW);
      });
    });
    kiosk(b, -10.4, 6, { ry: HALF, w: 2.6, color: '#c9423a', roof: WHITE, fascia: '#ffe07a', text: 'POP' });
    b.ico(-9.4, 1.68, 6, 0.3, 0.2, 0.5, '#fff2a8'); b.box(-9.4, 1.56, 5.4, 0.3, 0.4, 0.3, '#c9423a');
    extra(b, 'mall-popcorn', -10.9, 6, HALF, 'work');
    ropeLine(b, [[-8.4, -3.4], [-6.6, -3.4], [-6.6, 1.2], [-8.4, 1.2]]);
    extra(b, 'mall-usher', -9.6, -3.2, HALF + 0.3, 'stand', { look: { outfit: 'office', outfitColor: 'red' } });
    // Centre planter with a ring seat
    b.cyl(0.4, 0.3, 0.6, 2, 0.6, '#b5ae9c', { seg: 12 }); b.cyl(0.4, 0.62, 0.6, 2.3, 0.1, WOOD_LIGHT, { seg: 12 });
    b.cyl(0.4, 0.9, 0.6, 1.4, 0.5, '#8a6644', { seg: 10 }); b.cyl(0.4, 2.2, 0.6, 0.16, 2.4, '#7a6449', { seg: 6 });
    b.ico(0.4, 3.8, 0.6, 1.5, 1.1, 1.5, LEAF); b.ico(1, 4.4, 0.3, 0.9, 0.8, 0.9, '#6aa95a');
    extra(b, 'mall-sitter', 0.4, 2.7, 0, 'sit', { seat: 0.67 });
    // Food court
    [[5.6, 4.6], [8.6, 7], [4.6, 8]].forEach(([x, z], i) => {
      table(b, x, z, { round: true, w: 1.5, color: WHITE, leg: METAL });
      for (let c = 0; c < 3; c++) { const turn = i + c * 2.1; chair(b, x + Math.sin(turn) * 1.15, z + Math.cos(turn) * 1.15, { ry: turn + PI, color: [accent, '#f2c14e', '#39a9a6'][i] }); }
      b.cyl(x, 1.12, z, 0.14, 0.2, accent, { seg: 6, top: 1.2 });
    });
    extra(b, 'mall-diner', 5.6 + Math.sin(0) * 1.15, 4.6 + Math.cos(0) * 1.15, PI, 'sit');
    // ATMs, bins, banners, shoppers
    b.at(9.4, 0, -4.4, 0, () => { b.box(0, 1, 0, 1, 2, 0.8, '#3a4a6a'); b.quad(0, 1.4, 0.41, 0.6, 0.5, '#9fd8ff', GLOW); b.box(0, 0.95, 0.44, 0.6, 0.1, 0.1, METAL); sign(b, 0, 1.85, 0.41, 'ATM', { size: 0.16, color: WHITE }); });
    for (const x of [-4.6, 2.2]) { b.box(x, 4.9, -5, 0.04, 2, 0.04, METAL); b.box(x, 4.2, -5, 1.2, 1.9, 0.04, x < 0 ? accent : '#243a66'); b.quad(x, 4.4, -4.97, 0.7, 0.7, '#ffe07a'); }
    extra(b, 'mall-shopper-1', -6.4, -6, 0.3, 'walk'); extra(b, 'mall-shopper-2', 3.6, -6.4, PI - 0.4, 'stand');
    plant(b, -4.6, -7.6, { s: 1.1, pot: WHITE }); plant(b, 2.2, -7.6, { s: 1.1, pot: WHITE }); plant(b, -11, 9, { s: 1.4, pot: WHITE });
    b.light(-8, 4, -1, '#ffd58a', 22, 11);
    return {
      spots: [
        landmark('cinema', /cinema|movie|film|ticket|popcorn|screen/, -7.6, -1, -HALF),
        landmark('shops', /shop|store|boutique|window|cloth|fashion|buy|browse/, -6.4, -6.8, PI),
        landmark('tech', /tech|phone|gadget|electronic|game|arcade|book/, 1.6, -6.8, PI),
        landmark('foodcourt', /food|court|eat|ice|cream|shawarma|pizza|chicken|restaurant|table/, 6.6, 6.2, 0.4, { act: { pose: 'sit', x: 5.6 + Math.sin(2.1) * 1.15, z: 4.6 + Math.cos(2.1) * 1.15, ry: 2.1 + PI, seat: 0.6 } }),
        landmark('atm', /atm|bank|cash|withdraw|work|job/, 9.4, -3, PI, { act: { pose: 'work' } }),
        landmark('people', /people|crowd|meet/, 1, 4.6, 0),
      ],
      crowd: [[3, 3.4, 0.4], [-1.6, 4.4, -0.5], [-3.4, 1, 1.2], [4.2, -1.6, -0.8], [-3.4, -5.6, PI], [6.4, -6.6, PI], [-5.6, 4.6, 1.6], [0.6, 8, 0.2], [-2.6, 7.6, 0.6], [7.6, 1.6, -1], [-6.4, 8, 1.2], [8.4, -1, -1.6]],
    };
  },
};

export const SCENES = { buka, club, viewing, shrine, mall };
