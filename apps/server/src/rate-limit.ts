import { HttpError } from './errors.js';

/** Outcome of one rate limit check. */
export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window frees up (0 when allowed). */
  retryAfterSeconds: number;
}

/**
 * Fixed-window counters keyed by string (docs/backend.md §5.5). The in-memory store fits one
 * server process; a Redis implementation can replace it later without touching the routes.
 */
export interface RateLimitStore {
  /**
   * Adds `cost` to `key` in a window of `windowMs` if the total stays within `limit`.
   * A rejected hit does not consume budget.
   */
  hit(key: string, cost: number, limit: number, windowMs: number): Promise<RateLimitResult>;
}

interface Window {
  used: number;
  resetAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();
  private hits = 0;

  constructor(
    private readonly now: () => number = Date.now,
    /** Expired windows are swept every `sweepEvery` hits so memory stays bounded. */
    private readonly sweepEvery = 1000,
  ) {}

  get size(): number {
    return this.windows.size;
  }

  hit(key: string, cost: number, limit: number, windowMs: number): Promise<RateLimitResult> {
    const t = this.now();
    if (++this.hits % this.sweepEvery === 0) this.sweep(t);
    let w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      w = { used: 0, resetAt: t + windowMs };
      this.windows.set(key, w);
    }
    if (w.used + cost > limit) {
      return Promise.resolve({
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - t) / 1000)),
      });
    }
    w.used += cost;
    return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
  }

  private sweep(t: number): void {
    for (const [k, w] of this.windows) if (w.resetAt <= t) this.windows.delete(k);
  }
}

/** HTTP 429 with `Retry-After` (set by the app error handler). */
export class RateLimitedError extends HttpError {
  constructor(
    readonly retryAfterSeconds: number,
    message = 'too many requests',
  ) {
    super(429, 'rate_limited', message);
    this.name = 'RateLimitedError';
  }
}

/** Throws `RateLimitedError` when the hit is over the limit. */
export async function enforce(
  store: RateLimitStore,
  key: string,
  cost: number,
  limit: number,
  windowMs: number,
  message?: string,
): Promise<void> {
  const r = await store.hit(key, cost, limit, windowMs);
  if (!r.allowed) throw new RateLimitedError(r.retryAfterSeconds, message);
}
