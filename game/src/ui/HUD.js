// Thin wrapper around the HUD DOM nodes declared in index.html -- keeps game logic
// from sprinkling document.getElementById calls everywhere.
export class HUD {
  constructor() {
    this.crosshair = document.getElementById('crosshair');
    this.prompt = document.getElementById('interact-prompt');
    this.staminaFill = document.getElementById('stamina-fill');
    this.noteLog = document.getElementById('note-log');
    this.compass = document.getElementById('compass');
    this.fpsCounter = document.getElementById('fps-counter');
    this._noteTimer = 0;
  }

  setPrompt(text) {
    if (text) {
      this.prompt.textContent = text;
      this.prompt.classList.add('show');
    } else {
      this.prompt.classList.remove('show');
    }
  }

  setStamina(v) {
    this.staminaFill.style.width = Math.round(v * 100) + '%';
    this.staminaFill.style.background = v < 0.2 ? '#c95b3f' : '#b7ac74';
  }

  setCompass(yawRadians) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    let deg = (THREE_RAD2DEG(yawRadians) + 360) % 360;
    const idx = Math.round(deg / 45) % 8;
    this.compass.textContent = dirs[idx];
  }

  showNote(text) {
    this.noteLog.textContent = text;
    this.noteLog.classList.add('show');
    this._noteTimer = 6.0;
  }

  setFPS(v) {
    this.fpsCounter.textContent = 'FPS ' + Math.round(v);
  }

  update(dt) {
    if (this._noteTimer > 0) {
      this._noteTimer -= dt;
      if (this._noteTimer <= 0) this.noteLog.classList.remove('show');
    }
  }
}

function THREE_RAD2DEG(r) { return r * 180 / Math.PI; }
