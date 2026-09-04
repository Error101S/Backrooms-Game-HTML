// Dual virtual joysticks + jump/run buttons for touch devices, feeding the same
// InputManager.touch state the desktop keyboard path uses.
export class TouchControls {
  constructor(input) {
    this.input = input;
    this.container = document.getElementById('mobile-controls');
    this.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (this.isTouch) {
      this.container.classList.add('show');
      this._setupJoystick('joy-move', (x, y) => { input.touch.moveX = x; input.touch.moveY = y; });
      this._setupJoystick('joy-look', (x, y) => { input.touch.lookX = x; input.touch.lookY = y; });
      this._setupButton('jump-btn', (v) => { input.touch.jump = v; });
      this._setupButton('run-btn', (v) => { input.touch.run = v; });
      this._setupLookDrag();
    }
  }

  _setupJoystick(id, onMove) {
    const el = document.getElementById(id);
    const stick = el.querySelector('.stick');
    let active = false, originX = 0, originY = 0, touchId = null;
    const maxR = 40;

    const start = (e) => {
      const t = e.changedTouches ? e.changedTouches[0] : e;
      touchId = e.changedTouches ? t.identifier : 'mouse';
      const rect = el.getBoundingClientRect();
      originX = rect.left + rect.width / 2;
      originY = rect.top + rect.height / 2;
      active = true;
      e.preventDefault();
    };
    const move = (e) => {
      if (!active) return;
      const touches = e.changedTouches ? Array.from(e.changedTouches) : [e];
      const t = touches.find((t) => (e.changedTouches ? t.identifier === touchId : true));
      if (!t) return;
      let dx = t.clientX - originX, dy = t.clientY - originY;
      const len = Math.hypot(dx, dy);
      if (len > maxR) { dx = dx / len * maxR; dy = dy / len * maxR; }
      stick.style.transform = `translate(${dx}px, ${dy}px)`;
      onMove(dx / maxR, dy / maxR);
      e.preventDefault();
    };
    const end = (e) => {
      active = false;
      stick.style.transform = 'translate(0,0)';
      onMove(0, 0);
    };

    el.addEventListener('touchstart', start, { passive: false });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  _setupButton(id, onChange) {
    const el = document.getElementById(id);
    el.addEventListener('touchstart', (e) => { onChange(true); e.preventDefault(); }, { passive: false });
    el.addEventListener('touchend', (e) => { onChange(false); e.preventDefault(); });
    el.addEventListener('touchcancel', () => onChange(false));
  }

  _setupLookDrag() {
    // Swiping anywhere on the right half of the screen (outside the joystick/buttons) rotates the camera.
    let lastX = 0, lastY = 0, active = false, touchId = null;
    const canvas = document.getElementById('gl');
    canvas.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      if (t.clientX < window.innerWidth * 0.42) return;
      touchId = t.identifier;
      lastX = t.clientX; lastY = t.clientY; active = true;
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (!active) return;
      const t = Array.from(e.changedTouches).find((t) => t.identifier === touchId);
      if (!t) return;
      const dx = t.clientX - lastX, dy = t.clientY - lastY;
      lastX = t.clientX; lastY = t.clientY;
      this.input.mouseDX += dx * 2.2;
      this.input.mouseDY += dy * 2.2;
    }, { passive: true });
    canvas.addEventListener('touchend', () => { active = false; });
    canvas.addEventListener('touchcancel', () => { active = false; });
  }
}
