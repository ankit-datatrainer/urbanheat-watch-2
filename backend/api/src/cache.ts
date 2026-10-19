/** Small TTL cache with insertion-order eviction. */
export class TtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>();

  constructor(
    private ttlMs: number,
    private maxEntries = 1000,
  ) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  set(key: string, value: V, ttlMs = this.ttlMs): void {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
}
