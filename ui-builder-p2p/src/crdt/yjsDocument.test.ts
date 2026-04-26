import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { ROW_TOOLBAR_ID } from '../imageToUi/surgicalSlicer';
import {
  createDemoDoc,
  getElementsMap,
  moveChildInParent,
  readChildIds,
  readElement,
  ROOT_ID,
  updateElementContent,
  updateElementStyle,
} from './yjsDocument';

describe('moveChildInParent', () => {
  it('reorders leaf children inside a horizontal toolbar row Y.Array', () => {
    const doc = createDemoDoc();
    expect(readChildIds(doc, ROW_TOOLBAR_ID)).toEqual(['icon_doc', 'icon_layers', 'text_ops', 'btn_secondary']);

    moveChildInParent(doc, ROW_TOOLBAR_ID, 0, 2);
    expect(readChildIds(doc, ROW_TOOLBAR_ID)).toEqual(['icon_layers', 'text_ops', 'icon_doc', 'btn_secondary']);

    moveChildInParent(doc, ROW_TOOLBAR_ID, 3, 0);
    expect(readChildIds(doc, ROW_TOOLBAR_ID)).toEqual(['btn_secondary', 'icon_layers', 'text_ops', 'icon_doc']);
  });

  it('is a no-op for invalid indices', () => {
    const doc = createDemoDoc();
    const before = readChildIds(doc, ROW_TOOLBAR_ID);
    moveChildInParent(doc, ROW_TOOLBAR_ID, -1, 1);
    moveChildInParent(doc, ROW_TOOLBAR_ID, 99, 1);
    expect(readChildIds(doc, ROW_TOOLBAR_ID)).toEqual(before);
  });

  it('mutates shared Y structure so peers would converge on same ordering', () => {
    const doc = createDemoDoc();
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    moveChildInParent(doc, ROW_TOOLBAR_ID, 1, 3);
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(doc2)));
    expect(readChildIds(doc2, ROW_TOOLBAR_ID)).toEqual(readChildIds(doc, ROW_TOOLBAR_ID));
  });
});

describe('getElementsMap', () => {
  it('returns the elements map on demo doc', () => {
    const doc = createDemoDoc();
    expect(getElementsMap(doc).has(ROOT_ID)).toBe(true);
  });
});

describe('updateElementContent / updateElementStyle', () => {
  it('persists text edits to Yjs', () => {
    const doc = createDemoDoc();
    updateElementContent(doc, 'text_headline', 'Edited headline');
    expect(readElement(doc, 'text_headline')?.content).toBe('Edited headline');
  });

  it('merges style patches for inspector parity', () => {
    const doc = createDemoDoc();
    updateElementStyle(doc, 'text_kicker', { color: '#ff00aa', fontWeight: '700' });
    const st = readElement(doc, 'text_kicker')?.style;
    expect(st?.color).toBe('#ff00aa');
    expect(st?.fontWeight).toBe('700');
  });
});
