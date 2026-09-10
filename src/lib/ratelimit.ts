const buckets = new Map<string, number[]>();

export interface LimitResult {
  ok: boolean;
  retryAfterSec: number;
}

export function checkRateLimit(key: string, limit = Number(process.env.VISITS_PER_WINDOW ?? 6), windowMs = 10 * 60_000): LimitResult {
  const now = Date.now();
  const stamps = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (stamps.length >= limit) {
    const retryAfterSec = Math.ceil((windowMs - (now - stamps[0])) / 1000);
    buckets.set(key, stamps);
    return { ok: false, retryAfterSec };
  }
  stamps.push(now);
  buckets.set(key, stamps);
  return { ok: true, retryAfterSec: 0 };
}

const MAX_CONCURRENT = Number(process.env.MAX_CONCURRENT_VISITS ?? 1);
let active = 0;
const waiters: (() => void)[] = [];

export async function acquireSlot(timeoutMs = 90_000): Promise<() => void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return release;
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = waiters.indexOf(wake);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error("busy"));
    }, timeoutMs);
    const wake = () => {
      clearTimeout(timer);
      active += 1;
      resolve(release);
    };
    waiters.push(wake);
  });
}

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

export function queueDepth(): number {
  return waiters.length;
}
