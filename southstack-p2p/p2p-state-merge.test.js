import { describe, it, expect } from 'vitest';
import { mergeLlmChatItems, shouldPreferRemoteMerge } from './p2p-state-merge.js';

describe('shouldPreferRemoteMerge', () => {
  it('prefers remote when versions are lower but fullSnapshot is set (reconnect skew)', () => {
    expect(shouldPreferRemoteMerge(100, 1, { fullSnapshot: true })).toBe(true);
    expect(shouldPreferRemoteMerge(100, 1, { forceAcceptRemote: true })).toBe(true);
  });

  it('uses version order when not forcing', () => {
    expect(shouldPreferRemoteMerge(5, 10, {})).toBe(true);
    expect(shouldPreferRemoteMerge(10, 5, {})).toBe(false);
    expect(shouldPreferRemoteMerge(7, 7, {})).toBe(true);
  });
});

describe('mergeLlmChatItems', () => {
  it('keeps guest message when host version is higher (star relay)', () => {
    const local = [
      { id: 'a', role: 'user', content: 'host', at: 1 },
      { id: 'b', role: 'assistant', content: 'reply', at: 2 }
    ];
    const remote = [{ id: 'c', role: 'user', content: 'from guest', at: 3 }];
    const merged = mergeLlmChatItems(local, remote, false);
    const ids = merged.items.map(m => m.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(merged.items.find(m => m.id === 'c').content).toBe('from guest');
  });

  it('picks newer at for duplicate ids', () => {
    const local = [{ id: 'x', role: 'user', content: 'old', at: 10 }];
    const remote = [{ id: 'x', role: 'user', content: 'new', at: 20 }];
    const merged = mergeLlmChatItems(local, remote, true);
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].content).toBe('new');
  });
});
