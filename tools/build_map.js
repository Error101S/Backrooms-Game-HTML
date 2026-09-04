// Offline map-extraction pipeline: converts the reference blueprint image
// (the hand-drawn "currently mapped areas of the Backrooms" image) into the compact
// runtime_map.json consumed by game/src/world/MapData.js.
//
// Usage:  cd tools && npm install && node build_map.js
//
// What it does:
//  1. Samples the source PNG on a grid, classifying each cell as inside/outside a room
//     and tagging its color-coded "zone" (tan / pink office / blue water / green carpet / gray concrete).
//  2. Denoises the occupancy grid, then decomposes it into axis-aligned rectangles (floors/ceilings)
//     and merged wall-segment runs, per zone.
//  3. Scatters ceiling light-panel + dynamic-light-fixture candidates across every room.
//  4. Emits everything in world-space meters (flat, precision-trimmed arrays) plus an RLE-encoded
//     collision grid, to game/assets/map/runtime_map.json.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const SRC = path.join(__dirname, '..', 'dm8x0hp-63857b27-e7e8-4bdd-aa12-0971a763eafd.png');
const OUT = path.join(__dirname, '..', 'game', 'assets', 'map', 'runtime_map.json');
const png = PNG.sync.read(fs.readFileSync(SRC));
const { width: IW, height: IH, data } = png;

function getPix(x, y) {
  const i = (y * IW + x) * 4;
  return [data[i], data[i+1], data[i+2], data[i+3]];
}
function isBackgroundish(r,g,b,a) {
  if (a < 128) return true;
  const dGray = Math.abs(r-88)+Math.abs(g-88)+Math.abs(b-88);
  if (dGray < 34) return true;
  if (r>232 && g>232 && b>232) return true;
  if (r<40 && g<40 && b<40) return true;
  return false;
}
function classifyZone(r,g,b) {
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  const sat = max - min;
  if (b > r + 15 && b > g + 10 && b > 150) return 2; // blue water
  if (g > r + 8 && g > b + 8 && g > 150) return 3; // green carpet
  if (r > g + 15 && r > b && g < b + 15 && sat < 60 && r>190) return 1; // dusty rose / pink office
  if (Math.abs(r-g) < 12 && Math.abs(g-b) < 18 && b >= g - 5 && sat < 35 && r > 150 && r < 225) return 4; // gray/silver concrete
  return 0; // tan default
}

const CELL = 14;
const NX = Math.ceil(IW / CELL), NY = Math.ceil(IH / CELL);
let occ = new Uint8Array(NX * NY);
let zoneArr = new Uint8Array(NX * NY);

for (let gy = 0; gy < NY; gy++) {
  for (let gx = 0; gx < NX; gx++) {
    let insideCount = 0, total = 0;
    const zc = [0,0,0,0,0];
    const x0 = gx*CELL, y0 = gy*CELL;
    for (let dy = 0; dy < CELL; dy += 2) {
      const y = y0+dy; if (y >= IH) continue;
      for (let dx = 0; dx < CELL; dx += 2) {
        const x = x0+dx; if (x >= IW) continue;
        total++;
        const [r,g,b,a] = getPix(x,y);
        if (!isBackgroundish(r,g,b,a)) { insideCount++; zc[classifyZone(r,g,b)]++; }
      }
    }
    const inside = total > 0 && (insideCount/total) > 0.4;
    occ[gy*NX+gx] = inside ? 1 : 0;
    if (inside) { let bz=0,bc=-1; for(let z=0;z<5;z++) if (zc[z]>bc){bc=zc[z];bz=z;} zoneArr[gy*NX+gx]=bz; }
  }
}

function get(arr,x,y){ if(x<0||x>=NX||y<0||y>=NY) return 0; return arr[y*NX+x]; }

function majorityPass(src) {
  const out = new Uint8Array(NX*NY);
  for (let y=0;y<NY;y++) for (let x=0;x<NX;x++) {
    let cnt=0;
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) if (get(src,x+dx,y+dy)) cnt++;
    out[y*NX+x] = (cnt>=5) ? 1 : (cnt<=3 ? 0 : src[y*NX+x]);
  }
  return out;
}
occ = majorityPass(occ);
occ = majorityPass(occ);

let insideTotal = 0; for (let i=0;i<occ.length;i++) insideTotal += occ[i];
console.log('inside cells', insideTotal, (100*insideTotal/occ.length).toFixed(1)+'%');

// ---- rectangle decomposition per zone ----
function decomposeRects(mask, nx, ny) {
  const used = new Uint8Array(nx*ny);
  const rects = [];
  for (let y=0;y<ny;y++) for (let x=0;x<nx;x++) {
    const i = y*nx+x;
    if (!mask[i] || used[i]) continue;
    let w=1; while (x+w<nx && mask[y*nx+x+w] && !used[y*nx+x+w]) w++;
    let h=1;
    outer: while (y+h<ny) {
      for (let xx=x; xx<x+w; xx++) { const j=(y+h)*nx+xx; if (!mask[j] || used[j]) break outer; }
      h++;
    }
    for (let yy=y; yy<y+h; yy++) for (let xx=x; xx<x+w; xx++) used[yy*nx+xx]=1;
    rects.push({x,y,w,h});
  }
  return rects;
}
const zoneMasks = [0,1,2,3,4].map(z=>{ const m=new Uint8Array(NX*NY); for(let i=0;i<occ.length;i++) if(occ[i]&&zoneArr[i]===z) m[i]=1; return m; });
const floorRectsGrid = [];
for (let z=0; z<5; z++) for (const r of decomposeRects(zoneMasks[z], NX, NY)) floorRectsGrid.push({...r, zone:z});
console.log('floor rects', floorRectsGrid.length);

// ---- wall segments (grid space) with zone sampled from the inside side ----
function getOcc(x,y){ return get(occ,x,y); }
function getZoneAt(x,y){ return get(zoneArr,x,y); }

const vWallsGrid = [];
for (let x = 0; x <= NX; x++) {
  let runStart = -1;
  for (let y = 0; y <= NY; y++) {
    const a = getOcc(x-1,y), b = getOcc(x,y);
    const differs = (y < NY) && (a !== b);
    if (differs) { if (runStart === -1) runStart = y; }
    else if (runStart !== -1) {
      // sample zone: majority across the run from whichever side is inside
      const zc=[0,0,0,0,0];
      for (let yy=runStart; yy<y; yy++) {
        const insideX = getOcc(x-1,yy) ? x-1 : x;
        zc[getZoneAt(insideX,yy)]++;
      }
      let bz=0,bc=-1; for(let z=0;z<5;z++) if(zc[z]>bc){bc=zc[z];bz=z;}
      vWallsGrid.push({x, y0: runStart, y1: y, zone: bz});
      runStart = -1;
    }
  }
}
const hWallsGrid = [];
for (let y = 0; y <= NY; y++) {
  let runStart = -1;
  for (let x = 0; x <= NX; x++) {
    const a = getOcc(x,y-1), b = getOcc(x,y);
    const differs = (x < NX) && (a !== b);
    if (differs) { if (runStart === -1) runStart = x; }
    else if (runStart !== -1) {
      const zc=[0,0,0,0,0];
      for (let xx=runStart; xx<x; xx++) {
        const insideY = getOcc(xx,y-1) ? y-1 : y;
        zc[getZoneAt(xx,insideY)]++;
      }
      let bz=0,bc=-1; for(let z=0;z<5;z++) if(zc[z]>bc){bc=zc[z];bz=z;}
      hWallsGrid.push({y, x0: runStart, x1: x, zone: bz});
      runStart = -1;
    }
  }
}
console.log('vWalls', vWallsGrid.length, 'hWalls', hWallsGrid.length);

// ---- light fixture candidates on fine grid ----
// dense (visual emissive panels) stride 2, sparse (real dynamic lights) stride 6
function collectLights(stride) {
  const pts = [];
  for (let gy=1; gy<NY-1; gy+=stride) {
    for (let gx=1; gx<NX-1; gx+=stride) {
      if (occ[gy*NX+gx]) {
        // avoid extremely thin 1-cell slivers where a panel would clip walls: require 3x3 all occupied
        let ok = true;
        for (let dy=-1;dy<=1 && ok;dy++) for (let dx=-1;dx<=1;dx++) if (!getOcc(gx+dx,gy+dy)) { ok=false; break; }
        pts.push({ gx, gy, ok });
      }
    }
  }
  return pts;
}
const densePts = collectLights(2);
const sparsePts = collectLights(6);
console.log('dense light candidates', densePts.length, 'sparse', sparsePts.length);

// ---- convert to world space ----
const SCALE = 1.15;
const WALL_THICKNESS = 0.12;
const WALL_HEIGHT = 2.7;
const TALL_WALL_HEIGHT = 4.4;
function wx(gx){ return Math.round((gx - NX/2) * SCALE * 1000)/1000; }
function wz(gy){ return Math.round((gy - NY/2) * SCALE * 1000)/1000; }

const vWalls = [];
for (const w of vWallsGrid) {
  const len = (w.y1-w.y0)*SCALE; if (len < 0.05) continue;
  vWalls.push(wx(w.x), wz(w.y0), wz(w.y1), w.zone);
}
const hWalls = [];
for (const w of hWallsGrid) {
  const len = (w.x1-w.x0)*SCALE; if (len < 0.05) continue;
  hWalls.push(wz(w.y), wx(w.x0), wx(w.x1), w.zone);
}
const floorRects = [];
for (const r of floorRectsGrid) floorRects.push(wx(r.x), wz(r.y), wx(r.x+r.w), wz(r.y+r.h), r.zone);

const lightPanels = [];
let seed = 1337;
function rnd(){ seed = (seed*1103515245+12345)&0x7fffffff; return seed/0x7fffffff; }
for (const p of densePts) {
  if (!p.ok) continue;
  const flicker = rnd() < 0.035 ? 1 : 0;
  lightPanels.push(Math.round(wx(p.gx)*1000)/1000, Math.round(wz(p.gy)*1000)/1000, flicker);
}
const lightFixtures = [];
for (const p of sparsePts) {
  if (!p.ok) continue;
  lightFixtures.push(Math.round(wx(p.gx)*1000)/1000, Math.round(wz(p.gy)*1000)/1000);
}
console.log('lightPanels', lightPanels.length/3, 'lightFixtures', lightFixtures.length/2);

let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
for (let i=0;i<floorRects.length;i+=5) {
  minX=Math.min(minX,floorRects[i]); maxX=Math.max(maxX,floorRects[i+2]);
  minZ=Math.min(minZ,floorRects[i+1]); maxZ=Math.max(maxZ,floorRects[i+3]);
}

// ---- combined occupancy+zone grid for runtime collision & footstep material lookup ----
// value 0 = wall/void, 1..5 = inside with zone (zone+1)
const combined = new Uint8Array(NX*NY);
for (let i=0;i<occ.length;i++) combined[i] = occ[i] ? (zoneArr[i]+1) : 0;
const gridRLE = [];
{
  let curV = combined[0], curC = 0;
  for (let i=0;i<combined.length;i++) {
    if (combined[i] === curV) curC++;
    else { gridRLE.push(curV,curC); curV = combined[i]; curC = 1; }
  }
  gridRLE.push(curV,curC);
}
console.log('gridRLE length', gridRLE.length, 'vs raw', combined.length);

// ---- find a good spawn point: a spacious tan-zone room near map center ----
// search occ grid near center for a cell with large open neighborhood
function openness(gx,gy){
  let r=0;
  while (r<12) {
    let ok=true;
    for (let dy=-r; dy<=r && ok; dy++) for (let dx=-r; dx<=r; dx++) if(!getOcc(gx+dx,gy+dy)){ok=false;break;}
    if (!ok) break;
    r++;
  }
  return r;
}
let best=null, bestScore=-1;
const cx = NX/2, cy = NY/2;
for (let gy=2; gy<NY-2; gy++) for (let gx=2; gx<NX-2; gx++) {
  if (!getOcc(gx,gy)) continue;
  const d = Math.hypot(gx-cx, gy-cy);
  if (d > 60) continue; // search near-ish center first
  const o = openness(gx,gy);
  const score = o*10 - d*0.05;
  if (score > bestScore) { bestScore = score; best = {gx,gy,o}; }
}
if (!best) {
  for (let gy=2; gy<NY-2; gy++) for (let gx=2; gx<NX-2; gx++) {
    if (!getOcc(gx,gy)) continue;
    const o = openness(gx,gy);
    if (o > bestScore) { bestScore=o; best={gx,gy,o}; }
  }
}
const spawn = { x: wx(best.gx), z: wz(best.gy) };
console.log('spawn', spawn, 'openness radius', best.o);

const out = {
  scale: SCALE,
  wallThickness: WALL_THICKNESS,
  wallHeight: WALL_HEIGHT,
  tallWallHeight: TALL_WALL_HEIGHT,
  tallZone: 4,
  waterZone: 2,
  bounds: { minX, maxX, minZ, maxZ },
  spawn,
  vWalls, hWalls, floorRects,
  lightPanels, lightFixtures,
  grid: { nx: NX, ny: NY, cellSize: SCALE, originGX: NX/2, originGY: NY/2, rle: gridRLE },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('wrote', OUT, (fs.statSync(OUT).size / 1024).toFixed(1), 'KB');
