/**
 * Shared bound for outbound fetches. Every fan-out over a variable-length list
 * (studio-site scrapes during ingest, playback-source checks across the stored
 * catalogue) draws from ONE process-wide pool, so parallel adapters cannot
 * multiply the burst. Keeps the process within the 512MB deployment's budget.
 * Override with LISZT_FETCH_CONCURRENCY.
 */
export const DEFAULT_FETCH_CONCURRENCY = 6;

const MIN_FETCH_CONCURRENCY = 1;
const MAX_FETCH_CONCURRENCY = 16;

/** Resolve the configured in-flight limit, clamped to a sane range. */
export function resolveFetchConcurrency(value = process.env.LISZT_FETCH_CONCURRENCY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < MIN_FETCH_CONCURRENCY) return DEFAULT_FETCH_CONCURRENCY;
  return Math.min(MAX_FETCH_CONCURRENCY, Math.floor(parsed));
}

let active = 0;
const waiters = [];

async function acquire() {
  while (active >= resolveFetchConcurrency()) {
    await new Promise((resolve) => waiters.push(resolve));
  }
  active += 1;
}

function release() {
  active -= 1;
  waiters.shift()?.();
}

/** Run `task` holding one slot of the shared pool. */
async function withFetchSlot(task) {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

/**
 * Run `task` over `items` through the shared pool, preserving input order.
 * A rejected task rejects the whole call, matching Promise.all.
 */
export async function mapWithConcurrency(items, task) {
  const list = Array.from(items);
  const results = new Array(list.length);
  let next = 0;
  const workers = Math.max(1, Math.min(resolveFetchConcurrency(), list.length));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < list.length) {
      const index = next++;
      results[index] = await withFetchSlot(() => task(list[index], index));
    }
  }));
  return results;
}
