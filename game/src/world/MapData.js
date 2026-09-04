// Loads the pre-processed runtime map (derived offline from the reference blueprint image)
// and exposes fast collision + zone lookups used by the whole game.

export const ZONE_TAN = 0;
export const ZONE_PINK = 1;
export const ZONE_WATER = 2;
export const ZONE_GREEN = 3;
export const ZONE_CONCRETE = 4;

export class MapData {
  constructor(json) {
    this.scale = json.scale;
    this.wallThickness = json.wallThickness;
    this.wallHeight = json.wallHeight;
    this.tallWallHeight = json.tallWallHeight;
    this.tallZone = json.tallZone;
    this.waterZone = json.waterZone;
    this.bounds = json.bounds;
    this.spawn = json.spawn;

    this.vWalls = json.vWalls;   // flat [x, z0, z1, zone, ...]
    this.hWalls = json.hWalls;   // flat [z, x0, x1, zone, ...]
    this.floorRects = json.floorRects; // flat [x0,z0,x1,z1,zone, ...]
    this.lightPanels = json.lightPanels; // flat [x,z,flicker, ...]
    this.lightFixtures = json.lightFixtures; // flat [x,z, ...]

    const g = json.grid;
    this.gridNX = g.nx;
    this.gridNY = g.ny;
    this.gridCell = g.cellSize;
    this.gridOX = g.originGX;
    this.gridOY = g.originGY;
    this.grid = decodeRLE(g.rle, g.nx * g.ny);

    this._buildSpatialIndex();
  }

  // world -> grid cell coords
  worldToGrid(x, z) {
    const gx = Math.floor(x / this.gridCell + this.gridOX);
    const gy = Math.floor(z / this.gridCell + this.gridOY);
    return [gx, gy];
  }

  gridValueAt(gx, gy) {
    if (gx < 0 || gy < 0 || gx >= this.gridNX || gy >= this.gridNY) return 0;
    return this.grid[gy * this.gridNX + gx];
  }

  // Returns zone index (0..4) or -1 if outside any room (wall/void) at this world position
  zoneAt(x, z) {
    const [gx, gy] = this.worldToGrid(x, z);
    const v = this.gridValueAt(gx, gy);
    return v === 0 ? -1 : v - 1;
  }

  isInsideAt(x, z) {
    return this.zoneAt(x, z) !== -1;
  }

  // Build a uniform spatial hash of wall segments for fast nearby queries during collision resolution.
  _buildSpatialIndex() {
    const CELL = 6; // meters per bucket
    this.hashCell = CELL;
    this.wallBuckets = new Map();

    const addToBucket = (minX, maxX, minZ, maxZ, entry) => {
      const gx0 = Math.floor(minX / CELL), gx1 = Math.floor(maxX / CELL);
      const gz0 = Math.floor(minZ / CELL), gz1 = Math.floor(maxZ / CELL);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gz = gz0; gz <= gz1; gz++) {
          const key = gx + '_' + gz;
          let arr = this.wallBuckets.get(key);
          if (!arr) { arr = []; this.wallBuckets.set(key, arr); }
          arr.push(entry);
        }
      }
    };

    const halfT = this.wallThickness / 2;
    for (let i = 0; i < this.vWalls.length; i += 4) {
      const x = this.vWalls[i], z0 = this.vWalls[i + 1], z1 = this.vWalls[i + 2], zone = this.vWalls[i + 3];
      const entry = { orient: 0, x, z0: Math.min(z0, z1), z1: Math.max(z0, z1), zone };
      addToBucket(x - halfT, x + halfT, entry.z0, entry.z1, entry);
    }
    for (let i = 0; i < this.hWalls.length; i += 4) {
      const z = this.hWalls[i], x0 = this.hWalls[i + 1], x1 = this.hWalls[i + 2], zone = this.hWalls[i + 3];
      const entry = { orient: 1, z, x0: Math.min(x0, x1), x1: Math.max(x0, x1), zone };
      addToBucket(entry.x0, entry.x1, z - halfT, z + halfT, entry);
    }
  }

  // Query nearby wall segment entries around a world point within radius (meters)
  queryWallsNear(x, z, radius) {
    const CELL = this.hashCell;
    const gx0 = Math.floor((x - radius) / CELL), gx1 = Math.floor((x + radius) / CELL);
    const gz0 = Math.floor((z - radius) / CELL), gz1 = Math.floor((z + radius) / CELL);
    const seen = new Set();
    const out = [];
    for (let gx = gx0; gx <= gx1; gx++) {
      for (let gz = gz0; gz <= gz1; gz++) {
        const arr = this.wallBuckets.get(gx + '_' + gz);
        if (!arr) continue;
        for (const e of arr) {
          if (seen.has(e)) continue;
          seen.add(e);
          out.push(e);
        }
      }
    }
    return out;
  }
}

function decodeRLE(rle, totalLen) {
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (let i = 0; i < rle.length; i += 2) {
    const v = rle[i], c = rle[i + 1];
    out.fill(v, p, p + c);
    p += c;
  }
  return out;
}

export async function loadMapData(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load map data: ' + res.status);
  const json = await res.json();
  return new MapData(json);
}
