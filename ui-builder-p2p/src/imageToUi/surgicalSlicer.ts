import type { UbElementJson } from '../ubSchema';
import { ROOT_ID } from '../ubSchema';
import {
  MOBILE_CANVAS_WIDTH_PX,
  PIXEL_SNAP,
  SAFE_AREA_TOP_PX,
  SLICE_COMPLEXITY_NODE_BUDGET,
} from './constants';

export const ROW_TOOLBAR_ID = 'row_toolbar';

export type SlicePipelineResult = {
  elements: UbElementJson[];
  usedFallback: boolean;
  /** Heuristic complexity score (nodes + bands) */
  complexityScore: number;
  /** Hero fallback merged with colors sampled from the real bitmap */
  refinedWithSampledGradient?: boolean;
};

export type OcrToken = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  nx: number;
  ny: number;
  nw: number;
  nh: number;
};

export type RegionBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

const MOBILE_LOCK_WIDTH = 390;
const MOBILE_LOCK_HEIGHT = 693;

function normalizeCoordinate(value: number, scale: number): number {
  return Math.max(1, Math.round(value * scale));
}

function boxIoU(a: RegionBox, b: RegionBox): number {
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

function sampleBoxColor(data: Uint8ClampedArray, width: number, height: number, b: RegionBox): string {
  const cx = Math.max(0, Math.min(width - 1, Math.round(b.x + b.w * 0.5)));
  const cy = Math.max(0, Math.min(height - 1, Math.round(b.y + b.h * 0.5)));
  const i = (cy * width + cx) * 4;
  const rr = data[i];
  const gg = data[i + 1];
  const bb = data[i + 2];
  return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
}

function sampleEdgeColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  b: RegionBox,
  edge: 'top' | 'bottom',
): [number, number, number] {
  const x0 = Math.max(0, Math.min(width - 1, b.x));
  const y0 = Math.max(0, Math.min(height - 1, b.y));
  const x1 = Math.max(x0 + 1, Math.min(width, b.x + b.w));
  const y1 = Math.max(y0 + 1, Math.min(height, b.y + b.h));
  const rowY = edge === 'top' ? y0 : y1 - 1;
  let r = 0;
  let g = 0;
  let bl = 0;
  let n = 0;
  for (let x = x0; x < x1; x += 2) {
    const i = (rowY * width + x) * 4;
    r += data[i];
    g += data[i + 1];
    bl += data[i + 2];
    n++;
  }
  if (!n) return [148, 163, 184];
  return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
}

function rgbTupleToCss(rgb: [number, number, number]): string {
  return `#${rgb[0].toString(16).padStart(2, '0')}${rgb[1].toString(16).padStart(2, '0')}${rgb[2].toString(16).padStart(2, '0')}`;
}

function colorDeltaPercent(a: [number, number, number], b: [number, number, number]): number {
  const d = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  return d / (255 * 3);
}

function sampleRegionFill(data: Uint8ClampedArray, width: number, height: number, b: RegionBox): string {
  const top = sampleEdgeColor(data, width, height, b, 'top');
  const bottom = sampleEdgeColor(data, width, height, b, 'bottom');
  if (colorDeltaPercent(top, bottom) > 0.1) {
    return `linear-gradient(180deg, ${rgbTupleToCss(top)} 0%, ${rgbTupleToCss(bottom)} 100%)`;
  }
  return sampleBoxColor(data, width, height, b);
}

function sampleLumaAt(data: Uint8ClampedArray, width: number, height: number, x: number, y: number): number {
  const sx = Math.max(0, Math.min(width - 1, Math.round(x)));
  const sy = Math.max(0, Math.min(height - 1, Math.round(y)));
  const i = (sy * width + sx) * 4;
  return (data[i] + data[i + 1] + data[i + 2]) / 3;
}

function detectBorderRadiusPx(data: Uint8ClampedArray, width: number, height: number, b: RegionBox): number {
  const r = Math.max(2, Math.min(16, Math.floor(Math.min(b.w, b.h) * 0.18)));
  const cx = b.x + b.w * 0.5;
  const cy = b.y + b.h * 0.5;
  const center = sampleLumaAt(data, width, height, cx, cy);
  const topLeft = sampleLumaAt(data, width, height, b.x + 1, b.y + 1);
  const topRight = sampleLumaAt(data, width, height, b.x + b.w - 2, b.y + 1);
  const botLeft = sampleLumaAt(data, width, height, b.x + 1, b.y + b.h - 2);
  const botRight = sampleLumaAt(data, width, height, b.x + b.w - 2, b.y + b.h - 2);
  const edgeMidTop = sampleLumaAt(data, width, height, b.x + b.w * 0.5, b.y + 1);
  const cornerDelta = (Math.abs(topLeft - center) + Math.abs(topRight - center) + Math.abs(botLeft - center) + Math.abs(botRight - center)) / 4;
  const edgeDelta = Math.abs(edgeMidTop - center);
  if (cornerDelta > edgeDelta * 1.2 && cornerDelta > 8) return r;
  return Math.max(2, Math.floor(r * 0.5));
}

function estimateFontWeightFromToken(data: Uint8ClampedArray, width: number, height: number, t: OcrToken): string {
  const x0 = Math.max(0, t.x);
  const y0 = Math.max(0, t.y);
  const x1 = Math.min(width, t.x + t.w);
  const y1 = Math.min(height, t.y + t.h);
  let dark = 0;
  let n = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = (y * width + x) * 4;
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (l < 130) dark++;
      n++;
    }
  }
  const density = n ? dark / n : 0.15;
  if (density > 0.26) return '800';
  if (density > 0.18) return '700';
  if (density > 0.11) return '600';
  return '500';
}

function rgbAt(data: Uint8ClampedArray, w: number, h: number, x: number, y: number): string {
  const xi = Math.min(w - 1, Math.max(0, Math.floor(x)));
  const yi = Math.min(h - 1, Math.max(0, Math.floor(y)));
  const i = (yi * w + xi) * 4;
  return `#${data[i].toString(16).padStart(2, '0')}${data[i + 1].toString(16).padStart(2, '0')}${data[i + 2].toString(16).padStart(2, '0')}`;
}

/** Three-point sample → CSS gradient aligned with the deterministic hero angle */
export function sampleTriadicGradientFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const c1 = rgbAt(data, width, height, 0, height * 0.12);
  const c2 = rgbAt(data, width, height, width * 0.42, height * 0.48);
  const c3 = rgbAt(data, width, height, width * 0.92, height * 0.88);
  return `linear-gradient(165deg, ${c1} 0%, ${c2} 42%, ${c3} 100%)`;
}

/** Applies sampled gradient to the root section background (deterministic tree intact). */
export function mergeDeterministicHeroWithSampledGradient(
  flat: UbElementJson[],
  gradientCss: string,
): UbElementJson[] {
  return flat.map((e) =>
    e.id === ROOT_ID ? { ...e, style: { ...e.style, background: gradientCss } } : e,
  );
}

export function grayRowMeans(data: Uint8ClampedArray, width: number, height: number): Float64Array {
  const out = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let acc = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      acc += (r + g + b) / 3;
    }
    out[y] = acc / width;
  }
  return out;
}

/** Segment horizontal bands where content is darker than `threshold` */
export function segmentHorizontalBands(
  rowMean: Float64Array,
  threshold = 248,
  minBandPx = 36,
  minGapPx = 6,
): [number, number][] {
  const h = rowMean.length;
  const bands: [number, number][] = [];
  let y = 0;
  while (y < h) {
    while (y < h && rowMean[y] >= threshold) y++;
    if (y >= h) break;
    const y0 = y;
    while (y < h && rowMean[y] < threshold) y++;
    const y1 = y;
    if (y1 - y0 >= minBandPx) bands.push([y0, y1]);
    else if (y1 - y0 >= minGapPx) y = y1;
  }
  return bands;
}

export function estimateBitmapComplexity(width: number, height: number, data: Uint8ClampedArray): number {
  let edge = 0;
  const stride = 4;
  for (let y = 1; y < height - 1; y += 2) {
    for (let x = 1; x < width - 1; x += 2) {
      const i = (y * width + x) * stride;
      const g0 = (data[i] + data[i + 1] + data[i + 2]) / 3;
      const i2 = (y * width + (x + 1)) * stride;
      const g1 = (data[i2] + data[i2 + 1] + data[i2 + 2]) / 3;
      edge += Math.abs(g0 - g1);
    }
  }
  const norm = edge / ((width / 2) * (height / 2));
  const bands = segmentHorizontalBands(grayRowMeans(data, width, height));
  return PIXEL_SNAP(norm * 2 + bands.length * 6 + width * 0.01);
}

function lumaAt(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4;
  return (data[i] + data[i + 1] + data[i + 2]) / 3;
}

function cutPointsFromDiffs(diffs: number[], minGap: number): number[] {
  if (diffs.length === 0) return [];
  const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  const variance = diffs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / diffs.length;
  const std = Math.sqrt(variance);
  const threshold = mean + std * 1.25;
  const cuts: number[] = [];
  let last = -9999;
  for (let i = 0; i < diffs.length; i++) {
    if (diffs[i] > threshold && i - last >= minGap) {
      cuts.push(i);
      last = i;
    }
  }
  return cuts;
}

function segmentsFromCuts(size: number, cuts: number[], minSeg: number): [number, number][] {
  const out: [number, number][] = [];
  const pts = [0, ...cuts, size - 1];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = pts[i];
    const e = pts[i + 1];
    if (e - s >= minSeg) out.push([s, e]);
  }
  return out.length ? out : [[0, Math.max(0, size - 1)]];
}

export function detectRegionBoxesFromImageData(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): RegionBox[] {
  if (width < 2 || height < 2) return [];
  const rowDiffs = new Array<number>(height - 1).fill(0);
  const colDiffs = new Array<number>(width - 1).fill(0);

  for (let y = 0; y < height - 1; y++) {
    let acc = 0;
    for (let x = 0; x < width; x += 2) {
      acc += Math.abs(lumaAt(data, width, x, y + 1) - lumaAt(data, width, x, y));
    }
    rowDiffs[y] = acc / Math.max(1, Math.floor(width / 2));
  }
  for (let x = 0; x < width - 1; x++) {
    let acc = 0;
    for (let y = 0; y < height; y += 2) {
      acc += Math.abs(lumaAt(data, width, x + 1, y) - lumaAt(data, width, x, y));
    }
    colDiffs[x] = acc / Math.max(1, Math.floor(height / 2));
  }

  const rowCuts = cutPointsFromDiffs(rowDiffs, Math.max(16, Math.floor(height * 0.06)));
  const colCuts = cutPointsFromDiffs(colDiffs, Math.max(16, Math.floor(width * 0.06)));
  const rowSegs = segmentsFromCuts(height, rowCuts, Math.max(18, Math.floor(height * 0.05)));
  const colSegs = segmentsFromCuts(width, colCuts, Math.max(18, Math.floor(width * 0.07)));

  const boxes: RegionBox[] = [];
  for (const [y0, y1] of rowSegs) {
    for (const [x0, x1] of colSegs) {
      const w = x1 - x0;
      const h = y1 - y0;
      if (w < Math.max(28, width * 0.08) || h < Math.max(20, height * 0.03)) continue;
      let lumaAcc = 0;
      let n = 0;
      for (let y = y0; y < y1; y += 4) {
        for (let x = x0; x < x1; x += 4) {
          lumaAcc += lumaAt(data, width, x, y);
          n++;
        }
      }
      const luma = n ? lumaAcc / n : 255;
      if (luma > 251) continue;
      boxes.push({ x: x0, y: y0, w, h });
    }
  }
  boxes.sort((a, b) => b.w * b.h - a.w * a.h);
  const filtered: RegionBox[] = [];
  for (const b of boxes) {
    const duplicate = filtered.some((f) => boxIoU(f, b) > 0.62);
    if (duplicate) continue;
    filtered.push(b);
    if (filtered.length >= 28) break;
  }
  return filtered;
}

export function sampleBackgroundColor(data: Uint8ClampedArray, width: number, height: number): string {
  const points: [number, number][] = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
    [Math.floor(width * 0.5), Math.floor(height * 0.5)],
  ];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const [x, y] of points) {
    const i = (Math.max(0, y) * width + Math.max(0, x)) * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = points.length;
  const rr = Math.round(r / n);
  const gg = Math.round(g / n);
  const bb = Math.round(b / n);
  return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
}

export function buildBlankContainerFromRaster(
  width: number,
  height: number,
  data: Uint8ClampedArray,
): UbElementJson[] {
  return [
    {
      id: ROOT_ID,
      type: 'section',
      style: {
        width: `${width}px`,
        maxWidth: `${width}px`,
        height: 'auto',
        maxHeight: 'none',
        margin: '0 auto',
        position: 'relative',
        background: sampleBackgroundColor(data, width, height),
      },
      children: [],
    },
  ];
}

export function synthesizeAbsoluteDomFromRegions(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  boxes: RegionBox[],
  tokens: OcrToken[],
): UbElementJson[] {
  const viewportHeight = MOBILE_LOCK_HEIGHT;
  const validBoxes = boxes.filter(
    (b) =>
      b.w > 8 &&
      b.h > 8 &&
      !(b.w > width * 0.55 && b.h > height * 0.75) &&
      !(b.w > width * 0.9 && b.h > height * 0.35),
  );
  const elements: UbElementJson[] = [
    {
      id: ROOT_ID,
      type: 'section',
      style: {
        width: `${MOBILE_LOCK_WIDTH}px`,
        maxWidth: `${MOBILE_LOCK_WIDTH}px`,
        height: `${viewportHeight}px`,
        maxHeight: `${viewportHeight}px`,
        margin: '0 auto',
        position: 'relative',
        overflow: 'hidden',
        background: sampleBackgroundColor(data, width, height),
      },
      children: ['zone_main_viewport'],
    },
    {
      id: 'zone_main_viewport',
      type: 'column',
      style: {
        position: 'relative',
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        paddingTop: `${SAFE_AREA_TOP_PX}px`,
      },
      children: [],
    },
  ];
  const viewport = elements[1];

  const tokenUsed = new Array(tokens.length).fill(false);
  const boxUsed = new Array(validBoxes.length).fill(false);

  const tokenInside = (t: OcrToken, b: RegionBox) =>
    t.x >= b.x - 2 &&
    t.y >= b.y - 2 &&
    t.x + t.w <= b.x + b.w + 2 &&
    t.y + t.h <= b.y + b.h + 2;

  const iconCandidateIdx: number[] = [];
  const barCandidateIdx: number[] = [];
  validBoxes.forEach((b, i) => {
    const ratio = b.w / Math.max(1, b.h);
    if (b.w >= 16 && b.w <= 72 && b.h >= 16 && b.h <= 72 && ratio > 0.55 && ratio < 1.8) {
      iconCandidateIdx.push(i);
      return;
    }
    if (b.w >= Math.max(84, width * 0.16) && b.h >= 16 && b.h <= Math.max(120, height * 0.2) && ratio > 1.6) {
      barCandidateIdx.push(i);
    }
  });

  const rowGroups: Array<{ iconIdx: number; barIdx: number }> = [];
  iconCandidateIdx.forEach((ii) => {
    const icon = validBoxes[ii];
    const iconCy = icon.y + icon.h * 0.5;
    let best = -1;
    let bestDist = Infinity;
    barCandidateIdx.forEach((bi) => {
      if (boxUsed[bi]) return;
      const bar = validBoxes[bi];
      const barCy = bar.y + bar.h * 0.5;
      const dy = Math.abs(barCy - iconCy);
      if (bar.x <= icon.x) return;
      if (dy <= Math.max(18, Math.min(icon.h, bar.h) * 0.9) && dy < bestDist) {
        best = bi;
        bestDist = dy;
      }
    });
    if (best >= 0) {
      rowGroups.push({ iconIdx: ii, barIdx: best });
      boxUsed[ii] = true;
      boxUsed[best] = true;
    }
  });

  rowGroups.forEach((g, gi) => {
    const icon = validBoxes[g.iconIdx];
    const bar = validBoxes[g.barIdx];
    const rowId = `row_grp_${gi}`;
    const iconId = `${rowId}_icon`;
    const barId = `${rowId}_bar`;
    const x = Math.min(icon.x, bar.x);
    const y = Math.min(icon.y, bar.y);
    const w = Math.max(icon.x + icon.w, bar.x + bar.w) - x;
    const h = Math.max(icon.y + icon.h, bar.y + bar.h) - y;

    viewport.children?.push(rowId);
    elements.push({
      id: rowId,
      type: 'row',
      style: {
        position: 'absolute',
        left: `${x}px`,
        top: `${y}px`,
        width: `${Math.max(1, w)}px`,
        minHeight: `${Math.max(1, h)}px`,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: '10px',
      },
      children: [iconId, barId],
    });
    elements.push({
      id: iconId,
      type: 'icon',
      content: '●',
      style: {
        width: `${Math.max(12, icon.w)}px`,
        height: `${Math.max(12, icon.h)}px`,
        borderRadius: '999px',
        background: 'rgba(148,163,184,0.24)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${Math.max(8, Math.floor(Math.min(icon.w, icon.h) * 0.35))}px`,
        color: '#111827',
      },
    });
    elements.push({
      id: barId,
      type: 'column',
      style: {
        width: `${Math.max(20, bar.w)}px`,
        minHeight: `${Math.max(12, bar.h)}px`,
        borderRadius: '8px',
        background: 'rgba(148,163,184,0.18)',
      },
      children: [],
    });
  });

  validBoxes.forEach((b, i) => {
    if (boxUsed[i]) return;
    const id = `rg_${i}`;
    viewport.children?.push(id);
    const smallIconLike =
      b.w <= 64 &&
      b.h <= 64 &&
      Math.abs(b.w - b.h) <= 18 &&
      (b.x < width * 0.22 || b.y < height * 0.22);
    const regionTokens = tokens
      .map((t, ti) => ({ t, ti }))
      .filter(({ t }) => tokenInside(t, b));

    if (smallIconLike && regionTokens.length === 0) {
      const bg = sampleBoxColor(data, width, height, b);
      const radius = detectBorderRadiusPx(data, width, height, b);
      elements.push({
        id,
        type: 'icon',
        content: '',
        style: {
          position: 'absolute',
          left: `${b.x}px`,
          top: `${b.y}px`,
          width: `${Math.max(1, b.w)}px`,
          height: `${Math.max(1, b.h)}px`,
          borderRadius: `${Math.max(radius, Math.floor(Math.min(b.w, b.h) * 0.45))}px`,
          background: bg,
          color: 'transparent',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          fontSize: `${Math.max(10, Math.round(Math.min(b.w, b.h) * 0.36))}px`,
        },
      });
      return;
    }

    const childIds: string[] = [];
    const bg = sampleBoxColor(data, width, height, b);
    const radius = detectBorderRadiusPx(data, width, height, b);
    elements.push({
      id,
      type: 'column',
      style: {
        position: 'absolute',
        left: `${b.x}px`,
        top: `${b.y}px`,
        width: `${Math.max(1, b.w)}px`,
        minHeight: `${Math.max(1, b.h)}px`,
        borderRadius: `${radius}px`,
        background: bg,
        padding: '4px',
      },
      children: childIds,
    });

    regionTokens.forEach(({ t, ti }, tii) => {
      tokenUsed[ti] = true;
      const tid = `${id}_txt_${tii}`;
      childIds.push(tid);
      elements.push({
        id: tid,
        type: 'text',
        content: t.text,
        style: {
          position: 'absolute',
          left: `${Math.max(0, t.x - b.x)}px`,
          top: `${Math.max(0, t.y - b.y)}px`,
          width: `${Math.max(8, t.w)}px`,
          minHeight: `${Math.max(12, t.h)}px`,
          fontSize: `${Math.max(11, Math.round(t.h * 0.62))}px`,
          fontWeight: estimateFontWeightFromToken(data, width, height, t),
          color: '#111827',
        },
      });
    });

    // Strict mode: do not invent text when OCR did not detect any.
    // This keeps output truthful to extracted content.
  });

  tokens.forEach((t, i) => {
    if (tokenUsed[i]) return;
    const id = `txt_ocr_${i}`;
    viewport.children?.push(id);
    elements.push({
      id,
      type: 'text',
      content: t.text,
      style: {
        position: 'absolute',
        left: `${Math.max(0, t.x)}px`,
        top: `${Math.max(0, t.y)}px`,
        width: `${Math.max(8, t.w)}px`,
        minHeight: `${Math.max(12, t.h)}px`,
        fontSize: `${Math.max(11, Math.round(t.h * 0.62))}px`,
        fontWeight: estimateFontWeightFromToken(data, width, height, t),
        color: '#111827',
      },
    });
  });

  return containerizeAlignedAbsoluteChildren(elements, 'zone_main_viewport');
}

function parsePx(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const m = v.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function containerizeAlignedAbsoluteChildren(elements: UbElementJson[], parentId: string): UbElementJson[] {
  const snap4 = (v: number) => Math.round(v / 4) * 4;
  const parent = elements.find((e) => e.id === parentId);
  if (!parent?.children?.length) return elements;
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  const direct = parent.children
    .map((id) => byId.get(id))
    .filter((e): e is UbElementJson => !!e)
    .filter((e) => ['row', 'column', 'icon'].includes(e.type) && e.style?.position === 'absolute');
  if (direct.length < 2) return elements;

  const nodes = direct.map((e) => {
    const left = parsePx(e.style?.left);
    const top = parsePx(e.style?.top);
    const width = parsePx(e.style?.width);
    const height = parsePx(e.style?.height ?? e.style?.minHeight);
    return { e, left, top, width, height };
  });

  nodes.sort((a, b) => a.top - b.top);
  const clusters: typeof nodes[] = [];
  for (const n of nodes) {
    const c = clusters[clusters.length - 1];
    if (!c) {
      clusters.push([n]);
      continue;
    }
    const avgTop = c.reduce((acc, x) => acc + x.top, 0) / c.length;
    const avgH = c.reduce((acc, x) => acc + x.height, 0) / c.length;
    if (Math.abs(n.top - avgTop) <= Math.max(6, avgH * 0.35)) c.push(n);
    else clusters.push([n]);
  }

  let rowGroupSeq = 0;
  let colGroupSeq = 0;
  const newElements: UbElementJson[] = [];
  const removed = new Set<string>();
  const nextChildren = [...parent.children];

  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const sorted = [...cluster].sort((a, b) => a.left - b.left);
    const minX = Math.min(...sorted.map((n) => n.left));
    const minY = Math.min(...sorted.map((n) => n.top));
    const maxX = Math.max(...sorted.map((n) => n.left + n.width));
    const maxY = Math.max(...sorted.map((n) => n.top + n.height));
    const padTop = 0;
    const padLeft = 0;
    const padRight = 0;
    const padBottom = 0;
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i]!.left - (sorted[i - 1]!.left + sorted[i - 1]!.width);
      if (g >= 0) gaps.push(g);
    }
    const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
    const groupId = `group_row_${rowGroupSeq++}`;
    const childIds = sorted.map((n) => n.e.id);
    newElements.push({
      id: groupId,
      type: 'row',
      style: {
        position: 'absolute',
        left: `${snap4(minX)}px`,
        top: `${snap4(minY)}px`,
        width: `${Math.max(1, maxX - minX)}px`,
        minHeight: `${Math.max(1, maxY - minY)}px`,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: `${avgGap}px`,
        padding: `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`,
        zIndex: '0',
      },
      children: childIds,
    });
    for (const item of sorted) {
      removed.add(item.e.id);
      item.e.style = {
        ...item.e.style,
        position: undefined,
        left: undefined,
        top: undefined,
        zIndex: item.e.type === 'text' || item.e.type === 'icon' ? '1' : item.e.style?.zIndex ?? '0',
      };
    }
    const firstIdx = nextChildren.findIndex((id) => id === childIds[0]);
    if (firstIdx >= 0) nextChildren.splice(firstIdx, childIds.length, groupId);
  }

  parent.children = nextChildren.filter((id) => !removed.has(id));
  elements.push(...newElements);

  // Vertical grouping pass after row synthesis
  const refreshedChildren = parent.children
    ?.map((id) => byId.get(id) ?? elements.find((e) => e.id === id))
    .filter((e): e is UbElementJson => !!e) ?? [];
  const vCandidates = refreshedChildren
    .filter((e) => {
      const st = e.style ?? {};
      return st.position === 'absolute' || e.id.startsWith('group_row_');
    })
    .map((e) => {
      const st = e.style ?? {};
      const left = parsePx(st.left);
      const top = parsePx(st.top);
      const width = parsePx(st.width);
      const height = parsePx(st.height ?? st.minHeight);
      return { e, left, top, width, height };
    })
    .filter((n) => n.width > 0 && n.height > 0)
    .sort((a, b) => a.top - b.top);

  const vClusters: typeof vCandidates[] = [];
  for (const n of vCandidates) {
    const c = vClusters[vClusters.length - 1];
    if (!c) {
      vClusters.push([n]);
      continue;
    }
    const avgLeft = c.reduce((acc, x) => acc + x.left, 0) / c.length;
    const avgWidth = c.reduce((acc, x) => acc + x.width, 0) / c.length;
    if (Math.abs(n.left - avgLeft) <= Math.max(8, avgWidth * 0.25)) c.push(n);
    else vClusters.push([n]);
  }

  for (const cluster of vClusters) {
    if (cluster.length < 2) continue;
    const sorted = [...cluster].sort((a, b) => a.top - b.top);
    const minX = Math.min(...sorted.map((n) => n.left));
    const minY = Math.min(...sorted.map((n) => n.top));
    const maxX = Math.max(...sorted.map((n) => n.left + n.width));
    const maxY = Math.max(...sorted.map((n) => n.top + n.height));
    const widest = sorted.reduce((best, curr) => (curr.width > best.width ? curr : best), sorted[0]!);
    const padTop = Math.max(0, Math.round(widest.top - minY));
    const padLeft = Math.max(0, Math.round(widest.left - minX));
    const padRight = Math.max(0, Math.round(maxX - (widest.left + widest.width)));
    const padBottom = Math.max(0, Math.round(maxY - (widest.top + widest.height)));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const g = sorted[i]!.top - (sorted[i - 1]!.top + sorted[i - 1]!.height);
      if (g >= 0) gaps.push(g);
    }
    const avgGap = gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : 0;
    const groupId = `group_column_${colGroupSeq++}`;
    const childIds = sorted.map((n) => n.e.id);
    newElements.push({
      id: groupId,
      type: 'column',
      style: {
        position: 'absolute',
        left: `${snap4(minX)}px`,
        top: `${snap4(minY)}px`,
        width: `${Math.max(1, maxX - minX)}px`,
        minHeight: `${Math.max(1, maxY - minY)}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: `${avgGap}px`,
        padding: `${padTop}px ${padRight}px ${padBottom}px ${padLeft}px`,
        zIndex: '0',
      },
      children: childIds,
    });
    const firstIdx = parent.children?.findIndex((id) => id === childIds[0]) ?? -1;
    if (firstIdx >= 0 && parent.children) parent.children.splice(firstIdx, childIds.length, groupId);
    for (const item of sorted) {
      item.e.style = {
        ...(item.e.style ?? {}),
        position: undefined,
        left: undefined,
        top: undefined,
        zIndex: item.e.type === 'text' || item.e.type === 'icon' ? '1' : item.e.style?.zIndex ?? '0',
      };
    }
  }

  elements.push(...newElements.filter((e) => e.id.startsWith('group_column_')));

  // enforce strict layering globally
  for (const node of elements) {
    const st = node.style ?? {};
    if (st.position === 'absolute' && node.id !== ROOT_ID) {
      const left = parsePx(st.left);
      const top = parsePx(st.top);
      node.style = { ...st, left: `${snap4(left)}px`, top: `${snap4(top)}px` };
    }
  }

  for (const node of elements) {
    const st = node.style ?? {};
    if (node.type === 'text' || node.type === 'icon') {
      node.style = { ...st, zIndex: '1', position: st.position ?? 'relative' };
    } else if (node.children?.length) {
      node.style = { ...st, position: st.position ?? 'relative', zIndex: st.zIndex ?? '0' };
    }
  }
  return elements;
}

function avgGapFromSorted(starts: number[]): number {
  if (starts.length < 2) return 8;
  let acc = 0;
  let n = 0;
  for (let i = 1; i < starts.length; i++) {
    acc += Math.max(0, starts[i] - starts[i - 1]);
    n++;
  }
  return Math.max(6, Math.min(22, Math.round(acc / Math.max(1, n))));
}

type GluedToken = OcrToken & { members: OcrToken[] };
const UI_FONT_SCALE_PX = [12, 14, 16, 18, 20, 24, 32];

function snapFontSize(px: number): number {
  let best = UI_FONT_SCALE_PX[0] ?? 12;
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of UI_FONT_SCALE_PX) {
    const d = Math.abs(px - s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

function glueOcrTokens(tokens: OcrToken[]): GluedToken[] {
  if (tokens.length === 0) return [];
  const sorted = [...tokens].sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  const out: GluedToken[] = [];
  let current: GluedToken | null = null;
  for (const t of sorted) {
    if (!current) {
      current = { ...t, members: [t] };
      continue;
    }
    const yNear = Math.abs(t.y - current.y) <= 4;
    const expectedNextX = current.x + current.w;
    const xGap = t.x - expectedNextX;
    const smallGap = xGap >= -2 && xGap <= Math.max(18, Math.round(Math.min(current.h, t.h) * 1.2));
    if (yNear && smallGap) {
      current.text = `${current.text} ${t.text}`.replace(/\s+/g, ' ').trim();
      current.w = Math.max(current.x + current.w, t.x + t.w) - current.x;
      current.h = Math.max(current.h, t.h);
      current.members.push(t);
      continue;
    }
    out.push(current);
    current = { ...t, members: [t] };
  }
  if (current) out.push(current);
  return out;
}

function glueOcrTokensByBaseline(tokens: OcrToken[]): GluedToken[] {
  if (tokens.length === 0) return [];
  const sorted = [...tokens].sort((a, b) => (a.y + a.h === b.y + b.h ? a.x - b.x : a.y + a.h - (b.y + b.h)));
  const out: GluedToken[] = [];
  let current: GluedToken | null = null;
  for (const t of sorted) {
    if (!current) {
      current = { ...t, members: [t] };
      continue;
    }
    const baselineA = current.y + current.h;
    const baselineB = t.y + t.h;
    const sameBaseline = Math.abs(baselineA - baselineB) <= 4;
    const xGap = t.x - (current.x + current.w);
    const smallGap = xGap >= -2 && xGap <= Math.max(20, Math.round(Math.min(current.h, t.h) * 1.35));
    if (sameBaseline && smallGap) {
      current.text = `${current.text} ${t.text}`.replace(/\s+/g, ' ').trim();
      current.w = Math.max(current.x + current.w, t.x + t.w) - current.x;
      current.y = Math.min(current.y, t.y);
      current.h = Math.max(current.y + current.h, t.y + t.h) - current.y;
      current.members.push(t);
      continue;
    }
    out.push(current);
    current = { ...t, members: [t] };
  }
  if (current) out.push(current);
  return out;
}

function textNodesFromTokens(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  tokens: OcrToken[],
  idPrefix: string,
): UbElementJson[] {
  const glued = glueOcrTokensByBaseline(tokens);
  return glued.map((t, i) => ({
    id: `${idPrefix}_txt_${i}`,
    type: 'text',
    content: t.text,
    style: {
      fontSize: `${snapFontSize(Math.max(11, Math.round(t.h * 0.62)))}px`,
      fontWeight: estimateFontWeightFromToken(data, width, height, t),
      color: '#111827',
      lineHeight: '1.3',
    },
  }));
}

function tokenInsideBox(t: OcrToken, b: RegionBox): boolean {
  return (
    t.x >= b.x - 2 &&
    t.y >= b.y - 2 &&
    t.x + t.w <= b.x + b.w + 2 &&
    t.y + t.h <= b.y + b.h + 2
  );
}

function boxContains(outer: RegionBox, inner: RegionBox, pad = 2): boolean {
  return (
    inner.x >= outer.x - pad &&
    inner.y >= outer.y - pad &&
    inner.x + inner.w <= outer.x + outer.w + pad &&
    inner.y + inner.h <= outer.y + outer.h + pad
  );
}

function boxArea(b: RegionBox): number {
  return b.w * b.h;
}

function evenPx(v: number): number {
  const n = Math.max(0, Math.round(v));
  return n % 2 === 0 ? n : n + 1;
}

function deriveGapFromBoxes(axis: 'row' | 'column', boxes: RegionBox[]): number {
  if (boxes.length < 2) return 0;
  const sorted = [...boxes].sort((a, b) => (axis === 'row' ? a.x - b.x : a.y - b.y));
  let acc = 0;
  let n = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevEnd = axis === 'row' ? prev.x + prev.w : prev.y + prev.h;
    const currStart = axis === 'row' ? curr.x : curr.y;
    acc += Math.max(0, currStart - prevEnd);
    n++;
  }
  return n ? Math.max(0, Math.round(acc / n)) : 0;
}

function derivePaddingFromChildren(container: RegionBox, children: RegionBox[]): string {
  if (!children.length) return '0px';
  const minX = Math.min(...children.map((c) => c.x));
  const minY = Math.min(...children.map((c) => c.y));
  const maxX = Math.max(...children.map((c) => c.x + c.w));
  const maxY = Math.max(...children.map((c) => c.y + c.h));
  const top = Math.max(0, minY - container.y);
  const right = Math.max(0, container.x + container.w - maxX);
  const bottom = Math.max(0, container.y + container.h - maxY);
  const left = Math.max(0, minX - container.x);
  return `${Math.round(top)}px ${Math.round(right)}px ${Math.round(bottom)}px ${Math.round(left)}px`;
}

type IconGlyph = 'bell' | 'search' | 'menu' | 'avatar' | 'home' | 'user' | 'settings' | 'dot';

function mapIconGlyph(box: RegionBox, canvasW: number, canvasH: number): IconGlyph {
  const cx = box.x + box.w * 0.5;
  const cy = box.y + box.h * 0.5;
  if (cy <= canvasH * 0.22) {
    if (cx >= canvasW * 0.68) return cx >= canvasW * 0.84 ? 'search' : 'bell';
    return cx <= canvasW * 0.18 ? 'menu' : 'avatar';
  }
  if (cy >= canvasH * 0.78) {
    if (cx <= canvasW * 0.33) return 'home';
    if (cx <= canvasW * 0.66) return 'user';
    return 'settings';
  }
  return 'dot';
}

function iconPathForGlyph(glyph: IconGlyph): string {
  switch (glyph) {
    case 'bell':
      return "<path d='M12 4a4 4 0 0 0-4 4v2.4c0 .9-.3 1.7-.9 2.4L6 14h12l-1.1-1.2c-.6-.7-.9-1.5-.9-2.4V8a4 4 0 0 0-4-4'/><path d='M10 17a2 2 0 0 0 4 0'/>";
    case 'search':
      return "<circle cx='11' cy='11' r='5'/><path d='m15 15 4 4'/>";
    case 'menu':
      return "<path d='M4 7h16M4 12h16M4 17h16'/>";
    case 'avatar':
      return "<circle cx='12' cy='9' r='3.2'/><path d='M5.5 19a6.5 6.5 0 0 1 13 0'/>";
    case 'home':
      return "<path d='M4 11.5 12 5l8 6.5'/><path d='M7.5 10.5V19h9v-8.5'/>";
    case 'user':
      return "<circle cx='12' cy='8.5' r='3.2'/><path d='M5 19a7 7 0 0 1 14 0'/>";
    case 'settings':
      return "<circle cx='12' cy='12' r='2.7'/><path d='M12 5v2M12 17v2M5 12h2M17 12h2M7.8 7.8l1.4 1.4M14.8 14.8l1.4 1.4M16.2 7.8l-1.4 1.4M9.2 14.8l-1.4 1.4'/>";
    default:
      return "<circle cx='12' cy='12' r='6'/>";
  }
}

function iconPlaceholderDataUri(color: string, glyph: IconGlyph): string {
  const safe = encodeURIComponent(color);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${safe}' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>${iconPathForGlyph(glyph)}</svg>`;
  return `url("data:image/svg+xml;utf8,${svg}")`;
}

function enforceSemanticLayeringAndDirection(elements: UbElementJson[]): UbElementJson[] {
  const byId = new Map(elements.map((e) => [e.id, e] as const));
  for (const node of elements) {
    const style = node.style ?? {};
    if (node.type === 'text' || node.type === 'icon') {
      node.style = { ...style, zIndex: '10', position: 'relative' };
      continue;
    }
    if (!node.children?.length) continue;
    const children = node.children.map((id) => byId.get(id)).filter((v): v is UbElementJson => !!v);
    if (!children.length) continue;
    const xs = children.map((c) => parsePx(c.style?.left));
    const ys = children.map((c) => parsePx(c.style?.top));
    const xSpread = Math.max(...xs) - Math.min(...xs);
    const ySpread = Math.max(...ys) - Math.min(...ys);
    const flexDirection = xSpread > ySpread ? 'row' : 'column';
    node.style = {
      ...style,
      display: style.display ?? 'flex',
      flexDirection: (style.flexDirection as string | undefined) ?? flexDirection,
      zIndex: style.zIndex ?? '0',
      position: style.position ?? 'relative',
    };
  }
  return elements;
}

/**
 * Semantic synthesis: toolbar + sidebar + list repeater + OCR-first text.
 * Uses flex layout so edits reflow naturally.
 */
export function synthesizeSemanticDomFromRegions(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  boxes: RegionBox[],
  tokens: OcrToken[],
): UbElementJson[] {
  const targetWidth = MOBILE_LOCK_WIDTH;
  const scaleFactor = targetWidth / Math.max(1, width);
  const scalePx = (v: number) => normalizeCoordinate(v, scaleFactor);
  const scaledH = scalePx(height);
  const topZoneH = SAFE_AREA_TOP_PX;
  const scaledBoxes = boxes
    .filter((b) => b.w > 8 && b.h > 8 && !(b.w > width * 0.92 && b.h > height * 0.5))
    .slice(0, 64)
    .map((b) => ({ x: scalePx(b.x), y: scalePx(b.y), w: scalePx(b.w), h: scalePx(b.h) }));
  const scaledTokens = tokens.map((t) => ({
    ...t,
    x: scalePx(t.x),
    y: scalePx(t.y),
    w: scalePx(t.w),
    h: scalePx(t.h),
  }));

  const toolbarBoxes = scaledBoxes.filter((b) => b.y < topZoneH);
  const bodyBoxes = scaledBoxes.filter((b) => b.y >= topZoneH);

  const isSmallCircleIcon = (b: RegionBox) => {
    const radius = detectBorderRadiusPx(data, width, height, b);
    const minSide = Math.min(b.w, b.h);
    return minSide <= 40 && radius >= Math.floor(minSide * 0.45);
  };

  const sidebarCandidates = bodyBoxes.filter((b) => b.x < targetWidth * 0.22 && isSmallCircleIcon(b));
  sidebarCandidates.sort((a, b) => a.y - b.y);
  const sidebarGap = avgGapFromSorted(sidebarCandidates.map((b) => b.y));

  const rowCandidates = bodyBoxes
    .filter((b) => b.w > targetWidth * 0.2 && b.h >= 4)
    .sort((a, b) => a.y - b.y);
  const listGap = avgGapFromSorted(rowCandidates.map((b) => b.y));

  const toolbarTokens = scaledTokens.filter((t) => t.y < topZoneH);
  const bodyTokens = scaledTokens.filter((t) => t.y >= topZoneH);
  const bodyBg = sampleRegionFill(data, width, height, {
    x: 0,
    y: Math.max(0, topZoneH),
    w: targetWidth,
    h: Math.max(1, height - topZoneH),
  });
  const topToolbarBox: RegionBox = { x: 0, y: 0, w: targetWidth, h: topZoneH };
  const bodyAreaBox: RegionBox = { x: 0, y: topZoneH, w: targetWidth, h: Math.max(1, scaledH - topZoneH) };
  const usedBodyBoxIndexes = new Set<number>();

  let idSeq = 0;
  const nextId = (prefix: string) => `${prefix}_${idSeq++}`;

  const buildRecursiveContainer = (
    box: RegionBox,
    directBoxes: RegionBox[],
    localTokens: OcrToken[],
    depth: number,
    prefix: string,
  ): { node: UbElementJson; nodes: UbElementJson[] } => {
    const childNodes: UbElementJson[] = [];
    const childIds: string[] = [];
    const axis = (() => {
      if (directBoxes.length < 2) return 'column' as const;
      const minX = Math.min(...directBoxes.map((b) => b.x));
      const maxX = Math.max(...directBoxes.map((b) => b.x + b.w));
      const minY = Math.min(...directBoxes.map((b) => b.y));
      const maxY = Math.max(...directBoxes.map((b) => b.y + b.h));
      return maxX - minX > maxY - minY ? ('row' as const) : ('column' as const);
    })();
    const gap = deriveGapFromBoxes(axis, directBoxes);
    const padding = derivePaddingFromChildren(box, directBoxes);

    for (const child of directBoxes) {
      const childId = nextId(`${prefix}_box`);
      const nestedCandidates = bodyBoxes.filter(
        (b) => b !== child && boxContains(child, b) && boxArea(b) < boxArea(child) * 0.92,
      );
      const directNested = nestedCandidates.filter((n) => !nestedCandidates.some((o) => o !== n && boxContains(o, n)));
      const childTokens = localTokens.filter((t) => tokenInsideBox(t, child));
      if (depth < 2 && directNested.length >= 2) {
        const built = buildRecursiveContainer(child, directNested, childTokens, depth + 1, childId);
        built.node.id = childId;
        childIds.push(childId);
        childNodes.push(...built.nodes, built.node);
        continue;
      }
      const childColor = sampleBoxColor(data, width, height, child);
      const childRadius = detectBorderRadiusPx(data, width, height, child);
      const iconLike =
        Math.min(child.w, child.h) < 40 && childRadius >= Math.floor(Math.min(child.w, child.h) * 0.45);
      if (iconLike) {
        const glyph = Math.min(child.w, child.h) < 32 ? mapIconGlyph(child, targetWidth, scaledH) : 'dot';
        childIds.push(childId);
        childNodes.push({
          id: childId,
          type: 'icon',
          content: '',
          style: {
            width: `${evenPx(child.w)}px`,
            height: `${evenPx(child.h)}px`,
            borderRadius: '999px',
            color: childColor,
            backgroundColor: 'transparent',
            backgroundImage: iconPlaceholderDataUri(childColor, glyph),
            backgroundRepeat: 'no-repeat',
            backgroundPosition: 'center',
            backgroundSize: '72% 72%',
          },
        });
      } else {
        childIds.push(childId);
        childNodes.push({
          id: childId,
          type: 'column',
          style: {
            width: `${evenPx(child.w)}px`,
            minHeight: `${evenPx(child.h)}px`,
            borderRadius: `${Math.max(0, childRadius)}px`,
            background: sampleRegionFill(data, width, height, child),
          },
          children: [],
        });
      }
      const glue = glueOcrTokensByBaseline(childTokens);
      glue.forEach((t) => {
        const txtId = nextId(`${childId}_txt`);
        childIds.push(txtId);
        childNodes.push({
          id: txtId,
          type: 'text',
          content: t.text,
          style: {
            fontSize: `${snapFontSize(Math.round(t.h * 0.62))}px`,
            fontWeight: estimateFontWeightFromToken(data, width, height, t),
            color: '#111827',
            lineHeight: '1.3',
          },
        });
      });
    }

    return {
      node: {
        id: nextId(`${prefix}_grp`),
        type: 'column',
        style: {
          display: 'flex',
          flexDirection: axis,
          gap: `${gap}px`,
          width: '100%',
          borderRadius: `${detectBorderRadiusPx(data, width, height, box)}px`,
          background: sampleRegionFill(data, width, height, box),
          padding,
        },
        children: childIds,
      },
      nodes: childNodes,
    };
  };

  const elements: UbElementJson[] = [
    {
      id: ROOT_ID,
      type: 'section',
      style: {
        width: `${targetWidth}px`,
        maxWidth: `${targetWidth}px`,
        height: `${MOBILE_LOCK_HEIGHT}px`,
        maxHeight: `${MOBILE_LOCK_HEIGHT}px`,
        margin: '0 auto',
        position: 'relative',
        overflow: 'hidden',
        background: sampleBackgroundColor(data, width, height),
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: `${SAFE_AREA_TOP_PX}px 0px 0px 0px`,
      },
      children: ['zone_main_viewport'],
    },
    {
      id: 'zone_toolbar',
      type: 'row',
      style: {
        minHeight: `${topZoneH}px`,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: `${deriveGapFromBoxes('row', toolbarBoxes)}px`,
        borderRadius: `${detectBorderRadiusPx(data, width, height, topToolbarBox)}px`,
        background: sampleRegionFill(data, width, height, topToolbarBox),
        padding: derivePaddingFromChildren(topToolbarBox, toolbarBoxes),
      },
      children: [],
    },
    {
      id: 'zone_main_viewport',
      type: 'column',
      style: {
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      },
      children: ['zone_toolbar', 'zone_body'],
    },
    {
      id: 'zone_body',
      type: 'row',
      style: {
        display: 'flex',
        flexDirection: 'row',
        gap: `${deriveGapFromBoxes('row', [bodyAreaBox])}px`,
        alignItems: 'stretch',
        minHeight: `${scaledH}px`,
      },
      children: ['zone_sidebar', 'zone_content'],
    },
    {
      id: 'zone_sidebar',
      type: 'column',
      style: {
        width: `${evenPx(targetWidth * 0.18)}px`,
        gap: `${sidebarGap}px`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: bodyBg,
        borderRadius: `${detectBorderRadiusPx(data, width, height, bodyAreaBox)}px`,
        padding: derivePaddingFromChildren(bodyAreaBox, sidebarCandidates),
      },
      children: [],
    },
    {
      id: 'zone_content',
      type: 'column',
      style: {
        flex: '1',
        gap: `${listGap}px`,
        display: 'flex',
        flexDirection: 'column',
        background: bodyBg,
        borderRadius: `${detectBorderRadiusPx(data, width, height, bodyAreaBox)}px`,
        padding: derivePaddingFromChildren(bodyAreaBox, rowCandidates),
      },
      children: [],
    },
  ];

  const toolbar = elements.find((e) => e.id === 'zone_toolbar')!;
  const sidebar = elements.find((e) => e.id === 'zone_sidebar')!;
  const content = elements.find((e) => e.id === 'zone_content')!;

  // Toolbar zone: map icon-like boxes and OCR text
  toolbarBoxes.forEach((b, i) => {
    const id = `toolbar_box_${i}`;
    const iconLike = isSmallCircleIcon(b) || b.w <= 52;
    const iconColor = sampleBoxColor(data, width, height, b);
    toolbar.children?.push(id);
    elements.push(
      iconLike
        ? {
            id,
            type: 'icon',
            content: '',
            style: {
              width: `${evenPx(b.w)}px`,
              height: `${evenPx(b.h)}px`,
              borderRadius: `${detectBorderRadiusPx(data, width, height, b)}px`,
              color: iconColor,
              backgroundColor: 'transparent',
              backgroundImage: iconPlaceholderDataUri(iconColor, mapIconGlyph(b, targetWidth, scaledH)),
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              backgroundSize: '72% 72%',
            },
          }
        : {
            id,
            type: 'column',
            style: {
              width: `${evenPx(b.w)}px`,
              minHeight: `${evenPx(b.h)}px`,
              borderRadius: `${detectBorderRadiusPx(data, width, height, b)}px`,
              background: sampleRegionFill(data, width, height, b),
            },
            children: [],
          },
    );
  });
  const toolbarText = textNodesFromTokens(width, height, data, glueOcrTokensByBaseline(toolbarTokens), 'toolbar');
  toolbarText.forEach((t) => {
    toolbar.children?.push(t.id);
    elements.push(t);
  });

  // Sidebar zone: circle/small icon mapping
  sidebarCandidates.forEach((b, i) => {
    const id = `sidebar_icon_${i}`;
    const iconColor = sampleBoxColor(data, width, height, b);
    sidebar.children?.push(id);
    elements.push({
      id,
      type: 'icon',
      content: '',
      style: {
        width: `${evenPx(b.w)}px`,
        height: `${evenPx(b.h)}px`,
        borderRadius: '999px',
        color: iconColor,
        backgroundColor: 'transparent',
        backgroundImage: iconPlaceholderDataUri(iconColor, mapIconGlyph(b, targetWidth, scaledH)),
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
        backgroundSize: '72% 72%',
      },
    });
  });

  // Sidebar recursion for non-icon structures and OCR children
  const sidebarStructural = bodyBoxes.filter(
    (b) =>
      !sidebarCandidates.includes(b) &&
      b.x < targetWidth * 0.36 &&
      b.w > targetWidth * 0.12 &&
      b.h > 10,
  );
  if (sidebarStructural.length) {
    const directSidebar = sidebarStructural.filter(
      (n) => !sidebarStructural.some((o) => o !== n && boxContains(o, n)),
    );
    directSidebar.forEach((b, i) => {
      const nested = sidebarStructural.filter((rb) => rb !== b && boxContains(b, rb) && boxArea(rb) < boxArea(b) * 0.92);
      const directNested = nested.filter((n) => !nested.some((o) => o !== n && boxContains(o, n)));
      const localTokens = bodyTokens.filter((t) => tokenInsideBox(t, b));
      if (directNested.length >= 1) {
        const built = buildRecursiveContainer(b, directNested, localTokens, 0, `sidebar_group_${i}`);
        sidebar.children?.push(built.node.id);
        elements.push(...built.nodes, built.node);
      } else {
        const txt = textNodesFromTokens(width, height, data, localTokens, `sidebar_text_${i}`);
        txt.forEach((t) => {
          sidebar.children?.push(t.id);
          elements.push(t);
        });
      }
    });
  }

  // Repeated horizontal items -> ListRepeater rows
  rowCandidates.forEach((b, i) => {
    const rowId = `list_row_${i}`;
    const bodyIdx = bodyBoxes.findIndex((bb) => bb === b);
    if (bodyIdx >= 0) usedBodyBoxIndexes.add(bodyIdx);
    const rowTokenSet = bodyTokens.filter((t) => tokenInsideBox(t, b));
    const rowTokenGlued = glueOcrTokensByBaseline(rowTokenSet);
    const textNodes = textNodesFromTokens(width, height, data, rowTokenGlued, rowId);
    const rowChildren: string[] = [];
    const rightSmallToken = rowTokenGlued.find(
      (t) => t.w <= Math.max(2, Math.round(b.w * 0.25)) && t.x > b.x + b.w * 0.62,
    );
    const chatLike = rowTokenGlued.length >= 2 && !!rightSmallToken;

    if (b.h < 70 || i < 10) {
      const iconId = `${rowId}_icon`;
      const iconColor = sampleBoxColor(data, width, height, {
        x: b.x,
        y: b.y,
        w: Math.min(40, b.w),
        h: b.h,
      });
      rowChildren.push(iconId);
      elements.push({
        id: iconId,
        type: 'icon',
        content: '',
        style: {
          width: `${evenPx(Math.floor(b.h * 0.58))}px`,
          height: `${evenPx(Math.floor(b.h * 0.58))}px`,
          borderRadius: '999px',
          color: iconColor,
          backgroundColor: 'transparent',
          backgroundImage: iconPlaceholderDataUri(iconColor, mapIconGlyph(b, targetWidth, scaledH)),
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'center',
          backgroundSize: '72% 72%',
        },
      });
    }
    const nestedInRow = bodyBoxes.filter((rb) => rb !== b && boxContains(b, rb) && boxArea(rb) < boxArea(b) * 0.9);
    const directNested = nestedInRow.filter((n) => !nestedInRow.some((o) => o !== n && boxContains(o, n)));
    if (directNested.length >= 2) {
      nestedInRow.forEach((rb) => {
        const idx = bodyBoxes.findIndex((bb) => bb === rb);
        if (idx >= 0) usedBodyBoxIndexes.add(idx);
      });
      const built = buildRecursiveContainer(b, directNested, rowTokenSet, 0, rowId);
      rowChildren.push(built.node.id);
      elements.push(...built.nodes, built.node);
    } else {
      textNodes.forEach((t) => {
        rowChildren.push(t.id);
        elements.push(t);
      });
    }
    if (rowChildren.length === 0) {
      const barId = `${rowId}_bar`;
      rowChildren.push(barId);
      elements.push({
        id: barId,
        type: 'column',
        style: {
          width: `${evenPx(b.w)}px`,
          minHeight: `${evenPx(b.h)}px`,
          borderRadius: `${detectBorderRadiusPx(data, width, height, b)}px`,
          background: sampleRegionFill(data, width, height, b),
        },
        children: [],
      });
    }

    content.children?.push(rowId);
    elements.push({
      id: rowId,
      type: 'row',
      style: {
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: `${deriveGapFromBoxes('row', nestedInRow.length ? nestedInRow : [b])}px`,
        justifyContent: chatLike ? 'space-between' : 'flex-start',
        minHeight: `${evenPx(b.h)}px`,
        borderRadius: `${detectBorderRadiusPx(data, width, height, b)}px`,
        background: sampleRegionFill(data, width, height, b),
        padding: derivePaddingFromChildren(b, nestedInRow.length ? nestedInRow : [b]),
      },
      children: rowChildren,
    });
  });

  // Universal body recursion: apply to all remaining body containers (not only row candidates).
  bodyBoxes.forEach((b, bi) => {
    if (usedBodyBoxIndexes.has(bi)) return;
    const insideOther = bodyBoxes.some((outer, oi) => oi !== bi && boxContains(outer, b) && boxArea(outer) > boxArea(b));
    if (insideOther) return;
    const nested = bodyBoxes.filter((rb, ri) => ri !== bi && !usedBodyBoxIndexes.has(ri) && boxContains(b, rb) && boxArea(rb) < boxArea(b) * 0.92);
    const directNested = nested.filter((n) => !nested.some((o) => o !== n && boxContains(o, n)));
    const localTokens = bodyTokens.filter((t) => tokenInsideBox(t, b));
    const holderId = `body_box_${bi}`;
    if (directNested.length >= 1) {
      const built = buildRecursiveContainer(b, directNested, localTokens, 0, holderId);
      content.children?.push(built.node.id);
      elements.push(...built.nodes, built.node);
      usedBodyBoxIndexes.add(bi);
      directNested.forEach((rb) => {
        const idx = bodyBoxes.findIndex((bb) => bb === rb);
        if (idx >= 0) usedBodyBoxIndexes.add(idx);
      });
      return;
    }
    const loneId = `${holderId}_lone`;
    const bg = sampleBoxColor(data, width, height, b);
    const radius = detectBorderRadiusPx(data, width, height, b);
    const iconLike = Math.min(b.w, b.h) < 40 && radius >= Math.floor(Math.min(b.w, b.h) * 0.45);
    content.children?.push(loneId);
    elements.push(
      iconLike
        ? {
            id: loneId,
            type: 'icon',
            content: '',
            style: {
              width: `${evenPx(b.w)}px`,
              height: `${evenPx(b.h)}px`,
              borderRadius: '999px',
              color: bg,
              backgroundColor: 'transparent',
              backgroundImage: iconPlaceholderDataUri(bg, mapIconGlyph(b, targetWidth, scaledH)),
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              backgroundSize: '72% 72%',
            },
          }
        : {
            id: loneId,
            type: 'column',
            style: {
              minHeight: `${evenPx(b.h)}px`,
              borderRadius: `${radius}px`,
              background: sampleRegionFill(data, width, height, b),
              padding: derivePaddingFromChildren(b, directNested),
              display: 'flex',
              flexDirection: 'column',
              gap: `${deriveGapFromBoxes('column', directNested)}px`,
            },
            children: textNodesFromTokens(width, height, data, localTokens, loneId).map((n) => n.id),
          },
    );
    if (!iconLike) {
      const txtNodes = textNodesFromTokens(width, height, data, localTokens, loneId);
      elements.push(...txtNodes);
    }
    usedBodyBoxIndexes.add(bi);
  });

  if ((content.children?.length ?? 0) === 0) {
    const blankId = 'zone_content_blank';
    content.children?.push(blankId);
    elements.push({
      id: blankId,
      type: 'column',
      style: {
        minHeight: `${evenPx(Math.floor(height * 0.35))}px`,
        borderRadius: '10px',
        background: bodyBg,
      },
      children: [],
    });
  }

  return enforceSemanticLayeringAndDirection(elements);
}

/**
 * High-fidelity deterministic hero when raster analysis is too heavy or ambiguous.
 * Hierarchy: Section → Column → Row(s) → leaves (text, icon, button, image).
 */
export function generateDeterministicHeroFallback(): UbElementJson[] {
  const W = `${MOBILE_CANVAS_WIDTH_PX}px`;
  const safeTop = `${SAFE_AREA_TOP_PX}px`;
  const pill = '32px';
  const gradHero =
    'linear-gradient(165deg, #0f172a 0%, #1e3a8a 52%, #3f5be6 100%)';

  const out: UbElementJson[] = [];

  out.push({
    id: ROOT_ID,
    type: 'section',
    style: {
      width: W,
      maxWidth: W,
      margin: '0 auto',
      position: 'relative',
      zIndex: 0,
      boxSizing: 'border-box',
      height: 'auto',
      maxHeight: 'none',
      paddingTop: safeTop,
      paddingLeft: '20px',
      paddingRight: '20px',
      paddingBottom: '32px',
      background: gradHero,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      gap: '24px',
    },
    children: ['col_stack'],
  });

  out.push({
    id: 'col_stack',
    type: 'column',
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      gap: '24px',
      width: '100%',
      flex: '1 1 auto',
    },
    children: ['row_hero', 'row_visual', 'col_copy'],
  });

  out.push({
    id: 'row_hero',
    type: 'row',
    style: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '16px',
      width: '100%',
      minHeight: '56px',
      padding: '0',
      margin: '0',
    },
    children: ['text_kicker', 'icon_spark', 'btn_primary'],
  });

  out.push({
    id: 'text_kicker',
    type: 'text',
    content: 'SOUTHSTACK',
    style: {
      margin: '0',
      padding: '0',
      color: '#f8fafc',
      fontSize: '11px',
      fontWeight: '800',
      letterSpacing: '0.18em',
      lineHeight: '1.2',
      zIndex: 2,
      position: 'relative',
    },
  });

  out.push({
    id: 'icon_spark',
    type: 'icon',
    content: '✦',
    style: {
      width: '40px',
      height: '40px',
      minWidth: '40px',
      minHeight: '40px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: pill,
      background: 'rgba(248,250,252,0.14)',
      color: '#e0e7ff',
      fontSize: '20px',
      fontWeight: '800',
      zIndex: 2,
      position: 'relative',
      boxShadow: '0 8px 28px rgba(15,23,42,0.35)',
    },
  });

  out.push({
    id: 'btn_primary',
    type: 'button',
    content: 'Build now',
    style: {
      padding: '14px 28px',
      borderRadius: '24px',
      border: 'none',
      cursor: 'pointer',
      fontWeight: '800',
      fontSize: '14px',
      color: '#ffffff',
      background: '#3f5be6',
      boxShadow: '0 6px 16px rgba(63,91,230,0.28)',
      elevation: '2',
      zIndex: 2,
      position: 'relative',
    },
  });

  out.push({
    id: 'row_visual',
    type: 'row',
    style: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      width: '100%',
      padding: '0',
      margin: '0',
      gap: '0',
      zIndex: 1,
      position: 'relative',
    },
    children: ['img_hero'],
  });

  out.push({
    id: 'img_hero',
    type: 'image',
    content: 'Hero visual',
    src: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="342" height="120" viewBox="0 0 342 120"><rect width="342" height="120" rx="20" fill="rgba(248,250,252,0.12)" stroke="rgba(248,250,252,0.28)"/><text x="171" y="68" text-anchor="middle" fill="#e2e8f0" font-size="13" font-family="system-ui">342×120 · glass panel</text></svg>`,
    ),
    style: {
      width: '100%',
      maxWidth: '342px',
      height: 'auto',
      borderRadius: '20px',
      display: 'block',
      zIndex: 2,
      position: 'relative',
    },
  });

  out.push({
    id: 'col_copy',
    type: 'column',
    style: {
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      gap: '12px',
      width: '100%',
      zIndex: 2,
      position: 'relative',
    },
    children: ['text_headline', 'text_lead', ROW_TOOLBAR_ID],
  });

  out.push({
    id: 'text_headline',
    type: 'text',
    content: 'Div-first canvas',
    style: {
      margin: '0',
      padding: '0',
      color: '#f1f5f9',
      fontSize: '26px',
      fontWeight: '800',
      lineHeight: '1.15',
      letterSpacing: '-0.02em',
    },
  });

  out.push({
    id: 'text_lead',
    type: 'text',
    content: 'Section → Column → Row → Element. Each leaf is a ub-node with Yjs id + drag hitbox.',
    style: {
      margin: '0',
      padding: '0',
      color: '#94a3b8',
      fontSize: '13px',
      lineHeight: '1.5',
      fontWeight: '500',
    },
  });

  out.push({
    id: ROW_TOOLBAR_ID,
    type: 'row',
    style: {
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '10px',
      width: '100%',
      marginTop: '8px',
      padding: '12px 0 0 0',
      minHeight: '52px',
    },
    children: ['icon_doc', 'icon_layers', 'text_ops', 'btn_secondary'],
  });

  out.push({
    id: 'icon_doc',
    type: 'icon',
    content: '📄',
    style: {
      width: '44px',
      height: '44px',
      minWidth: '44px',
      minHeight: '44px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: '14px',
      background: 'rgba(15,23,42,0.35)',
      fontSize: '20px',
      zIndex: 2,
    },
  });

  out.push({
    id: 'icon_layers',
    type: 'icon',
    content: '▤',
    style: {
      width: '44px',
      height: '44px',
      minWidth: '44px',
      minHeight: '44px',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: '14px',
      background: 'rgba(15,23,42,0.35)',
      fontSize: '20px',
      zIndex: 2,
    },
  });

  out.push({
    id: 'text_ops',
    type: 'text',
    content: 'Slice + audit',
    style: {
      padding: '0 8px',
      margin: '0',
      color: '#cbd5e1',
      fontSize: '12px',
      fontWeight: '700',
      letterSpacing: '0.04em',
    },
  });

  out.push({
    id: 'btn_secondary',
    type: 'button',
    content: 'Ship',
    style: {
      padding: '12px 22px',
      borderRadius: '24px',
      border: '1px solid rgba(248,250,252,0.45)',
      cursor: 'pointer',
      fontWeight: '800',
      fontSize: '13px',
      color: '#1a1a1a',
      background: '#ffffff',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      elevation: '2',
      zIndex: 2,
    },
  });

  return out;
}

function buildSlicedPlanFromBands(bands: [number, number][]): UbElementJson[] {
  const elements: UbElementJson[] = [
    {
      id: ROOT_ID,
      type: 'section',
      style: {
        width: `${MOBILE_CANVAS_WIDTH_PX}px`,
        maxWidth: `${MOBILE_CANVAS_WIDTH_PX}px`,
        margin: '0 auto',
        height: 'auto',
        maxHeight: 'none',
        background: '#0b1220',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px',
        gap: '10px',
      },
      children: [],
    },
  ];
  const rowIds: string[] = [];
  const extra: UbElementJson[] = [];
  bands.slice(0, 8).forEach(([y0, y1], i) => {
    const id = `row_band_${i}`;
    rowIds.push(id);
    const h = PIXEL_SNAP(y1 - y0);
    const smartFontSize = `${snapFontSize(Math.round(h * 0.42))}px`;
    extra.push({
      id,
      type: 'row',
      style: {
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: '10px',
        width: '100%',
        minHeight: `${evenPx(h)}px`,
        padding: `${derivePaddingFromChildren({ x: 0, y: y0, w: MOBILE_CANVAS_WIDTH_PX, h }, [{ x: 0, y: y0, w: MOBILE_CANVAS_WIDTH_PX, h }])}`,
        margin: '0',
        borderRadius: '12px',
        background: 'rgba(248,250,252,0.06)',
      },
      children: [`text_band_${i}`],
    });
    extra.push({
      id: `text_band_${i}`,
      type: 'text',
      content: `Band ${i + 1} · y ${y0}–${y1}px`,
      style: {
        margin: '0',
        padding: '0 4px',
        color: '#e2e8f0',
        fontSize: smartFontSize,
        fontWeight: '700',
        lineHeight: h > 30 ? '1.1' : '1.3',
      },
    });
  });

  const root = elements.find((e) => e.id === ROOT_ID);
  if (root && rowIds.length) root.children = rowIds;
  elements.push(...extra);
  if (elements.length > SLICE_COMPLEXITY_NODE_BUDGET) {
    return buildBlankContainerFromRaster(MOBILE_CANVAS_WIDTH_PX, 812, new Uint8ClampedArray(MOBILE_CANVAS_WIDTH_PX * 812 * 4));
  }
  return elements;
}

/**
 * Raster-driven slice: horizontal projection → row divs. Falls back to deterministic hero on complexity.
 */
export function sliceBitmapToUbPlan(width: number, height: number, imageData: ImageData): SlicePipelineResult {
  const data = imageData.data;
  const complexityScore = estimateBitmapComplexity(width, height, data);
  const rowMean = grayRowMeans(data, width, height);
  const bands = segmentHorizontalBands(rowMean);

  const tooComplex =
    complexityScore > 420 ||
    bands.length < 2 ||
    bands.length > 14 ||
    width !== MOBILE_CANVAS_WIDTH_PX;

  if (tooComplex) {
    return {
      elements: buildBlankContainerFromRaster(width, height, data),
      usedFallback: true,
      complexityScore,
    };
  }

  const sliced = buildSlicedPlanFromBands(bands);
  if (sliced.length > SLICE_COMPLEXITY_NODE_BUDGET) {
    return {
      elements: buildBlankContainerFromRaster(width, height, data),
      usedFallback: true,
      complexityScore,
    };
  }
  return { elements: sliced, usedFallback: false, complexityScore };
}
