import * as THREE from 'three';

export type Vec3 = [number, number, number];
type Face = [Vec3, Vec3, Vec3, Vec3, Vec3];
type Tri = [number, number, number];
type Quad = [number, number, number, number];

/** A tiny indexed, vertex-colour geometry assembler. */
export class GeometryBatch {
  positions: number[] = [];
  normals: number[] = [];
  colors: number[] = [];
  indices: number[] = [];

  append(vertices: number[], normals: number[], indices: number[], color: THREE.ColorRepresentation): void {
    const offset = this.positions.length / 3;
    const tint = new THREE.Color(color);
    this.positions.push(...vertices);
    this.normals.push(...normals);
    for (let i = 0; i < vertices.length / 3; i += 1) this.colors.push(tint.r, tint.g, tint.b);
    for (const index of indices) this.indices.push(offset + index);
  }

  box(x: number, y: number, z: number, width: number, height: number, depth: number, color: THREE.ColorRepresentation): void {
    const x0 = x - width / 2; const x1 = x + width / 2;
    const y0 = y - height / 2; const y1 = y + height / 2;
    const z0 = z - depth / 2; const z1 = z + depth / 2;
    const faces: Face[] = [
      [[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]],
      [[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]],
      [[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0]],
      [[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0]],
      [[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0]],
      [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0]],
    ];
    const vertices: number[] = []; const normals: number[] = []; const indices: number[] = [];
    for (const face of faces) {
      const base = vertices.length / 3;
      for (let i = 0; i < 4; i += 1) { vertices.push(...face[i]!); normals.push(...face[4]); }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.append(vertices, normals, indices, color);
  }

  /** Add a gabled triangular prism with its ridge parallel to Z. */
  roof(x: number, y: number, z: number, width: number, height: number, depth: number, color: THREE.ColorRepresentation): void {
    const x0=x-width/2; const x1=x+width/2; const z0=z-depth/2; const z1=z+depth/2;
    const v: Vec3[] = [[x0,y,z0],[x1,y,z0],[x,y+height,z0],[x0,y,z1],[x1,y,z1],[x,y+height,z1]];
    const triangles: Tri[] = [[1,0,2],[3,4,5],[0,4,3],[0,1,4],[1,5,4],[1,2,5],[2,3,5],[2,0,3]];
    for (const [a,b,c] of triangles) {
      const va=new THREE.Vector3(...v[a]!); const vb=new THREE.Vector3(...v[b]!); const vc=new THREE.Vector3(...v[c]!);
      const n=vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();
      this.append([...v[a]!,...v[b]!,...v[c]!],[n.x,n.y,n.z,n.x,n.y,n.z,n.x,n.y,n.z],[0,1,2],color);
    }
  }

  /** Add an upright low-poly cylinder. */
  cylinder(x: number, y: number, z: number, radius: number, height: number, segments: number, color: THREE.ColorRepresentation): void {
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
  leaningPost(x: number, y: number, z: number, width: number, height: number, leanX: number, leanZ: number, color: THREE.ColorRepresentation): void {
    const w = width / 2; const y0 = y - height / 2; const y1 = y + height / 2;
    const v: Vec3[] = [[x-w,y0,z-w],[x+w,y0,z-w],[x+w,y0,z+w],[x-w,y0,z+w],[x+leanX-w,y1,z+leanZ-w],[x+leanX+w,y1,z+leanZ-w],[x+leanX+w,y1,z+leanZ+w],[x+leanX-w,y1,z+leanZ+w]];
    const quads: Quad[] = [[1,0,4,5],[2,1,5,6],[3,2,6,7],[0,3,7,4],[4,7,6,5],[0,1,2,3]];
    for (const [a,b,c,d] of quads) {
      const va=new THREE.Vector3(...v[a]!); const vb=new THREE.Vector3(...v[b]!); const vc=new THREE.Vector3(...v[c]!);
      const n=vb.clone().sub(va).cross(vc.clone().sub(va)).normalize();
      this.append([...v[a]!,...v[b]!,...v[c]!,...v[d]!],[n.x,n.y,n.z,n.x,n.y,n.z,n.x,n.y,n.z,n.x,n.y,n.z],[0,1,2,0,2,3],color);
    }
  }

  /** Add a box rotated around its local Z axis. */
  rotatedBoxZ(x: number, y: number, z: number, width: number, height: number, depth: number, angle: number, color: THREE.ColorRepresentation): void {
    const c=Math.cos(angle); const s=Math.sin(angle); const x0=-width/2; const x1=width/2; const y0=-height/2; const y1=height/2; const z0=-depth/2; const z1=depth/2;
    const transform=([px,py,pz]: Vec3): Vec3=>[x+px*c-py*s,y+px*s+py*c,z+pz];
    const rotate=([nx,ny,nz]: Vec3): Vec3=>[nx*c-ny*s,nx*s+ny*c,nz];
    const faces: Face[]=[[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1],[0,0,1]],[[x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0],[0,0,-1]],[[x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[1,0,0]],[[x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0],[-1,0,0]],[[x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0],[0,1,0]],[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[0,-1,0]]];
    const vertices: number[]=[]; const normals: number[]=[]; const indices: number[]=[];
    for(const face of faces){ const base=vertices.length/3; const normal=rotate(face[4]); for(let i=0;i<4;i+=1){ vertices.push(...transform(face[i]!)); normals.push(...normal); } indices.push(base,base+1,base+2,base,base+2,base+3); }
    this.append(vertices,normals,indices,color);
  }

  /** Add a rectangular four-sided pyramid. */
  pyramid(x: number, y: number, z: number, width: number, height: number, depth: number, color: THREE.ColorRepresentation): void {
    const v: Vec3[] = [[x-width/2,y,z-depth/2],[x+width/2,y,z-depth/2],[x+width/2,y,z+depth/2],[x-width/2,y,z+depth/2],[x,y+height,z]];
    const triangles: Tri[] = [[0,2,1],[0,3,2],[0,1,4],[1,2,4],[2,3,4],[3,0,4]];
    for(const [a,b,c] of triangles){ const va=new THREE.Vector3(...v[a]!); const vb=new THREE.Vector3(...v[b]!); const vc=new THREE.Vector3(...v[c]!); const n=vb.clone().sub(va).cross(vc.clone().sub(va)).normalize(); this.append([...v[a]!,...v[b]!,...v[c]!],[n.x,n.y,n.z,n.x,n.y,n.z,n.x,n.y,n.z],[0,1,2],color); }
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}

export function countModel(root: THREE.Object3D): { triangles: number, drawCalls: number } {
  let triangles = 0; let drawCalls = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position!.count;
    triangles += count / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
    drawCalls += Array.isArray(object.material) ? object.material.length : 1;
  });
  return { triangles, drawCalls };
}
