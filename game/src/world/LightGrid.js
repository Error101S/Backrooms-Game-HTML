import * as THREE from 'three';
import { hashSeed, mulberry32 } from '../utils/PRNG.js';

// Recreates the recessed fluorescent ceiling panels seen in the found-footage reference
// (image-2): a grid of flat white-glowing squares set into the drop ceiling. For
// performance across the whole ~300 room map we do this in two tiers:
//  1. Every panel gets an emissive, unlit quad (one merged draw call, no per-pixel lighting cost).
//  2. Only a small pool of real THREE.PointLights exists at once; each frame we re-home the
//     pool to the fixtures nearest the player so illumination + shadows stay local and cheap.

const PANEL_SIZE = 0.62;
// Panels render plain white (not yellow) -- the warm tint seen in the reference footage is
// tape stock/VHS color response, reproduced only when VHS Camcorder Mode is active.

const QUALITY_POOL = { low: 10, medium: 18, high: 28 };
const QUALITY_RANGE = { low: 14, medium: 20, high: 28 };

export class LightGrid {
  constructor(scene, parentGroup, mapData, quality) {
    this.scene = scene;
    this.map = mapData;
    this.quality = quality;
    this.time = 0;

    this._buildPanels(parentGroup);
    this._buildFixturePool(parentGroup);
    this._flickerStates = new Map(); // panel index -> {phase, active}
  }

  heightForZone(zone) {
    return zone === this.map.tallZone ? this.map.tallWallHeight : this.map.wallHeight;
  }

  _buildPanels(parentGroup) {
    const panels = this.map.lightPanels;
    const count = Math.max(1, panels.length / 3);
    const geo = new THREE.PlaneGeometry(PANEL_SIZE, PANEL_SIZE);
    geo.rotateX(Math.PI / 2);
    // Bright, unlit white plane standing in for the fluorescent diffuser lens. toneMapped:false
    // lets us push individual panels well past 1.0 for a believable glow while keeping the whole
    // grid to a single draw call. IMPORTANT: do NOT set vertexColors:true here -- that flag makes
    // three.js expect a per-vertex `color` BufferAttribute on the geometry (there isn't one), which
    // multiplies every pixel by (0,0,0) and renders the panels pure black. Per-instance color from
    // InstancedMesh.setColorAt() is wired in automatically via the separate USE_INSTANCING_COLOR
    // shader path and needs no material flag at all.
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });

    const inst = new THREE.InstancedMesh(geo, mat, count);
    inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    inst.name = 'CeilingLightPanels';
    inst.frustumCulled = false;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    this._flickerIndices = [];

    const n = panels.length / 3;
    for (let i = 0; i < n; i++) {
      const x = panels[i * 3], z = panels[i * 3 + 1], flicker = panels[i * 3 + 2];
      const zone = this.map.zoneAt(x, z);
      const zoneSafe = zone === -1 ? 0 : zone;
      const y = this.heightForZone(zoneSafe) - 0.035;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      color.setRGB(1.6, 1.55, 1.35);
      inst.setColorAt(i, color);
      if (flicker) this._flickerIndices.push(i);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;

    parentGroup.add(inst);
    this.panelMesh = inst;
    this.panelCount = count;
  }

  _buildFixturePool(parentGroup) {
    const fixtures = this.map.lightFixtures;
    this.fixturePositions = [];
    for (let i = 0; i < fixtures.length; i += 2) {
      const x = fixtures[i], z = fixtures[i + 1];
      const zone = this.map.zoneAt(x, z);
      const zoneSafe = zone === -1 ? 0 : zone;
      const y = this.heightForZone(zoneSafe) - 0.15;
      this.fixturePositions.push(new THREE.Vector3(x, y, z));
    }

    const poolSize = QUALITY_POOL[this.quality] ?? QUALITY_POOL.medium;
    this.range = QUALITY_RANGE[this.quality] ?? QUALITY_RANGE.medium;
    this.pool = [];
    for (let i = 0; i < poolSize; i++) {
      const light = new THREE.PointLight(0xfff6df, 0, 6.5, 2.0);
      light.castShadow = i < Math.min(6, poolSize); // only a handful cast shadows for perf
      if (light.castShadow) {
        light.shadow.mapSize.set(512, 512);
        light.shadow.bias = -0.003;
        light.shadow.camera.near = 0.2;
        light.shadow.camera.far = 8;
      }
      parentGroup.add(light);
      this.pool.push(light);
    }
    this._reassignCooldown = 0;
  }

  update(dt, elapsed, playerPos) {
    this.time = elapsed;

    // Animate flickering panels (small subset) by toggling per-instance brightness.
    if (this._flickerIndices && this._flickerIndices.length && this.panelMesh.instanceColor) {
      const inst = this.panelMesh;
      const color = new THREE.Color();
      for (const idx of this._flickerIndices) {
        const seed = hashSeed(idx * 7 + 1, Math.floor(elapsed * 2.7));
        const r = mulberry32(seed)();
        const on = r > 0.12; // mostly on, brief dark stutters
        const c = on ? 1.6 : 0.15 + r * 0.15;
        color.setRGB(c, c * 0.97, c * 0.85);
        inst.setColorAt(idx, color);
      }
      inst.instanceColor.needsUpdate = true;
    }

    if (!playerPos || this.fixturePositions.length === 0) return;

    this._reassignCooldown -= dt;
    if (this._reassignCooldown <= 0) {
      this._reassignCooldown = 0.25; // re-home lights 4x/sec, plenty smooth, cheap
      this._reassignPool(playerPos);
    }
  }

  _reassignPool(playerPos) {
    const fixtures = this.fixturePositions;
    const range2 = this.range * this.range;
    // partial selection: gather within range, sort by distance, take closest N
    const candidates = [];
    for (let i = 0; i < fixtures.length; i++) {
      const dx = fixtures[i].x - playerPos.x, dz = fixtures[i].z - playerPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < range2) candidates.push([d2, i]);
    }
    candidates.sort((a, b) => a[0] - b[0]);

    for (let i = 0; i < this.pool.length; i++) {
      const light = this.pool[i];
      if (i < candidates.length) {
        const fp = fixtures[candidates[i][1]];
        light.position.copy(fp);
        const d = Math.sqrt(candidates[i][0]);
        const fade = THREE.MathUtils.clamp(1 - d / this.range, 0, 1);
        light.intensity = 0.55 * fade * fade + 0.05;
      } else {
        light.intensity = 0;
      }
    }
  }
}
