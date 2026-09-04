// Central tuning knobs so Low/Medium/High presets touch every expensive system consistently.
export const QualityPresets = {
  low: {
    pixelRatioCap: 1.0,
    shadows: false,
    shadowMapSize: 512,
    bloom: false,
    fog: true,
    fxaa: false,
    maxDrawDistance: 55,
  },
  medium: {
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    bloom: true,
    fog: true,
    fxaa: true,
    maxDrawDistance: 75,
  },
  high: {
    pixelRatioCap: 2.0,
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    fog: true,
    fxaa: true,
    maxDrawDistance: 110,
  },
};

export function getQuality(name) {
  return QualityPresets[name] || QualityPresets.medium;
}
