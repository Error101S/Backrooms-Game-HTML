import * as THREE from 'three';

// Accumulates raw vertex data for many small quads/boxes that share a material and
// bakes them into a single BufferGeometry. This keeps the whole ~300-room map to a
// handful of draw calls instead of thousands, while still allowing world-space UV
// tiling (so texture scale stays correct regardless of room size).
export class GeometryBatcher {
  constructor() {
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.indices = [];
    this._vertCount = 0;
  }

  addQuad(p0, p1, p2, p3, normal, uv0, uv1, uv2, uv3) {
    const base = this._vertCount;
    this.positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
    for (let i = 0; i < 4; i++) this.normals.push(normal.x, normal.y, normal.z);
    this.uvs.push(uv0.x, uv0.y, uv1.x, uv1.y, uv2.x, uv2.y, uv3.x, uv3.y);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this._vertCount += 4;
  }

  // Axis-aligned horizontal quad (floor/ceiling) spanning world rect, UV derived from world XZ.
  addHorizontalQuad(x0, z0, x1, z1, y, tileSize, facingUp) {
    const n = facingUp ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, -1, 0);
    const uvScale = 1 / tileSize;
    const p00 = new THREE.Vector3(x0, y, z0);
    const p10 = new THREE.Vector3(x1, y, z0);
    const p11 = new THREE.Vector3(x1, y, z1);
    const p01 = new THREE.Vector3(x0, y, z1);
    const uv00 = new THREE.Vector2(x0 * uvScale, z0 * uvScale);
    const uv10 = new THREE.Vector2(x1 * uvScale, z0 * uvScale);
    const uv11 = new THREE.Vector2(x1 * uvScale, z1 * uvScale);
    const uv01 = new THREE.Vector2(x0 * uvScale, z1 * uvScale);
    // addQuad(p00, p01, p11, p10) winds counter-clockwise when viewed from +Y (i.e. faces up);
    // reversing that order faces -Y instead. Verified against THREE's right-handed CCW convention.
    if (facingUp) {
      this.addQuad(p00, p01, p11, p10, n, uv00, uv01, uv11, uv10);
    } else {
      this.addQuad(p00, p10, p11, p01, n, uv00, uv10, uv11, uv01);
    }
  }

  // Vertical quad along X axis at fixed Z, from x0..x1, y0..y1. normalSign = +1 or -1 (which way it faces along Z)
  addVerticalQuadX(x0, x1, z, y0, y1, tileSize, normalSign) {
    const n = new THREE.Vector3(0, 0, normalSign);
    const uvScale = 1 / tileSize;
    const uMin = x0 * uvScale, uMax = x1 * uvScale;
    const vMin = y0 * uvScale, vMax = y1 * uvScale;
    const pA = new THREE.Vector3(x0, y0, z);
    const pB = new THREE.Vector3(x1, y0, z);
    const pC = new THREE.Vector3(x1, y1, z);
    const pD = new THREE.Vector3(x0, y1, z);
    if (normalSign > 0) {
      this.addQuad(pA, pB, pC, pD,
        n, new THREE.Vector2(uMin, vMin), new THREE.Vector2(uMax, vMin), new THREE.Vector2(uMax, vMax), new THREE.Vector2(uMin, vMax));
    } else {
      this.addQuad(pB, pA, pD, pC,
        n, new THREE.Vector2(uMax, vMin), new THREE.Vector2(uMin, vMin), new THREE.Vector2(uMin, vMax), new THREE.Vector2(uMax, vMax));
    }
  }

  // Vertical quad along Z axis at fixed X, from z0..z1, y0..y1. normalSign = +1 or -1 (which way it faces along X)
  addVerticalQuadZ(x, z0, z1, y0, y1, tileSize, normalSign) {
    const n = new THREE.Vector3(normalSign, 0, 0);
    const uvScale = 1 / tileSize;
    const uMin = z0 * uvScale, uMax = z1 * uvScale;
    const vMin = y0 * uvScale, vMax = y1 * uvScale;
    const pA = new THREE.Vector3(x, y0, z0);
    const pB = new THREE.Vector3(x, y0, z1);
    const pC = new THREE.Vector3(x, y1, z1);
    const pD = new THREE.Vector3(x, y1, z0);
    // Verified winding: (pA,pB,pC,pD) faces -X, (pB,pA,pD,pC) faces +X.
    if (normalSign > 0) {
      this.addQuad(pB, pA, pD, pC,
        n, new THREE.Vector2(uMax, vMin), new THREE.Vector2(uMin, vMin), new THREE.Vector2(uMin, vMax), new THREE.Vector2(uMax, vMax));
    } else {
      this.addQuad(pA, pB, pC, pD,
        n, new THREE.Vector2(uMin, vMin), new THREE.Vector2(uMax, vMin), new THREE.Vector2(uMax, vMax), new THREE.Vector2(uMin, vMax));
    }
  }

  // Convenience: a thin wall box between two grid-aligned faces (adds both faces + top cap).
  //
  // The box's *span* (z0..z1 here) is extended by half the wall thickness at each end before
  // building geometry. Wall segments from the map data meet exactly at their shared endpoint
  // (e.g. a vertical wall's z1 equals a horizontal wall's z), but each wall's own thickness box
  // only covers its own span -- the small square where the two walls' thickness boxes should
  // overlap (the outer corner "notch") is left uncovered by either one, producing a visible
  // gap/see-through hole at every L/T-shaped corner in the map. Extending each wall's span by
  // its own half-thickness on both ends makes every wall's footprint reach past the shared
  // corner point and into the neighboring wall's footprint, fully sealing the joint.
  addWallBoxV(x, z0, z1, y0, y1, thickness, tileSize) {
    const half = thickness / 2;
    const ez0 = z0 - half, ez1 = z1 + half;
    this.addVerticalQuadZ(x - half, ez0, ez1, y0, y1, tileSize, -1);
    this.addVerticalQuadZ(x + half, ez0, ez1, y0, y1, tileSize, 1);
    this.addHorizontalQuad(x - half, ez0, x + half, ez1, y1, tileSize, true);
  }

  addWallBoxH(z, x0, x1, y0, y1, thickness, tileSize) {
    const half = thickness / 2;
    const ex0 = x0 - half, ex1 = x1 + half;
    this.addVerticalQuadX(ex0, ex1, z - half, y0, y1, tileSize, -1);
    this.addVerticalQuadX(ex0, ex1, z + half, y0, y1, tileSize, 1);
    this.addHorizontalQuad(ex0, z - half, ex1, z + half, y1, tileSize, true);
  }

  isEmpty() {
    return this._vertCount === 0;
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setIndex(this.indices);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}
