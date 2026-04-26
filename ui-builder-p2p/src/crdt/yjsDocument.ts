import * as Y from 'yjs';
import type { UbElementJson, UbElementType, UbStyle } from '../ubSchema';
import { ROOT_ID } from '../ubSchema';
import { generateDeterministicHeroFallback } from '../imageToUi/surgicalSlicer';
import { tryHydrateDocFromStorage } from '../p2p/p2pAutosave';

export type { UbElementJson, UbElementType, UbStyle } from '../ubSchema';
export { ROOT_ID };

/** Wire / transact origins — extend when P2P applies remote updates */
export const ORIGIN_LOCAL = 'ub-local';
export const ORIGIN_REMOTE = 'ub-remote';

const ELEMENTS_KEY = 'elements';

function isContainerType(t: UbElementType): boolean {
  return t === 'section' || t === 'column' || t === 'row';
}

export function getElementsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap(ELEMENTS_KEY);
}

export function styleToYMap(style: UbStyle | undefined): Y.Map<string> {
  const m = new Y.Map<string>();
  if (!style) return m;
  for (const [k, v] of Object.entries(style)) {
    if (v !== undefined) m.set(k, String(v));
  }
  return m;
}

export function yMapToStyle(m: Y.Map<string> | undefined): UbStyle | undefined {
  if (!m || m.size === 0) return undefined;
  const o: UbStyle = {};
  m.forEach((v, k) => {
    o[k] = v;
  });
  return o;
}

export function elementToJson(id: string, el: Y.Map<unknown>): UbElementJson {
  const type = el.get('type') as UbElementType;
  const out: UbElementJson = { id, type };
  const content = el.get('content');
  if (typeof content === 'string') out.content = content;
  const src = el.get('src');
  if (typeof src === 'string') out.src = src;
  const style = el.get('style') as Y.Map<string> | undefined;
  const s = yMapToStyle(style);
  if (s) out.style = s;
  if (isContainerType(type)) {
    const ch = el.get('children') as Y.Array<string> | undefined;
    out.children = ch ? ch.toArray() : [];
  }
  return out;
}

export function readElement(doc: Y.Doc, id: string): UbElementJson | undefined {
  const raw = getElementsMap(doc).get(id);
  if (!raw) return undefined;
  return elementToJson(id, raw as Y.Map<unknown>);
}

export function readChildIds(doc: Y.Doc, parentId: string): string[] {
  const parent = getElementsMap(doc).get(parentId) as Y.Map<unknown> | undefined;
  if (!parent) return [];
  const ch = parent.get('children') as Y.Array<string> | undefined;
  return ch ? ch.toArray() : [];
}

/** Flex reorder: move child at `fromIndex` to `toIndex` inside parent's `children` Y.Array */
export function moveChildInParent(
  doc: Y.Doc,
  parentId: string,
  fromIndex: number,
  toIndex: number,
  origin: string = ORIGIN_LOCAL,
): void {
  const elements = getElementsMap(doc);
  const parent = elements.get(parentId) as Y.Map<unknown> | undefined;
  if (!parent) return;
  const children = parent.get('children') as Y.Array<string> | undefined;
  if (!children || children.length === 0) return;
  if (fromIndex < 0 || fromIndex >= children.length) return;
  if (toIndex < 0 || toIndex >= children.length) return;
  if (fromIndex === toIndex) return;

  doc.transact(() => {
    const id = children.get(fromIndex);
    children.delete(fromIndex, 1);
    children.insert(toIndex, [id]);
  }, origin);
}

function putElement(elements: Y.Map<Y.Map<unknown>>, spec: UbElementJson): void {
  const m = new Y.Map<unknown>();
  m.set('type', spec.type);
  if (spec.content != null) m.set('content', spec.content);
  if (spec.src != null) m.set('src', spec.src);
  if (spec.style) m.set('style', styleToYMap(spec.style));
  if (spec.children?.length) {
    const arr = new Y.Array<string>();
    arr.insert(0, spec.children);
    m.set('children', arr);
  } else if (isContainerType(spec.type)) {
    const arr = new Y.Array<string>();
    m.set('children', arr);
  }
  elements.set(spec.id, m);
}

/** Replace all elements from a flat slice plan (unique ids required). */
export function ingestFlatElements(doc: Y.Doc, specs: UbElementJson[], origin: string = ORIGIN_LOCAL): void {
  doc.transact(() => {
    const em = getElementsMap(doc);
    for (const k of [...em.keys()]) em.delete(k);
    for (const s of specs) putElement(em, s);
  }, origin);
}

/** Merge style keys into the element's Y.Map style (inspector / manual parity). */
export function updateElementStyle(
  doc: Y.Doc,
  id: string,
  patch: UbStyle,
  origin: string = ORIGIN_LOCAL,
): void {
  doc.transact(() => {
    const raw = getElementsMap(doc).get(id) as Y.Map<unknown> | undefined;
    if (!raw) return;
    let sm = raw.get('style') as Y.Map<string> | undefined;
    if (!sm) {
      sm = new Y.Map<string>();
      raw.set('style', sm);
    }
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) sm.delete(k);
      else sm.set(k, String(v));
    }
  }, origin);
}

export function updateElementContent(
  doc: Y.Doc,
  id: string,
  content: string,
  origin: string = ORIGIN_LOCAL,
): void {
  doc.transact(() => {
    const raw = getElementsMap(doc).get(id) as Y.Map<unknown> | undefined;
    if (!raw) return;
    raw.set('content', content);
  }, origin);
}

export function cloneLastSidebarConversationItem(doc: Y.Doc, origin: string = ORIGIN_LOCAL): string | null {
  let newId: string | null = null;
  doc.transact(() => {
    const elements = getElementsMap(doc);
    const sidebar = elements.get('desktop_sidebar') as Y.Map<unknown> | undefined;
    if (!sidebar) return;
    const children = sidebar.get('children') as Y.Array<string> | undefined;
    if (!children) return;
    const childIds = children.toArray();
    const sidebarItemIds = childIds.filter((id) => /^sidebar_item_\d+$/.test(id));
    if (sidebarItemIds.length === 0) return;
    const lastId = sidebarItemIds[sidebarItemIds.length - 1]!;
    const lastNumber = Math.max(
      ...sidebarItemIds.map((id) => {
        const m = id.match(/^sidebar_item_(\d+)$/);
        return Number(m?.[1] ?? 0);
      }),
    );
    const nextNumber = Math.max(lastNumber + 1, 1);
    newId = `sidebar_item_${nextNumber}`;
    if (elements.has(newId)) return;

    const lastEl = elements.get(lastId) as Y.Map<unknown> | undefined;
    const lastStyle = lastEl?.get('style') as Y.Map<string> | undefined;
    const content = `Conversation ${nextNumber}`;
    const newEl = new Y.Map<unknown>();
    newEl.set('type', 'text');
    newEl.set('content', content);
    if (lastStyle) {
      const styleCopy = new Y.Map<string>();
      lastStyle.forEach((v, k) => styleCopy.set(k, v));
      newEl.set('style', styleCopy);
    }
    elements.set(newId, newEl);
    children.insert(children.length, [newId]);
  }, origin);
  return newId;
}

/** Demo / default canvas: modular hero from deterministic generator */
export function createDemoDoc(): Y.Doc {
  const doc = new Y.Doc();
  ingestFlatElements(doc, generateDeterministicHeroFallback());
  return doc;
}

/** Blank initializer used when there is no persisted local snapshot. */
export function createEmptyDoc(): Y.Doc {
  const doc = new Y.Doc();
  ingestFlatElements(doc, [{ id: ROOT_ID, type: 'section', children: [] }]);
  return doc;
}

/**
 * Zero-flash initializer: builds a blank doc and hydrates from local storage before first paint.
 */
export function getInitialDoc(): Y.Doc {
  const doc = createEmptyDoc();
  if (typeof window === 'undefined') return doc;
  tryHydrateDocFromStorage(doc);
  return doc;
}
