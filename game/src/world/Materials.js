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
  tex.anisotropy = 8;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(path, tex);
  return tex;
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
  // The real patterned wallcovering (subtle chevron/stripe motif) -- this is the texture the
  // reference calls out as "wallpaper", distinct from the flat single-tone painted_wall sets
  // below. This is now the *primary* wall material (previously this slot was wired to the
  // painted_wall files by mistake, so every wall rendered as a flat painted color and the
  // actual wallpaper/ texture files were never used anywhere in the game).
  wallpaper: {
    color: BASE + 'wallpaper/color.jpg',
    normal: BASE + 'wallpaper/normal.jpg',
    rough: BASE + 'wallpaper/rough.jpg',
    metersPerTile: 2.4,
  },
  // Flat painted-wall variants, used as the occasional alternate patch for variety (matching
  // the reference's "different wall here" notes) -- no longer the default.
  paintedWall: {
    color: BASE + 'painted_wall/color.jpg',
    normal: BASE + 'painted_wall/normal.jpg',
    rough: BASE + 'painted_wall/rough.jpg',
    metersPerTile: 2.4,
  },
  paintedWall2: {
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

// IMPORTANT: geometry UVs are already baked directly in *tile units* by GeometryBatcher --
// every call site in World.js passes a `tileSize` to addHorizontalQuad/addWallBoxV/H that
// matches this exact texture set's `metersPerTile` (e.g. carpet uses metersPerTile 2.2 and
// the floor batcher is built with tileSize 2.2), so a UV value of 1.0 already corresponds to
// exactly one real tile. That means `texture.repeat` here must stay at its default (1,1) --
// applying any extra multiplier on top (as a previous version did, scaling by an unrelated
// "room width / metersPerTile" constant) double-tiles the pattern and makes it look wrong at
// every room size (either smeared into a flat blur on large rooms or reduced to noise on
// small ones), which is why the carpet/ceiling/wallpaper patterns read as "not showing up"
// despite the image files themselves loading fine.
function makeMaterial(set, { tint = 0xffffff, roughnessMul = 1, extra = {} } = {}) {
  const color = loadTex(set.color, { srgb: true });
  const normal = loadTex(set.normal);
  const rough = loadTex(set.rough);
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

export function createCarpetMaterial(zone) {
  const tint = ZoneTints[zone] ? ZoneTints[zone].carpet : 0xffffff;
  return makeMaterial(TextureSets.carpet, { tint, roughnessMul: 1 });
}

export function createWallMaterial(zone, alt = false) {
  // Primary wall covering is the real patterned "wallpaper" texture set (per the reference's
  // fabric-look wallcovering); the flat painted_wall set is now only ever the occasional
  // alternate-room variant for subtle visual variety, never the default.
  const set = alt ? TextureSets.paintedWall2 : TextureSets.wallpaper;
  const tint = ZoneTints[zone] ? ZoneTints[zone].wall : 0xffffff;
  return makeMaterial(set, { tint, roughnessMul: 0.95 });
}

export function createCeilingMaterial(alt = false) {
  const set = alt ? TextureSets.ceiling2 : TextureSets.ceiling;
  return makeMaterial(set, { roughnessMul: 1 });
}

export function createPoolMaterial() {
  return makeMaterial(TextureSets.pool, { roughnessMul: 0.6, extra: { metalness: 0.05 } });
}
