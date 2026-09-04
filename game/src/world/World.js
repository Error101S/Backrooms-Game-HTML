import * as THREE from 'three';
import { GeometryBatcher } from './GeometryBatcher.js';
import {
  createCarpetMaterial, createWallMaterial, createCeilingMaterial, createPoolMaterial,
} from './Materials.js';
import { ZONE_WATER, ZONE_CONCRETE } from './MapData.js';
import { hashSeed, mulberry32 } from '../utils/PRNG.js';
import { LightGrid } from './LightGrid.js';

const FLOOR_Y = 0;

// Builds the entire static level geometry from the processed map data: floors, ceilings,
// walls, baseboards, water, and hands off ceiling light placement to LightGrid.
export class World {
  constructor(scene, mapData, quality = 'medium') {
    this.scene = scene;
    this.map = mapData;
    this.quality = quality;
    this.group = new THREE.Group();
    this.group.name = 'WorldGeometry';
    this.scene.add(this.group);

    this.collidersFlat = []; // AABB list for quick collision (in addition to spatial hash on mapData)

    this._buildFloorsAndCeilings();
    this._buildWalls();
    this._buildBaseboards();

    this.lightGrid = new LightGrid(scene, this.group, mapData, quality);
  }

  heightForZone(zone) {
    return zone === this.map.tallZone ? this.map.tallWallHeight : this.map.wallHeight;
  }

  _buildFloorsAndCeilings() {
    const rects = this.map.floorRects;
    // group rects by zone so we can batch geometry per-material
    const byZone = new Map();
    for (let i = 0; i < rects.length; i += 5) {
      const x0 = rects[i], z0 = rects[i + 1], x1 = rects[i + 2], z1 = rects[i + 3], zone = rects[i + 4];
      if (!byZone.has(zone)) byZone.set(zone, []);
      byZone.get(zone).push([x0, z0, x1, z1]);
    }

    for (const [zone, list] of byZone) {
      const floorBatch = new GeometryBatcher();
      const ceilBatch = new GeometryBatcher();
      const ceilHeight = this.heightForZone(zone);
      // Plain Backrooms: every zone (including the map's blue-coded area) gets a normal,
      // dry floor at the same height -- no water/pool basin. The tiled zone still uses the
      // pool_tiles PBR texture set purely as a flooring pattern (bathroom-style tile),
      // just without any water surface or lowered basin.
      const isTiled = zone === ZONE_WATER;
      for (const [x0, z0, x1, z1] of list) {
        floorBatch.addHorizontalQuad(x0, z0, x1, z1, FLOOR_Y, isTiled ? 1.0 : 2.2, true);
        ceilBatch.addHorizontalQuad(x0, z0, x1, z1, ceilHeight, 1.2, false);
        // record simple AABB collider info isn't needed for floor (walls only)
        this.collidersFlat.push({ x0, z0, x1, z1, zone });
      }
      if (!floorBatch.isEmpty()) {
        const mat = isTiled ? createPoolMaterial() : createCarpetMaterial(zone);
        const mesh = new THREE.Mesh(floorBatch.build(), mat);
        mesh.receiveShadow = true;
        mesh.name = 'Floor_zone' + zone;
        this.group.add(mesh);
      }
      if (!ceilBatch.isEmpty()) {
        const alt = zone === ZONE_CONCRETE;
        const mat = createCeilingMaterial(alt);
        const mesh = new THREE.Mesh(ceilBatch.build(), mat);
        mesh.receiveShadow = false;
        mesh.name = 'Ceiling_zone' + zone;
        this.group.add(mesh);
      }
    }
  }

  _buildWalls() {
    // Group wall segments by zone (their "room" association) then split roughly half into
    // the alternate wallpaper pattern using a hash, for subtle variety like the reference's
    // differing carpet/wallpaper notes ("different carpet here!", "wall painted with trees").
    const byZoneAlt = new Map(); // key `${zone}_${alt}` -> batcher

    const getBatcher = (zone, alt) => {
      const key = zone + '_' + (alt ? 1 : 0);
      if (!byZoneAlt.has(key)) byZoneAlt.set(key, new GeometryBatcher());
      return byZoneAlt.get(key);
    };

    const vW = this.map.vWalls, hW = this.map.hWalls;
    for (let i = 0; i < vW.length; i += 4) {
      const x = vW[i], z0 = vW[i + 1], z1 = vW[i + 2], zone = vW[i + 3];
      const h = this.heightForZone(zone);
      const seed = hashSeed(Math.round(x * 10), Math.round(z0 * 10));
      const alt = mulberry32(seed)() < 0.22;
      getBatcher(zone, alt).addWallBoxV(x, Math.min(z0, z1), Math.max(z0, z1), 0, h, this.map.wallThickness, 2.4);
    }
    for (let i = 0; i < hW.length; i += 4) {
      const z = hW[i], x0 = hW[i + 1], x1 = hW[i + 2], zone = hW[i + 3];
      const h = this.heightForZone(zone);
      const seed = hashSeed(Math.round(x0 * 10), Math.round(z * 10) + 1);
      const alt = mulberry32(seed)() < 0.22;
      getBatcher(zone, alt).addWallBoxH(z, Math.min(x0, x1), Math.max(x0, x1), 0, h, this.map.wallThickness, 2.4);
    }

    for (const [key, batch] of byZoneAlt) {
      if (batch.isEmpty()) continue;
      const [zoneStr, altStr] = key.split('_');
      const zone = Number(zoneStr), alt = altStr === '1';
      const mat = createWallMaterial(Number(zone), alt);
      const mesh = new THREE.Mesh(batch.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = 'Wall_zone' + zone + (alt ? '_alt' : '');
      this.group.add(mesh);
    }
  }

  _buildBaseboards() {
    // Thin dark trim strip along the base of every wall for grounding/detail, matching the
    // reference footage's visible skirting boards. Spans are extended by half-thickness at
    // each end (same reasoning as GeometryBatcher.addWallBoxV/H) so the trim fully seals
    // corners instead of leaving a gap where two walls meet.
    const batch = new GeometryBatcher();
    const H = 0.09;
    const vW = this.map.vWalls, hW = this.map.hWalls;
    for (let i = 0; i < vW.length; i += 4) {
      const x = vW[i], z0 = vW[i + 1], z1 = vW[i + 2];
      const half = this.map.wallThickness / 2 + 0.01;
      const zmin = Math.min(z0, z1) - half, zmax = Math.max(z0, z1) + half;
      batch.addVerticalQuadZ(x - half, zmin, zmax, 0, H, 4, -1);
      batch.addVerticalQuadZ(x + half, zmin, zmax, 0, H, 4, 1);
    }
    for (let i = 0; i < hW.length; i += 4) {
      const z = hW[i], x0 = hW[i + 1], x1 = hW[i + 2];
      const half = this.map.wallThickness / 2 + 0.01;
      const xmin = Math.min(x0, x1) - half, xmax = Math.max(x0, x1) + half;
      batch.addVerticalQuadX(xmin, xmax, z - half, 0, H, 4, -1);
      batch.addVerticalQuadX(xmin, xmax, z + half, 0, H, 4, 1);
    }
    if (!batch.isEmpty()) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x4a4326, roughness: 0.85 });
      const mesh = new THREE.Mesh(batch.build(), mat);
      mesh.name = 'Baseboards';
      this.group.add(mesh);
    }
  }

  update(dt, elapsed, playerPos) {
    this.lightGrid.update(dt, elapsed, playerPos);
  }
}

