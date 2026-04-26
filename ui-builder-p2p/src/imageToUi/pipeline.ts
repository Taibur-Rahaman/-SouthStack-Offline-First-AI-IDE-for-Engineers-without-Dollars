import { ingestFlatElements } from '../crdt/yjsDocument';
import type { UbElementJson } from '../ubSchema';
import { ROOT_ID } from '../ubSchema';
import { auditAndHealSection, auditLayoutDrift, type LayoutAuditResult } from './auditLayoutDrift';
import { DEMO_IMAGE_DATA_URL } from './demoImage';
import { AUTONOMY_COMPLEXITY_MERGE_THRESHOLD, MOBILE_CANVAS_WIDTH_PX } from './constants';
import {
  buildBlankContainerFromRaster,
  detectRegionBoxesFromImageData,
  grayRowMeans,
  type RegionBox,
  segmentHorizontalBands,
  type OcrToken,
  synthesizeSemanticDomFromRegions,
  sliceBitmapToUbPlan,
  type SlicePipelineResult,
} from './surgicalSlicer';
import * as Y from 'yjs';

export type ImageToUiRunResult = SlicePipelineResult & {
  audit: LayoutAuditResult;
  doc: Y.Doc;
};

const DESKTOP_CANVAS_WIDTH_PX = 980;
const TILE_HEIGHT_PX = 832;
const LONG_UI_THRESHOLD_PX = 1000;
const MOBILE_VIEWPORT_HEIGHT_PX = 693;

function synthesizeSemanticFromAny(
  w: number,
  h: number,
  data: Uint8ClampedArray,
  boxes: RegionBox[],
  tokens: OcrToken[],
): UbElementJson[] {
  const fallbackBoxes = boxes.length ? boxes : [{ x: 0, y: 0, w, h }];
  return synthesizeSemanticDomFromRegions(w, h, data, fallbackBoxes, tokens);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

async function runOcrPass(img: HTMLImageElement, width: number, height: number): Promise<OcrToken[]> {
  if (typeof window === 'undefined') return [];
  const detectorHolder = window as unknown as {
    TextDetector?: new () => { detect: (source: CanvasImageSource) => Promise<any[]> };
    OCRDetector?: new () => { detect: (source: CanvasImageSource) => Promise<any[]> };
  };
  const DetectorCtor = detectorHolder.TextDetector ?? detectorHolder.OCRDetector;
  if (!DetectorCtor) return [];
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, width, height);

  const high = document.createElement('canvas');
  high.width = width;
  high.height = height;
  const hctx = high.getContext('2d');
  if (hctx) {
    hctx.drawImage(img, 0, 0, width, height);
    const id = hctx.getImageData(0, 0, width, height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] + d[i + 1] + d[i + 2]) / 3;
      const v = g > 145 ? 255 : 0;
      d[i] = v;
      d[i + 1] = v;
      d[i + 2] = v;
    }
    hctx.putImageData(id, 0, 0);
  }

  const iou = (a: OcrToken, b: OcrToken) => {
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
  };

  const parseDetections = (out: any[]): OcrToken[] => {
    const tokens: OcrToken[] = [];
    for (const item of out ?? []) {
      const text = String(item?.rawValue ?? item?.text ?? '').trim();
      const bb = item?.boundingBox;
      if (!text || !bb) continue;
      const x = Math.max(0, Math.round(bb.x ?? 0));
      const y = Math.max(0, Math.round(bb.y ?? 0));
      const w = Math.max(1, Math.round(bb.width ?? 1));
      const h = Math.max(1, Math.round(bb.height ?? 1));
      tokens.push({
        text,
        x,
        y,
        w,
        h,
        nx: x / Math.max(1, width),
        ny: y / Math.max(1, height),
        nw: w / Math.max(1, width),
        nh: h / Math.max(1, height),
      });
    }
    return tokens;
  };
  try {
    const detector = new DetectorCtor();
    const [rawA, rawB] = await Promise.all([
      detector.detect(canvas).catch(() => []),
      detector.detect(high).catch(() => []),
    ]);
    const merged: OcrToken[] = [];
    for (const t of [...parseDetections(rawA), ...parseDetections(rawB)]) {
      const duplicate = merged.some((m) => m.text === t.text && iou(m, t) > 0.68);
      if (!duplicate) merged.push(t);
    }
    return merged
      .filter((t) => t.text.length >= 2)
      .slice(0, 180);
  } catch {
    return [];
  }
}

async function runOcrPassOnTile(
  img: HTMLImageElement,
  fullRasterWidth: number,
  fullRasterHeight: number,
  tileY: number,
  tileH: number,
): Promise<OcrToken[]> {
  if (typeof window === 'undefined') return [];
  const detectorHolder = window as unknown as {
    TextDetector?: new () => { detect: (source: CanvasImageSource) => Promise<any[]> };
    OCRDetector?: new () => { detect: (source: CanvasImageSource) => Promise<any[]> };
  };
  const DetectorCtor = detectorHolder.TextDetector ?? detectorHolder.OCRDetector;
  if (!DetectorCtor) return [];

  const scale = fullRasterWidth / Math.max(1, img.naturalWidth);
  const srcY = Math.max(0, Math.floor(tileY / Math.max(0.0001, scale)));
  const srcH = Math.max(1, Math.floor(tileH / Math.max(0.0001, scale)));

  const canvas = document.createElement('canvas');
  canvas.width = fullRasterWidth;
  canvas.height = tileH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, 0, fullRasterWidth, tileH);

  const parseDetections = (out: any[]): OcrToken[] => {
    const tokens: OcrToken[] = [];
    for (const item of out ?? []) {
      const text = String(item?.rawValue ?? item?.text ?? '').trim();
      const bb = item?.boundingBox;
      if (!text || !bb) continue;
      const x = Math.max(0, Math.round(bb.x ?? 0));
      const y = Math.max(0, Math.round(bb.y ?? 0));
      const w = Math.max(1, Math.round(bb.width ?? 1));
      const h = Math.max(1, Math.round(bb.height ?? 1));
      tokens.push({
        text,
        x,
        y,
        w,
        h,
        nx: x / Math.max(1, fullRasterWidth),
        ny: y / Math.max(1, tileH),
        nw: w / Math.max(1, fullRasterWidth),
        nh: h / Math.max(1, tileH),
      });
    }
    return tokens;
  };
  try {
    const detector = new DetectorCtor();
    const out = await detector.detect(canvas).catch(() => []);
    return parseDetections(out).slice(0, 180);
  } catch {
    return [];
  }
}

function cropTileImageData(imageData: ImageData, y: number, h: number): ImageData {
  const width = imageData.width;
  const out = new Uint8ClampedArray(width * h * 4);
  for (let row = 0; row < h; row++) {
    const srcStart = ((y + row) * width) * 4;
    const dstStart = (row * width) * 4;
    out.set(imageData.data.subarray(srcStart, srcStart + width * 4), dstStart);
  }
  return new ImageData(out, width, h);
}

function namespaceElements(elements: UbElementJson[], prefix: string): UbElementJson[] {
  const idMap = new Map<string, string>();
  for (const el of elements) {
    idMap.set(el.id, `${prefix}${el.id}`);
  }
  return elements.map((el) => {
    const nextId = idMap.get(el.id) ?? `${prefix}${el.id}`;
    const nextChildren = el.children?.map((cid) => idMap.get(cid) ?? `${prefix}${cid}`);
    return { ...el, id: nextId, children: nextChildren };
  });
}

function detectStickyHeaderFromTiles(
  tileTokens: OcrToken[][],
  tileElements: UbElementJson[][],
): { text: string; background: string } | null {
  if (tileTokens.length < 2) return null;
  const topToken = (tokens: OcrToken[]) =>
    tokens
      .filter((t) => t.y < 90)
      .sort((a, b) => a.y - b.y)[0];
  const t1 = topToken(tileTokens[0] ?? []);
  const t2 = topToken(tileTokens[1] ?? []);
  if (!t1 || !t2) return null;
  if (t1.text.trim().toLowerCase() !== t2.text.trim().toLowerCase()) return null;
  const topBg = tileElements[0]?.find((e) => e.id === ROOT_ID)?.style?.background;
  if (!topBg || typeof topBg !== 'string') return null;
  return { text: t1.text, background: topBg };
}

function stitchTiledSemanticElements(
  tileElements: UbElementJson[][],
  tileTokens: OcrToken[][],
  targetWidth: number,
): UbElementJson[] {
  const namespacedTiles = tileElements.map((els, i) => namespaceElements(els, `tile_${i}_`));
  const scrollChildren: string[] = [];
  const out: UbElementJson[] = [
    {
      id: ROOT_ID,
      type: 'section',
      style: {
        width: `${targetWidth}px`,
        maxWidth: `${targetWidth}px`,
        margin: '0 auto',
        background: '#121212',
        height: `${MOBILE_VIEWPORT_HEIGHT_PX}px`,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        paddingTop: '60px',
      },
      children: ['zone_main_viewport'],
    },
    {
      id: 'zone_main_viewport',
      type: 'column',
      style: {
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        width: '100%',
      },
      children: ['zone_scroll_container'],
    },
    {
      id: 'zone_scroll_container',
      type: 'column',
      style: {
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
      },
      children: scrollChildren,
    },
  ];

  namespacedTiles.forEach((tile, idx) => {
    const tileRoot = tile.find((e) => e.id === `tile_${idx}_${ROOT_ID}`);
    const tileSectionId = `tile_section_${idx}`;
    scrollChildren.push(tileSectionId);
    out.push({
      id: tileSectionId,
      type: 'column',
      style: {
        width: '100%',
        minHeight: `${TILE_HEIGHT_PX}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: '0px',
        padding: '0px',
      },
      children: tileRoot?.children ?? [],
    });
    out.push(...tile.filter((e) => e.id !== `tile_${idx}_${ROOT_ID}`));
  });

  const sticky = detectStickyHeaderFromTiles(tileTokens, tileElements);
  if (sticky) {
    out[0] = {
      ...out[0]!,
      children: ['zone_sticky_header', 'zone_main_viewport'],
    };
    out.splice(2, 0, {
      id: 'zone_sticky_header',
      type: 'row',
      style: {
        position: 'sticky',
        top: '0px',
        zIndex: '20',
        width: '100%',
        minHeight: '60px',
        padding: '12px 16px',
        background: sticky.background,
        display: 'flex',
        alignItems: 'center',
      },
      children: ['zone_sticky_header_text'],
    });
    out.splice(3, 0, {
      id: 'zone_sticky_header_text',
      type: 'text',
      content: sticky.text,
      style: {
        color: '#e0e0e0',
        fontSize: '16px',
        fontWeight: '700',
      },
    });
  }
  return out;
}

function looksLikeBandProjection(elements: UbElementJson[]): boolean {
  return elements.some((el) => el.id.startsWith('row_band_') || el.id.startsWith('text_band_'));
}

function estimateBandColumns(imageData: ImageData, y0: number, y1: number): number {
  const { data, width } = imageData;
  const colDark = new Array(width).fill(0);
  const h = Math.max(1, y1 - y0);
  for (let x = 0; x < width; x++) {
    let dark = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * 4;
      const g = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (g < 232) dark++;
    }
    colDark[x] = dark / h;
  }
  const threshold = 0.06;
  let groups = 0;
  let inGroup = false;
  let groupWidth = 0;
  const minGroupWidth = Math.max(12, Math.floor(width * 0.08));
  for (let x = 0; x < width; x++) {
    if (colDark[x] > threshold) {
      inGroup = true;
      groupWidth++;
    } else if (inGroup) {
      if (groupWidth >= minGroupWidth) groups++;
      inGroup = false;
      groupWidth = 0;
    }
  }
  if (inGroup && groupWidth >= minGroupWidth) groups++;
  if (groups > 0) return Math.max(1, Math.min(4, groups));

  // Dark UIs can keep every column "active", so dark-threshold grouping collapses to 1.
  // Fallback: detect a strong vertical brightness transition (e.g., left nav + main panel).
  const colMean = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * 4;
      acc += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    colMean[x] = acc / h;
  }
  let bestX = -1;
  let bestDelta = 0;
  const left = Math.floor(width * 0.2);
  const right = Math.floor(width * 0.8);
  for (let x = left + 2; x < right - 2; x++) {
    const l = (colMean[x - 2] + colMean[x - 1]) * 0.5;
    const r = (colMean[x + 1] + colMean[x + 2]) * 0.5;
    const d = Math.abs(r - l);
    if (d > bestDelta) {
      bestDelta = d;
      bestX = x;
    }
  }
  if (bestX > 0 && bestDelta > 12) return 2;
  return 1;
}

function findDominantVerticalSplit(imageData: ImageData): number | null {
  const { data, width, height } = imageData;
  const y0 = Math.floor(height * 0.1);
  const y1 = Math.floor(height * 0.9);
  const h = Math.max(1, y1 - y0);
  const colMean = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * 4;
      acc += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    colMean[x] = acc / h;
  }
  let bestX = -1;
  let bestDelta = 0;
  for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x++) {
    const l = (colMean[x - 1] ?? colMean[x]) * 0.5 + (colMean[x - 2] ?? colMean[x]) * 0.5;
    const r = (colMean[x + 1] ?? colMean[x]) * 0.5 + (colMean[x + 2] ?? colMean[x]) * 0.5;
    const d = Math.abs(r - l);
    if (d > bestDelta) {
      bestDelta = d;
      bestX = x;
    }
  }
  if (bestX > 0 && bestDelta > 10) return bestX / Math.max(1, width);
  return null;
}

function findMultipleVerticalSplits(imageData: ImageData): number[] {
  const { data, width, height } = imageData;
  const y0 = Math.floor(height * 0.1);
  const y1 = Math.floor(height * 0.9);
  const h = Math.max(1, y1 - y0);
  const colMean = new Array(width).fill(0);
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * width + x) * 4;
      acc += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    colMean[x] = acc / h;
  }
  const candidates: Array<{ x: number; d: number }> = [];
  for (let x = Math.floor(width * 0.12); x < Math.floor(width * 0.92); x++) {
    const l = ((colMean[x - 1] ?? colMean[x]) + (colMean[x - 2] ?? colMean[x])) * 0.5;
    const r = ((colMean[x + 1] ?? colMean[x]) + (colMean[x + 2] ?? colMean[x])) * 0.5;
    const d = Math.abs(r - l);
    if (d > 8) candidates.push({ x, d });
  }
  candidates.sort((a, b) => b.d - a.d);
  const picked: number[] = [];
  for (const c of candidates) {
    if (picked.every((p) => Math.abs(p - c.x) > width * 0.12)) {
      picked.push(c.x);
    }
    if (picked.length >= 3) break;
  }
  return picked.sort((a, b) => a - b).map((x) => x / Math.max(1, width));
}

function looksLikeIdeScreenshot(imageData: ImageData): boolean {
  const { data, width, height } = imageData;
  const topH = Math.max(1, Math.floor(height * 0.08));
  let topAcc = 0;
  let bodyAcc = 0;
  let topN = 0;
  let bodyN = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4;
      const l = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (y < topH) {
        topAcc += l;
        topN++;
      } else {
        bodyAcc += l;
        bodyN++;
      }
    }
  }
  const topMean = topN ? topAcc / topN : 0;
  const bodyMean = bodyN ? bodyAcc / bodyN : 0;
  const splits = findMultipleVerticalSplits(imageData);
  return splits.length >= 2 && Math.abs(topMean - bodyMean) > 10;
}

function avgLuma(imageData: ImageData): number {
  const { data } = imageData;
  let acc = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 16) {
    acc += (data[i] + data[i + 1] + data[i + 2]) / 3;
    n++;
  }
  return n ? acc / n : 128;
}

function avgLumaRegion(imageData: ImageData, x0: number, x1: number, y0: number, y1: number): number {
  const { data, width, height } = imageData;
  const sx0 = Math.max(0, Math.min(width - 1, Math.floor(x0)));
  const sx1 = Math.max(sx0 + 1, Math.min(width, Math.floor(x1)));
  const sy0 = Math.max(0, Math.min(height - 1, Math.floor(y0)));
  const sy1 = Math.max(sy0 + 1, Math.min(height, Math.floor(y1)));
  let acc = 0;
  let n = 0;
  for (let y = sy0; y < sy1; y += 2) {
    for (let x = sx0; x < sx1; x += 2) {
      const i = (y * width + x) * 4;
      acc += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n++;
    }
  }
  return n ? acc / n : 128;
}

function preferDarkTheme(imageData: ImageData): boolean {
  // Decide from the central workspace area (not whole screenshot chrome),
  // so white desktop/editor captures don't get forced into dark theme.
  const centerLuma = avgLumaRegion(
    imageData,
    imageData.width * 0.22,
    imageData.width * 0.82,
    imageData.height * 0.12,
    imageData.height * 0.88,
  );
  const overallLuma = avgLuma(imageData);
  return centerLuma < 112 && overallLuma < 120;
}

function buildIdeWorkspaceScaffold(imageData: ImageData, scaledHeight: number): UbElementJson[] {
  const dark = preferDarkTheme(imageData);
  const shellBg = dark ? '#0b0f17' : '#f8fafc';
  const panelBg = dark ? '#111827' : '#ffffff';
  const panelSoft = dark ? '#1f2937' : '#eef2ff';
  const text = dark ? '#e5e7eb' : '#1f2937';
  const splits = findMultipleVerticalSplits(imageData);
  const left = splits[0] ? Math.max(0.14, Math.min(0.24, splits[0])) : 0.18;
  const right = splits[1] ? Math.max(0.72, Math.min(0.9, splits[1])) : 0.78;
  const navPct = Math.round(left * 100);
  const rightPanelPct = Math.max(14, Math.round((1 - right) * 100));
  const centerPct = Math.max(40, 100 - navPct - rightPanelPct);
  const topBarH = Math.max(44, Math.floor(scaledHeight * 0.08));
  const bottomH = Math.max(120, Math.floor(scaledHeight * 0.22));

  return [
    {
      id: ROOT_ID,
      type: 'section',
      style: {
        width: '1100px',
        maxWidth: '1100px',
        margin: '0 auto',
        background: shellBg,
        minHeight: `${Math.max(680, scaledHeight)}px`,
        padding: '0',
      },
      children: ['ide_root_col'],
    },
    {
      id: 'ide_root_col',
      type: 'column',
      style: { display: 'flex', flexDirection: 'column', minHeight: `${Math.max(680, scaledHeight)}px` },
      children: ['ide_topbar', 'ide_body', 'ide_terminal'],
    },
    {
      id: 'ide_topbar',
      type: 'row',
      style: { minHeight: `${topBarH}px`, background: panelSoft, padding: '10px 12px', alignItems: 'center', display: 'flex', flexDirection: 'row', gap: '10px' },
      children: ['ide_tab_1', 'ide_tab_2', 'ide_tab_3', 'ide_tab_4'],
    },
    { id: 'ide_tab_1', type: 'text', content: 'Explorer', style: { color: text, fontSize: '13px', fontWeight: '700' } },
    { id: 'ide_tab_2', type: 'text', content: 'Editor', style: { color: text, fontSize: '13px', fontWeight: '700' } },
    { id: 'ide_tab_3', type: 'text', content: 'Browser', style: { color: text, fontSize: '13px', fontWeight: '700' } },
    { id: 'ide_tab_4', type: 'text', content: 'Agent', style: { color: text, fontSize: '13px', fontWeight: '700' } },
    {
      id: 'ide_body',
      type: 'row',
      style: { display: 'flex', flexDirection: 'row', flex: '1', minHeight: `${Math.max(380, scaledHeight - topBarH - bottomH)}px` },
      children: ['ide_nav', 'ide_editor', 'ide_sidepanel'],
    },
    {
      id: 'ide_nav',
      type: 'column',
      style: { width: `${navPct}%`, background: panelBg, padding: '10px', gap: '8px' },
      children: ['nav_title', 'nav_item_1', 'nav_item_2', 'nav_item_3', 'nav_item_4'],
    },
    { id: 'nav_title', type: 'text', content: 'Project files', style: { color: text, fontSize: '14px', fontWeight: '800' } },
    { id: 'nav_item_1', type: 'text', content: 'src/', style: { color: text, fontSize: '12px' } },
    { id: 'nav_item_2', type: 'text', content: 'components/', style: { color: text, fontSize: '12px' } },
    { id: 'nav_item_3', type: 'text', content: 'styles/', style: { color: text, fontSize: '12px' } },
    { id: 'nav_item_4', type: 'text', content: 'README.md', style: { color: text, fontSize: '12px' } },
    {
      id: 'ide_editor',
      type: 'column',
      style: { width: `${centerPct}%`, background: dark ? '#0f172a' : '#ffffff', padding: '10px', gap: '10px' },
      children: ['editor_header', 'editor_canvas'],
    },
    { id: 'editor_header', type: 'text', content: 'Editor / Preview', style: { color: text, fontSize: '15px', fontWeight: '800' } },
    { id: 'editor_canvas', type: 'row', style: { flex: '1', minHeight: '260px', borderRadius: '10px', background: dark ? '#111827' : '#f8fafc' }, children: [] },
    {
      id: 'ide_sidepanel',
      type: 'column',
      style: { width: `${rightPanelPct}%`, background: panelBg, padding: '10px', gap: '10px' },
      children: ['side_title', 'side_card_1', 'side_card_2'],
    },
    { id: 'side_title', type: 'text', content: 'Agent / Inspector', style: { color: text, fontSize: '14px', fontWeight: '800' } },
    { id: 'side_card_1', type: 'row', style: { minHeight: '120px', borderRadius: '10px', background: panelSoft }, children: [] },
    { id: 'side_card_2', type: 'row', style: { minHeight: '140px', borderRadius: '10px', background: panelSoft }, children: [] },
    {
      id: 'ide_terminal',
      type: 'row',
      style: { minHeight: `${bottomH}px`, background: dark ? '#020617' : '#e2e8f0', padding: '10px', alignItems: 'flex-start' },
      children: ['terminal_text'],
    },
    { id: 'terminal_text', type: 'text', content: '> terminal / logs', style: { color: text, fontSize: '12px', fontWeight: '700' } },
  ];
}

function buildDesktopSplitScaffold(imageData: ImageData, scaledHeight: number, splitRatio = 0.34): UbElementJson[] {
  const clampedSplit = Math.max(0.24, Math.min(0.45, splitRatio));
  const dark = preferDarkTheme(imageData);
  const shellBg = dark ? '#0f172a' : '#e2e8f0';
  const sidebarBg = dark ? '#111827' : '#f8fafc';
  const mainBg = dark ? '#0b1220' : '#ffffff';
  const cardBg = dark ? '#1e293b' : '#f1f5f9';
  const textPrimary = dark ? '#f8fafc' : '#0f172a';
  const textSecondary = dark ? '#e2e8f0' : '#334155';
  return [
    {
      id: ROOT_ID,
      type: 'section',
      style: {
        width: '980px',
        maxWidth: '980px',
        margin: '0 auto',
        background: shellBg,
        minHeight: `${Math.max(640, scaledHeight)}px`,
        padding: '0',
      },
      children: ['desktop_shell'],
    },
    {
      id: 'desktop_shell',
      type: 'row',
      style: { display: 'flex', flexDirection: 'row', width: '100%', minHeight: `${Math.max(640, scaledHeight)}px` },
      children: ['desktop_sidebar', 'desktop_main'],
    },
    {
      id: 'desktop_sidebar',
      type: 'column',
      style: { width: `${Math.round(clampedSplit * 100)}%`, background: sidebarBg, padding: '16px', gap: '10px' },
      children: ['sidebar_profile', 'sidebar_search', 'sidebar_item_1', 'sidebar_item_2', 'sidebar_item_3', 'sidebar_item_4', 'sidebar_item_5'],
    },
    { id: 'sidebar_profile', type: 'text', content: 'Contacts / Menu', style: { color: textPrimary, fontSize: '22px', fontWeight: '800', marginBottom: '4px' } },
    {
      id: 'sidebar_search',
      type: 'text',
      content: 'Search chats',
      style: { color: textSecondary, background: dark ? '#1f2937' : '#e2e8f0', borderRadius: '999px', padding: '9px 12px', fontSize: '13px' },
    },
    { id: 'sidebar_item_1', type: 'text', content: 'Conversation 1', style: { color: textSecondary, fontSize: '16px' } },
    { id: 'sidebar_item_2', type: 'text', content: 'Conversation 2', style: { color: textSecondary, fontSize: '16px' } },
    { id: 'sidebar_item_3', type: 'text', content: 'Conversation 3', style: { color: textSecondary, fontSize: '16px' } },
    { id: 'sidebar_item_4', type: 'text', content: 'Conversation 4', style: { color: textSecondary, fontSize: '16px' } },
    { id: 'sidebar_item_5', type: 'text', content: 'Conversation 5', style: { color: textSecondary, fontSize: '16px' } },
    {
      id: 'desktop_main',
      type: 'column',
      style: { width: `${100 - Math.round(clampedSplit * 100)}%`, background: mainBg, padding: '16px', gap: '10px' },
      children: ['main_topbar', 'main_stream'],
    },
    {
      id: 'main_topbar',
      type: 'row',
      style: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: '52px', borderRadius: '10px', background: cardBg, padding: '10px 14px' },
      children: ['main_title', 'main_action'],
    },
    { id: 'main_title', type: 'text', content: 'Primary Content', style: { color: textPrimary, fontSize: '18px', fontWeight: '700' } },
    { id: 'main_action', type: 'button', content: 'Action', style: { border: 'none', borderRadius: '8px', padding: '8px 12px', background: dark ? '#334155' : '#cbd5e1', color: textPrimary, fontWeight: '700' } },
    {
      id: 'main_stream',
      type: 'column',
      style: { display: 'flex', flexDirection: 'column', gap: '10px' },
      children: ['msg_1', 'msg_2', 'msg_3', 'msg_4'],
    },
    { id: 'msg_1', type: 'row', style: { minHeight: '84px', borderRadius: '12px', background: cardBg }, children: [] },
    { id: 'msg_2', type: 'row', style: { minHeight: '120px', borderRadius: '12px', background: cardBg }, children: [] },
    { id: 'msg_3', type: 'row', style: { minHeight: '72px', borderRadius: '12px', background: cardBg }, children: [] },
    { id: 'msg_4', type: 'row', style: { minHeight: '140px', borderRadius: '12px', background: cardBg }, children: [] },
  ];
}

function buildUniversalScaffoldFromImage(imageData: ImageData, scaledHeight: number, desktopMode: boolean): UbElementJson[] {
  if (desktopMode) {
    if (looksLikeIdeScreenshot(imageData)) {
      return buildIdeWorkspaceScaffold(imageData, scaledHeight);
    }
    const split = findDominantVerticalSplit(imageData);
    return buildDesktopSplitScaffold(imageData, scaledHeight, split ?? 0.34);
  }
  const globalSplit = findDominantVerticalSplit(imageData);
  const rowMean = grayRowMeans(imageData.data, imageData.width, imageData.height);
  const rawBands = segmentHorizontalBands(rowMean, 246, 28, 5);
  let bands = rawBands.length ? rawBands.slice(0, 9) : [];

  // If segmentation collapses into 0-1 huge dark band, synthesize structural rows.
  const collapsed =
    bands.length <= 1 ||
    (bands.length === 1 && bands[0] && (bands[0][1] - bands[0][0]) / Math.max(1, imageData.height) > 0.72);
  if (collapsed) {
    const H = imageData.height;
    bands = [
      [0, Math.min(H, Math.floor(H * 0.14))],
      [Math.floor(H * 0.14), Math.min(H, Math.floor(H * 0.34))],
      [Math.floor(H * 0.34), Math.min(H, Math.floor(H * 0.58))],
      [Math.floor(H * 0.58), Math.min(H, Math.floor(H * 0.8))],
      [Math.floor(H * 0.8), H],
    ];
  }
  return [
    {
      id: ROOT_ID,
      type: 'section',
      style: {
        width: `${MOBILE_CANVAS_WIDTH_PX}px`,
        maxWidth: `${MOBILE_CANVAS_WIDTH_PX}px`,
        margin: '0 auto',
        background: '#f1f5f9',
        minHeight: `${Math.max(700, scaledHeight)}px`,
        padding: '14px 10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
      },
      children: bands.map((_, i) => `band_${i}`),
    },
    ...bands.flatMap(([y0, y1], i) => {
      let cols = estimateBandColumns(imageData, y0, y1);
      if (globalSplit && cols === 1) {
        // Prevent "single tiny left block + empty right area" on split UIs.
        cols = 2;
      }
      const bandHeight = Math.max(48, y1 - y0);
      const children = Array.from({ length: cols }, (_, c) => `band_${i}_col_${c}`);
      const colWidths =
        cols === 1
          ? ['100%']
          : cols === 2 && globalSplit
            ? [`${Math.max(26, Math.min(58, Math.round(globalSplit * 100)))}%`, `${Math.max(42, Math.min(74, 100 - Math.round(globalSplit * 100)))}%`]
            : cols === 2
              ? ['49%', '49%']
              : cols === 3
                ? ['32%', '32%', '32%']
                : ['24%', '24%', '24%', '24%'];
      const bandNode: UbElementJson = {
        id: `band_${i}`,
        type: 'row',
        style: {
          display: 'flex',
          flexDirection: 'row',
          gap: '10px',
          flexWrap: cols > 3 ? 'wrap' : 'nowrap',
          background: '#ffffff',
          borderRadius: '12px',
          padding: '10px',
          minHeight: `${Math.min(220, Math.max(56, bandHeight))}px`,
        },
        children,
      };
      const colNodes: UbElementJson[] = children.map((id, c) => ({
        id,
        type: 'column',
        style: {
          width: '100%',
          widthDesktop: colWidths[c] ?? '24%',
          widthMobile: '100%',
          minHeight: `${Math.max(36, Math.floor(bandHeight * 0.75))}px`,
          borderRadius: '10px',
          background: i % 2 === 0 ? '#e2e8f0' : '#dbeafe',
          display: 'flex',
          justifyContent: 'center',
          padding: '10px',
          gap: '6px',
        },
        children: [`${id}_text`],
      }));
      const textNodes: UbElementJson[] = children.map((id, c) => ({
        id: `${id}_text`,
        type: 'text',
        content: cols === 2 ? (c === 0 ? `Panel ${i + 1}.A` : `Panel ${i + 1}.B`) : `Section ${i + 1}.${c + 1}`,
        style: { fontSize: '13px', color: '#1e293b', fontWeight: '700' },
      }));
      return [bandNode, ...colNodes, ...textNodes];
    }),
  ];
}

function pickTargetCanvasWidth(img: HTMLImageElement, source: string | File): number {
  const aspect = img.naturalWidth / Math.max(1, img.naturalHeight);
  // Uploads can be desktop/IDE captures; analyze at desktop width for better structure recovery.
  if (typeof source !== 'string' && aspect > 1.18) return DESKTOP_CANVAS_WIDTH_PX;
  return MOBILE_CANVAS_WIDTH_PX;
}

export function rasterToImageData(
  img: HTMLImageElement,
  targetWidth: number = MOBILE_CANVAS_WIDTH_PX,
): { w: number; h: number; imageData: ImageData } {
  const scale = targetWidth / img.naturalWidth;
  const w = targetWidth;
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2d context unavailable');
  }
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { w, h, imageData };
}

function buildSliceFromRaster(
  w: number,
  h: number,
  imageData: ImageData,
): SlicePipelineResult {
  // Legacy heuristic path retained for compatibility; no hero fallback in primary flow.
  if (w !== MOBILE_CANVAS_WIDTH_PX) return { elements: buildBlankContainerFromRaster(w, h, imageData.data), usedFallback: true, complexityScore: 999, refinedWithSampledGradient: false };
  const raw = sliceBitmapToUbPlan(w, h, imageData);
  return { elements: raw.elements, usedFallback: raw.usedFallback, complexityScore: raw.complexityScore, refinedWithSampledGradient: false };
}

export function rasterToSliceResult(img: HTMLImageElement): SlicePipelineResult {
  try {
    const { w, h, imageData } = rasterToImageData(img, MOBILE_CANVAS_WIDTH_PX);
    return buildSliceFromRaster(w, h, imageData);
  } catch {
    return {
      elements: buildBlankContainerFromRaster(MOBILE_CANVAS_WIDTH_PX, 812, new Uint8ClampedArray(MOBILE_CANVAS_WIDTH_PX * 812 * 4)),
      usedFallback: true,
      complexityScore: 999,
      refinedWithSampledGradient: false,
    };
  }
}

/**
 * End-to-end: scale to 390px → slice (with autonomy refinement) → Yjs ingest → zero-drift audit.
 */
export async function runImageToUiPipeline(source: string | File = DEMO_IMAGE_DATA_URL): Promise<ImageToUiRunResult> {
  if (typeof document === 'undefined') {
    throw new Error('runImageToUiPipeline requires a browser environment');
  }

  let url: string;
  let revoke: string | null = null;
  if (typeof source !== 'string') {
    url = URL.createObjectURL(source);
    revoke = url;
  } else {
    url = source;
  }

  try {
    const img = await loadImage(url);
    const targetWidth = pickTargetCanvasWidth(img, source);
    const raster = rasterToImageData(img, targetWidth);
    let slice: SlicePipelineResult;
    if (raster.h > LONG_UI_THRESHOLD_PX) {
      const tileElements: UbElementJson[][] = [];
      const tileTokens: OcrToken[][] = [];
      let complexity = 0;
      for (let y = 0, tileIndex = 0; y < raster.h; y += TILE_HEIGHT_PX, tileIndex++) {
        const tileH = Math.min(TILE_HEIGHT_PX, raster.h - y);
        const tileImage = cropTileImageData(raster.imageData, y, tileH);
        const boxes = detectRegionBoxesFromImageData(tileImage.data, raster.w, tileH);
        const tokensRaw = await runOcrPassOnTile(img, raster.w, raster.h, y, tileH);
        const tokens = tokensRaw.map((t) => ({ ...t, y: t.y + tileIndex * TILE_HEIGHT_PX }));
        const localTokens = tokens.map((t) => ({ ...t, y: t.y - tileIndex * TILE_HEIGHT_PX }));
        const tile = synthesizeSemanticFromAny(raster.w, tileH, tileImage.data, boxes, localTokens);
        tileElements.push(tile);
        tileTokens.push(tokens);
        complexity += boxes.length + localTokens.length;
      }
      slice = {
        elements: stitchTiledSemanticElements(tileElements, tileTokens, raster.w),
        usedFallback: false,
        complexityScore: complexity,
        refinedWithSampledGradient: false,
      };
    } else {
      const tokens = await runOcrPass(img, raster.w, raster.h);
      const boxes = detectRegionBoxesFromImageData(raster.imageData.data, raster.w, raster.h);
    const elements = synthesizeSemanticFromAny(raster.w, raster.h, raster.imageData.data, boxes, tokens);
      slice = {
        elements,
        usedFallback: false,
        complexityScore: boxes.length + tokens.length,
        refinedWithSampledGradient: false,
      };
    }
    const doc = new Y.Doc();
    ingestFlatElements(doc, slice.elements);
    auditAndHealSection(doc);
    return { ...slice, audit: auditLayoutDrift(doc), doc };
  } finally {
    if (revoke) URL.revokeObjectURL(revoke);
  }
}

/** Explicit file upload entry — same as passing `File` into `runImageToUiPipeline`. */
export function runImageToUiPipelineFromUpload(file: File): Promise<ImageToUiRunResult> {
  return runImageToUiPipeline(file);
}

/** Node-friendly entry when you already have ImageData at 390px width */
export function runSliceOnImageData(width: number, height: number, imageData: ImageData): ImageToUiRunResult {
  const slice = buildSliceFromRaster(width, height, imageData);
  const doc = new Y.Doc();
  ingestFlatElements(doc, slice.elements);
  auditAndHealSection(doc);
  return { ...slice, audit: auditLayoutDrift(doc), doc };
}

export function materializeSliceIntoDoc(doc: Y.Doc, elements: UbElementJson[]): void {
  ingestFlatElements(doc, elements);
  auditAndHealSection(doc);
}
