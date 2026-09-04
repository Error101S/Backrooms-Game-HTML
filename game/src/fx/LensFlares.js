import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/addons/objects/Lensflare.js';

// Adds subtle lens-flare streaks/halos to the brightest nearby ceiling fixtures, sold through
// three.js's built-in Lensflare object (it does its own screen-space occlusion test against the
// depth buffer, so flares naturally hide behind walls/corners and only bloom into view once a
// light is actually visible to the camera -- exactly the "light flares" effect requested).
//
// Textures are generated procedurally on a <canvas> (soft round glow + a couple of small ring
// "ghost" elements) rather than shipped as image assets, since nothing in the reference texture
// pack is meant for this.
const FLARE_COUNT_BY_QUALITY = { low: 0, medium: 3, high: 6 };

function makeGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,250,230,0.85)');
  g.addColorStop(0.45, 'rgba(255,240,190,0.25)');
  g.addColorStop(1.0, 'rgba(255,240,190,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRingTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const g = ctx.createRadialGradient(cx, cy, size * 0.22, cx, cy, size * 0.5);
  g.addColorStop(0.0, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,240,200,0.5)');
  g.addColorStop(0.9, 'rgba(255,240,200,0.15)');
  g.addColorStop(1.0, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.5, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class LensFlareSystem {
  constructor(scene, lightGrid, quality) {
    this.scene = scene;
    this.lightGrid = lightGrid;
    this.count = FLARE_COUNT_BY_QUALITY[quality] ?? FLARE_COUNT_BY_QUALITY.medium;
    this.flares = [];
    if (this.count <= 0) return;

    const glowTex = makeGlowTexture();
    const ringTex = makeRingTexture();

    for (let i = 0; i < this.count; i++) {
      const flare = new Lensflare();
      flare.addElement(new LensflareElement(glowTex, 220, 0, new THREE.Color(0xfff6df)));
      flare.addElement(new LensflareElement(ringTex, 55, 0.35, new THREE.Color(0xfff6df)));
      flare.addElement(new LensflareElement(ringTex, 30, 0.6, new THREE.Color(0xd8c98a)));
      flare.visible = false;
      scene.add(flare);
      this.flares.push(flare);
    }
  }

  setQuality(quality) {
    // Rebuilding the pool on quality change is rare (menu toggle) so simplicity wins over reuse.
    for (const f of this.flares) { this.scene.remove(f); f.dispose(); }
    this.flares = [];
    this.count = FLARE_COUNT_BY_QUALITY[quality] ?? FLARE_COUNT_BY_QUALITY.medium;
    if (this.count <= 0) return;
    const glowTex = makeGlowTexture();
    const ringTex = makeRingTexture();
    for (let i = 0; i < this.count; i++) {
      const flare = new Lensflare();
      flare.addElement(new LensflareElement(glowTex, 220, 0, new THREE.Color(0xfff6df)));
      flare.addElement(new LensflareElement(ringTex, 55, 0.35, new THREE.Color(0xfff6df)));
      flare.addElement(new LensflareElement(ringTex, 30, 0.6, new THREE.Color(0xd8c98a)));
      flare.visible = false;
      this.scene.add(flare);
      this.flares.push(flare);
    }
  }

  // Follows the LightGrid's own re-homed PointLight pool (already the N fixtures nearest the
  // player, sorted by distance/brightness) so flares always sit on lights that are actually lit.
  update() {
    if (this.flares.length === 0) return;
    const pool = this.lightGrid.pool;
    for (let i = 0; i < this.flares.length; i++) {
      const flare = this.flares[i];
      const light = pool[i];
      if (!light || light.intensity <= 0.01) {
        flare.visible = false;
        continue;
      }
      flare.visible = true;
      flare.position.copy(light.position);
    }
  }

  dispose() {
    for (const f of this.flares) { this.scene.remove(f); f.dispose(); }
    this.flares = [];
  }
}
