class NonRetryableResponseError extends Error {}

/** Fetch source pages with bounded retries and a useful failure location. */
export async function fetchAnalVidsText(url, fetchImpl, { attempts = 3, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { headers: { "user-agent": "Liszt catalogue updater/1.0" } });
      if (response.ok) return await response.text();
      if (response.status < 500 && response.status !== 429) {
        return Promise.reject(new NonRetryableResponseError(`AnalVids returned ${response.status} for ${url}`));
      }
      if (attempt === attempts) throw new Error(`AnalVids returned ${response.status} for ${url} after ${attempts} attempts`);
    } catch (error) {
      if (error instanceof NonRetryableResponseError) throw error;
      if (attempt === attempts) throw new Error(`AnalVids fetch failed for ${url} after ${attempts} attempts: ${error.message}`, { cause: error });
    }
    await delay(500 * 2 ** (attempt - 1));
  }
}
