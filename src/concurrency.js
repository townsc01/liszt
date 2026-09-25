export function concurrencyLimit(value, fallback = 4) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 16) : fallback;
}

export async function mapWithConcurrency(items, limit, mapper) {
  if (!items.length) return [];
  const concurrency = concurrencyLimit(limit, 1);
  const output = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      output[index] = await mapper(items[index], index);
    }
  }));
  return output;
}
