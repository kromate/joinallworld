import * as THREE from 'three';

/** @typedef {[number, number, number]} Vec3 */

/** A tiny indexed, vertex-colour geometry assembler. */
export class GeometryBatch {
  constructor() {
    /** @type {number[]} */ this.positions = [];
    /** @type {number[]} */ this.normals = [];
    /** @type {number[]} */ this.colors = [];
    /** @type {number[]} */ this.indices = [];
  }

  /** @param {number[]} vertices @param {number[]} normals @param {number[]} indices @param {THREE.ColorRepresentation} color */
  append(vertices, normals, indices, color) {
    const offset = this.positions.length / 3;
    const tint = new THREE.Color(color);
    this.positions.push(...vertices);
    this.normals.push(...normals);
    for (let i = 0; i < vertices.length / 3; i += 1) this.colors.push(tint.r, tint.g, tint.b);
    for (const index of indices) this.indices.push(offset + index);
  }

  /** @param {number} x @param {number} y @param {number} z @param {number} width @param {number} height @param {number} depth @param {THREE.ColorRepresentation} color */
  box(x, y, z, width, height, depth, color) {
    const x0 = x - width / 2; const x1 = x + width / 2;
    const y0 = y - height / 2; const y1 = y + height / 2;
    const z0 = z - depth / 2; const z1 = z + depth / 2;
    const faces = [
      [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]],
      [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]],
      [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0]],
      [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0]],
      [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0]],
      [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0]],
    ];
    const vertices = []; const normals = []; const indices = [];
    for (const face of faces) {
      const base = vertices.length / 3;
      for (let i = 0; i < 4; i += 1) { vertices.push(...face[i]); normals.push(...face[4]); }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.append(vertices, normals, indices, color);
  }

  /** Add a gabled triangular prism with its ridge parallel to Z. */
  roof(x, y, z, width, height, depth, color) {
    const x0=x-width/2; const x1=x+width/2; const z0=z-depth/2; const z1=z+depth/2;
    const v=[[x0,y,z0],[x1,y,z0],[x,y+height,z0],[x0,y,z1],[x1,y,z1],[x,y+height,z1]];
    const triangles=[[1,0,2],[3,4,5],[0,4,3],[0,1,4],[1,5,4],[1,2,5],[2,3,5],[2,0,3]];
    for (const [a,b,c] of triangles) {
      const va=new THREE.Vector3(...v[a]); const vb=new THREE.Vector3(...v[b]); const vc=new THREE.Vector3(...v[c]);
      const n=vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();
      this.append([...v[a],...v[b],...v[c]],[n.x,n.y,n.z,n.x,n.y,n.z,n.x,n.y,n.z],[0,1,2],color);
    }
  }

  /** Add an upright low-poly cylinder. */
  cylinder(x, y, z, radius, height, segments, color) {
    for (let i = 0; i < segments; i += 1) {
      const a = i / segments * Math.PI * 2;
      const b = (i + 1) / segments * Math.PI * 2;
      const ax = x + Math.cos(a) * radius; const az = z + Math.sin(a) * radius;
      const bx = x + Math.cos(b) * radius; const bz = z + Math.sin(b) * radius;
      const y0 = y - height / 2; const y1 = y + height / 2;
      const nx = Math.cos((a + b) / 2); const nz = Math.sin((a + b) / 2);
      this.append([ax,y0,az,bx,y0,bz,bx,y1,bz,ax,y1,az],[nx,0,nz,nx,0,nz,nx,0,nz,nx,0,nz],[0,1,2,0,2,3],color);
      this.append([x,y1,z,ax,y1,az,bx,y1,bz],[0,1,0,0,1,0,0,1,0],[0,1,2],color);
      this.append([x,y0,z,bx,y0,bz,ax,y0,az],[0,-1,0,0,-1,0,0,-1,0],[0,1,2],color);
    }
  }

  /** Add a square post whose top leans away from its base. */
  leaningPost(x, y, z, width, height, leanX, leanZ, color) {
    const w = width / 2; const y0 = y - height / 2; const y1 = y + height / 2;
    const v=[[x-w,y0,z-w],[x+w,y0,z-w],[x+w,y0,z+w],[x-w,y0,z+w],[x+leanX-w,y1,z+leanZ-w],[x+leanX+w,y1,z+leanZ-w],[x+leanX+w,y1,z+leanZ+w],[x+leanX-w,y1,z+leanZ+w]];
    const quads=[[1,0,4,5],[2,1,5,6],[3,2,6,7],[0,3,7,4],[4,7,6,5],[0,1,2,3]];
    for (const [a,b,c,d] of quads) {
      const va=new THREE.Vector3(...v[a]); const vb=new THREE.Vector3(...v[b]); const vc=new THREE.Vector3(...v[c]);
      const n=vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();
      this.append([...v[a],...v[b],...v[c],...v[d]],[n.x,n.y,n.z,n.x,n.y,n.z,n.x,n.y,n.z,n.x,n.y,n.z],[0,1,2,0,2,3],color);
    }
  }

  /** Add a box rotated around its local Z axis. */
  rotatedBoxZ(x, y, z, width, height, depth, angle, color) {
    const c=Math.cos(angle); const s=Math.sin(angle); const x0=-width/2; const x1=width/2; const y0=-height/2; const y1=height/2; const z0=-depth/2; const z1=depth/2;
    const transform=([px,py,pz])=>[x+px*c-py*s,y+px*s+py*c,z+pz];
    const rotate=([nx,ny,nz])=>[nx*c-ny*s,nx*s+ny*c,nz];
    const faces=[[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]],[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]],[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0]],[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0]],[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0]],[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0]]];
    const vertices=[]; const normals=[]; const indices=[];
    for(const face of faces){ const base=vertices.length/3; const normal=rotate(face[4]); for(let i=0;i<4;i+=1){ vertices.push(...transform(face[i])); normals.push(...normal); } indices.push(base,base+1,base+2,base,base+2,base+3); }
    this.append(vertices,normals,indices,color);
  }

  /** Add a rectangular four-sided pyramid. */
  pyramid(x, y, z, width, height, depth, color) {
    const v=[[x-width/2,y,z-depth/2],[x+width/2,y,z-depth/2],[x+width/2,y,z+depth/2],[x-width/2,y,z+depth/2],[x,y+height,z]];
    const triangles=[[0,2,1],[0,3,2],[0,1,4],[1,2,4],[2,3,4],[3,0,4]];
    for(const [a,b,c] of triangles){ const va=new THREE.Vector3(...v[a]); const vb=new THREE.Vector3(...v[b]); const vc=new THREE.Vector3(...v[c]); const n=vb.clone().sub(va).cross(vc.clone().sub(va)).normalize(); this.append([...v[a],...v[b],...v[c]],[n.x,n.y,n.z,n.x,n.y,n.z,n.x,n.y,n.z],[0,1,2],color); }
  }

  /** @returns {THREE.BufferGeometry} */
  build() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** @param {THREE.Object3D} root */
export function countModel(root) {
  let triangles = 0; let drawCalls = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    const geometry = object.geometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    triangles += count / 3 * (object.isInstancedMesh ? object.count : 1);
    drawCalls += Array.isArray(object.material) ? object.material.length : 1;
  });
  return { triangles, drawCalls };
}
