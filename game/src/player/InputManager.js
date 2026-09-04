// Centralizes keyboard / mouse / touch input so the rest of the game only reads simple state.
export class InputManager {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.pointerLocked = false;
    this.touch = {
      moveX: 0, moveY: 0, lookX: 0, lookY: 0,
      jump: false, run: false,
    };

    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onPointerLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
      this.onPointerLockChange && this.onPointerLockChange(this.pointerLocked);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
  }

  isDown(code) { return this.keys.has(code); }

  requestPointerLock() {
    if (this.dom.requestPointerLock) this.dom.requestPointerLock();
  }

  exitPointerLock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  consumeMouseDelta() {
    const dx = this.mouseDX, dy = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;
    return [dx, dy];
  }

  get moveVector() {
    let x = 0, z = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    x += this.touch.moveX;
    z += this.touch.moveY;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z };
  }

  get running() {
    return this.isDown('ShiftLeft') || this.isDown('ShiftRight') || this.touch.run;
  }

  get jumpPressed() {
    return this.isDown('Space') || this.touch.jump;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
  }
}
