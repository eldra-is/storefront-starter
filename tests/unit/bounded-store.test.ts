import { describe, expect, it } from 'vitest';
import { BoundedTtlStore, PartitionedTtlStore } from '../../shared/utils/bounded-store';

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

describe('PartitionedTtlStore', () => {
  const make = () =>
    new PartitionedTtlStore({
      partitions: [{ prefix: 'login:', maxEntries: 3 }],
      defaultMaxEntries: 5,
      now: () => 0,
    });

  it('a flood of pending logins never evicts a session', () => {
    const store = make();
    for (let i = 0; i < 5; i += 1) store.set(`session:${i}`, `s${i}`);
    for (let i = 0; i < 1000; i += 1) store.set(`login:${i}`, `l${i}`);
    for (let i = 0; i < 5; i += 1) expect(store.get(`session:${i}`)).toBe(`s${i}`);
    expect(store.keys().filter((key) => key.startsWith('login:'))).toEqual([
      'login:997',
      'login:998',
      'login:999',
    ]);
  });

  it('sessions are evicted only by other sessions', () => {
    const store = make();
    store.set('login:a', '1');
    for (let i = 0; i < 6; i += 1) store.set(`session:${i}`, `s${i}`);
    expect(store.get('login:a')).toBe('1');
    expect(store.get('session:0')).toBeNull();
    expect(store.get('session:5')).toBe('s5');
  });

  it('removes, clears and sweeps across partitions', () => {
    let now = 0;
    const store = new PartitionedTtlStore({
      partitions: [{ prefix: 'login:', maxEntries: 3 }],
      defaultMaxEntries: 5,
      now: () => now,
    });
    store.set('login:a', '1', 1);
    store.set('session:a', '2', 100);
    store.remove('session:a');
    expect(store.has('session:a')).toBe(false);
    now = 2000;
    expect(store.sweep()).toBe(1);
    store.set('session:b', '3');
    store.clear();
    expect(store.keys()).toEqual([]);
  });
});
