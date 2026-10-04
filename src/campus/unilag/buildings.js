import { signLetters } from '../shared/signs.js';

/** Original procedural interpretations. Reference evidence and limits are in CAMPUS-UNILAG.md.
 * @typedef {import('./layout.js').CampusBuilding} Building
 * @typedef {ReturnType<import('../../scene/build.ts').createBatch>} Batch
 */

/** @param {Batch} batch @param {Building} b @param {number} detail
 * @param {import('../shared/geometry.js').Instance[]} windows */
export function drawBuilding(batch, b, detail, windows) {
  const { x, z, w, d, h } = b;
  const cream = b.color || '#dfd0ad', roof = '#795c50', red = '#983e3d';
  const box = (dx, y, dz, width, height, depth, color) => batch.box(x + dx, y, z + dz, width, height, depth, color);
  if (b.kind === 'gate') {
    for (const side of [-1, 1]) {
      box(side * w * .36, h / 2, 0, w * .15, h, d, cream);
      box(side * w * .36, h * .64, d * .51, w * .095, h * .58, .35, red);
    }
    box(0, h * .82, 0, w * .9, h * .22, d * .7, cream);
    if (detail) {
      signLetters(batch, b.id === 'main-gate' ? 'UNIVERSITY OF LAGOS' : 'UNILAG SECOND GATE', x, h * .79, z + d / 2 + .31, w * .83);
      batch.cyl(x, h * .86, z + d / 2 + .2, 1.5, .25, '#b99147', { rx: Math.PI / 2, seg: 12 });
      for (const side of [-1, 1]) box(side * w * .53, h * .55, 0, w * .2, .25, d * 1.4, '#4d5955');
    }
    return;
  }
  if (b.id === 'swimming-pool') {
    box(0,.02,0,w+2,.04,d+2,'#d4d7c0');
    box(0,.06,0,w,.04,d,'#539cae');
    for(let lane=-2;lane<=2;lane++)box(lane*w/6,.095,0,.08,.025,d,'#eef0cc');
    return;
  }
  if (b.kind === 'sports' || b.kind === 'court') {
    box(0, .025, 0, w, .05, d, b.kind === 'sports' ? '#629362' : '#bd7353');
    for (const side of [-1, 1]) {
      box(side * (w / 2 - 1), .1, 0, .22, .05, d - 2, '#f2efe1');
      box(0, .1, side * (d / 2 - 1), w - 2, .05, .22, '#f2efe1');
      if (b.kind === 'sports') {
        box(side * (w / 2 - 1), 2.2, -3, .2, 4.4, .2, '#ffffff');
        box(side * (w / 2 - 1), 2.2, 3, .2, 4.4, .2, '#ffffff');
        box(side * (w / 2 - 1), 4.4, 0, .2, .2, 6.2, '#ffffff');
      }
    }
    box(0, .1, 0, .2, .05, d - 2, '#f2efe1');
    if (detail && b.kind === 'sports') {
      for (let row = 0; row < 4; row++) box(0, .6 + row * .7, -d / 2 - 2 - row, w * .8, .7, 1, '#67a0b3');
      box(0, 5, -d / 2 - 4, w * .85, .4, 6, red);
    }
    return;
  }
  if (b.kind === 'garden' || b.kind === 'lagoon') {
    box(0, .02, 0, w, .04, d, '#c5c6a0');
    return;
  }
  if (b.kind === 'amphitheatre') {
    for (let i = 0; i < (detail ? 5 : 2); i++) box(0, .3 + i * .35, -i * 1.7, w - i * 2, .6, 1.3, cream);
    return;
  }
  if (b.kind === 'senate' && detail) {
    const lobby=6;
    box(0,-.08,0,w,.16,d,'#d9c3a0');
    box(0,lobby/2,-d/2+.5,w,lobby,1,cream);
    for(const side of [-1,1])box(side*(w/2-.5),lobby/2,0,1,lobby,d,cream);
    box(0,lobby+.4,0,w+3,.8,d+2,cream);
    box(0,(h+lobby)/2,-d*.22,w*.7,h-lobby,d*.5,cream);
    const front=d*.03+.2;
    for(let floor=0;floor<10;floor++)for(let col=-2;col<=2;col++){
      box(col*w*.125,8+floor*3.15,front,2.8,2.5,.25,'#9a4640');
      box(col*w*.125,8+floor*3.15,front+.18,1.8,1.65,.18,'#687e80');
    }
    box(0,3.1,d/2+.18,14,.85,.2,'#244d49');
    signLetters(batch,'SENATE HOUSE',x,3.1,z+d/2+.31,13);
    return;
  }
  if (b.interior && detail === 2) {
    box(0, -.08, 0, w, .16, d, '#d9c3a0');
    box(0, h / 2, -d / 2 + .5, w, h, 1, cream);
    for (const side of [-1, 1]) box(side * (w / 2 - .5), h / 2, 0, 1, h, d, cream);
    // An open front and open roof keep the ground-floor rooms visible and reachable.
    box(0, h - .6, -d / 2 + 2, w + 1.5, 1.2, 4, roof);
    if (b.kind === 'senate') {
      box(0, h * .65, -d * .35, w * .66, h * .7, d * .28, cream);
    }
    furnish(batch, b);
  } else {
    box(0, h / 2, 0, w, h, d, cream);
    box(0, h + .3, 0, w + 1, .6, d + 1, roof);
  }
  if (!detail) return;
  if (b.kind === 'senate') {
    for (let col = -3; col <= 3; col++) box(col * w / 8, h * .6, -d * .18, .6, h * .65, .7, red);
    for (let floor = 1; floor <= 8; floor++) box(0, h * (.28 + floor * .075), -d * .17, w * .8, .4, .7, '#d5b98b');
  } else if (b.kind === 'library') {
    for (let col = -4; col <= 4; col++) box(col * w / 10, h * .76, d / 2 + .3, .65, h * .38, 1.1, '#dfdcc8');
    box(0, h + .9, d / 2 - 1, w + 5, 1, 6, cream);
  } else if (b.kind === 'auditorium') {
    box(0, h + .7, 0, w + 4, 1.4, d + 5, '#c4a25c');
    for (const side of [-1, 1]) box(side * w * .39, h / 2, d / 2 + 1, .8, h, .8, cream);
  } else if (b.kind === 'mosque') {
    batch.ball(x, h + 1.5, z, w * .28, 4, d * .28, '#75a294', { seg: 10 });
    batch.cyl(x - w / 2 - 2, h * .75, z - d / 2, 1.2, h * 1.5, cream, { seg: 8 });
  } else if (b.kind === 'chapel') {
    box(0, h + 2, -d / 2, .45, 5, .45, '#efe5ce');
    box(0, h + 2.8, -d / 2, 2.7, .45, .45, '#efe5ce');
  }
  if (b.kind !== 'senate') {
    const rows = Math.min(4, Math.max(1, Math.floor(h / 4)));
    for (let row = 0; row < rows; row++) for (let col = 0; col < Math.floor(w / 4); col++) {
      // Upper facade windows only where there is a wall. Open-front rooms keep their entrance clear.
      windows.push({ x: x - w / 2 + 2 + col * 4, y: 2.2 + row * 3.6, z: z - d / 2 - .12, sx: 2, sy: 1.5, sz: .16 });
    }
  }
  box(0, 3.1, d / 2 + .18, Math.min(w, 14), .85, .2, b.kind === 'bank' ? '#da6d2f' : '#244d49');
  signLetters(batch,b.label,x,3.1,z+d/2+.31,Math.min(w-1,13));
}

/** Furniture occupies the sides, leaving the centre approach open.
 * @param {Batch} batch @param {Building} b */
function furnish(batch, b) {
  const { x, z, w, d, kind } = b;
  const box = (dx, y, dz, width, height, depth, color) => batch.box(x + dx, y, z + dz, width, height, depth, color);
  if (kind === 'library') {
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) {
      box(side * (w / 2 - 3), 1.8, -d / 2 + 4 + row * 4, 2, 3.6, 2.7, '#7e5337');
      for (let shelf = 0; shelf < 3; shelf++) box(side * (w / 2 - 2.8), .7 + shelf, -d / 2 + 4 + row * 4, 1.5, .6, 2.4, ['#984c44', '#5b7777', '#be9649'][shelf]);
    }
  } else if (kind === 'hall') {
    for (const side of [-1, 1]) {
      box(side * (w / 2 - 3), .6, -d / 2 + 5, 3.5, 1.2, 6, '#846242');
      box(side * (w / 2 - 3), 1.3, -d / 2 + 5, 3.4, .3, 5.8, '#82a7a0');
      box(side * (w / 2 - 3), 1.55, -d / 2 + 3, 2.5, .25, 1.2, '#eee3ce');
      box(side * (w / 2 - 3), 2, d / 2 - 3, 2.8, 4, 2, '#ad895b');
    }
  } else if (kind === 'bank') {
    box(0, 1.3, -d / 2 + 3, w - 5, 2.6, 2, '#df722d');
    box(-w / 2 + 3, 1.8, d / 2 - 2, 2, 3.6, 1, '#36434b');
    box(-w / 2 + 3, 2.2, d / 2 - 1.4, 1.3, .85, .2, '#9acaab');
  } else {
    const cafe = kind === 'cafeteria';
    for (const side of [-1, 1]) for (let row = 0; row < Math.min(3, Math.floor((d - 4) / 4)); row++) {
      box(side * (w / 2 - 4), 1.1, -d / 2 + 4 + row * 4, 4, .3, 2, cafe ? '#bb4938' : '#aa8864');
      box(side * (w / 2 - 4), .5, -d / 2 + 5 + row * 4, 3.5, .8, .8, cafe ? '#c85a43' : '#577b7c');
    }
    if (kind === 'lecture' || kind === 'auditorium') box(0, 3, -d / 2 + .6, w * .55, 3, .25, '#345e52');
    if (cafe) box(0, 1.2, -d / 2 + 2, w - 4, 2.4, 2, '#d3a363');
  }
}
