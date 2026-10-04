/**
 * OWNER: scenes
 * Work and self-care venues: tech hub, office tower, gym, salon and radio station.
 * Scene definition format: see venues-outdoor.js.
 */
import { GLOW, GLASS } from './build.ts';
import {
  room, table, chair, stool, bench, sofa, counter, speaker, screen, plant, shelf, desk, laptop, rug, bottles, windowPane,
  door, sign, landmark, extra,
  WOOD, WOOD_DARK, WOOD_LIGHT, METAL, METAL_DARK, WHITE, BLACK, WARM,
} from './props.js';

const PI = Math.PI, HALF = Math.PI / 2;

function pendant(b, x, z, color = WARM, y = 4.2) {
  b.box(x, y + 0.9, z, 0.03, 1.5, 0.03, BLACK);
  b.cyl(x, y, z, 0.4, 0.3, '#2a2d33', { seg: 8, top: 0.4 });
  b.cyl(x, y - 0.16, z, 0.36, 0.03, color, { seg: 8, ...GLOW });
}

const hub = {
  mood: 'indoor', accent: '#3fae6a',
  build(b, { accent }) {
    room(b, { floor: '#cdb891', wall: '#ece8dc', side: '#e3dfd2', trim: '#b5ae9c' });
    b.box(0, 4.6, -9.94, 24, 0.5, 0.06, accent);
    b.box(-11.94, 4.6, 0, 0.06, 0.5, 20, accent);
    // Whiteboard wall
    b.box(-4.6, 2.6, -9.72, 5.6, 2.8, 0.1, METAL); b.quad(-4.6, 2.6, -9.66, 5.3, 2.5, '#f8f8f4');
    [[-6.4, 3.2, 1.4, '#3f72c4'], [-6, 2.8, 2, '#3f72c4'], [-6.2, 2.4, 1.6, '#c9423a'], [-3.4, 3.2, 1.2, '#2f8f55'], [-3.2, 2.2, 1.6, '#2a2d33']].forEach(([x, y, w, color]) => b.quad(x, y, -9.65, w, 0.08, color));
    b.cyl(-3.4, 2.7, -9.66, 0.5, 0.02, '#c9423a', { seg: 10, rx: HALF, open: true });
    [['#ffe07a', -5], ['#f2a6c8', -4.5], ['#b8f0c8', -2.6], ['#ffe07a', -2.2]].forEach(([color, x], i) => b.quad(x, 1.75 + (i % 2) * 0.1, -9.65, 0.36, 0.36, color));
    // Pitch stage with a screen
    b.box(6, 0.15, -8, 6.4, 0.3, 3.4, '#8a6644');
    screen(b, 6, 3, -9.7, { w: 5, h: 2.6, color: '#1f3a4a' });
    b.quad(4.6, 3.5, -9.62, 1.6, 0.16, '#7fe0a8', GLOW);
    for (let i = 0; i < 5; i++) b.quad(4.2 + i * 0.5, 2.3 + (i * i) * 0.05, -9.62, 0.34, 0.5 + i * i * 0.1, i === 4 ? '#ffe07a' : '#7fb8ff', GLOW);
    sign(b, 7.4, 3.6, -9.62, 'DEMO', { size: 0.26, color: WHITE, lit: true });
    b.box(4, 0.95, -7.4, 0.7, 1.3, 0.5, WOOD_DARK); laptop(b, 4, 1.6, -7.4, { ry: PI });
    extra(b, 'hub-founder', 6.6, -7.6, 0.2, 'wave', { y: 0.3, look: { outfit: 'hoodie', body: 'man', outfitColor: 'green' } });
    // Desks
    [[-5.4, -3.4], [-2.2, -3.4], [1, -3.4], [-5.4, 0.8], [-2.2, 0.8], [1, 0.8]].forEach(([x, z], i) => {
      desk(b, x, z, { color: i % 2 ? '#e9e2cf' : WOOD_LIGHT, seatColor: i % 3 === 0 ? accent : '#4d6f8f' });
      if (i % 2) b.cyl(x + 0.75, 1.13, z + 0.2, 0.09, 0.18, WHITE, { seg: 6 });
    });
    extra(b, 'hub-dev-1', -5.4, -2.45, PI, 'sit'); extra(b, 'hub-dev-2', 1, -2.45, PI, 'sit', { look: { outfit: 'hoodie', body: 'man' } });
    extra(b, 'hub-dev-3', -2.2, 1.75, PI, 'sit'); extra(b, 'hub-mentor', -4, 2.4, 2.4, 'stand');
    for (const [x, z] of [[-3.8, -3], [-0.6, -3], [-3.8, 1.2], [-0.6, 1.2]]) pendant(b, x, z);
    b.light(-2.2, 3.6, -1, '#ffe2b0', 20, 12);
    // Coffee corner on the left wall
    counter(b, -10.8, 4.4, { w: 5.6, d: 1.1, ry: HALF, color: '#3a4a45', top: WOOD_LIGHT, stripe: accent });
    b.box(-10.9, 1.8, 2.6, 0.7, 0.9, 0.8, '#2a2d33'); b.quad(-10.54, 1.9, 2.6, 0.3, 0.2, '#ffb070', { ry: HALF, ...GLOW });
    for (let i = 0; i < 4; i++) b.cyl(-10.7, 1.44, 3.6 + i * 0.3, 0.09, 0.18, WHITE, { seg: 6 });
    b.box(-10.8, 1.4, 5.6, 0.7, 0.06, 1, '#cfd6dc'); for (let i = 0; i < 6; i++) b.ball(-10.9 + (i % 2) * 0.24, 1.5, 5.3 + Math.floor(i / 2) * 0.28, 0.12, 0.11, 0.12, '#c98a3c', { seg: 5 });
    sign(b, -11.92, 3.2, 4.4, 'COFFEE', { size: 0.34, color: '#3a4a45', ry: HALF });
    stool(b, -9.4, 3.4, { h: 0.85 }); stool(b, -9.4, 5.4, { h: 0.85 });
    extra(b, 'hub-barista', -11.2, 3.6, HALF, 'work');
    // Bean-bag lounge
    rug(b, 7.4, 5.4, 5.6, 4.4, '#5d8f7a', { border: '#e9e2cf' });
    [[5.8, 4.4, '#e0822f'], [8.8, 4.2, '#3f72c4'], [7.6, 6.8, '#dd6fa0']].forEach(([x, z, color]) => { b.ball(x, 0.45, z, 0.75, 0.5, 0.75, color, { seg: 8 }); b.ball(x, 0.85, z - 0.35, 0.55, 0.4, 0.4, color, { seg: 7 }); });
    table(b, 7.2, 5.4, { round: true, w: 1, h: 0.5 });
    extra(b, 'hub-lounger', 8.8, 4.3, -0.6, 'sit', { seat: 0.62 });
    // ATM, server rack, plants
    b.at(10.6, 0, -8.9, 0, () => { b.box(0, 1.1, 0, 1.1, 2.2, 0.9, '#3a4a6a'); b.quad(0, 1.5, 0.46, 0.7, 0.55, '#9fd8ff', GLOW); b.box(0, 1, 0.5, 0.7, 0.1, 0.12, METAL); sign(b, 0, 2, 0.46, 'ATM', { size: 0.16, color: WHITE }); });
    b.box(-10.9, 1.5, -8.6, 1.2, 3, 1.2, '#2a2d33');
    for (let i = 0; i < 8; i++) b.quad(-10.29, 0.6 + i * 0.3, -8.9 + (i % 3) * 0.3, 0.14, 0.08, i % 3 ? '#58d68a' : '#ffb070', { ry: HALF, ...GLOW });
    plant(b, -8.6, -8.9, { s: 1.3 }); plant(b, 10.6, 8.6, { s: 1.4 }); plant(b, 2.4, -8.9, { s: 1.1 });
    return {
      spots: [
        landmark('desks', /desk|hack|code|project|laptop|wi-?fi|freelance|gig|work|job/, 2.8, 1.8, -HALF, { act: { pose: 'sit', x: 1, z: 1.75, ry: PI, seat: 0.6 } }),
        landmark('whiteboard', /meetup|whiteboard|board|learn|class|talk|workshop|founder|gist/, -4.6, -7.4, PI),
        landmark('pitch', /pitch|stage|startup|demo|present|investor|hackathon/, 5.4, -7, 0, { y: 0.3, act: { pose: 'wave' }, approach: [5.4, -5.7] }),
        landmark('coffee', /coffee|puff|snack|tea|kitchen|cafe/, -8.2, 4.4, -HALF),
        landmark('atm', /atm|cash|bank/, 10.6, -7.2, PI, { act: { pose: 'work' } }),
        landmark('lounge', /lounge|chill|bean|relax|rest/, 6.4, 6.6, 0.6),
        landmark('people', /people|crowd|meet/, -1.4, 5.6, 0),
      ],
      raised: [{ rect: [2.8, -9.7, 9.2, -6.3], y: 0.3, lip: 0.3 }],
      crowd: [[0.6, 6.6, 0.4], [-3.4, 6.2, -0.5], [2.4, 4.4, 2.4], [-6.4, 5.4, 1.2], [3.4, -5.6, PI], [-7.6, -5.6, 2.6], [8.2, -4.8, PI], [-0.6, 8.4, 0.2], [3.6, 8, -0.4], [-7.4, 0.4, 1.6], [3.8, -1.2, -1.2], [-5.4, 8.4, 0.8]],
    };
  },
};

const office = {
  mood: 'indoor', accent: '#3f72c4',
  build(b, { accent }) {
    room(b, { floor: '#dcd8d0', wall: '#cfc8b8', side: '#c2ccd4', trim: '#8f8a7e', h: 6 });
    b.box(0, 0.056, 0, 21, 0.02, 17, '#cfcabf'); b.box(0, 0.06, 0, 20.4, 0.02, 16.4, '#e6e2da');
    // Tall windows with a skyline on the left wall
    for (let i = 0; i < 4; i++) {
      const z = -7 + i * 4.6;
      b.box(-11.92, 3.1, z, 0.1, 5, 3.6, '#8f8a7e');
      b.quad(-11.84, 3.1, z, 3.3, 4.7, '#bfe0f2', { ry: HALF, ...GLOW });
      for (let t = 0; t < 3; t++) b.quad(-11.83, 1.2 + ((i + t) % 3) * 0.5, z - 1.1 + t * 1.1, 0.8, 1 + ((i + t) % 3), ['#8fb0c9', '#7a9ab5', '#a3c0d6'][t], { ry: HALF, ...GLOW });
      b.box(-11.82, 3.1, z, 0.04, 5, 0.08, '#8f8a7e');
    }
    // Lifts
    for (const x of [-8.4, -5.4]) {
      b.box(x, 1.9, -9.74, 2.4, 3.8, 0.12, '#6f767e');
      for (const side of [-1, 1]) b.box(x + side * 0.56, 1.8, -9.66, 1.06, 3.5, 0.06, '#b9c0c6');
      b.box(x, 3.95, -9.66, 0.7, 0.22, 0.04, '#ffb070', GLOW);
    }
    b.box(-6.9, 1.7, -9.68, 0.2, 0.36, 0.06, '#2a2d33'); b.quad(-6.9, 1.76, -9.64, 0.08, 0.08, '#58d68a', GLOW);
    sign(b, -6.9, 4.6, -9.68, 'LIFTS', { size: 0.26, color: '#4a4a44' });
    // Reception with a logo wall
    b.box(3, 3, -9.7, 8, 4.6, 0.16, '#2d3f5c');
    sign(b, 3, 4, -9.6, 'TOWERS', { size: 0.6, color: '#f4e6b8', lit: true });
    b.box(3, 3.2, -9.6, 5.4, 0.06, 0.04, accent, GLOW);
    for (let i = 0; i < 3; i++) b.box(0.6 + i * 0.4, 2.2 + i * 0.3, -9.6, 0.3, 0.9 + i * 0.6, 0.06, '#d6a83a');
    counter(b, 3, -6.4, { w: 6, d: 1.1, color: '#e9e4d8', top: '#3a3f46', stripe: accent });
    laptop(b, 2, 1.36, -6.5, { ry: PI }); b.box(4.6, 1.5, -6.4, 0.5, 0.3, 0.3, '#2a2d33');
    extra(b, 'office-reception', 2.6, -7.6, 0, 'work', { look: { outfit: 'office', body: 'woman', outfitColor: 'navy' } });
    // Turnstiles and security
    for (let i = 0; i < 3; i++) { b.box(-8.6 + i * 1.5, 0.55, -5.4, 0.3, 1.1, 1.4, '#8b9096'); b.box(-8.6 + i * 1.5, 1.12, -4.9, 0.2, 0.04, 0.2, i === 1 ? '#ff6a5a' : '#58d68a', GLOW); if (i < 2) b.box(-7.85 + i * 1.5, 0.8, -5.4, 1.2, 0.06, 0.06, METAL); }
    extra(b, 'office-guard', -4.6, -5.2, 0.5, 'stand', { look: { body: 'man', outfit: 'office', outfitColor: 'navy', bottomsColor: 'navy', hair: 'lowcut' } });
    // Waiting lounge
    rug(b, -7.4, 3.6, 5, 4.4, '#55657a', { border: '#d9d4c6' });
    sofa(b, -9.6, 3.6, { w: 3.8, ry: HALF, color: '#3a4658', cushion: '#55657a' });
    sofa(b, -7, 6.6, { w: 3, ry: PI, color: '#3a4658', cushion: '#55657a' });
    table(b, -7, 3.6, { w: 1.6, d: 1, h: 0.5, color: '#2a2d33', leg: METAL });
    b.box(-7, 0.54, 3.6, 0.6, 0.04, 0.44, WHITE);
    plant(b, -10.4, 0.4, { s: 1.5, pot: '#e9e4d8' }); plant(b, -10.4, 6.9, { s: 1.3, pot: '#e9e4d8' });
    extra(b, 'office-visitor', -9.5, 4.2, HALF, 'sit', { seat: 0.69 });
    b.cyl(-3.4, 0.6, -9.1, 0.3, 1.2, WHITE, { seg: 8 }); b.cyl(-3.4, 1.5, -9.1, 0.26, 0.6, '#bfe3f2', { seg: 8, ...GLASS });
    // Open-plan desks
    [[4.2, 1.6], [7.6, 1.6], [4.2, 5.6], [7.6, 5.6]].forEach(([x, z], i) => {
      desk(b, x, z, { color: '#e9e4d8', seatColor: '#2d3f5c' });
      b.box(x + 1.5, 0.8, z + 0.2, 0.08, 1.6, 2.4, i % 2 ? accent : '#b9c0c6');
    });
    b.box(2.5, 0.8, 1.8, 0.08, 1.6, 2.4, '#b9c0c6'); b.box(2.5, 0.8, 5.8, 0.08, 1.6, 2.4, accent);
    extra(b, 'office-worker-1', 4.2, 2.55, PI, 'sit'); extra(b, 'office-worker-2', 7.6, 6.55, PI, 'sit', { look: { outfit: 'office' } });
    b.box(10.4, 0.6, 8.4, 1.2, 1.2, 1, '#e9e4d8'); b.box(10.4, 1.26, 8.4, 1, 0.12, 0.8, '#3a3f46');
    // Meeting table
    b.box(8.6, 1, -2.6, 3.6, 0.08, 1.8, '#bfe3ef', GLASS); for (const sx of [-1.5, 1.5]) b.box(8.6 + sx, 0.5, -2.6, 0.1, 1, 1.4, METAL);
    for (const [dx, dz, ry] of [[-1, -1.3, 0], [1, -1.3, 0], [-1, 1.3, PI], [1, 1.3, PI]]) chair(b, 8.6 + dx, -2.6 + dz, { ry, color: '#2d3f5c' });
    extra(b, 'office-meeting', 9.6, -3.9, 0, 'sit', { look: { outfit: 'office' } });
    b.box(10.9, 2.9, -9.7, 1.6, 1, 0.08, BLACK); b.quad(10.9, 2.9, -9.65, 1.4, 0.8, '#9fd8ff', GLOW);
    b.light(3, 3.6, -5, '#fff2d0', 22, 12);
    return {
      spots: [
        landmark('reception', /reception|lobby|front|visitor|security|gate|sign in/, 3, -4.6, PI),
        landmark('desks', /desk|work|shift|job|office|task|report|computer/, 5.9, 3.4, HALF, { act: { pose: 'sit', x: 7.6, z: 2.55, ry: PI, seat: 0.6 } }),
        landmark('lifts', /lift|elevator|floor|upstairs|boss|hr|promotion|interview/, -6.9, -7.6, PI),
        landmark('meeting', /meeting|board|conference|present|client/, 6, -2.6, HALF, { act: { pose: 'sit', x: 7.6, z: -1.3, ry: PI, seat: 0.6 } }),
        landmark('lounge', /lounge|wait|sofa|coffee|break|water|gist/, -5.4, 3.6, -HALF, { act: { pose: 'sit', x: -7.4, z: 6.5, ry: PI, seat: 0.69 } }),
        landmark('people', /people|crowd|meet/, 0, 2.6, 0),
      ],
      crowd: [[1.4, 4.2, 0.4], [-1.8, 3.6, -0.5], [0.6, 0.4, 2.4], [-2.6, -2.4, 1.2], [0.4, -4.4, PI], [5.6, -4.6, PI], [-3.4, 6.6, 0.6], [1.2, 7.6, 0.2], [-1.4, -6.4, 2.6], [-4.4, 0.6, 1.6], [2.2, -1.6, -1.2], [-0.4, 9, 0.3]],
    };
  },
};

function treadmill(b, x, z, ry) {
  b.at(x, 0, z, ry, () => {
    b.box(0, 0.2, 0, 1, 0.3, 2.4, '#2a2d33'); b.box(0, 0.37, 0, 0.8, 0.04, 2.2, '#4a4f58');
    for (const side of [-1, 1]) { b.box(side * 0.46, 0.95, 0.95, 0.07, 1.5, 0.07, METAL); b.box(side * 0.46, 1.5, 0.5, 0.06, 0.06, 0.9, METAL); }
    b.box(0, 1.75, 1, 0.9, 0.5, 0.12, '#2a2d33', { rx: 0.3 }); b.quad(0, 1.76, 0.93, 0.6, 0.3, '#7fe0a8', { ry: PI, rx: -0.3, ...GLOW });
  });
}
function barbell(b, x, y, z, { w = 2.2, color = '#c9423a', ry = 0 } = {}) {
  b.at(x, y, z, ry, () => {
    b.cyl(0, 0, 0, 0.035, w, METAL, { seg: 5, rz: HALF });
    for (const side of [-1, 1]) { b.cyl(side * (w / 2 - 0.25), 0, 0, 0.34, 0.1, color, { seg: 9, rz: HALF }); b.cyl(side * (w / 2 - 0.38), 0, 0, 0.26, 0.08, '#2a2d33', { seg: 9, rz: HALF }); }
  });
}

const gym = {
  mood: 'indoor', accent: '#e9614b',
  build(b, { accent }) {
    room(b, { floor: '#4a515c', wall: '#d9d4c8', side: '#cfcabd', trim: '#2a2d33' });
    b.box(0, 4.7, -9.94, 24, 0.6, 0.06, accent); b.box(0, 4.1, -9.94, 24, 0.14, 0.06, '#2a2d33');
    sign(b, 6.4, 3.3, -9.9, 'NO PAIN', { size: 0.44, color: '#2a2d33' });
    // Mirror wall on the left
    for (let i = 0; i < 4; i++) { b.box(-11.92, 2.4, -6.6 + i * 3.6, 0.08, 3.6, 3.3, '#8b9096'); b.quad(-11.86, 2.4, -6.6 + i * 3.6, 3.1, 3.4, '#cfe6ee', { ry: HALF }); }
    // Treadmills facing the mirrors
    for (const z of [-6.6, -3.8, -1]) treadmill(b, -9.4, z, -HALF);
    extra(b, 'gym-runner', -9.2, -3.8, -HALF, 'walk', { y: 0.39, look: { outfit: 'casual', outfitColor: 'teal' } });
    b.at(-9.4, 0, 2.4, -HALF, () => {
      b.box(0, 0.5, 0, 0.5, 0.2, 1.6, '#2a2d33'); b.cyl(0, 0.5, -0.5, 0.42, 0.08, METAL, { seg: 9, rz: HALF }); b.cyl(0, 0.5, 0.6, 0.42, 0.08, METAL, { seg: 9, rz: HALF });
      b.box(0, 1.1, -0.2, 0.4, 0.1, 0.5, accent); b.box(0, 1.2, 0.7, 0.6, 0.06, 0.06, METAL); b.box(0, 0.9, 0.65, 0.06, 0.7, 0.06, METAL);
    });
    // Free weights: rack, bench press, squat rack
    b.at(0.6, 0, -9.1, 0, () => {
      for (const y of [0.6, 1.3]) { b.box(0, y, 0, 5.2, 0.08, 0.7, METAL_DARK, { rx: 0.2 }); for (let i = 0; i < 6; i++) { const size = 0.12 + i * 0.022; b.cyl(-2.2 + i * 0.88, y + 0.2, 0.05, size, 0.5, i % 2 ? '#2a2d33' : accent, { seg: 7, rz: HALF }); } }
      for (const side of [-1, 1]) b.box(side * 2.6, 0.8, 0, 0.1, 1.6, 0.8, METAL_DARK);
    });
    b.at(-3.2, 0, -5, 0, () => {
      b.box(0, 0.55, 0.3, 0.7, 0.14, 2.4, '#2a2d33'); for (const sz of [-0.7, 1.2]) b.box(0, 0.26, sz, 0.5, 0.5, 0.1, METAL);
      for (const side of [-1, 1]) b.box(side * 0.8, 0.8, -0.6, 0.08, 1.6, 0.08, METAL);
      barbell(b, 0, 1.55, -0.6, { w: 2.6 });
    });
    extra(b, 'gym-spotter', -3.2, -6.4, 0, 'work');
    b.at(3.4, 0, -5.2, 0, () => {
      for (const sx of [-1, 1]) for (const sz of [-0.7, 0.7]) b.box(sx * 1, 1.5, sz, 0.1, 3, 0.1, METAL_DARK);
      b.box(0, 3, -0.7, 2.1, 0.1, 0.1, METAL_DARK); b.box(0, 3, 0.7, 2.1, 0.1, 0.1, accent);
      for (const sx of [-1, 1]) b.box(sx * 1, 3, 0, 0.1, 0.1, 1.5, METAL_DARK);
      barbell(b, 0, 2, 0.6, { w: 2.8, color: '#3f72c4' });
      b.box(0, 0.05, 0, 2.6, 0.06, 2, '#3a3f46');
    });
    for (let i = 0; i < 4; i++) { b.ball(6.6 + i * 0.7, 0.24, -8.8, 0.22, 0.22, 0.22, i % 2 ? accent : '#2a2d33', { seg: 6 }); b.box(6.6 + i * 0.7, 0.5, -8.8, 0.24, 0.1, 0.07, METAL); }
    // Mats
    [['#39a9a6', 4.2], ['#dd6fa0', 6.4], ['#f2c14e', 8.6]].forEach(([color, x]) => b.box(x, 0.085, 4.6, 1.5, 0.05, 3.6, color));
    b.ball(10.4, 0.6, 7.6, 0.6, 0.6, 0.6, '#3f72c4', { seg: 9 });
    extra(b, 'gym-yoga', 6.4, 4.2, 0, 'sit', { seat: 0.05, look: { body: 'woman', outfit: 'casual', hair: 'bun' } });
    extra(b, 'gym-trainer', 5.4, 1.4, 0.6, 'wave', { look: { outfit: 'casual', outfitColor: 'red' } });
    // Punching bag
    b.box(9.6, 2.1, -2.4, 0.14, 4.2, 0.14, METAL_DARK); b.box(8.9, 4.2, -2.4, 1.6, 0.14, 0.14, METAL_DARK);
    b.box(8.2, 3.8, -2.4, 0.03, 0.8, 0.03, METAL); b.cyl(8.2, 2.5, -2.4, 0.42, 1.9, '#a8323a', { seg: 9 });
    b.box(9.6, 0.1, -2.4, 1.2, 0.2, 1.2, METAL_DARK);
    extra(b, 'gym-boxer', 7.2, -1.8, HALF + 0.4, 'dance', { look: { outfit: 'chill', body: 'man' } });
    // Front desk, lockers, water
    counter(b, -8.4, 7.4, { w: 4, d: 1, color: '#2a2d33', top: accent });
    sign(b, -8.4, 0.75, 7.92, 'GYM', { size: 0.36, color: WHITE });
    extra(b, 'gym-desk', -8.4, 6.4, 0, 'stand');
    for (let i = 0; i < 4; i++) { b.box(8 + i * 0.9, 1.4, -9.5, 0.84, 2.8, 0.7, i % 2 ? '#3f72c4' : '#55657a'); b.box(8.3 + i * 0.9, 1.5, -9.13, 0.06, 0.2, 0.04, METAL); }
    b.cyl(-5.6, 0.6, 8.6, 0.3, 1.2, WHITE, { seg: 8 }); b.cyl(-5.6, 1.5, 8.6, 0.26, 0.6, '#bfe3f2', { seg: 8, ...GLASS });
    bench(b, 0.6, 8.6, { w: 3 });
    b.light(0, 4.4, -2, '#f2f6ff', 20, 14);
    return {
      spots: [
        landmark('treadmills', /treadmill|run|cardio|jog|cycle|bike/, -7.2, -1, -HALF, { act: { pose: 'walk', x: -9.2, z: -1, y: 0.39, ry: -HALF } }),
        landmark('weights', /weight|lift|bench|dumbbell|strength|squat|press|barbell|muscle/, 0.6, -6.6, PI, { act: { pose: 'work' } }),
        landmark('mats', /mat|yoga|stretch|aerobic|class|zumba|dance|floor/, 8.6, 4.6, 0, { act: { pose: 'dance' } }),
        landmark('bag', /bag|box|punch|spar|fight/, 7, -3.4, HALF, { act: { pose: 'dance' } }),
        landmark('desk', /reception|front|desk|member|trainer|coach|smoothie|juice|work|job/, -8.4, 8.9, PI),
        landmark('people', /people|crowd|meet/, 0, 4.4, 0),
      ],
      crowd: [[1.6, 2.6, 0.4], [-2.2, 3.4, -0.5], [-0.6, 0.4, 2.4], [-4.6, 1.6, 1.2], [1.6, 6.4, 0.2], [-2.8, 6.4, 0.6], [6.4, 0.6, -2], [-0.4, -3.6, PI], [-6.6, -5, -HALF], [9.4, 1.6, -1], [-5.6, 4.6, 1.6], [3.2, 8.6, 0]],
    };
  },
};

function salonChair(b, x, z, ry, color) {
  b.at(x, 0, z, ry, () => {
    b.cyl(0, 0.06, 0, 0.5, 0.1, METAL, { seg: 9 }); b.cyl(0, 0.35, 0, 0.1, 0.5, METAL, { seg: 6 });
    b.box(0, 0.65, 0, 0.9, 0.2, 0.9, color); b.box(0, 1.25, -0.4, 0.9, 1.1, 0.16, color);
    for (const side of [-1, 1]) b.box(side * 0.5, 0.95, 0.05, 0.1, 0.1, 0.8, '#2a2d33');
    b.box(0, 0.3, 0.6, 0.6, 0.06, 0.3, METAL);
  });
}

const salon = {
  mood: 'indoor', accent: '#dd6fa0',
  build(b, { accent }) {
    room(b, { floor: '#f0dccb', wall: '#f2bdb8', side: '#e8aeac', trim: '#a8687a' });
    for (let i = 0; i < 6; i++) for (let j = 0; j < 5; j++) if ((i + j) % 2) b.box(-10 + i * 4, 0.056, -8 + j * 4, 4, 0.02, 4, '#e3c3b4');
    sign(b, -1.4, 4.9, -9.92, 'SALON', { size: 0.5, color: accent, lit: true });
    // Styling stations
    [-6, -1.4, 3.2].forEach((x, i) => {
      b.box(x, 2.6, -9.76, 2, 2.6, 0.1, '#d6a83a'); b.quad(x, 2.6, -9.7, 1.76, 2.36, '#d3e9f0');
      for (const side of [-1, 1]) for (let k = 0; k < 4; k++) b.box(x + side * 1.12, 1.6 + k * 0.66, -9.72, 0.14, 0.14, 0.06, WARM, GLOW);
      b.box(x, 1.2, -9.5, 2.2, 0.08, 0.6, WHITE); bottles(b, x, 1.24, -9.5, { n: 4, gap: 0.36, colors: [accent, '#39a9a6', '#f2c14e', '#8055c2'] });
      salonChair(b, x, -7.4, PI, i % 2 ? '#3a3f46' : '#7a3f5c');
    });
    extra(b, 'salon-client', -6, -7.4, PI, 'sit', { seat: 0.75, look: { body: 'woman', hair: 'long' } });
    extra(b, 'salon-stylist', -5.2, -6.4, PI + 0.6, 'work', { look: { body: 'woman', hair: 'braids', outfit: 'casual', outfitColor: 'pink' } });
    extra(b, 'salon-barber', 4.2, -6.6, PI - 0.5, 'work', { look: { body: 'man', hair: 'lowcut' } });
    extra(b, 'salon-client-2', 3.2, -7.4, PI, 'sit', { seat: 0.75, look: { body: 'man', hair: 'afro' } });
    // Hood dryers on the left
    [-2.4, 1].forEach((z) => {
      chair(b, -10.6, z, { ry: HALF, color: '#7a3f5c' });
      b.box(-11.4, 1.6, z, 0.1, 3.2, 0.1, METAL); b.box(-11, 3.1, z, 0.9, 0.1, 0.1, METAL);
      b.ball(-10.55, 2.75, z, 0.5, 0.46, 0.5, '#e9e4d8', { seg: 8 }); b.cyl(-10.55, 2.5, z, 0.44, 0.06, '#f2a6c8', { seg: 8, ...GLOW });
    });
    extra(b, 'salon-dryer', -10.55, -2.4, HALF, 'sit', { look: { body: 'woman', hair: 'bald' } });
    // Wash basin with a reclined chair
    b.box(9, 0.6, -9.2, 1.6, 1.2, 1, WHITE); b.cyl(9, 1.2, -9, 0.5, 0.2, '#2a2d33', { seg: 9, top: 1.2 }); b.cyl(9, 1.32, -9, 0.52, 0.02, '#9fd0e6', { seg: 9 });
    b.cyl(9, 1.6, -9.5, 0.03, 0.5, METAL, { seg: 4 });
    b.at(9, 0, -7.7, PI, () => { b.box(0, 0.6, 0, 0.9, 0.2, 1, '#3a3f46'); b.box(0, 1, 0.6, 0.9, 0.16, 0.9, '#3a3f46', { rx: -0.9 }); b.cyl(0, 0.25, 0, 0.12, 0.5, METAL, { seg: 6 }); });
    // Nail table
    table(b, 3.6, 2.6, { w: 1.8, d: 0.9, h: 0.95, color: WHITE, leg: '#d6a83a' });
    chair(b, 3.6, 1.6, { color: accent }); chair(b, 3.6, 3.6, { ry: PI, color: '#7a3f5c' });
    for (let i = 0; i < 5; i++) b.cyl(3 + i * 0.16, 1.02, 2.3, 0.04, 0.14, ['#c9423a', accent, '#8055c2', '#f2c14e', '#39a9a6'][i], { seg: 5 });
    b.cyl(4.3, 1.2, 2.6, 0.03, 0.4, '#d6a83a', { seg: 4 }); b.ball(4.3, 1.44, 2.6, 0.12, 0.08, 0.12, WARM, { seg: 6, ...GLOW });
    extra(b, 'salon-nails', 3.6, 1.6, 0, 'sit', { look: { body: 'woman', hair: 'bun' } });
    // Reception, waiting bench, products
    counter(b, 8.2, 5.6, { w: 3, d: 1, ry: -HALF, color: '#7a3f5c', top: WHITE, stripe: '#d6a83a' });
    b.box(8.2, 1.5, 5.2, 0.4, 0.3, 0.5, '#2a2d33');
    extra(b, 'salon-owner', 9.2, 5.6, -HALF, 'wave', { look: { body: 'woman', outfit: 'owambe', hair: 'gele', fabric: 'ankara', outfitColor: 'pink' } });
    bench(b, -7, 7.6, { w: 4, back: true, color: '#d9b0b0', leg: '#b58a8a', ry: PI });
    table(b, -3.8, 7.4, { round: true, w: 1, h: 0.6, color: WHITE });
    b.box(-3.8, 0.64, 7.4, 0.5, 0.04, 0.36, accent);
    extra(b, 'salon-waiting', -7.6, 7.6, PI, 'sit');
    shelf(b, -11.6, 5.6, { ry: HALF, w: 3.4, h: 3.4, rows: 4, per: 7, color: WHITE, items: [accent, '#39a9a6', '#f2c14e', '#8055c2', '#e9e4d8'] });
    [[8.2, '#c98a5c'], [10, '#7a4a2f']].forEach(([x, tone], i) => { b.box(x, 3.4, -9.74, 1.3, 1.7, 0.06, WHITE); b.quad(x, 3.3, -9.7, 1, 1.2, i ? '#f2d0b8' : '#d0e4f2'); b.ball(x, 3.3, -9.68, 0.26, 0.3, 0.02, tone, { seg: 7 }); b.ball(x, 3.55, -9.67, 0.36, 0.3, 0.02, '#1c1917', { seg: 7 }); });
    rug(b, 0, 0.6, 4.4, 3, accent, { border: WHITE });
    plant(b, 10.6, 9, { s: 1.2, pot: WHITE }); plant(b, -10.8, -8.6, { s: 1.1, pot: WHITE });
    b.light(0, 4.4, -4, '#ffe6ea', 20, 14);
    return {
      spots: [
        landmark('chair', /chair|style|hair|braid|cut|barb|weave|wig|fix|relax|make|shave/, -1.4, -5.6, PI, { act: { pose: 'sit', x: -1.4, z: -7.4, ry: PI, seat: 0.75 } }),
        landmark('dryer', /dryer|dry|hood|steam|treat/, -8.6, 1, -HALF, { act: { pose: 'sit', x: -10.55, z: 1, ry: HALF, seat: 0.6 } }),
        landmark('wash', /wash|basin|shampoo|rinse/, 7.2, -7.4, HALF),
        landmark('nails', /nail|manicure|pedicure|polish/, 5.4, 3.6, -HALF, { act: { pose: 'sit', x: 3.6, z: 3.6, ry: PI, seat: 0.6 } }),
        landmark('reception', /reception|front|pay|book|gist|gossip|work|job|learn|mama/, 6.6, 5.6, HALF),
        landmark('people', /people|crowd|meet/, 0, 5.4, 0),
      ],
      crowd: [[1.4, 6.6, 0.4], [-1.6, 4.4, -0.5], [0.4, 0.4, 2.4], [-3.4, 1.6, 1.2], [-3.4, -4.6, PI], [1.2, -4.6, PI], [6.6, -2.6, -1.2], [-7.4, 3.8, 1.6], [5.6, 8, -0.2], [-5.6, -1.6, 1.8], [7.6, 1, -1.4], [2.4, 8.6, 0.2]],
    };
  },
};

function boomMic(b, x, z, ry) {
  b.at(x, 1.1, z, ry, () => {
    b.cyl(0, 0.3, 0, 0.03, 0.6, METAL_DARK, { seg: 4 }); b.box(0, 0.68, 0.3, 0.04, 0.04, 0.8, METAL_DARK, { rx: -0.35 });
    b.cyl(0, 0.72, 0.66, 0.08, 0.26, '#2a2d33', { seg: 6 }); b.ball(0, 0.58, 0.66, 0.1, 0.1, 0.1, '#8b9096', { seg: 6 });
  });
}

const radio = {
  mood: 'indoor', accent: '#ff5a4a',
  build(b, { accent }) {
    room(b, { floor: '#4f4a60', wall: '#5d5674', side: '#544e6a', trim: '#2f2b3d' });
    // Acoustic foam
    for (let row = 0; row < 3; row++) for (let col = 0; col < 9; col++) if ((row + col) % 2) b.box(-2.2 + col * 1.2, 1.5 + row * 1.2, -9.86, 1.1, 1.1, 0.22, col % 3 ? '#3d3850' : '#48425e');
    for (let row = 0; row < 3; row++) for (let col = 0; col < 5; col++) if ((row + col) % 2 === 0) b.box(-11.86, 1.5 + row * 1.2, 2.6 + col * 1.2, 0.22, 1.1, 1.1, '#3d3850');
    // ON AIR
    b.box(2.6, 4.9, -9.76, 3.6, 0.9, 0.2, '#2a1a1c'); b.quad(2.6, 4.9, -9.65, 3.4, 0.7, '#7a1f1f', GLOW);
    sign(b, 2.6, 4.9, -9.64, 'ON AIR', { size: 0.4, color: '#ffb0a0', lit: true });
    sign(b, 8.6, 4.8, -9.9, '99.9 FM', { size: 0.4, color: '#f4e6b8', lit: true });
    // Studio desk
    b.box(1.6, 1.05, -3.2, 5.6, 0.12, 2.2, '#3a2f3d'); b.cyl(1.6, 1.05, -2.1, 2.8, 0.12, '#3a2f3d', { seg: 14, sz: 0.5 });
    b.box(1.6, 0.5, -3.2, 4.8, 1, 1.4, '#2a2330');
    b.box(1.6, 1.2, -3.6, 1.8, 0.16, 0.9, '#2a2d33', { rx: 0.2 });
    for (let i = 0; i < 8; i++) b.box(0.9 + i * 0.2, 1.31 + (i % 3) * 0.02, -3.6 + (i % 3) * 0.14, 0.06, 0.05, 0.14, i % 2 ? '#58d68a' : accent, GLOW);
    for (const dx of [-1.9, 1.9]) screen(b, 1.6 + dx, 1.75, -3.9, { w: 1, h: 0.66, color: '#7fd1e8', ry: PI + (dx > 0 ? 0.4 : -0.4), stand: false });
    boomMic(b, 0.6, -3.4, PI); boomMic(b, 0.2, -2.2, 0.3); boomMic(b, 3, -2.2, -0.3);
    chair(b, 1.6, -4.9, { color: '#2a2d33' }); chair(b, 0.2, -0.6, { ry: PI, color: '#7a3f5c' }); chair(b, 3, -0.6, { ry: PI, color: '#7a3f5c' });
    extra(b, 'radio-host', 1.6, -4.9, 0, 'sit', { look: { outfit: 'casual', hair: 'locs', body: 'man' } });
    extra(b, 'radio-guest', 3, -0.6, PI, 'sit');
    rug(b, 1.6, -2.6, 8, 6.4, '#6a3f5a', { border: '#2f2b3d' });
    // Control room behind glass
    b.box(-6, 0.5, -6.6, 0.2, 1, 6.4, '#3d3850'); b.box(-6, 2.2, -6.6, 0.08, 2.4, 6.4, '#bfe3ef', GLASS); b.box(-6, 3.5, -6.6, 0.2, 0.2, 6.4, '#3d3850');
    b.box(-6, 2, -3.4, 0.24, 4, 0.24, '#3d3850');
    table(b, -7.6, -6.6, { w: 4.4, d: 1.2, ry: HALF, color: '#2a2330' });
    b.box(-7.6, 1.16, -6.6, 0.9, 0.12, 3.6, '#2a2d33');
    for (let i = 0; i < 10; i++) b.box(-7.6 + (i % 2) * 0.3 - 0.15, 1.24, -8.2 + i * 0.36, 0.08, 0.05, 0.14, ['#58d68a', '#ffd34d', accent][i % 3], GLOW);
    b.box(-10.9, 1.6, -8.4, 1.2, 3.2, 1.6, '#1f1b2a');
    for (let i = 0; i < 9; i++) b.quad(-10.28, 0.6 + i * 0.3, -8.8 + (i % 3) * 0.4, 0.2, 0.1, i % 2 ? '#58d68a' : '#7fb8ff', { ry: HALF, ...GLOW });
    chair(b, -8.9, -6.6, { ry: HALF, color: '#2a2d33' });
    extra(b, 'radio-producer', -8.9, -6.6, HALF, 'sit', { look: { outfit: 'hoodie', body: 'man' } });
    // News booth
    table(b, 8.4, -6.6, { w: 2.4, d: 1.1, color: '#3a2f3d' }); boomMic(b, 8.4, -6.9, 0);
    b.box(8.9, 1.07, -6.4, 0.5, 0.03, 0.7, WHITE); b.box(8.4, 0.6, -6.02, 2.4, 0.9, 0.03, accent);
    sign(b, 8.4, 0.62, -6, 'NEWS', { size: 0.3, color: WHITE });
    chair(b, 8.4, -7.7, { color: '#2a2d33' });
    // Lounge, records, plants
    sofa(b, 8.6, 5, { w: 4, ry: -HALF, color: '#7a5c8e', cushion: '#9478a8' });
    table(b, 6.4, 5, { round: true, w: 1.2, h: 0.55, color: '#2a2330' });
    b.cyl(6.4, 0.66, 5, 0.1, 0.16, WHITE, { seg: 6 });
    extra(b, 'radio-waiting', 8.5, 5.8, -HALF, 'sit', { seat: 0.69 });
    shelf(b, -11.6, -1.6, { ry: HALF, w: 3.4, h: 3.2, rows: 4, per: 12, items: ['#c9423a', '#2a2d33', '#d6a83a', '#3f72c4', '#e9e4d8'] });
    b.at(-9.6, 0, 6.6, 0.6, () => { speaker(b, 0, 0, { h: 1.4, w: 0.9 }); });
    b.cyl(-5.4, 5, 4.6, 0.5, 0.06, WHITE, { seg: 12, rx: HALF }); b.box(-5.4, 5.1, 4.64, 0.04, 0.34, 0.02, BLACK);
    plant(b, 10.6, 8.8, { s: 1.3, pot: '#2f2b3d' }); plant(b, -4.8, 8.6, { s: 1.1, pot: '#2f2b3d' });
    b.light(1.6, 4.2, -2.6, '#ffd9c8', 24, 13); b.light(2.6, 4.4, -8.6, accent, 14, 7);
    return {
      spots: [
        landmark('studio', /studio|mic|host|present|show|air|broadcast|dj|shift|work|job/, 4.6, -4.9, -HALF, { act: { pose: 'sit', x: 1.6, z: -4.9, ry: 0, seat: 0.6 } }),
        landmark('guest', /guest|interview|call|request|shout|advert|jingle|voice/, 0.2, 0.9, PI, { act: { pose: 'sit', x: 0.2, z: -0.6, ry: PI, seat: 0.6 } }),
        landmark('control', /control|producer|engineer|mix|edit|record/, -4.6, -6.6, -HALF),
        landmark('news', /news|read|booth|bulletin|traffic|weather/, 8.4, -4.8, PI),
        landmark('lounge', /lounge|sofa|wait|chill|green/, 5.6, 6.8, 0.8, { act: { pose: 'sit', x: 8.5, z: 4, ry: -HALF, seat: 0.69 } }),
        landmark('people', /people|crowd|meet/, -1.6, 5.6, 0),
      ],
      crowd: [[0.6, 6.6, 0.4], [-3.4, 4.6, -0.5], [2.4, 4.4, 2.4], [-4, 1.2, 1.2], [5.6, 1.6, -1.2], [-3.4, -1.6, 1.6], [6, -2.6, -1.6], [-7.6, 2.6, 1.8], [-1.2, 8.6, 0.2], [3.4, 8.2, -0.2], [-8.4, 5, 1.2], [6.8, -8.2, PI]],
    };
  },
};

export const SCENES = { hub, office, gym, salon, radio };
