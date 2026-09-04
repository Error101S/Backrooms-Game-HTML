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

    // Map each fixture to its nearest ceiling panel so a real point light can be visually
    // synced to the flicker state of the panel it sits under (see _panelFlickerMul below) --
    // without this the emissive panel could be seen stuttering while the light illuminating
    // the room from that same spot stayed rock-steady, an obvious disconnect.
    this._fixtureNearestPanel = this._buildNearestPanelMap();

    const poolSize = QUALITY_POOL[this.quality] ?? QUALITY_POOL.medium;
    this.range = QUALITY_RANGE[this.quality] ?? QUALITY_RANGE.medium;
    this.pool = [];
    // Per-slot crossfade state, parallel to `pool`. `fixtureIdx: -1` means "unassigned / dark".
    // `pendingFixtureIdx` holds a queued reassignment that is applied only once the slot has
    // faded to black at its *current* spot -- this is what turns the old hard "teleport the
    // light + snap its intensity" pop into an invisible cut: fade out in the dark room it's
    // leaving, jump position while it can't be seen, fade in at the new spot.
    this._poolState = [];
    for (let i = 0; i < poolSize; i++) {
      // NOTE ON INTENSITY UNITS: three.js (this bundled build is r169) lights are physically
      // photometric -- PointLight.intensity is candela and combines with inverse-square distance
      // falloff (see getDistanceAttenuation in the lighting shader chunk), not the old pre-r155
      // "legacy" arbitrary-unit lights. A PointLight with intensity ~0.5 (the previous value
      // here) produces only a small fraction of a lux at a couple of meters -- far too dim for
      // MeshStandardMaterial surfaces to visibly pick up, which is why these lights glowed at
      // their own position (the emissive unlit panel mesh) but never actually lit the floor,
      // walls, or ceiling around them despite `intensity > 0`. Values in the 8-18 range are
      // what's actually needed for a physically-lit point source to read as "lighting the room"
      // at the couple-of-meters range these ceiling fixtures sit above the player.
      const light = new THREE.PointLight(0xfff6df, 0, 7.5, 1.75);
      light.castShadow = i < Math.min(6, poolSize); // only a handful cast shadows for perf
      if (light.castShadow) {
        light.shadow.mapSize.set(512, 512);
        light.shadow.bias = -0.003;
        light.shadow.camera.near = 0.2;
        light.shadow.camera.far = 8;
      }
      parentGroup.add(light);
      this.pool.push(light);
      this._poolState.push({ fixtureIdx: -1, pendingFixtureIdx: -1, targetIntensity: 0, baseIntensity: 0 });
    }
    this._reassignCooldown = 0;

    // Soft, shadowless fill light that always rides just above the player. Real fluorescent
    // office ceilings bounce a fair bit of light back up off floors/nearby walls that a sparse
    // point-light pool alone can't fake (you'd otherwise get a harsh, pitch-black floor the
    // instant you step past the pool's range); this stand-in for that bounce light is cheap
    // (no shadow map) and keeps nearby geometry readable without washing out the moody dimness.
    this.fillLight = new THREE.PointLight(0xd9cfa8, 1.4, 5.5, 1.9);
    this.fillLight.castShadow = false;
    parentGroup.add(this.fillLight);
  }

  // For every fixture, find the closest light panel by squared distance. O(fixtures * panels)
  // but this only ever runs once at level load (hundreds * a few thousand = well under a frame
  // budget even on load).
  _buildNearestPanelMap() {
    const panels = this.map.lightPanels;
    const panelCount = panels.length / 3;
    const out = new Int32Array(this.fixturePositions.length).fill(-1);
    for (let f = 0; f < this.fixturePositions.length; f++) {
      const fx = this.fixturePositions[f].x, fz = this.fixturePositions[f].z;
      let bestD = Infinity, bestI = -1;
      for (let p = 0; p < panelCount; p++) {
        const dx = panels[p * 3] - fx, dz = panels[p * 3 + 1] - fz;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; bestI = p; }
      }
      out[f] = bestI;
    }
    return out;
  }

  // Returns a 0..1 brightness multiplier for the panel nearest a given fixture, using the exact
  // same deterministic hash/tick the panel mesh itself animates with, so a point light and the
  // emissive panel above it always flicker in lockstep rather than as two independent systems.
  _panelFlickerMul(fixtureIdx, elapsed) {
    const panelIdx = this._fixtureNearestPanel ? this._fixtureNearestPanel[fixtureIdx] : -1;
    if (panelIdx < 0 || !this._flickerIndices || !this._flickerIndices.includes(panelIdx)) return 1;
    const seed = hashSeed(panelIdx * 7 + 1, Math.floor(elapsed * 2.7));
    const r = mulberry32(seed)();
    return r > 0.12 ? 1 : 0.12 + r * 0.18;
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

    if (!playerPos) return;
    if (this.fillLight) this.fillLight.position.set(playerPos.x, playerPos.y + 1.1, playerPos.z);
    if (this.fixturePositions.length === 0) return;

    this._reassignCooldown -= dt;
    if (this._reassignCooldown <= 0) {
      this._reassignCooldown = 0.25; // re-evaluate assignments 4x/sec, plenty smooth, cheap
      this._reassignPool(playerPos);
    }

    this._updateCrossfade(dt, elapsed);
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
      const state = this._poolState[i];
      if (i < candidates.length) {
        const fixtureIdx = candidates[i][1];
        const d = Math.sqrt(candidates[i][0]);
        // smoothstep falloff instead of a plain square: keeps the fully-bright core a little
        // wider and rolls off more gently right at the range edge, so a fixture entering/leaving
        // the active pool eases in/out rather than visibly ramping on a hard quadratic curve.
        const t = THREE.MathUtils.clamp(1 - d / this.range, 0, 1);
        const fade = t * t * (3 - 2 * t);
        // Scaled up to match the photometric candela intensity now used by the pool's
        // PointLights (see the constructor note above) -- this is what actually makes each
        // fixture cast visible, falling-off light onto the floor/walls/ceiling around it
        // instead of just producing an emissive dot with no real illumination.
        state.baseIntensity = 11 * fade + 0.6;

        if (fixtureIdx !== state.fixtureIdx && fixtureIdx !== state.pendingFixtureIdx) {
          if (state.fixtureIdx === -1) {
            // slot was already dark/unused -- safe to assign and jump straight there
            state.fixtureIdx = fixtureIdx;
            this.pool[i].position.copy(fixtures[fixtureIdx]);
          } else {
            // slot is lit somewhere else right now -- queue the move, fade out first (see
            // _updateCrossfade), and only relocate once it's actually dark.
            state.pendingFixtureIdx = fixtureIdx;
          }
        }
      } else if (state.fixtureIdx !== -1 || state.pendingFixtureIdx !== -1) {
        // fell out of range entirely: fade out in place, then go fully idle
        state.pendingFixtureIdx = -2; // sentinel: "unassign, don't reassign"
        state.baseIntensity = 0;
      }
    }
  }

  _updateCrossfade(dt, elapsed) {
    const FADE_RATE = 9; // ~110ms time-constant fade, quick but not a pop
    for (let i = 0; i < this.pool.length; i++) {
      const light = this.pool[i];
      const state = this._poolState[i];
      const hasPending = state.pendingFixtureIdx !== -1;
      const flickerMul = state.fixtureIdx >= 0 ? this._panelFlickerMul(state.fixtureIdx, elapsed) : 1;
      state.targetIntensity = hasPending ? 0 : state.baseIntensity * flickerMul;

      light.intensity = THREE.MathUtils.lerp(light.intensity, state.targetIntensity, Math.min(1, dt * FADE_RATE));

      if (hasPending && light.intensity < 0.015) {
        light.intensity = 0;
        if (state.pendingFixtureIdx === -2) {
          state.fixtureIdx = -1;
        } else {
          state.fixtureIdx = state.pendingFixtureIdx;
          light.position.copy(this.fixturePositions[state.fixtureIdx]);
        }
        state.pendingFixtureIdx = -1;
      }
    }
  }
}
