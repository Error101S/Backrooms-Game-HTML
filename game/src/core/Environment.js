import * as THREE from 'three';

// Global lighting mood + fog. The reference footage (image-2) shows an evenly lit,
// slightly warm/dim fluorescent office-basement space with soft falloff into darkness
// down long hallways -- reproduced here with a low warm ambient + hemisphere fill and a
// fog that eats detail at range (also masks the level-of-detail culling boundary).
export function setupEnvironment(scene, quality) {
  scene.background = new THREE.Color(0x0d0b06);

  const hemi = new THREE.HemisphereLight(0x9a916b, 0x141008, 0.55);
  scene.add(hemi);

  const ambient = new THREE.AmbientLight(0xfff3d6, 0.28);
  scene.add(ambient);

  const fog = new THREE.Fog(0x0d0b06, 8, quality.maxDrawDistance);
  scene.fog = fog;

  return { hemi, ambient, fog };
}
