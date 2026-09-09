/**
 * Tiny TTL cache.
 *
 * TourAPI 개발계정은 일 1,000건 제한이 있어서, 같은 질의를 반복하면
 * 금방 한도가 찹니다. 화면 하나가 여러 카테고리를 동시에 조회하므로
 * 인메모리 캐시가 사실상 필수입니다.
 */
export class TtlCache {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) { this.misses++; return undefined; }
    if (Date.now() > hit.expires) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return hit.value;
  }

  set(key, value) {
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }

  /** Collapses concurrent identical requests onto one upstream call. */
  async wrap(key, fn) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    if (!this.inflight) this.inflight = new Map();
    if (this.inflight.has(key)) return this.inflight.get(key);

    const p = (async () => {
      try {
        const value = await fn();
        this.set(key, value);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, p);
    return p;
  }

  clear() { this.map.clear(); }

  stats() {
    return { size: this.map.size, hits: this.hits, misses: this.misses };
  }
}
