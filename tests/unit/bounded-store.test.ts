import { describe, expect, it } from 'vitest';
import { BoundedTtlStore } from '../../shared/utils/bounded-store';

describe('BoundedTtlStore', () => {
  it('returns what was stored until it expires', () => {
    let now = 0;
    const store = new BoundedTtlStore({ maxEntries: 10, now: () => now });
    store.set('a', '1', 60);
    expect(store.get('a')).toBe('1');
    now = 59_999;
    expect(store.get('a')).toBe('1');
    now = 60_000;
    expect(store.get('a')).toBeNull();
    expect(store.size).toBe(0);
  });

  it('keeps an entry without a TTL until it is removed', () => {
    const store = new BoundedTtlStore({ maxEntries: 10, now: () => 0 });
    store.set('a', '1');
    expect(store.has('a')).toBe(true);
    store.remove('a');
    expect(store.has('a')).toBe(false);
  });

  it('evicts the least recently used entry beyond the cap', () => {
    const store = new BoundedTtlStore({ maxEntries: 2, now: () => 0 });
    store.set('a', '1');
    store.set('b', '2');
    store.get('a');
    store.set('c', '3');
    expect(store.keys().sort()).toEqual(['a', 'c']);
  });

  it('sweeps expired entries', () => {
    let now = 0;
    const store = new BoundedTtlStore({ maxEntries: 10, now: () => now });
    store.set('short', '1', 1);
    store.set('long', '2', 100);
    now = 5_000;
    expect(store.sweep()).toBe(1);
    expect(store.keys()).toEqual(['long']);
  });
});
