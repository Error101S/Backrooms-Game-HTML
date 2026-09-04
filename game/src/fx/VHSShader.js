import * as THREE from 'three';

// A single combined fragment shader that reproduces the look of a consumer camcorder
// recording onto analog videotape sometime between 1972 and 1997:
//  - barrel/fisheye lens distortion (cheap wide-angle camcorder lens)
//  - NTSC-ish color response: the fluorescent white lights push toward a warm tape-yellow,
//    saturation is boosted then chroma is bled/smeared horizontally (chroma delay)
//  - scanlines + interlace flicker
//  - vignette + soft focus blur at the edges
//  - tape noise/grain, dropout streaks, and a subtle vertical roll/jitter
//  - a rolling status bar look is handled by the DOM overlay (timestamp + REC dot),
//    this shader only owns the *image* degradation.
export const VHSShader = {
  name: 'VHSShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAspect: { value: 1.0 },
    uIntensity: { value: 1.0 },        // master effect blend (0 = off, 1 = full)
    uFisheye: { value: 0.34 },         // lens barrel strength
    uYellowAmount: { value: 0.55 },    // how strongly whites push to yellow tape stock
    uNoiseAmount: { value: 0.09 },
    uScanlineAmount: { value: 0.18 },
    uChromaShift: { value: 0.0035 },
    uVignette: { value: 0.42 },
    uJitter: { value: 1.0 },
    uEraYear: { value: 1987 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uIntensity;
    uniform float uFisheye;
    uniform float uYellowAmount;
    uniform float uNoiseAmount;
    uniform float uScanlineAmount;
    uniform float uChromaShift;
    uniform float uVignette;
    uniform float uJitter;
    uniform float uEraYear;
    uniform float uAspect;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }

    // Wide-angle camcorder lens: barrel distortion around the frame center. The aspect
    // correction keeps the warp circular (not stretched into an ellipse) on wide viewports.
    vec2 fisheyeUv(vec2 uv, float strength, float aspect) {
      vec2 cc = uv - 0.5;
      cc.x *= aspect;
      float dist = dot(cc, cc);
      vec2 warped = cc + cc * dist * strength;
      warped.x /= aspect;
      return warped + 0.5;
    }

    void main() {
      vec2 uv = vUv;

      // --- gentle horizontal roll/jitter typical of a worn tape transport ---
      float rollSpeed = 0.05;
      float rollLine = fract(uv.y * 1.0 + uTime * rollSpeed);
      float jitterBand = smoothstep(0.0, 0.02, rollLine) * smoothstep(1.0, 0.98, rollLine);
      float lineJitter = (hash(vec2(floor(uv.y * 120.0), floor(uTime * 12.0))) - 0.5) * 0.0035 * uJitter;
      uv.x += lineJitter * (1.0 - jitterBand);

      // --- fisheye lens warp ---
      vec2 duv = fisheyeUv(uv, uFisheye * uIntensity, uAspect);

      // out-of-frame -> soft black (camcorder lens vignette edge)
      float outOfFrame = step(0.0, duv.x) * step(duv.x, 1.0) * step(0.0, duv.y) * step(duv.y, 1.0);

      vec2 sampleUv = clamp(duv, 0.001, 0.999);

      // --- chromatic aberration / chroma delay (classic composite video smear) ---
      float shift = uChromaShift * (0.6 + 0.4 * sin(uTime * 0.5));
      float r = texture2D(tDiffuse, sampleUv + vec2(shift, 0.0)).r;
      float g = texture2D(tDiffuse, sampleUv).g;
      float b = texture2D(tDiffuse, sampleUv - vec2(shift, 0.0)).b;
      vec3 color = vec3(r, g, b);

      // --- tape stock color response: push bright whites/fluorescent toward warm yellow ---
      float luma = dot(color, vec3(0.299, 0.587, 0.114));
      float brightMask = smoothstep(0.55, 1.0, luma);
      vec3 yellowShift = vec3(1.08, 1.0, 0.62);
      color = mix(color, color * yellowShift, brightMask * uYellowAmount * uIntensity);
      // overall slight warm base tint + reduced blue matches faded low-band NTSC tape
      color *= vec3(1.05, 1.0, 0.86);
      color = mix(color, vec3(dot(color, vec3(0.33))), 0.06 * uIntensity);

      // saturation boost then soft-clip, mimicking cheap CCD + tape saturation punch
      float sLuma = dot(color, vec3(0.299, 0.587, 0.114));
      color = mix(vec3(sLuma), color, 1.18);

      // --- scanlines ---
      float scan = sin((sampleUv.y) * uResolution.y * 1.0) * 0.5 + 0.5;
      color *= mix(1.0, 0.78 + 0.22 * scan, uScanlineAmount * uIntensity);

      // faint interlace flicker
      float interlace = mod(floor(sampleUv.y * uResolution.y * 0.5) + floor(uTime * 50.0), 2.0);
      color *= 1.0 - (interlace * 0.02 * uIntensity);

      // --- grain / tape noise (older-era stock is noisier / lower fidelity) ---
      float eraNoise = mix(1.6, 0.85, clamp((uEraYear - 1972.0) / 25.0, 0.0, 1.0));
      float grain = noise(sampleUv * uResolution.xy * 0.75 + uTime * 60.0) - 0.5;
      color += grain * uNoiseAmount * eraNoise * uIntensity;

      // occasional horizontal dropout streak
      float dropoutSeed = hash(vec2(floor(uTime * 6.0), floor(sampleUv.y * 60.0)));
      float dropout = step(0.9975, dropoutSeed) * (0.6 + 0.4 * hash(vec2(uTime, sampleUv.y)));
      color = mix(color, vec3(1.0), dropout * 0.5 * uIntensity);

      // --- vignette + soft edge blur feel (approximated by darkening + slight desaturation) ---
      vec2 vc = sampleUv - 0.5;
      float vig = 1.0 - dot(vc, vc) * uVignette * 2.2;
      color *= clamp(vig, 0.0, 1.0);

      // frame edges (fisheye) go black like looking through a camcorder viewfinder lens
      color *= outOfFrame;

      // subtle bottom-heavy darkening typical of consumer camcorders' auto-iris
      color *= 1.0 - 0.05 * smoothstep(0.0, 1.0, sampleUv.y) * uIntensity;

      gl_FragColor = vec4(color, 1.0);
    }
  `,
};
