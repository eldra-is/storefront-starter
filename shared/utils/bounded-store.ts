/**
 * An in-memory key/value store with per-entry expiry and a size cap, least recently used evicted
 * first. Backs the `memory` session driver (server/utils/memory-session-driver.ts) so a single-server
 * storefront cannot grow without bound from abandoned logins and sessions.
 */
interface Entry {
  value: string;
  expiresAt: number | undefined;
}

export class BoundedTtlStore {
  private readonly entries = new Map<string, Entry>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: { maxEntries: number; now?: () => number }) {
    this.maxEntries = options.maxEntries;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  private live(key: string): Entry | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry;
  }

  get(key: string): string | null {
    const entry = this.live(key);
    if (!entry) return null;
    // Map keeps insertion order: re-inserting marks the entry most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return this.live(key) !== null;
  }

  /** `ttlSeconds` undefined or not positive: kept until removed or evicted. */
  set(key: string, value: string, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds && ttlSeconds > 0 ? this.now() + ttlSeconds * 1000 : undefined;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  remove(key: string): void {
    this.entries.delete(key);
  }

  keys(): string[] {
    this.sweep();
    return [...this.entries.keys()];
  }

  clear(): void {
    this.entries.clear();
  }

  /** Drops every expired entry; returns how many went. */
  sweep(): number {
    const now = this.now();
    let removed = 0;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

/**
 * Several `BoundedTtlStore`s behind one key space, chosen by key prefix, each with its own cap. The
 * session store gives pending logins (`login:`) their own small partition: anyone can start a login
 * without signing in, so a flood of them may push out other pending logins but never a session.
 */
export class PartitionedTtlStore {
  private readonly partitions: Array<{ prefix: string; store: BoundedTtlStore }>;
  private readonly fallback: BoundedTtlStore;

  constructor(options: {
    partitions: Array<{ prefix: string; maxEntries: number }>;
    defaultMaxEntries: number;
    now?: () => number;
  }) {
    this.partitions = options.partitions.map(({ prefix, maxEntries }) => ({
      prefix,
      store: new BoundedTtlStore({ maxEntries, now: options.now }),
    }));
    this.fallback = new BoundedTtlStore({
      maxEntries: options.defaultMaxEntries,
      now: options.now,
    });
  }

  private storeFor(key: string): BoundedTtlStore {
    return this.partitions.find(({ prefix }) => key.startsWith(prefix))?.store ?? this.fallback;
  }

  private all(): BoundedTtlStore[] {
    return [...this.partitions.map(({ store }) => store), this.fallback];
  }

  get(key: string): string | null {
    return this.storeFor(key).get(key);
  }

  has(key: string): boolean {
    return this.storeFor(key).has(key);
  }

  set(key: string, value: string, ttlSeconds?: number): void {
    this.storeFor(key).set(key, value, ttlSeconds);
  }

  remove(key: string): void {
    this.storeFor(key).remove(key);
  }

  keys(): string[] {
    return this.all().flatMap((store) => store.keys());
  }

  clear(): void {
    for (const store of this.all()) store.clear();
  }

  sweep(): number {
    return this.all().reduce((removed, store) => removed + store.sweep(), 0);
  }
}
