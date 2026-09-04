import * as THREE from 'three';

// Central factory for the PBR materials sourced from the reference texture pack
// (carpet / ceiling tiles / painted wallpaper / pool tiles). Textures are tiled in
// world units so scale stays consistent no matter how large a room is.

const loader = new THREE.TextureLoader();
const cache = new Map();

function loadTex(path, { srgb = false } = {}) {
  if (cache.has(path)) return cache.get(path);
  const tex = loader.load(path);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(path, tex);
  return tex;
}

function cloneRepeat(tex, rx, ry) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  return t;
}

const BASE = './assets/textures/';

export const TextureSets = {
  carpet: {
    color: BASE + 'carpet/color.jpg',
    normal: BASE + 'carpet/normal.jpg',
    rough: BASE + 'carpet/rough.jpg',
    metersPerTile: 2.2,
  },
  ceiling: {
    color: BASE + 'ceiling_tiles/color.jpg',
    normal: BASE + 'ceiling_tiles/normal.jpg',
    rough: BASE + 'ceiling_tiles/rough.jpg',
    metersPerTile: 1.2,
  },
  ceiling2: {
    color: BASE + 'ceiling_tiles_2/color.jpg',
    normal: BASE + 'ceiling_tiles_2/normal.jpg',
    rough: BASE + 'ceiling_tiles_2/rough.jpg',
    metersPerTile: 1.2,
  },
  wallpaper: {
    color: BASE + 'painted_wall/color.jpg',
    normal: BASE + 'painted_wall/normal.jpg',
    rough: BASE + 'painted_wall/rough.jpg',
    metersPerTile: 2.4,
  },
  wallpaper2: {
    color: BASE + 'painted_wall_2/color.jpg',
    normal: BASE + 'painted_wall_2/normal.jpg',
    rough: BASE + 'painted_wall_2/rough.jpg',
    metersPerTile: 2.4,
  },
  pool: {
    color: BASE + 'pool_tiles/color.jpg',
    normal: BASE + 'pool_tiles/normal.jpg',
    rough: BASE + 'pool_tiles/rough.jpg',
    metersPerTile: 1.0,
  },
};

// Zone tints applied on top of the base wallpaper/carpet to echo the reference
// blueprint's color-coded rooms (pink office, tiled area, green carpet room, gray concrete).
// Zone 2 ("blue" on the map) renders as a plain dry tiled floor (pool_tiles texture, see
// createPoolMaterial) rather than water -- this game has no water/flooded areas.
export const ZoneTints = {
  0: { carpet: 0xffffff, wall: 0xffffff },        // tan / default
  1: { carpet: 0xf3c9c2, wall: 0xf1d3cd },        // dusty rose office
  2: { carpet: 0x8fb9d6, wall: 0xffffff },        // tiled area (wall tint only; floor uses pool tile material)
  3: { carpet: 0xafe0b0, wall: 0xd9f0da },        // green carpet room
  4: { carpet: 0xc9cdd3, wall: 0xd7dade },        // gray concrete area
};

function makeMaterial(set, { repeat, tint = 0xffffff, roughnessMul = 1, extra = {} } = {}) {
  const color = cloneRepeat(loadTex(set.color, { srgb: true }), repeat.x, repeat.y);
  const normal = cloneRepeat(loadTex(set.normal), repeat.x, repeat.y);
  const rough = cloneRepeat(loadTex(set.rough), repeat.x, repeat.y);
  return new THREE.MeshStandardMaterial({
    map: color,
    normalMap: normal,
    roughnessMap: rough,
    roughness: roughnessMul,
    metalness: 0.02,
    color: tint,
    ...extra,
  });
}

export function createCarpetMaterial(zone, width, depth) {
  const set = TextureSets.carpet;
  const repeat = new THREE.Vector2(Math.max(0.5, width / set.metersPerTile), Math.max(0.5, depth / set.metersPerTile));
  const tint = ZoneTints[zone] ? ZoneTints[zone].carpet : 0xffffff;
  return makeMaterial(set, { repeat, tint, roughnessMul: 1 });
}

export function createWallMaterial(zone, length, height, alt = false) {
  const set = alt ? TextureSets.wallpaper2 : TextureSets.wallpaper;
  const repeat = new THREE.Vector2(Math.max(0.5, length / set.metersPerTile), Math.max(0.5, height / set.metersPerTile));
  const tint = ZoneTints[zone] ? ZoneTints[zone].wall : 0xffffff;
  return makeMaterial(set, { repeat, tint, roughnessMul: 0.95 });
}

export function createCeilingMaterial(width, depth, alt = false) {
  const set = alt ? TextureSets.ceiling2 : TextureSets.ceiling;
  const repeat = new THREE.Vector2(Math.max(0.5, width / set.metersPerTile), Math.max(0.5, depth / set.metersPerTile));
  return makeMaterial(set, { repeat, roughnessMul: 1 });
}

export function createPoolMaterial(width, depth) {
  const set = TextureSets.pool;
  const repeat = new THREE.Vector2(Math.max(0.5, width / set.metersPerTile), Math.max(0.5, depth / set.metersPerTile));
  return makeMaterial(set, { repeat, roughnessMul: 0.6, extra: { metalness: 0.05 } });
}
