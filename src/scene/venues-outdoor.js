/**
 * OWNER: scenes
 * Open-air venues: park, market, beach, rooftop, polling unit, canopy walk, state house, and
 * the generic plaza used for unknown kinds.
 *
 * A scene definition is `{ mood, accent?, camera?, build(b, context) }`. build draws the static
 * venue into a geometry batch and returns `{ spots, crowd, spare }`:
 *   spots  landmarks a venue spot can attach to (see `landmark` in props.js)
 *   crowd  [x, z, ry] standing places for other players and NPCs
 *   spare  [x, z] places for spots that match no landmark
 * The camera looks in from the front right (+x, +z), so tall things go to the back and left.
 */
import { GLOW, GLASS } from './build.js';
import {
  ground, table, chair, stool, bench, counter, stall, speaker, plant, palm, leafTree, tallTree, bush, lampPost, kiosk, crate,
  column, flag, parasol, ropeLine, stringLights, fence, windowPane, door, sofa, sign, signBoard, car, bottles, landmark, extra,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, LEAF, LEAF_DARK, WARM,
} from './props.js';

const PI = Math.PI, HALF = Math.PI / 2;

const park = {
  mood: 'outdoor', accent: '#f2c14e',
  build(b, { accent }) {
    ground(b, { w: 30, d: 26, color: '#538553' });
    b.box(0, 0.04, 3, 2.6, 0.04, 20, '#d1c197');
    b.box(0, 0.04, 2.4, 27, 0.04, 2.4, '#d1c197');
    b.disc(0, 0.07, 2.4, 3.3, '#dccfa8', { seg: 18 });
    // Fountain
    b.cyl(0, 0.3, 2.4, 1.5, 0.5, '#a39f92', { seg: 12 });
    b.disc(0, 0.57, 2.4, 1.3, '#79c3df', { seg: 12, ...GLASS });
    b.cyl(0, 0.85, 2.4, 0.18, 1.2, '#a39f92', { seg: 6 });
    b.cyl(0, 1.45, 2.4, 0.55, 0.1, '#b5b1a3', { seg: 8, top: 1.3 });
    // Amphitheatre: stage, backdrop and three curved tiers
    const sx = -4, sz = -8.6;
    b.cyl(sx, 0.3, sz, 3, 0.6, '#8d7a66', { seg: 16 });
    b.cyl(sx, 0.63, sz, 2.8, 0.08, '#a8927a', { seg: 16 });
    b.box(sx, 2.2, sz - 3, 7.4, 4.4, 0.4, '#3d5a4e');
    b.box(sx, 4.5, sz - 3, 7.8, 0.3, 0.6, accent);
    for (const side of [-1, 1]) { b.box(sx + side * 3.9, 2.6, sz - 2.7, 0.5, 5.2, 0.5, '#2f463d'); b.box(sx + side * 3.9, 5.3, sz - 2.6, 0.7, 0.3, 0.7, WARM, GLOW); }
    b.light(sx, 4, sz - 0.5, '#ffd9a0', 26, 12);
    [4.6, 5.8, 7].forEach((radius, tier) => {
      for (let i = 0; i < 5; i++) {
        const turn = (i - 2) * 0.38;
        b.box(sx + Math.sin(turn) * radius, 0.2 + tier * 0.17, sz + Math.cos(turn) * radius, radius * 0.4, 0.4 + tier * 0.34, 0.85, tier % 2 ? '#a5a595' : '#94978a', { ry: turn });
      }
    });
    extra(b, 'park-poet', sx - 0.4, sz + 0.2, 0.2, 'wave', { y: 0.67 });
    extra(b, 'park-watch-1', sx - 1.7, sz + 5.5, PI - 0.3, 'sit', { seat: 0.74, y: 0 });
    extra(b, 'park-watch-2', sx + 2.2, sz + 6.6, PI + 0.33, 'sit', { seat: 1.08 });
    // Art gallery pavilion
    const gx = 9, gz = -8;
    b.box(gx, 0.1, gz, 7.4, 0.2, 4.6, '#c9c2b2');
    for (const dx of [-3.4, 3.4]) for (const dz of [-2, 2]) b.box(gx + dx, 1.9, gz + dz, 0.22, 3.6, 0.22, WHITE);
    b.box(gx, 3.8, gz, 7.8, 0.22, 5, WHITE);
    b.box(gx, 3.95, gz, 7.2, 0.1, 4.4, '#d96a4f');
    [['#d9603f', '#f0c24a'], ['#3f7fc4', '#e9e2cf'], ['#57a06a', '#d86f9c']].forEach(([one, two], i) => {
      const px = gx - 2.3 + i * 2.3;
      b.box(px, 1.75, gz - 1.6, 1.8, 2.3, 0.14, WHITE);
      b.quad(px, 1.85, gz - 1.52, 1.4, 1.5, one);
      b.quad(px + 0.2, 1.6, gz - 1.51, 0.7, 0.7, two);
    });
    b.box(gx + 1.2, 0.55, gz + 0.9, 0.8, 0.7, 0.8, '#d8d2c2');
    b.ico(gx + 1.2, 1.35, gz + 0.9, 0.42, 0.55, 0.4, '#b5763f');
    b.ico(gx + 1.3, 2.05, gz + 0.9, 0.3, 0.34, 0.3, '#c98d4f');
    extra(b, 'park-painter', gx - 1.4, gz + 0.4, PI + 0.2, 'work');
    // Under the trees: shade, bench and an ayo board
    [[8.5, 5.5, 1.15, 0], [12, 8.6, 1, 1], [5.2, 9.8, 0.95, 2], [12.6, 3, 0.9, 1]].forEach(([x, z, s, tone]) => leafTree(b, x, z, { s, tone }));
    bench(b, 10.3, 6.6, { w: 2.8, ry: -HALF, back: true, color: '#8f9384', leg: '#6f766c' });
    table(b, 7.3, 8, { w: 1.3, d: 0.9, h: 0.7 });
    b.box(7.3, 0.74, 8, 0.9, 0.08, 0.36, '#6b4a2f');
    for (let i = 0; i < 6; i++) b.cyl(7.3 - 0.33 + (i % 3) * 0.33, 0.79, 8 + (i < 3 ? -0.09 : 0.09), 0.06, 0.02, '#d9c58c', { seg: 5 });
    stool(b, 7.3, 7.1, { h: 0.45 }); stool(b, 7.3, 8.9, { h: 0.45 });
    extra(b, 'park-ayo', 7.3, 8.9, PI, 'sit', { seat: 0.45 });
    // Drinks kiosk and the community desk
    kiosk(b, -11.2, 6.6, { ry: HALF, text: 'DRINKS' });
    extra(b, 'park-kiosk', -11.6, 6.6, HALF, 'work');
    stool(b, -8.6, 5.4, { h: 0.75 }); stool(b, -8.6, 7.8, { h: 0.75 });
    table(b, -3.4, 9.6, { w: 2.6, d: 1 });
    b.box(-3.4, 0.6, 10.12, 2.6, 0.9, 0.04, accent);
    sign(b, -3.4, 0.62, 10.15, 'HELP', { size: 0.34, color: '#2f3b36' });
    b.box(-4.1, 1.14, 9.6, 0.5, 0.08, 0.36, WHITE);
    // Trees, lamps and planting around the edge
    [[-12, -9, 1.2, 0], [-12.5, -3, 1.05, 1], [-9.5, -11, 0.95, 2], [3, -11.2, 1, 1], [-13, 11, 0.9, 0], [13, -2.4, 0.85, 2]].forEach(([x, z, s, tone]) => leafTree(b, x, z, { s, tone }));
    lampPost(b, -2.6, -0.2, { light: true }); lampPost(b, 3.2, 5.4); lampPost(b, 11.5, 0.6); lampPost(b, -9, 1);
    [[-6, 0.6], [5.5, 0.4], [-2.2, 12], [3, 12.2], [-13.4, 2.6]].forEach(([x, z], i) => bush(b, x, z, { s: 0.9 + (i % 2) * 0.25 }));
    bench(b, 4.2, 0.5, { w: 2.6, ry: PI, back: true, color: '#8f9384', leg: '#6f766c' });
    bench(b, -4.6, 4.4, { w: 2.6, back: true, color: '#8f9384', leg: '#6f766c' });
    return {
      spots: [
        landmark('amphitheatre', /amphi|stage|theat|play|show|comedy|perform/, -4, -4.9, PI),
        landmark('art', /art|gallery|exhibit|paint/, 9, -5, PI),
        landmark('trees', /tree|shade|chill|ayo|rest/, 8.8, 7.6, -HALF, { act: { pose: 'sit', x: 10.25, z: 6.6, ry: -HALF, seat: 0.6 } }),
        landmark('drinks', /drink|kiosk|bar|juice|zobo/, -8.4, 6.6, -HALF),
        landmark('people', /people|crowd|meet/, 2.6, 5.2, 0),
        landmark('work', /work|desk|job|community|volunteer|help/, -3.4, 8.7, 0, { act: { pose: 'work' } }),
      ],
      crowd: [[3.8, 4.2, 0.4], [1.6, 6.6, -0.5], [4.6, 6.8, 2.6], [-2.2, 5.6, 1.2], [-1.6, 0.4, 2.8], [0.6, -2.6, PI], [-6.6, -2.6, 2.6], [6, 2.8, -1], [-5.4, 7, 0.6], [2.2, 9, 2.2], [-7.6, 2.4, 1.6], [6.8, -3.6, 0.5]],
    };
  },
};

function heap(b, x, z, color, r = 0.5) {
  b.cyl(x, 0.22, z, r, 0.44, '#b68f55', { seg: 8, top: 1.2 });
  b.ico(x, 0.55, z, r * 0.95, 0.3, r * 0.95, color);
}

const market = {
  mood: 'outdoor', accent: '#f08a3c',
  build(b) {
    ground(b, { w: 30, d: 26, color: '#d2b584', edge: '#9a8058' });
    b.box(1, 0.04, 1.5, 9, 0.03, 19, '#c2a273');
    b.box(0, 0.04, -3.6, 26, 0.03, 3, '#c2a273');
    const palettes = [['#d2553f', '#f0e2c0'], ['#3d8f6a', '#f0e2c0'], ['#e0a43a', '#b5483f'], ['#3f72c4', '#ece2c6']];
    // Back row: tomatoes and peppers, yams and plantain, grains, fabric
    stall(b, -9.6, -8.4, { awning: palettes[0], goods: ['#d9482f', '#c9372c', '#5f9a48'] });
    stall(b, -5, -8.4, { awning: palettes[1], goods: ['#a67c4a', '#e3c24a', '#7c9b3c'] });
    stall(b, -0.4, -8.4, { awning: palettes[2], goods: ['#ede4c8', '#b87a3c', '#8f5a34'] });
    b.at(5.2, 0, -8.6, 0, () => {
      for (const side of [-1, 1]) b.box(side * 2, 1.9, 0, 0.14, 3.8, 0.14, WOOD_DARK);
      b.box(0, 3.75, 0, 4.2, 0.14, 0.14, WOOD_DARK);
      ['#c9423a', '#3f72c4', '#e0a43a', '#3f9a5a', '#8055c2', '#dd6fa0'].forEach((color, i) => {
        b.box(-1.6 + i * 0.64, 2.55, 0.02 + (i % 2) * 0.06, 0.56, 2.3, 0.06, color);
        b.box(-1.6 + i * 0.64, 2.2, 0.07 + (i % 2) * 0.06, 0.56, 0.3, 0.02, i % 2 ? '#f0e2c0' : '#2f2a3a');
      });
      table(b, 0, 1.3, { w: 3.6, d: 1, h: 0.9 });
      ['#3f9a5a', '#c9423a', '#d6a83a', '#243a66', '#dd6fa0'].forEach((color, i) => b.cyl(-1.3 + i * 0.65, 1.06, 1.3, 0.16, 0.9, color, { seg: 6, rx: HALF }));
    });
    // Left row faces the lane
    stall(b, -12.2, -1.6, { ry: HALF, awning: palettes[3], goods: ['#8a5a36', '#d9c9a0', '#c9423a'] });
    stall(b, -12.2, 3.6, { ry: HALF, awning: palettes[0], goods: ['#5f9a48', '#e8a13a', '#f0e2c0'] });
    // Phones and gadgets kiosk
    kiosk(b, 10.6, -8.2, { color: '#3a6ea5', roof: '#243a66', fascia: '#f2c14e', text: 'PHONES' });
    for (let i = 0; i < 4; i++) b.quad(9.5 + i * 0.72, 2.1, -7.72, 0.4, 0.6, ['#9fd8ff', '#b8f0c8', '#ffd58a', '#f2a6c8'][i], GLOW);
    // Ground traders under parasols
    parasol(b, 7.6, 3.4, { colors: ['#e9614b', WHITE] });
    heap(b, 6.8, 4.3, '#d9482f'); heap(b, 8.2, 4.5, '#e8a13a'); heap(b, 7.6, 5.4, '#5f9a48', 0.42);
    stool(b, 8.6, 3, { h: 0.4 });
    extra(b, 'market-mat', 8.6, 3, 0.9, 'sit', { seat: 0.4 });
    parasol(b, -3.6, 6.8, { colors: ['#3f9a5a', '#f0e2c0'] });
    b.box(-3.6, 0.07, 7.9, 2.6, 0.04, 1.8, '#a1493d');
    for (let i = 0; i < 5; i++) b.ball(-4.5 + i * 0.45, 0.24, 7.9 + (i % 2) * 0.4, 0.2, 0.16, 0.2, i % 2 ? '#8a5a36' : '#b98a4f', { seg: 6 });
    // Sacks, crates, wheelbarrow
    for (const [x, z, color] of [[-7.4, -5.8, '#d9cdaa'], [-6.6, -5.9, '#cdbf99'], [2.2, -6, '#d9cdaa'], [12.6, 1.4, '#cdbf99'], [12.4, 2.3, '#d9cdaa']]) b.ball(x, 0.42, z, 0.4, 0.5, 0.36, color, { seg: 7 });
    crate(b, -8.6, 0, 7.2, { fill: '#d9482f' }); crate(b, -8.6, 0, 8.1, { fill: '#e8a13a' }); crate(b, -8.6, 0.42, 7.64, { fill: '#5f9a48' });
    crate(b, 12, 0, -3.4, { fill: '#7c9b3c' }); crate(b, 12.2, 0, -4.3);
    b.at(3.6, 0, 7.6, 0.6, () => {
      b.box(0, 0.62, 0, 1, 0.4, 1.5, '#4d7a8a');
      b.ico(0, 0.92, 0, 0.42, 0.24, 0.6, '#a67c4a');
      b.cyl(0, 0.3, 0.9, 0.3, 0.12, BLACK, { seg: 8, rz: HALF });
      for (const side of [-1, 1]) b.box(side * 0.45, 0.6, -1.15, 0.06, 0.06, 1, WOOD_DARK);
    });
    lampPost(b, -2.2, -4.6, { light: true }); lampPost(b, 5.6, 1.2);
    stringLights(b, [-11.6, 3.7, -5.4], [-2.2, 4.3, -4.6], { n: 8 });
    stringLights(b, [-2.2, 4.3, -4.6], [8.6, 3.7, -5.6], { n: 9 });
    extra(b, 'market-tomato', -9.6, -9.3, 0, 'work');
    extra(b, 'market-yam', -5, -9.3, 0.2, 'stand');
    extra(b, 'market-cloth', 6.6, -6.4, -0.5, 'wave');
    extra(b, 'market-shopper', 0.6, -2.6, 2.6, 'walk');
    extra(b, 'market-provisions', -12.8, -1.6, HALF, 'stand');
    return {
      spots: [
        landmark('produce', /produce|food|tomato|pepper|vegetable|grocer|stall|ingredient|yam|rice/, -5, -5.4, PI),
        landmark('fabric', /fabric|cloth|ankara|tailor|aso|lace|fashion/, 4.6, -5.6, PI),
        landmark('gadgets', /phone|gadget|electronic|computer|charger|tech/, 10.6, -4.6, PI),
        landmark('provisions', /provision|haggle|trader|mama|shop|buy|bargain|price/, -9.2, 1, -HALF),
        landmark('people', /people|crowd|meet/, 1.4, 3, 0),
        landmark('porter', /porter|carry|load|work|job|hustle|barrow/, 2.4, 6.2, 0.6, { act: { pose: 'work' } }),
      ],
      crowd: [[2.8, 1.4, 0.5], [-0.6, 4.6, -0.4], [3.4, 4.2, 2.4], [-2.6, 0.6, 1.4], [-7.6, -4.6, PI], [-1.2, -5.4, PI], [7.6, -3, 2.6], [-8.2, 4.4, -HALF], [5.6, 6.8, 0.2], [-5.6, 3, 1], [9.6, 0.6, -0.8], [0.2, 9, 0.3]],
    };
  },
};

function lounger(b, x, z, ry, color) {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.32, 0.25, 0.8, 0.1, 1.5, color);
    b.box(0, 0.6, -0.8, 0.8, 0.1, 0.9, color, { rx: -0.75 });
    for (const sz of [-0.3, 0.8]) b.box(0, 0.14, sz, 0.7, 0.28, 0.08, WOOD_LIGHT);
  });
}

const beach = {
  mood: 'outdoor', accent: '#ff8a5c',
  build(b) {
    ground(b, { w: 30, d: 26, color: '#e6d3a0', edge: '#c2ad7a' });
    b.box(0, 0.035, -9.6, 30, 0.1, 7.2, '#2c7fa8');
    b.box(0, 0.06, -9.2, 30, 0.1, 8, '#7fd3de', GLASS);
    b.box(0, 0.04, -4.6, 30, 0.03, 1.6, '#d6c08c');
    for (let i = 0; i < 9; i++) b.box(-13 + i * 3.3, 0.125, -5.25 + (i % 3) * 0.22, 2.9, 0.03, 0.28, '#f4f7f2');
    for (let i = 0; i < 5; i++) b.box(-11 + i * 5.6, 0.125, -8.4 - (i % 2) * 1.6, 2.2, 0.03, 0.18, '#d9f1f2');
    [[-12, -2.6, 1.05, 0.14, 0.4], [-8.6, 9.6, 0.95, 0.1, 2.2], [12.4, -2.2, 1.1, 0.16, 3.6], [12.8, 8.2, 0.9, 0.12, 5], [-13, 4.4, 1, 0.08, 1.2]].forEach(([x, z, s, lean, ry]) => palm(b, x, z, { s, lean, ry }));
    // Canopies with loungers
    [[-3.6, -0.6, ['#ff8a5c', WHITE]], [2.2, -0.9, ['#39a9a6', WHITE]], [7.8, -0.4, ['#f2c14e', WHITE]]].forEach(([x, z, colors], i) => {
      parasol(b, x, z, { colors, r: 1.9 });
      lounger(b, x - 0.9, z + 0.5, PI + 0.1, colors[0]);
      lounger(b, x + 0.9, z + 0.5, PI - 0.1, i % 2 ? '#f0e2c0' : '#e9eef0');
    });
    extra(b, 'beach-lounger', 3.1, -0.2, PI, 'sit', { seat: 0.36 });
    // Thatched beach bar
    kiosk(b, -11.4, 0.6, { ry: HALF, color: '#b78d54', roof: '#c9a85a', fascia: '#7a5a34', text: 'BAR', textColor: '#f4e6b8' });
    b.cone(-11.2, 3.75, 0.6, 2.8, 1.3, '#b99746', { seg: 8 });
    stool(b, -8.4, -0.4, { h: 0.75 }); stool(b, -8.4, 1.6, { h: 0.75 });
    extra(b, 'beach-barman', -11.8, 0.6, HALF, 'work');
    // Volleyball
    for (const side of [-1, 1]) b.cyl(7 + side * 3, 1.3, 6.6, 0.07, 2.6, WOOD_DARK, { seg: 5 });
    b.box(7, 2, 6.6, 6, 1, 0.03, '#f4f4ec', GLASS);
    b.box(7, 2.52, 6.6, 6, 0.06, 0.05, WHITE);
    b.ball(6, 0.22, 8.2, 0.2, 0.2, 0.2, '#f2e24a', { seg: 7 });
    b.box(7, 0.045, 6.6, 6.4, 0.02, 5.2, '#ecdcae');
    extra(b, 'beach-volley', 8.4, 4.9, 0.2, 'dance');
    // Bonfire with log seats
    const fx = -3.2, fz = 7.2;
    b.cyl(fx, 0.08, fz, 0.9, 0.14, '#8a8478', { seg: 10 });
    for (let i = 0; i < 3; i++) b.cyl(fx, 0.25, fz, 0.09, 1.2, '#5a3d28', { seg: 5, rz: 1.1, ry: i * 2.1 });
    b.cone(fx, 0.7, fz, 0.34, 0.9, '#ff9a3c', { seg: 6, ...GLOW });
    b.cone(fx + 0.12, 0.62, fz + 0.1, 0.2, 0.6, '#ffe07a', { seg: 5, ...GLOW });
    b.light(fx, 1.2, fz, '#ff9a4a', 24, 10);
    for (let i = 0; i < 3; i++) { const turn = 0.6 + i * 1.9; b.cyl(fx + Math.sin(turn) * 2, 0.24, fz + Math.cos(turn) * 2, 0.24, 1.5, '#7a5a3c', { seg: 6, rz: HALF, ry: turn }); }
    extra(b, 'beach-fire', fx + Math.sin(0.6) * 2, fz + Math.cos(0.6) * 2, 0.6 + PI, 'sit', { seat: 0.44 });
    // Boat, surfboards and mats
    b.at(10.4, 0, -4.2, 0.5, () => {
      b.ball(0, 0.32, 0, 0.8, 0.5, 2.4, '#2f6f8f', { seg: 8 });
      b.box(0, 0.6, 0, 1.3, 0.1, 3.6, '#e9d9a8');
      b.box(0, 0.7, -0.4, 1.2, 0.08, 0.3, WOOD);
    });
    [[-6.6, -3.2, '#ff8a5c'], [-6, -3.3, '#39a9a6'], [-5.4, -3.2, '#f2e24a']].forEach(([x, z, color]) => b.ball(x, 1.05, z, 0.22, 1.1, 0.05, color, { seg: 7, rx: -0.12 }));
    b.box(1.2, 0.05, 4.6, 1.6, 0.03, 2.4, '#d86f9c'); b.box(-0.8, 0.05, 5, 1.6, 0.03, 2.4, '#3f72c4', { ry: 0.3 });
    stringLights(b, [-11, 3.4, 2.6], [-3.6, 3.1, -0.6], { n: 8 });
    return {
      spots: [
        landmark('water', /water|swim|sea|ocean|surf|wave|dip|shore/, 3.4, -3.9, PI),
        landmark('canopy', /canop|lounge|chill|relax|tan|sun|shade|nap|cabana/, -0.4, 0.9, 0, { act: { pose: 'sit', x: -2.7, z: 0.1, ry: PI, seat: 0.36 } }),
        landmark('bar', /bar|drink|coconut|suya|grill|food|palm.?wine|cocktail/, -8.2, 0.6, -HALF),
        landmark('volleyball', /volley|ball|game|sport|play|football/, 5.6, 8.4, PI, { act: { pose: 'dance' } }),
        landmark('bonfire', /fire|bonfire|night|party|music|gist/, -3.2, 9.4, PI),
        landmark('people', /people|crowd|meet/, 1.6, 2.8, 0),
      ],
      crowd: [[3.2, 3.6, 0.4], [0.2, 2.4, -0.5], [4.6, 2, 2.4], [-1.4, 4.2, 1.2], [6.2, -3.4, PI], [0.4, -3.6, PI + 0.3], [-5.4, 4.8, 2.2], [9.6, 2.6, -1], [-6.4, 0.8, HALF], [5.4, 5.2, 0.4], [-1.2, 8.8, 2.6], [10.6, 5.4, -0.4]],
    };
  },
};

const rooftop = {
  mood: 'outdoor', accent: '#ffb347',
  build(b) {
    // Deck on top of a tower, with the city falling away behind and to the left
    b.box(0, -6, 0, 23, 12, 19, '#4b5562');
    b.box(0, 0.03, 0, 22, 0.08, 18, '#8c6d4f');
    for (let i = 0; i < 8; i++) b.box(-9.6 + i * 2.75, 0.075, 0, 0.06, 0.02, 18, '#73583f');
    b.box(0, 0.6, -9.25, 23, 1.2, 0.5, '#5d6875'); b.box(-11.25, 0.6, 0, 0.5, 1.2, 19, '#5d6875');
    b.box(0, 0.5, 9.2, 22.6, 0.9, 0.08, '#bfe3ef', GLASS); b.box(11.2, 0.5, 0, 0.08, 0.9, 18.4, '#bfe3ef', GLASS);
    b.box(0, 0.98, 9.2, 22.6, 0.06, 0.12, METAL); b.box(11.2, 0.98, 0, 0.12, 0.06, 18.4, METAL);
    // Skyline
    [[-16, -15, 5, 9, 5, '#55617a'], [-9, -17, 6, 4, 5, '#6f7c92'], [-2, -15.5, 4.4, 12, 4.4, '#5f6b84'], [4.5, -17.5, 6, 6, 5, '#77839a'], [11, -15.5, 5, 10, 5, '#4f5b74'], [17, -17, 5, 3, 5, '#6f7c92'],
      [-17.5, -6, 5, 6, 6, '#64708a'], [-16, 2, 4.4, 11, 5, '#55617a'], [-18, 9.5, 5, 2, 6, '#6f7c92']].forEach(([x, z, w, top, d, color], i) => {
      b.box(x, top - 12, z, w, 24, d, color);
      const onLeft = x < -14 && z > -12;
      for (let row = 0; row < 4; row++) for (let col = 0; col < 2; col++) {
        if ((row * 3 + col + i) % 3 === 0) continue;
        const lit = ['#ffe1a0', '#bfe3ff', '#ffd58a'][(row + col + i) % 3];
        if (onLeft) b.quad(x + w / 2 + 0.02, top - 1.2 - row * 1.5, z + (col - 0.5) * d * 0.45, d * 0.28, 0.7, lit, { ry: HALF, ...GLOW });
        else b.quad(x + (col - 0.5) * w * 0.45, top - 1.2 - row * 1.5, z + d / 2 + 0.02, w * 0.28, 0.7, lit, GLOW);
      }
    });
    b.cyl(-2, 13.4, -15.5, 0.06, 2.8, METAL, { seg: 4 }); b.box(-2, 14.9, -15.5, 0.18, 0.18, 0.18, '#ff5a4a', GLOW);
    // Bar along the left
    counter(b, -8.2, -1, { w: 7, d: 1, ry: HALF, color: '#3a2f3d', top: '#d9b46a', stripe: '#ffb347' });
    b.box(-10.6, 1.6, -1, 0.5, 2.4, 6.4, '#2f2733');
    for (const y of [1.5, 2.2]) { b.box(-10.3, y, -1, 0.5, 0.06, 6.2, '#d9b46a'); bottles(b, -10.25, y + 0.03, -1, { n: 12, gap: 0.48, ry: HALF, lit: true, colors: ['#8fe0b0', '#ffc46a', '#ff8f7a', '#bfe3ff'] }); }
    sign(b, -10.3, 3.3, -1, 'BAR', { size: 0.6, color: '#ffcf6a', ry: HALF, lit: true, board: '#2f2733' });
    for (const z of [-3.6, -1.9, -0.2, 1.5]) stool(b, -6.9, z, { h: 0.85, color: '#d9b46a' });
    extra(b, 'roof-barman', -9.3, -0.4, HALF, 'work');
    extra(b, 'roof-guest', -6.9, -1.9, -HALF, 'sit', { seat: 0.85 });
    // Lounge with a fire table
    sofa(b, 3.4, -7.6, { w: 4.2, color: '#e9e2d0', cushion: '#c96a4a' });
    sofa(b, 6.9, -5.2, { w: 3.4, ry: -HALF, color: '#e9e2d0', cushion: '#c96a4a' });
    b.cyl(3.6, 0.35, -5, 0.9, 0.6, '#3d4250', { seg: 10 });
    b.cyl(3.6, 0.68, -5, 0.6, 0.08, '#ff9a3c', { seg: 8, ...GLOW });
    b.cone(3.6, 0.95, -5, 0.2, 0.5, '#ffd06a', { seg: 5, ...GLOW });
    b.light(3.6, 1.6, -5, '#ffad5c', 20, 9);
    extra(b, 'roof-lounge', 2.6, -7.5, 0.2, 'sit', { seat: 0.69 });
    // High tables
    [[-2, 3], [1.8, 5.4], [-3.4, 6.6]].forEach(([x, z]) => { table(b, x, z, { round: true, w: 1.2, h: 1.3, color: '#e9e2d0', leg: METAL_DARK }); b.cyl(x, 1.42, z, 0.07, 0.22, '#ffcf6a', { seg: 5, ...GLOW }); });
    extra(b, 'roof-chat-1', -2.9, 3, HALF, 'stand'); extra(b, 'roof-chat-2', -1.1, 3.2, -HALF, 'wave');
    // Plunge pool
    b.box(6.4, 0.2, 4.6, 6, 0.4, 4.6, '#d9d4c6');
    b.box(6.4, 0.3, 4.6, 5.2, 0.3, 3.8, '#2c8fb5');
    b.box(6.4, 0.43, 4.6, 5.2, 0.06, 3.8, '#8fe3ee', GLASS);
    // DJ corner and planting
    table(b, -3, -7.8, { w: 2.6, d: 1, h: 1.2, color: '#2a2630', leg: '#2a2630' });
    for (const dx of [-0.6, 0.6]) b.cyl(-3 + dx, 1.24, -7.8, 0.34, 0.05, '#15151a', { seg: 10 });
    speaker(b, -5.4, -8, { h: 1.9 }); speaker(b, -0.6, -8, { h: 1.9 });
    extra(b, 'roof-dj', -3, -8.5, 0, 'work');
    for (const x of [8.6, 10.2]) plant(b, x, -8.2, { s: 1.2, pot: '#d9d4c6' });
    plant(b, -10.2, 7.6, { s: 1.3, pot: '#d9d4c6' }); plant(b, 10.2, 8, { s: 1, pot: '#d9d4c6' });
    // String lights from four masts to a centre mast
    const masts = [[-10.6, -8.6], [10.6, -8.6], [-10.6, 8.6], [10.6, 8.6]];
    for (const [x, z] of masts) b.cyl(x, 2.3, z, 0.06, 4.6, METAL_DARK, { seg: 5 });
    b.cyl(0, 2.6, 0.6, 0.06, 5.2, METAL_DARK, { seg: 5 });
    for (const [x, z] of masts) stringLights(b, [x, 4.5, z], [0, 5.1, 0.6], { n: 8, sag: 0.7 });
    return {
      spots: [
        landmark('bar', /bar|drink|cocktail|bottle|wine|champagne|shot/, -6, 0.6, -HALF),
        landmark('lounge', /lounge|sofa|chill|relax|dinner|date|table|eat|fire/, 3.4, -3.4, PI, { act: { pose: 'sit', x: 4.6, z: -7.5, ry: 0, seat: 0.69 } }),
        landmark('view', /view|skyline|photo|selfie|sunset|edge|rail|city/, 9.6, -7, PI - 0.4),
        landmark('pool', /pool|swim|dip|jacuzzi|plunge/, 6.4, 1.4, 0),
        landmark('dj', /dj|music|dance|deck/, -3, -5.6, PI, { act: { pose: 'dance' } }),
        landmark('people', /people|crowd|meet/, 0.8, 1.6, 0),
      ],
      crowd: [[2.6, 2.4, 0.4], [-0.6, 0.2, -0.5], [1.2, 3.6, 2.4], [-4.6, 0.6, 1.2], [0.4, -4, PI], [-1.6, -4.6, 2.6], [8.6, 0.8, -1], [-4.4, 4.6, 0.6], [3.4, 7.4, 2.2], [-6.6, 5.6, 1.6], [6.8, -2, 0.5], [-0.4, 7.6, 0.2]],
    };
  },
};

function votingBooth(b, x, z) {
  b.at(x, 0, z, 0, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(sx * 0.6, 0.55, sz * 0.4, 0.07, 1.1, 0.07, METAL);
    b.box(0, 1.12, 0, 1.4, 0.06, 1, WHITE);
    b.box(0, 1.6, -0.48, 1.4, 0.9, 0.05, WHITE);
    for (const side of [-1, 1]) b.box(side * 0.68, 1.6, 0, 0.05, 0.9, 1, WHITE);
    b.box(0, 1.92, -0.44, 1.4, 0.2, 0.03, '#2f8f55');
    b.box(0.2, 1.17, 0.1, 0.4, 0.03, 0.5, '#f4f1e4');
  });
}

const polling = {
  mood: 'outdoor', accent: '#3fae6a',
  build(b) {
    ground(b, { w: 30, d: 26, color: '#c9b78c', edge: '#8f8262' });
    b.box(0, 0.035, 11.6, 30, 0.04, 2.8, '#5a8a52'); b.box(13.6, 0.035, 0, 2.8, 0.04, 26, '#5a8a52');
    // School block along the back
    b.box(0, 2, -11.6, 27, 4, 2.6, '#e3d6a8');
    b.box(0, 4.2, -11.2, 28, 0.4, 3.8, '#a3503f');
    b.box(0, 0.6, -10.28, 27, 1.2, 0.04, '#5f8f6a');
    for (let i = 0; i < 6; i++) if (i !== 3) windowPane(b, -11 + i * 4.4, 2.5, -10.26, { w: 1.9, h: 1.3, frame: '#7a6a4a', glass: '#7f9aa3' });
    door(b, 2.2, -10.24, { w: 1.5, h: 2.9, color: '#4a6a55', frame: '#7a6a4a' });
    sign(b, -5, 3.75, -10.2, 'PRIMARY SCHOOL', { size: 0.3, color: '#4a3a2a' });
    [['#3fae6a', WHITE], ['#c9423a', '#f2c14e'], ['#3f72c4', WHITE]].forEach(([one, two], i) => { b.quad(6 + i * 1.5, 2.1, -10.24, 1.1, 1.5, one); b.quad(6 + i * 1.5, 2.3, -10.23, 0.6, 0.6, two); });
    // Officials under a canopy
    const cx = -5, cz = -3.6;
    for (const dx of [-3, 3]) for (const dz of [-2, 2]) b.cyl(cx + dx, 1.7, cz + dz, 0.07, 3.4, METAL, { seg: 5 });
    for (let i = 0; i < 4; i++) b.box(cx - 2.4 + i * 1.6, 3.5, cz, 1.6, 0.1, 4.6, i % 2 ? WHITE : '#3fae6a');
    b.box(cx, 3.2, cz + 2.3, 6.4, 0.5, 0.06, WHITE);
    sign(b, cx, 3.2, cz + 2.34, 'VOTE', { size: 0.3, color: '#2f8f55' });
    table(b, cx, cz, { w: 4.4, d: 1.2 });
    b.box(cx, 0.6, cz + 0.62, 4.4, 0.9, 0.03, '#3fae6a');
    for (const dx of [-1.4, 0, 1.4]) { b.box(cx + dx, 1.08, cz + 0.1, 0.5, 0.05, 0.7, WHITE); }
    b.box(cx + 1.9, 1.2, cz - 0.2, 0.4, 0.3, 0.3, '#3a3f46');
    for (const dx of [-1.2, 1.2]) { chair(b, cx + dx, cz - 1, { color: '#e9e4d4' }); extra(b, `poll-official-${dx}`, cx + dx, cz - 1, 0, 'sit', { look: { outfit: 'office', outfitColor: dx < 0 ? 'green' : 'cream' } }); }
    // Ballot box
    b.box(1.6, 0.45, 0.4, 1.1, 0.9, 1.1, METAL_DARK);
    b.box(1.6, 1.32, 0.4, 1, 0.84, 1, '#dff1f4', GLASS);
    b.box(1.6, 1.78, 0.4, 1.1, 0.1, 1.1, '#2f8f55');
    b.box(1.6, 1.84, 0.4, 0.5, 0.02, 0.08, BLACK);
    for (let i = 0; i < 4; i++) b.box(1.45 + (i % 2) * 0.3, 0.96 + i * 0.04, 0.3 + (i % 3) * 0.12, 0.4, 0.03, 0.3, WHITE, { ry: i * 0.7 });
    // Voting booths
    for (const x of [6.6, 8.6, 10.6]) votingBooth(b, x, -5.4);
    extra(b, 'poll-voter', 8.6, -4.5, PI, 'work');
    // Queue lane
    ropeLine(b, [[-1.6, 3.4], [2.2, 3.4], [6, 3.4], [9.8, 3.4]]);
    ropeLine(b, [[-1.6, 5.4], [2.2, 5.4], [6, 5.4], [9.8, 5.4]]);
    [[8.6, 0.1], [6.6, -0.1], [4.6, 0.1], [2.6, 0]].forEach(([x, dz], i) => extra(b, `poll-queue-${i}`, x, 4.4 + dz, -HALF, i === 2 ? 'wave' : 'stand'));
    // Results board, bench, tree, security
    b.at(-12.6, 0, 3.6, HALF, () => {
      for (const side of [-1, 1]) b.box(side * 1.7, 1.4, 0, 0.12, 2.8, 0.12, WOOD_DARK);
      b.box(0, 2.1, 0, 3.6, 2, 0.1, '#2f4a45');
      sign(b, 0, 2.8, 0.06, 'RESULTS', { size: 0.26, color: WHITE });
      for (let i = 0; i < 6; i++) b.quad(-1.2 + (i % 3) * 1.2, 2.2 - Math.floor(i / 3) * 0.7, 0.07, 0.8, 0.55, i === 1 ? '#ffe9a8' : WHITE);
    });
    bench(b, -9.6, 8.6, { w: 3.2, back: true });
    extra(b, 'poll-rest', -9.2, 8.6, 0, 'sit');
    leafTree(b, 11.6, 9.4, { s: 1.15, tone: 2 }); leafTree(b, -13, -6.6, { s: 1, tone: 0 });
    flag(b, 12.4, -8.6, { h: 6.2 });
    extra(b, 'poll-guard', 11.2, 0.8, -HALF - 0.3, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', hair: 'lowcut' } });
    return {
      spots: [
        landmark('queue', /queue|line|wait|join|turn/, 0.6, 4.4, -HALF),
        landmark('booth', /booth|vote|thumb|paper|choose/, 6.6, -4.3, PI, { act: { pose: 'work' } }),
        landmark('ballot', /ballot|box|cast|drop/, 1.6, 1.8, PI, { act: { pose: 'work' } }),
        landmark('officials', /official|register|accredit|desk|pvc|card|agent|observer|inec|work|job/, -5, -1.8, PI),
        landmark('results', /result|board|count|tally|collat/, -10.6, 3.6, -HALF),
        landmark('people', /people|crowd|meet/, -3.6, 6.6, 0),
      ],
      crowd: [[-2, 8.2, 0.4], [-5.2, 5.2, -0.5], [-1.2, 1.4, 2.4], [4.6, 0.6, 1.2], [4.2, 7.6, 0.2], [7.6, 8, -0.4], [-8.6, 0.6, 1], [10.2, -2.6, PI], [-9.8, 5.6, -HALF], [0.4, -4.6, 2.6], [12, 4.6, -1.4], [-6.4, 9.6, 0.6]],
    };
  },
};

/** Suspended bridge between two platforms; returns the deck height at its middle. */
function bridge(b, from, to, { segments = 6, sag = 0.7 } = {}) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const heading = Math.atan2(dx, dz), flat = Math.hypot(dx, dz);
  const point = (t) => [from[0] + dx * t, from[1] + dy * t - sag * 4 * t * (1 - t), from[2] + dz * t];
  for (let i = 0; i < segments; i++) {
    const a = point(i / segments), c = point((i + 1) / segments);
    const length = Math.hypot(flat / segments, c[1] - a[1]) + 0.04, pitch = -Math.atan2(c[1] - a[1], flat / segments);
    b.at((a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2, heading, () => {
      b.box(0, 0, 0, 1.2, 0.08, length, i % 2 ? '#a9835a' : '#96724c');
      for (const side of [-1, 1]) {
        b.box(side * 0.6, 1, 0, 0.05, 0.05, length, '#d8c9a0');
        b.box(side * 0.6, 0.5, 0, 0.04, 0.04, length, '#d8c9a0');
        b.box(side * 0.6, 0.5, -length / 2 + 0.05, 0.05, 1, 0.05, '#7a5c3c');
      }
    }, pitch);
  }
  return point(0.5)[1] + 0.04;
}
function platform(b, x, z, h, { roof = false } = {}) {
  b.cyl(x, (h + 4.4) / 2, z, 0.42, h + 4.4, '#6b5440', { seg: 7, top: 0.7 });
  b.cyl(x, h - 0.12, z, 1.7, 0.24, '#8f6d49', { seg: 8 });
  for (let i = 0; i < 8; i++) { const turn = i * PI / 4 + PI / 8; b.box(x + Math.sin(turn) * 1.55, h + 0.5, z + Math.cos(turn) * 1.55, 0.07, 1, 0.07, '#7a5c3c'); }
  b.cyl(x, h + 1, z, 1.58, 0.06, '#d8c9a0', { seg: 8, open: true });
  for (const [dx, dz] of [[0.8, 0.5], [-0.7, 0.7]]) b.box(x + dx * 0.9, h / 2, z + dz * 0.9, 0.1, h, 0.1, '#6b5440', { rz: dx * 0.12 });
  if (roof) b.cone(x, h + 3.2, z, 2.2, 1.2, '#b99746', { seg: 8 });
  else b.ico(x + 0.3, h + 5, z - 0.2, 1.7, 1.3, 1.6, LEAF);
}

const walk = {
  mood: 'outdoor', accent: '#f2d27a',
  camera: { landscape: [16, 21.5, 26.5], portrait: [17, 31, 40] },
  build(b) {
    ground(b, { w: 30, d: 26, color: '#3f6e48', edge: '#2c4f36' });
    // Trail
    [[-10, 1.6], [-8.4, 3.4], [-6.2, 5], [-3.8, 6.2], [-1.2, 7], [1.6, 7.4], [4.4, 7.2], [7, 6.6], [9.4, 5.2]].forEach(([x, z], i) => b.disc(x, 0.05, z, 0.9 + (i % 2) * 0.2, '#b7a67c', { seg: 9 }));
    // Platforms and bridges
    const towers = [[-8, 3.2, 5.6], [-3.4, 3.9, -3.4], [4.4, 4.5, -4.6], [9.6, 3.4, 2.6]];
    towers.forEach(([x, h, z], i) => platform(b, x, z, h, { roof: i === 2 }));
    const edge = (a, c, r = 1.5) => { const dx = c[0] - a[0], dz = c[2] - a[2], d = Math.hypot(dx, dz); return [a[0] + dx / d * r, a[1], a[2] + dz / d * r]; };
    const decks = [];
    for (let i = 0; i < 3; i++) decks.push(bridge(b, edge(towers[i], towers[i + 1]), edge(towers[i + 1], towers[i]), { segments: i === 1 ? 6 : 7 }));
    // Stair up to the first platform
    for (let i = 0; i < 8; i++) b.box(-8, 0.2 + i * 0.4, 10.6 - i * 0.45, 1.2, 0.12, 0.5, '#a9835a');
    for (const side of [-1, 1]) b.box(-8 + side * 0.62, 2.4, 8.9, 0.06, 0.06, 4.9, '#d8c9a0', { rx: 0.73 });
    // Ticket hut
    kiosk(b, -12.2, -1.4, { ry: HALF, color: '#7a9a62', roof: '#5a4630', fascia: '#e9dcb4', text: 'CANOPY', w: 3.2 });
    extra(b, 'walk-ranger', -12.6, -1.4, HALF, 'wave', { look: { outfit: 'sitework', outfitColor: 'green' } });
    // Forest
    [[-13, -10, 9, 1.2, 0], [-9.4, -11.2, 10, 1.1, 1], [-4, -11.6, 8.4, 1, 2], [1.6, -11.4, 9.6, 1.2, 0], [8, -11, 8.8, 1.05, 1], [13, -9, 9.4, 1.1, 2],
      [-13.4, -5, 8, 1, 2], [-13.2, 10.4, 6.4, 0.95, 1], [13.4, -3, 7.4, 0.95, 0], [13.2, 9.6, 5.6, 0.9, 2]].forEach(([x, z, h, s, tone]) => tallTree(b, x, z, { h, s, tone }));
    [[-5, 1], [0.6, 1.6], [2.4, -9], [-10.6, -6.6], [6.6, 10.6], [12, 6.4], [-1.6, 10.8], [-12.4, 6.6], [7.6, 0.4]].forEach(([x, z], i) => bush(b, x, z, { s: 0.9 + (i % 3) * 0.3, color: i % 2 ? LEAF : LEAF_DARK }));
    for (const [x, z] of [[0, 4.2], [3.2, 3], [-1.4, -8], [10.4, -6.4]]) { b.ico(x, 0.3, z, 0.6, 0.4, 0.5, '#8a8f8a'); }
    // Picnic clearing
    table(b, 5.6, 9.6, { w: 2.4, d: 1, h: 0.9 });
    bench(b, 5.6, 8.6, { w: 2.4 }); bench(b, 5.6, 10.6, { w: 2.4 });
    extra(b, 'walk-picnic', 5.2, 8.6, 0, 'sit');
    // A monkey on the rail and a hiker on the far bridge
    b.at(4.4, 5.56, -3.1, 0.6, () => { b.ball(0, 0.22, 0, 0.18, 0.24, 0.16, '#8a6a4a', { seg: 6 }); b.ball(0, 0.56, 0.04, 0.15, 0.15, 0.15, '#9a7a56', { seg: 6 }); b.box(0, 0.2, -0.3, 0.05, 0.05, 0.5, '#8a6a4a', { rx: 0.6 }); });
    const far = [(towers[1][0] + towers[2][0]) / 2, decks[1], (towers[1][2] + towers[2][2]) / 2];
    extra(b, 'walk-hiker', far[0] + 1.2, -1.2, 1.6, 'walk', { y: far[1] + 0.12, z: far[2] - 0.2 });
    signBoard(b, -4.6, 8.4, 'TRAIL', { y: 1.5, size: 0.26, board: '#5a4630', color: '#f0e2b8' });
    const mid = [(towers[0][0] + towers[1][0]) / 2, decks[0], (towers[0][2] + towers[1][2]) / 2];
    const heading = Math.atan2(towers[1][0] - towers[0][0], towers[1][2] - towers[0][2]);
    return {
      spots: [
        landmark('gate', /gate|ticket|entry|entrance|start|pay|guide|ranger/, -9.6, -1.4, -HALF),
        landmark('bridge', /bridge|walk|canopy|cross|suspend|rope/, mid[0], mid[2], heading, { y: mid[1] }),
        landmark('tower', /tower|lookout|view|top|bird|photo|selfie/, towers[2][0], towers[2][2] + 0.7, 0, { y: towers[2][1] }),
        landmark('trail', /trail|forest|floor|nature|monkey|feed|hike|jog/, 1.6, 7.4, HALF, { act: { pose: 'walk' } }),
        landmark('picnic', /picnic|rest|eat|snack|chill|relax/, 7.6, 8.4, -HALF, { act: { pose: 'sit', x: 6.2, z: 10.6, ry: PI, seat: 0.6 } }),
        landmark('people', /people|crowd|meet/, 0.6, 9.6, 0),
      ],
      crowd: [[2, 10.4, 0.4], [-1.2, 8.6, -0.5], [3.2, 8.4, 2.4], [-3.6, 9.8, 1.2], [-9.4, 0.6, 2], [-6.4, 4.6, 2.2], [9.4, 7, -1], [-0.4, 5.4, 0.6], [4.6, 5.6, 2.2], [11, 9.4, -0.6], [-10.6, 8.6, 1], [8.2, 11, 0.2]],
    };
  },
};

const statehouse = {
  mood: 'outdoor', accent: '#f2c14e',
  build(b) {
    ground(b, { w: 30, d: 26, color: '#528a55' });
    b.box(0, 0.04, 3.4, 15, 0.04, 16, '#d9d3c2');
    b.box(0, 0.045, 3.4, 4, 0.04, 16, '#c9a69a');
    // Main block
    b.box(0, 3.4, -11.2, 25, 6.8, 3.6, '#efe9da');
    b.box(0, 7, -11.2, 25.6, 0.5, 4.2, '#d9d1bc');
    for (const side of [-1, 1]) for (let i = 0; i < 2; i++) for (const y of [1.9, 4.7]) windowPane(b, side * (8.4 + i * 2.8), y, -9.38, { w: 1.3, h: 1.6, glass: '#7fa3b8', frame: '#cfc6ae' });
    b.cyl(0, 7.9, -11.2, 2.6, 1.4, '#e3dcc8', { seg: 12 });
    b.ball(0, 8.6, -11.2, 2.4, 1.9, 2.4, '#d6a83a', { seg: 10 });
    b.cyl(0, 10.9, -11.2, 0.08, 1.4, '#c9ced3', { seg: 4 });
    // Portico: landing, steps, columns, pediment
    b.box(0, 0.4, -7.2, 15, 0.8, 4.6, '#e3dcc8');
    for (let i = 0; i < 4; i++) b.box(0, 0.7 - i * 0.2 - 0.1, -4.7 + i * 0.42, 15 - i * 0.2, 0.2, 0.44, i % 2 ? '#d9d1bc' : '#e3dcc8');
    for (const x of [-6.4, -3.9, -1.5, 1.5, 3.9, 6.4]) column(b, x, -5.6, { h: 6.2, r: 0.38, color: '#f5f0e2' });
    b.at(0, 0.8, 0, 0, () => {
      b.box(0, 5.75, -7.2, 15.2, 0.7, 4.4, '#efe9da');
      b.cyl(0, 6.1 + 0.62, -5.3, 1.24, 0.5, '#efe9da', { seg: 3, rx: -HALF, sx: 6.9 });
      b.cyl(0, 6.1 + 0.6, -5.02, 0.9, 0.06, '#d9d1bc', { seg: 3, rx: -HALF, sx: 6.9 });
      b.cyl(0, 6.72, -4.96, 0.42, 0.06, '#d6a83a', { seg: 10, rx: HALF });
      sign(b, 0, 5.75, -4.98, 'STATE HOUSE', { size: 0.4, color: '#5a5340' });
      door(b, 0, -9.3, { w: 2.2, h: 3.8, color: '#5a4630', frame: '#d6a83a' });
      b.box(0, 0.03, -6.6, 2.6, 0.03, 5, '#a8323a');
    });
    b.box(0, 0.06, -3, 2.6, 0.03, 1.8, '#a8323a');
    // Podium and press
    b.box(0, 0.1, -1.2, 3.2, 0.2, 2.2, '#8a8f96');
    b.box(0, 0.85, -0.7, 1.1, 1.3, 0.6, '#5a4630');
    b.box(0, 1.53, -0.7, 1.3, 0.08, 0.8, '#7a5c3c', { rx: 0.2 });
    b.quad(0, 0.95, -0.39, 0.5, 0.5, '#d6a83a');
    for (const dx of [-0.22, 0, 0.22]) { b.cyl(dx, 1.78, -0.6, 0.02, 0.4, BLACK, { seg: 4, rx: 0.4 }); b.ball(dx, 1.97, -0.52, 0.05, 0.07, 0.05, '#3a3f46', { seg: 5 }); }
    for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) chair(b, -2.7 + i * 1.8, 3 + row * 1.7, { ry: PI, color: '#e9e4d4' });
    extra(b, 'state-press-1', -2.7, 3, PI, 'sit'); extra(b, 'state-press-2', 0.9, 4.7, PI, 'sit'); extra(b, 'state-press-3', 2.7, 3, PI, 'sit');
    b.at(4.8, 0, 1.6, -2.5, () => { for (const [dx, dz] of [[0, 0.3], [-0.26, -0.2], [0.26, -0.2]]) b.cyl(dx, 0.8, dz, 0.03, 1.6, BLACK, { seg: 4 }); b.box(0, 1.7, 0, 0.4, 0.3, 0.6, '#2a2d33'); });
    extra(b, 'state-camera', 5.3, 2.2, -2.5, 'work');
    for (const x of [-7, 7]) extra(b, `state-guard-${x}`, x * 0.9, -2.5, 0, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', hair: 'lowcut', fabric: 'plain' } });
    // Grounds
    flag(b, 9.6, 1.4, { h: 7.4, w: 2.4 });
    flag(b, -9.6, 1.4, { h: 6.4, w: 2, colors: ['#3f72c4', WHITE, '#d6a83a'] });
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i++) b.box(side * 8, 0.45, -1.6 + i * 2.6, 0.9, 0.8, 2.2, i % 2 ? LEAF : LEAF_DARK);
      lampPost(b, side * 6.6, 9.4, { light: side < 0 });
      b.box(side * 10.4, 1.4, 10.8, 1.6, 2.8, 1.6, '#efe9da'); b.box(side * 10.4, 2.9, 10.8, 2, 0.2, 2, '#3f5a6a');
      leafTree(b, side * 12.6, -5.4, { s: 1.05, tone: side < 0 ? 0 : 1 }); leafTree(b, side * 12.4, 5.6, { s: 0.9, tone: 2 });
    }
    fence(b, [-14, 12.4], [-2.6, 12.4], { h: 1.3, color: '#2f343a', gap: 1 }); fence(b, [2.6, 12.4], [14, 12.4], { h: 1.3, color: '#2f343a', gap: 1 });
    car(b, -11.2, 6.8, { ry: 0.1 });
    b.cyl(11.2, 0.25, 7.4, 1.5, 0.4, '#d9d3c2', { seg: 12 }); b.disc(11.2, 0.47, 7.4, 1.3, '#79c3df', { seg: 12, ...GLASS }); b.cyl(11.2, 0.8, 7.4, 0.16, 1.2, '#d9d3c2', { seg: 6 });
    return {
      spots: [
        landmark('podium', /podium|speech|address|press|rally|campaign|declare|announce/, 0, -1.5, 0, { y: 0.2, act: { pose: 'wave' } }),
        landmark('steps', /step|stair|protest|petition|photo|tour/, -4.4, -2.4, PI),
        landmark('office', /office|governor|door|inside|meeting|sign|bill|budget|cabinet|work|job/, 0, -7.6, PI, { y: 0.83 }),
        landmark('gardens', /garden|lawn|flag|gate|guard|fountain/, 9.6, 3.6, PI),
        landmark('people', /people|crowd|meet/, 4.2, 6.6, 0),
      ],
      crowd: [[2.4, 7.6, 0.4], [-0.8, 6.8, -0.5], [5.6, 4.6, 2.4], [-3.6, 7.4, 1.2], [-5.6, 1.6, 2.6], [5.6, -1.6, -2.4], [-2.4, 9.6, 0.6], [1.2, 10.2, 0.2], [-6.2, 5.4, 1.6], [6.4, 8.6, -0.6], [-4.6, -0.6, 2.2], [3.4, 0.4, 2.8]],
      spare: [[-6, 8], [6, 9], [-3, 10.4], [3.4, 9.8]],
    };
  },
};

/** Plain plaza for venue kinds that have no scene of their own. */
const generic = {
  mood: 'outdoor', accent: '#f2c14e',
  build(b, { label, accent }) {
    ground(b, { w: 28, d: 24, color: '#538553' });
    b.disc(0, 0.06, 0, 8.5, '#d1c197', { seg: 20 });
    b.disc(0, 0.07, 0, 3, '#dccfa8', { seg: 16 });
    b.cyl(0, 0.4, -0.4, 1.1, 0.8, '#8d7a66', { seg: 10 });
    b.ico(0, 1.5, -0.4, 0.7, 0.9, 0.7, accent);
    signBoard(b, 0, -7.4, String(label).slice(0, 12), { y: 3, size: 0.5 });
    bench(b, -5, 2, { ry: HALF, back: true }); bench(b, 5, 2, { ry: -HALF, back: true }); bench(b, 0, -5.4, { back: true });
    [[-10, -7, 1.1, 0], [10, -7.6, 1, 1], [-11, 5, 0.95, 2], [11, 6, 1.05, 0]].forEach(([x, z, s, tone]) => leafTree(b, x, z, { s, tone }));
    lampPost(b, -6.6, -5.6, { light: true }); lampPost(b, 6.6, -5.6);
    bush(b, -7.6, 7.6); bush(b, 7.8, 8.2, { s: 1.2 });
    return {
      spots: [landmark('centre', /centre|center|main|square/, 0, 3, 0), landmark('people', /people|crowd|meet/, 3, 5.4, 0), landmark('bench', /bench|sit|rest|chill/, -3.6, 2, HALF), landmark('board', /board|sign|notice|info/, 0, -5.6, PI)],
      crowd: [[2, 2, 0.4], [-2, 4, -0.5], [4, 0, 2.4], [-4, -1, 1.2], [0, 6.6, 0], [5.4, 4.6, -0.8], [-5.6, 5.4, 0.8], [2.4, -3, 2.8], [-2.6, -3.4, 2.4], [6.6, -1.6, -1.6], [-6.8, -2, 1.6], [0.4, 8.4, 0.2]],
    };
  },
};

export const SCENES = { park, market, beach, rooftop, polling, walk, statehouse, generic };
