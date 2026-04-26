import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { createDemoDoc, ingestFlatElements } from '../crdt/yjsDocument';
import { ROOT_ID } from '../ubSchema';
import { generateDeterministicHeroFallback } from './surgicalSlicer';
import { auditAndHealSection, auditLayoutDrift } from './auditLayoutDrift';

describe('auditLayoutDrift', () => {
  it('detects safe-area drift and heals to 60px / 390px contract', () => {
    const doc = new Y.Doc();
    const bad = generateDeterministicHeroFallback().map((e) =>
      e.id === ROOT_ID
        ? { ...e, style: { ...e.style, paddingTop: '59px', width: '388px', maxWidth: '388px' } }
        : e,
    );
    ingestFlatElements(doc, bad);
    const before = auditLayoutDrift(doc);
    expect(Math.abs(before.driftPx)).toBeGreaterThanOrEqual(1);
    auditAndHealSection(doc);
    const after = auditLayoutDrift(doc);
    expect(after.driftPx).toBe(0);
    expect(after.widthDriftPx).toBe(0);
  });

  it('demo doc is already aligned', () => {
    const doc = createDemoDoc();
    const a = auditLayoutDrift(doc);
    expect(a.driftPx).toBe(0);
    expect(a.widthDriftPx).toBe(0);
  });
});
