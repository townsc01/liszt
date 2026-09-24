import { fetchPageText } from "../fetch-page.js";

/** Fetch source pages with bounded retries and a useful failure location. */
export async function fetchAnalVidsText(url, fetchImpl, { attempts = 3, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetchPageText(url, fetchImpl, { source: "AnalVids" });
    } catch (error) {
      if (error.status && error.status < 500 && error.status !== 429) throw error;
      if (/FlareSolverr/.test(error.message)) throw error;
      if (error.status && attempt === attempts) {
        throw new Error(`AnalVids returned ${error.status} for ${url} after ${attempts} attempts`, { cause: error });
      }
      if (attempt === attempts) throw new Error(`AnalVids fetch failed for ${url} after ${attempts} attempts: ${error.message}`, { cause: error });
    }
    await delay(500 * 2 ** (attempt - 1));
  }
}
