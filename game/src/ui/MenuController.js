// Wires up the start screen, pause menu, and settings controls. Kept separate from
// Game.js so input/UI wiring doesn't clutter the core simulation loop.
export class MenuController {
  constructor(game) {
    this.game = game;
    this.startScreen = document.getElementById('start-screen');
    this.menuLayer = document.getElementById('menu-layer');
    this.pointerHint = document.getElementById('pointer-lock-hint');
    this.paused = true;

    document.getElementById('start-btn').addEventListener('click', () => this._onStart());
    document.getElementById('resume-btn').addEventListener('click', () => this.game.requestResume());

    const vhsBtn = document.getElementById('vhs-toggle-btn');
    vhsBtn.addEventListener('click', () => {
      this.game.toggleVHS();
      vhsBtn.textContent = this.game.vhs.enabled ? 'On' : 'Off';
      vhsBtn.classList.toggle('active', this.game.vhs.enabled);
    });
    this.vhsBtn = vhsBtn;

    const qualitySelect = document.getElementById('quality-select');
    qualitySelect.addEventListener('change', () => this.game.setQuality(qualitySelect.value));

    const sensSlider = document.getElementById('sens-slider');
    sensSlider.addEventListener('input', () => this.game.setSensitivity(parseFloat(sensSlider.value)));

    const fovSlider = document.getElementById('fov-slider');
    fovSlider.addEventListener('input', () => this.game.setFOV(parseFloat(fovSlider.value)));

    const fpsBtn = document.getElementById('fps-toggle-btn');
    fpsBtn.addEventListener('click', () => {
      const show = this.game.toggleFPS();
      fpsBtn.textContent = show ? 'On' : 'Off';
      fpsBtn.classList.toggle('active', show);
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this._onEscape();
      if (e.code === 'KeyV' && !this._isTyping()) this._toggleVHSHotkey();
    });
  }

  _isTyping() { return false; }

  _toggleVHSHotkey() {
    if (this.startScreen.classList.contains('hidden') === false) return;
    this.game.toggleVHS();
    this.vhsBtn.textContent = this.game.vhs.enabled ? 'On' : 'Off';
    this.vhsBtn.classList.toggle('active', this.game.vhs.enabled);
  }

  _onStart() {
    this.startScreen.classList.add('hidden');
    this.game.requestResume();
  }

  _onEscape() {
    if (this.startScreen.classList.contains('hidden') === false) return;
    if (this.game.running) {
      this.game.requestPause();
    } else {
      this.game.requestResume();
    }
  }

  showPauseMenu(show) {
    this.menuLayer.classList.toggle('show', show);
  }

  showPointerHint(show) {
    this.pointerHint.classList.toggle('show', show);
  }
}
