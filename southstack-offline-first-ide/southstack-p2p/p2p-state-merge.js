/**
 * Shared-state merge helpers for P2P sync (star topology + versioned doc).
 */

export function cloneLlmChatShape(raw) {
  if (!raw || typeof raw !== 'object') {
    return { busy: false, runPeerId: null, streamPartial: '', items: [] };
  }
  return {
    busy: !!raw.busy,
    runPeerId: raw.runPeerId || null,
    streamPartial: typeof raw.streamPartial === 'string' ? raw.streamPartial : '',
    items: Array.isArray(raw.items) ? raw.items.map(m => ({ ...m })) : []
  };
}

/**
 * Union chat bubbles by id; same id keeps the copy with latest `at`.
 * Streaming fields use preferRemoteBusy + longest partial heuristic.
 */
export function mergeLlmChatItems(localItems, remoteItems, preferRemoteBusy) {
  const a = Array.isArray(localItems) ? localItems : [];
  const b = Array.isArray(remoteItems) ? remoteItems : [];
  const byId = new Map();
  for (const m of a) {
    if (m && m.id) byId.set(m.id, { ...m });
  }
  for (const m of b) {
    if (!m || !m.id) continue;
    const prev = byId.get(m.id);
    if (!prev) {
      byId.set(m.id, { ...m });
      continue;
    }
    const prevAt = Number(prev.at) || 0;
    const nextAt = Number(m.at) || 0;
    byId.set(m.id, nextAt >= prevAt ? { ...m } : { ...prev });
  }
  const merged = Array.from(byId.values());
  merged.sort((x, y) => (Number(x.at) || 0) - (Number(y.at) || 0));
  const loc = cloneLlmChatShape({ items: a });
  const rem = cloneLlmChatShape({ items: b });
  return {
    busy: preferRemoteBusy ? rem.busy : loc.busy || rem.busy,
    runPeerId: preferRemoteBusy ? rem.runPeerId || loc.runPeerId : loc.runPeerId || rem.runPeerId,
    streamPartial:
      preferRemoteBusy && rem.streamPartial
        ? rem.streamPartial
        : rem.streamPartial && rem.streamPartial.length >= (loc.streamPartial || '').length
          ? rem.streamPartial
          : loc.streamPartial || rem.streamPartial,
    items: merged
  };
}
