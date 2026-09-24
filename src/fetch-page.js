/** Fetch an HTML page, using FlareSolverr when the source answers with 403. */
export async function fetchPageText(url, fetchImpl = fetch, { headers = {}, source = "Source" } = {}) {
  const response = await fetchImpl(url, {
    headers: { "user-agent": "Liszt catalogue updater/1.0", accept: "text/html", ...headers },
  });
  if (response.ok) return response.text();
  if (response.status !== 403) {
    const error = new Error(`${source} returned ${response.status} for ${url}`);
    error.status = response.status;
    throw error;
  }

  const endpoint = process.env.FLARESOLVERR_URL;
  if (!endpoint) {
    const error = new Error(`${source} returned 403 for ${url}; set FLARESOLVERR_URL to enable FlareSolverr`);
    error.status = 403;
    throw error;
  }

  let solverResponse;
  try {
    solverResponse = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 60_000 }),
    });
  } catch (error) {
    throw new Error(`FlareSolverr request failed for ${url}: ${error.message}`, { cause: error });
  }
  if (!solverResponse.ok) throw new Error(`FlareSolverr returned ${solverResponse.status} for ${url}`);

  let result;
  try {
    result = await solverResponse.json();
  } catch (error) {
    throw new Error(`FlareSolverr returned invalid JSON for ${url}`, { cause: error });
  }
  if (result.status !== "ok" || typeof result.solution?.response !== "string") {
    throw new Error(`FlareSolverr did not return a page for ${url}: ${result.message || result.status || "invalid response"}`);
  }
  if (result.solution.status < 200 || result.solution.status >= 300) {
    throw new Error(`FlareSolverr returned page status ${result.solution.status} for ${url}`);
  }
  return result.solution.response;
}
