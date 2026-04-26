import * as Y from 'yjs';
import { getElementsMap, readElement } from '../crdt/yjsDocument';
import { ROOT_ID } from '../ubSchema';
import { MOBILE_CANVAS_WIDTH_PX, PIXEL_SNAP, SAFE_AREA_TOP_PX } from './constants';

export type LayoutAuditResult = {
  driftPx: number;
  widthDriftPx: number;
};

function parsePx(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const m = v.trim().match(/^(-?[0-9.]+)px$/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Compares declared section metrics against the 390px mobile contract + 60px safe area.
 */
export function auditLayoutDrift(doc: Y.Doc, sectionId: string = ROOT_ID): LayoutAuditResult {
  const el = readElement(doc, sectionId);
  if (!el?.style) return { driftPx: 0, widthDriftPx: 0 };

  const pt = parsePx(el.style.paddingTop);
  const driftPx = PIXEL_SNAP(pt - SAFE_AREA_TOP_PX);

  const w = parsePx(el.style.width) || parsePx(el.style.maxWidth);
  const widthDriftPx = w ? PIXEL_SNAP(w - MOBILE_CANVAS_WIDTH_PX) : 0;

  return { driftPx, widthDriftPx };
}

/** If layout drifts ≥1px vs artboard, snap padding-top + width on the section Y.Map. */
export function auditAndHealSection(doc: Y.Doc, sectionId: string = ROOT_ID): LayoutAuditResult {
  const before = auditLayoutDrift(doc, sectionId);
  if (Math.abs(before.driftPx) < 1 && Math.abs(before.widthDriftPx) < 1) {
    return before;
  }

  const em = getElementsMap(doc);
  const raw = em.get(sectionId) as Y.Map<unknown> | undefined;
  const styleMap = raw?.get('style') as Y.Map<string> | undefined;
  if (!styleMap) return before;

  doc.transact(() => {
    styleMap.set('paddingTop', `${SAFE_AREA_TOP_PX}px`);
    styleMap.set('width', `${MOBILE_CANVAS_WIDTH_PX}px`);
    styleMap.set('maxWidth', `${MOBILE_CANVAS_WIDTH_PX}px`);
  });

  return auditLayoutDrift(doc, sectionId);
}
