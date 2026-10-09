import { defineDriver } from 'unstorage';
import { PartitionedTtlStore } from '~~/shared/utils/bounded-store';

/** At most this many sessions per server; the least recently used go first. */
export const MEMORY_SESSION_MAX_ENTRIES = 10_000;
/**
 * Pending logins have their own, smaller cap: starting a login needs no account, so a flood of them
 * can only push out other pending logins, never a session.
 */
export const MEMORY_LOGIN_MAX_ENTRIES = 2_000;
/** Cached `/me` answers likewise: they can only push out each other, never a session. */
export const MEMORY_ME_MAX_ENTRIES = 2_000;
/** Expired records are swept this often, so abandoned logins do not wait for a read to leave. */
export const MEMORY_SESSION_SWEEP_MS = 5 * 60 * 1000;

/**
 * The `memory` session driver: unstorage's own memory driver ignores TTLs and has no size cap, so a
 * busy single-server storefront would keep every abandoned login and session for the process life.
 */
export const boundedMemoryDriver = defineDriver(() => {
  const store = new PartitionedTtlStore({
    partitions: [
      { prefix: 'login:', maxEntries: MEMORY_LOGIN_MAX_ENTRIES },
      { prefix: 'me:', maxEntries: MEMORY_ME_MAX_ENTRIES },
    ],
    defaultMaxEntries: MEMORY_SESSION_MAX_ENTRIES,
  });
  const sweeper = setInterval(() => store.sweep(), MEMORY_SESSION_SWEEP_MS);
  // Never keep the process alive for the sweep alone.
  sweeper.unref?.();
  return {
    name: 'eldra-bounded-memory',
    hasItem: (key: string) => store.has(key),
    getItem: (key: string) => store.get(key),
    setItem: (key: string, value: string, options?: { ttl?: number }) =>
      store.set(key, value, options?.ttl),
    removeItem: (key: string) => store.remove(key),
    getKeys: (base?: string) => store.keys().filter((key) => !base || key.startsWith(base)),
    clear: (base?: string) => {
      if (!base) return store.clear();
      for (const key of store.keys()) if (key.startsWith(base)) store.remove(key);
    },
    dispose: () => clearInterval(sweeper),
  };
});
