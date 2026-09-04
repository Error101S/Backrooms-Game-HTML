import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { VHSShader } from './VHSShader.js';

// Owns the render pipeline: base scene render -> optional bloom (sells the glowing ceiling
// panels) -> VHS pass (only active in camcorder mode) -> output/tonemap.
export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.82);
    this.bloomPass.enabled = !!quality.bloom;
    this.composer.addPass(this.bloomPass);

    this.vhsPass = new ShaderPass(VHSShader);
    this.vhsPass.enabled = false;
    this.composer.addPass(this.vhsPass);

    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.vhsEnabled = false;
    this.setSize(window.innerWidth, window.innerHeight, renderer.getPixelRatio());
  }

  setQuality(quality) {
    this.bloomPass.enabled = !!quality.bloom;
  }

  setSize(w, h, pixelRatio) {
    this.composer.setSize(w, h);
    this.composer.setPixelRatio(pixelRatio);
    this.vhsPass.uniforms.uResolution.value.set(w * pixelRatio, h * pixelRatio);
    this.vhsPass.uniforms.uAspect.value = w / h;
  }

  setVHS(enabled) {
    this.vhsEnabled = enabled;
    this.vhsPass.enabled = enabled;
  }

  update(dt, elapsed) {
    if (this.vhsEnabled) {
      this.vhsPass.uniforms.uTime.value = elapsed;
    }
  }

  render() {
    this.composer.render();
  }
}
