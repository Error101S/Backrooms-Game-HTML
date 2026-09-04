import * as THREE from 'three';
import { hashSeed, mulberry32 } from '../utils/PRNG.js';

// Scatters lore pickups through the mapped rooms, echoing the hand-written annotations
// visible on the reference blueprint ("found wedding ring in this cabinet", "found satchel
// and empty notebook here", "mummified rat", etc). These are the game's primary interaction
// / feedback loop: look at a glowing item, press E, it's logged to the HUD note panel and
// counted toward a small completion goal.
const LORE_ENTRIES = [
  'Found a wedding ring in this cabinet. No name inside.',
  'A satchel and an empty notebook, half-buried in dust.',
  'Old camp gear here. Another survivor, maybe. Or maybe not anymore.',
  'A shoe. Just one. No sign of its owner.',
  'Tarnished tenor saxophone, valves seized solid.',
  'Torn wallpaper -- something was clawed off the wall here.',
  'A mannequin propped in the corner. It wasn\'t here a second ago... was it?',
  'Mahogany desk, gold pen still chained to it. The chain is snapped.',
  'A child\'s cardboard covenant, folded into a paper crane.',
  'Faded Polaroid: a man falling through a floor into a yellow room.',
  'Someone carved tally marks into the concrete. There are hundreds.',
  'A leather sofa, oddly warm to the touch.',
  'Receipts stuffed in a cupboard, all in a language you almost recognize.',
  'The horse skull is exactly where the note said it would be.',
  'A tiny red room, empty except for the smell of static.',
  'Melted crayons fused into the carpet fibers.',
  'This journal page just says "1500m -- 79F" over and over.',
  'A rotary phone, no cord, ringing very faintly when you pick it up.',
];

const PICKUP_RADIUS = 0.55;
const INTERACT_DISTANCE = 2.2;

export class Interactables {
  constructor(scene, mapData, count = 22) {
    this.scene = scene;
    this.map = mapData;
    this.items = [];
    this.total = 0;
    this.found = 0;
    this._buildItems(count);
  }

  _buildItems(count) {
    const rects = this.map.floorRects;
    const candidates = [];
    for (let i = 0; i < rects.length; i += 5) {
      const x0 = rects[i], z0 = rects[i + 1], x1 = rects[i + 2], z1 = rects[i + 3], zone = rects[i + 4];
      const w = x1 - x0, d = z1 - z0;
      if (w < 1.6 || d < 1.6) continue; // skip narrow corridor slivers, prefer roomy spots
      candidates.push({ cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w, d, zone });
    }
    // deterministic shuffle+pick so the layout is stable across sessions
    const rand = mulberry32(hashSeed(1000, 7331));
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    const geo = new THREE.OctahedronGeometry(0.11, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xd8c98a, emissive: 0x554417, emissiveIntensity: 1.1, roughness: 0.35, metalness: 0.4,
    });

    const n = Math.min(count, candidates.length, LORE_ENTRIES.length);
    for (let i = 0; i < n; i++) {
      const c = candidates[i];
      const jitterX = (rand() - 0.5) * Math.min(1.2, c.w * 0.3);
      const jitterZ = (rand() - 0.5) * Math.min(1.2, c.d * 0.3);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(c.cx + jitterX, 0.55, c.cz + jitterZ);
      mesh.castShadow = true;
      const light = new THREE.PointLight(0xd8c98a, 0.5, 2.2, 2);
      light.position.set(0, 0.15, 0);
      mesh.add(light);
      this.scene.add(mesh);
      this.items.push({ mesh, light, text: LORE_ENTRIES[i], collected: false, baseY: 0.55 });
    }
    this.total = this.items.length;
  }

  update(dt, elapsed) {
    for (const item of this.items) {
      if (item.collected) continue;
      item.mesh.rotation.y += dt * 1.2;
      item.mesh.position.y = item.baseY + Math.sin(elapsed * 1.6 + item.mesh.position.x) * 0.06;
    }
  }

  // Returns the nearest interactable within range of the player, or null.
  findNearby(playerPos) {
    let best = null, bestDist = INTERACT_DISTANCE;
    for (const item of this.items) {
      if (item.collected) continue;
      const d = item.mesh.position.distanceTo(playerPos);
      if (d < bestDist) { bestDist = d; best = item; }
    }
    return best;
  }

  collect(item) {
    if (item.collected) return;
    item.collected = true;
    item.mesh.visible = false;
    this.found++;
  }
}
