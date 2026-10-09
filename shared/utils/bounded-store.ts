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
