import * as THREE from 'three';
import { loadMapData } from '../world/MapData.js';
import { World } from '../world/World.js';
import { Interactables } from '../world/Interactables.js';
import { setupEnvironment } from './Environment.js';
import { getQuality } from './QualitySettings.js';
import { InputManager } from '../player/InputManager.js';
import { PlayerController } from '../player/PlayerController.js';
import { PostFX } from '../fx/PostFX.js';
import { VHSController } from '../fx/VHSController.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { HUD } from '../ui/HUD.js';
import { MenuController } from '../ui/MenuController.js';
import { TouchControls } from '../ui/TouchControls.js';
import { MiniMap } from '../ui/MiniMap.js';

const MAP_URL = './assets/map/runtime_map.json';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.running = false;
    this.qualityName = 'medium';
    this.quality = getQuality(this.qualityName);
    this.clock = new THREE.Clock();
    this.showFPS = false;
    this._fpsSmoothed = 60;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(82, window.innerWidth / window.innerHeight, 0.05, 200);

    this.env = setupEnvironment(this.scene, this.quality);
    this.input = new InputManager(canvas);
    this.audio = new AudioSystem();
    this.hud = new HUD();
    this.postFX = new PostFX(this.renderer, this.scene, this.camera, this.quality);
    this.vhs = new VHSController(this.postFX, {
      tagEl: document.getElementById('vhs-tag'),
      timestampEl: document.getElementById('vhs-timestamp'),
    });
    this.menu = new MenuController(this);
    this.touch = new TouchControls(this.input);

    this.input.onPointerLockChange = (locked) => {
      if (!locked && this.running) {
        // lost pointer lock unexpectedly (e.g. Esc or alt-tab) -> pause the sim
        this.requestPause(true);
      }
    };

    canvas.addEventListener('click', () => {
      if (this.running) this.input.requestPointerLock();
    });

    window.addEventListener('resize', () => this._onResize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyE' && this.running) this._tryInteract();
    });
    // Fail-safe: if the tab loses focus (alt-tab, switching windows) while playing,
    // pause immediately so the player never keeps moving/falling unattended.
    window.addEventListener('blur', () => {
      if (this.running) this.requestPause(true);
    });

    this._loaded = false;
    this._setLoadProgress(0.08);
    this._boot();
  }

  async _boot() {
    this._setLoadProgress(0.25);
    const mapData = await loadMapData(MAP_URL);
    this._setLoadProgress(0.55);
    this.map = mapData;
    this.world = new World(this.scene, mapData, this.qualityName);
    this.interactables = new Interactables(this.scene, mapData, 22);
    this.player = new PlayerController(this.camera, mapData, this.input);
    this.miniMap = new MiniMap(mapData, this.interactables);
    this._loaded = true;
    this._setLoadProgress(1);
    setTimeout(() => {
      const el = document.getElementById('loading');
      if (el) { el.classList.add('hidden'); setTimeout(() => el.remove(), 700); }
    }, 250);
  }

  _setLoadProgress(p) {
    const fill = document.getElementById('loadbar-fill');
    if (fill) fill.style.width = Math.round(p * 100) + '%';
  }

  requestResume() {
    if (!this._loaded) return;
    this.running = true;
    this._userPaused = false;
    this.menu.showPauseMenu(false);
    this.menu.showPointerHint(false);
    this.audio.ensureStarted();
    this.audio.resume();
    this.input.requestPointerLock();
    this.clock.getDelta(); // avoid a big dt jump after being paused
  }

  requestPause(fromLostLock = false) {
    this.running = false;
    this._userPaused = true;
    this.menu.showPauseMenu(true);
    this.menu.showPointerHint(false);
    this.input.exitPointerLock();
  }

  toggleVHS() { this.vhs.toggle(); }

  setQuality(name) {
    this.qualityName = name;
    this.quality = getQuality(name);
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.postFX.setQuality(this.quality);
    this.scene.fog.far = this.quality.maxDrawDistance;
    this._onResize();
  }

  setSensitivity(v) { if (this.player) this.player.sensitivity = v; }
  setFOV(v) { this.camera.fov = v; this.camera.updateProjectionMatrix(); }

  toggleFPS() {
    this.showFPS = !this.showFPS;
    this.hud.fpsCounter.classList.toggle('show', this.showFPS);
    return this.showFPS;
  }

  _onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.postFX.setSize(w, h, this.renderer.getPixelRatio());
  }

  _tryInteract() {
    if (!this.interactables) return;
    const item = this.interactables.findNearby(this.camera.position);
    if (item) {
      this.interactables.collect(item);
      this.hud.showNote(item.text);
      this.audio.playInteract();
    }
  }

  start() {
    this.renderer.setAnimationLoop((t) => this._tick(t));
  }

  _tick() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const elapsed = this.clock.elapsedTime;

    if (this.running && this._loaded) {
      const [dx, dy] = this.input.consumeMouseDelta();
      const touchLook = this.input.touch;
      this.player.handleLook(dx + touchLook.lookX * 14, dy + touchLook.lookY * 14);

      this.player.update(dt);
      this.world.update(dt, elapsed, this.player.position);
      this.interactables.update(dt, elapsed);
      this.vhs.update(dt);

      // footstep + interaction feedback
      for (const step of this.player.drainFootsteps()) {
        this.audio.playFootstep({ running: step.running, water: this.player.inWater });
      }
      this.audio.setDroneIntensity(this.player.map.zoneAt(this.player.position.x, this.player.position.z) === -1 ? 0 : 0.15);

      const nearby = this.interactables.findNearby(this.camera.position);
      this.hud.setPrompt(nearby ? 'Press E to examine' : '');
      this.hud.setStamina(this.player.stamina);
      this.hud.setCompass(this.player.yaw);
      this.hud.update(dt);
      if (this.miniMap) this.miniMap.updatePlayer(this.player.position, this.player.yaw);
    }

    this.postFX.update(dt, elapsed);
    this.postFX.render();

    if (this.showFPS) {
      const inst = 1 / Math.max(0.0001, dt);
      this._fpsSmoothed += (inst - this._fpsSmoothed) * 0.08;
      this.hud.setFPS(this._fpsSmoothed);
    }
  }
}
