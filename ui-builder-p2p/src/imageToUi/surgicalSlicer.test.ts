import { describe, expect, it } from 'vitest';
import { MOBILE_CANVAS_WIDTH_PX } from './constants';
import { ROOT_ID } from '../ubSchema';
import {
  generateDeterministicHeroFallback,
  grayRowMeans,
  mergeDeterministicHeroWithSampledGradient,
  sampleTriadicGradientFromImageData,
  segmentHorizontalBands,
  sliceBitmapToUbPlan,
} from './surgicalSlicer';

function makeBarsImageData(): ImageData {
  const w = MOBILE_CANVAS_WIDTH_PX;
  const h = 400;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const dark = y % 120 < 48;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = dark ? 20 : 250;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, w, h);
  }
  return { data, width: w, height: h, colorSpace: 'srgb', dispose: () => {} } as ImageData;
}

describe('surgicalSlicer', () => {
  it('generateDeterministicHeroFallback returns unique ids and row hierarchy', () => {
    const els = generateDeterministicHeroFallback();
    const ids = els.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const root = els.find((e) => e.id === 'root');
    expect(root?.type).toBe('section');
    expect(root?.children?.[0]).toBe('col_stack');
    const toolbar = els.find((e) => e.id === 'row_toolbar');
    expect(toolbar?.type).toBe('row');
    expect(toolbar?.children?.length).toBeGreaterThanOrEqual(4);
  });

  it('segmentHorizontalBands finds repeating dark bands', () => {
    const img = makeBarsImageData();
    const rowMean = grayRowMeans(img.data, img.width, img.height);
    const bands = segmentHorizontalBands(rowMean, 240, 20, 4);
    expect(bands.length).toBeGreaterThanOrEqual(2);
  });

  it('sliceBitmapToUbPlan uses projection when complexity is acceptable', () => {
    const img = makeBarsImageData();
    const res = sliceBitmapToUbPlan(img.width, img.height, img);
    expect(res.elements.length).toBeGreaterThan(0);
    expect(res.complexityScore).toBeGreaterThanOrEqual(0);
  });

  it('mergeDeterministicHeroWithSampledGradient swaps only root background', () => {
    const flat = generateDeterministicHeroFallback();
    const merged = mergeDeterministicHeroWithSampledGradient(flat, 'linear-gradient(0deg, #111, #222)');
    const root = merged.find((e) => e.id === ROOT_ID);
    expect(root?.style?.background).toContain('linear-gradient');
    const other = merged.find((e) => e.id === 'btn_primary');
    expect(other?.style?.background).toEqual(flat.find((e) => e.id === 'btn_primary')?.style?.background);
  });

  it('sampled gradient uses 0%/42%/100% stops', () => {
    const img = makeBarsImageData();
    const gradient = sampleTriadicGradientFromImageData(img.data, img.width, img.height);
    expect(gradient).toContain(' 0%');
    expect(gradient).toContain(' 42%');
    expect(gradient).toContain(' 100%');
  });
});
