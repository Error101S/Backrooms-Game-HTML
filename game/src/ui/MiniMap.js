// A toggleable top-down map (M key) rendered on a 2D canvas overlay, echoing the
// reference blueprint image itself: same silhouette, same zone colors, plus a live
// player marker + heading arrow and collected-item pins.
const ZONE_COLORS = ['#e8d0a0', '#f0b8ae', '#5aa0cf', '#8ecf92', '#b4b9c1'];

export class MiniMap {
  constructor(mapData, interactables) {
    this.map = mapData;
    this.interactables = interactables;
    this.visible = false;

    this.canvas = document.createElement('canvas');
    this.canvas.id = 'minimap-canvas';
    Object.assign(this.canvas.style, {
      position: 'fixed', inset: '0', margin: 'auto', zIndex: 30,
      background: 'rgba(5,5,3,0.92)', display: 'none',
      border: '1px solid rgba(216,201,138,0.4)',
    });
    document.getElementById('app').appendChild(this.canvas);

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.toggle();
    });
    window.addEventListener('resize', () => this._layout());
    this._layout();
    this._prerender();
  }

  _layout() {
    const size = Math.min(window.innerWidth, window.innerHeight) * 0.82;
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.style.width = size + 'px';
    this.canvas.style.height = size + 'px';
    if (this.visible) this._draw();
  }

  toggle() {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
    if (this.visible) this._draw();
  }

  _prerender() {
    const b = this.map.bounds;
    const worldW = b.maxX - b.minX, worldD = b.maxZ - b.minZ;
    const res = 900;
    const off = document.createElement('canvas');
    off.width = res; off.height = res;
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, res, res);

    const toPx = (x, z) => [
      ((x - b.minX) / worldW) * res,
      ((z - b.minZ) / worldD) * res,
    ];

    const rects = this.map.floorRects;
    for (let i = 0; i < rects.length; i += 5) {
      const [px0, pz0] = toPx(rects[i], rects[i + 1]);
      const [px1, pz1] = toPx(rects[i + 2], rects[i + 3]);
      ctx.fillStyle = ZONE_COLORS[rects[i + 4]] || ZONE_COLORS[0];
      ctx.fillRect(px0, pz0, Math.max(1, px1 - px0), Math.max(1, pz1 - pz0));
    }
    this._prerendered = off;
    this._res = res;
  }

  _draw() {
    const ctx = this.canvas.getContext('2d');
    const w = this.canvas.width, h = this.canvas.height;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this._prerendered, 0, 0, this._res, this._res, 0, 0, w, h);
  }

  updatePlayer(pos, yaw) {
    if (!this.visible) return;
    this._draw();
    const ctx = this.canvas.getContext('2d');
    const b = this.map.bounds;
    const w = this.canvas.width, h = this.canvas.height;
    const px = ((pos.x - b.minX) / (b.maxX - b.minX)) * w;
    const pz = ((pos.z - b.minZ) / (b.maxZ - b.minZ)) * h;

    // collected item pins
    if (this.interactables) {
      ctx.fillStyle = 'rgba(216,201,138,0.9)';
      for (const item of this.interactables.items) {
        if (!item.collected) continue;
        const ix = ((item.mesh.position.x - b.minX) / (b.maxX - b.minX)) * w;
        const iz = ((item.mesh.position.z - b.minZ) / (b.maxZ - b.minZ)) * h;
        ctx.beginPath(); ctx.arc(ix, iz, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(yaw);
    ctx.fillStyle = '#ff5a3c';
    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
