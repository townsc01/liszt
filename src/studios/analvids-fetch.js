/** Fetch source pages with bounded retries and a useful failure location. */
export async function fetchAnalVidsText(url, fetchImpl, { attempts = 3, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: { "user-agent": "Liszt catalogue updater/1.0", accept: "text/html" },
      });
      if (response.ok) return await response.text();
      const error = new Error(`AnalVids returned ${response.status} for ${url}`);
      error.status = response.status;
      throw error;
    } catch (error) {
      if (error.status && error.status < 500 && error.status !== 429) throw error;
      if (error.status && attempt === attempts) {
        throw new Error(`AnalVids returned ${error.status} for ${url} after ${attempts} attempts`, { cause: error });
      }
      if (attempt === attempts) throw new Error(`AnalVids fetch failed for ${url} after ${attempts} attempts: ${error.message}`, { cause: error });
    }
    await delay(500 * 2 ** (attempt - 1));
  }
}
