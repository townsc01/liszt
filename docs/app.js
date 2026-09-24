const list = document.querySelector("#list");
const empty = document.querySelector("#empty");
const search = document.querySelector("#search");
const sort = document.querySelector("#sort");
const studio = document.querySelector("#studio");
const count = document.querySelector("#count");
const notices = document.querySelector("#notices");
const refresh = document.querySelector("#refresh");
const lastChecked = document.querySelector("#last-checked");
const sourcesDialog = document.querySelector("#sources");
const addDialog = document.querySelector("#add");
const sourcesList = document.querySelector("#sources-list");
const navLinks = document.querySelectorAll("nav [data-view]");
const catalogueUrl = document.body.dataset.catalogueUrl || "./catalogue.json";
const refreshUrl = document.body.dataset.refreshUrl;
const apiBase = document.body.dataset.apiBase || "";
let scenes = [];
let sourceStatuses = [];

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const parseDate = (value) => new Date(`${value}T12:00:00Z`);

function render() {
  const query = search.value.trim().toLowerCase();
  const filtered = scenes.filter((scene) => (studio.value === "all" || scene.studioId === studio.value) && [scene.title, scene.studio, ...scene.performers].join(" ").toLowerCase().includes(query));
  filtered.sort((a, b) => sort.value === "title" ? a.title.localeCompare(b.title) : (sort.value === "oldest" ? 1 : -1) * a.releaseDate.localeCompare(b.releaseDate));
  const groups = new Map();
  for (const scene of filtered) {
    const month = parseDate(scene.releaseDate).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
    groups.set(month, [...(groups.get(month) || []), scene]);
  }
  count.textContent = `${filtered.length} ${filtered.length === 1 ? "release" : "releases"}`;
  empty.hidden = filtered.length > 0;
  list.hidden = filtered.length === 0;
  list.innerHTML = [...groups].map(([month, items]) => `<section class="month"><div class="month-heading"><h2>${escapeHtml(month)}</h2><span>${items.length} ${items.length === 1 ? "release" : "releases"}</span></div>${items.map((scene, index) => {
    const date = parseDate(scene.releaseDate);
    const initials = scene.title.split(/\s+/).slice(0, 2).map((word) => word[0]).join("");
    return `<article class="row" style="animation-delay:${index * 45}ms"><time class="date" datetime="${scene.releaseDate}"><strong>${date.getUTCDate().toString().padStart(2, "0")}</strong><span>${date.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })}</span></time><div class="thumb">${scene.thumbnailUrl ? `<img src="${escapeHtml(scene.thumbnailUrl)}" alt="">` : escapeHtml(initials)}</div><div class="details"><h3>${escapeHtml(scene.title)}</h3><p>${escapeHtml(scene.studio)}</p></div><div class="performers">${scene.performers.map(escapeHtml).join(" · ") || "Performers unlisted"}</div><a class="link" href="${escapeHtml(scene.releaseUrl)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} source record">↗</a></article>`;
  }).join("")}</section>`).join("");
}

function renderSources() {
  if (!sourceStatuses.length) {
    sourcesList.innerHTML = '<div class="empty source-empty"><span>∅</span><h2>No sources configured</h2></div>';
    return;
  }
  sourcesList.innerHTML = sourceStatuses.map((item) => {
    const authority = item.authority || {};
    const updated = item.lastSuccessfulRefresh ? new Date(item.lastSuccessfulRefresh).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "Not yet refreshed";
    const releaseCount = scenes.filter((scene) => scene.studioId === item.id).length;
    const sourceUrl = /^https?:\/\//i.test(authority.url || "") ? authority.url : "#";
    return `<article class="source-item"><div class="source-item__status ${item.error ? "source-item__status--error" : ""}" aria-label="${item.error ? "Source has an error" : "Source is available"}"></div><div class="source-item__body"><p class="source-role">${escapeHtml(authority.role || "Catalogue source")}</p><h3>${escapeHtml(item.name)}</h3><p class="source-authority">Provided by ${escapeHtml(authority.name || "Unknown authority")}</p><dl><div><dt>Watchlist records</dt><dd>${releaseCount}</dd></div><div><dt>Last successful refresh</dt><dd>${escapeHtml(updated)}</dd></div></dl>${item.error ? `<p class="source-error">${escapeHtml(item.error)}</p>` : ""}</div><a class="source-open" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer"><span>Open catalogue</span> ↗</a></article>`;
  }).join("");
}

function syncView() {
  const showSources = location.hash === "#sources";
  const showAdd = location.hash === "#add";
  navLinks.forEach((link) => link.classList.toggle("active", link.dataset.view === (showSources ? "sources" : showAdd ? "add" : "watchlist")));
  if (showSources && !sourcesDialog.open) sourcesDialog.showModal();
  if (!showSources && sourcesDialog.open) sourcesDialog.close();
  if (showAdd && !addDialog.open) addDialog.showModal();
  if (!showAdd && addDialog.open) addDialog.close();
}

window.addEventListener("hashchange", syncView);
sourcesDialog.querySelector(".dialog-close").addEventListener("click", () => { location.hash = "watchlist"; });
sourcesDialog.addEventListener("click", (event) => {
  if (event.target === sourcesDialog) location.hash = "watchlist";
});
sourcesDialog.addEventListener("close", () => {
  if (location.hash === "#sources") history.replaceState(null, "", `${location.pathname}${location.search}#watchlist`);
  syncView();
});
addDialog.querySelector(".dialog-close").addEventListener("click", () => { location.hash = "watchlist"; });
addDialog.addEventListener("close", () => { if (location.hash === "#add") history.replaceState(null, "", `${location.pathname}${location.search}#watchlist`); syncView(); });
addDialog.addEventListener("click", (event) => { if (event.target === addDialog) location.hash = "watchlist"; });

const discoveryStatus = document.querySelector("#discovery-status");
const studioPreview = document.querySelector("#studio-preview");
const tokenInput = document.querySelector("#admin-token");
tokenInput.value = sessionStorage.getItem("liszt-admin-token") || "";
const apiRequest = async (path, options = {}) => {
  const response = await fetch(`${apiBase}${path}`, { ...options, headers: { "content-type": "application/json", authorization: `Bearer ${tokenInput.value}`, ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
};
document.querySelector("#discover-form").addEventListener("submit", async (event) => {
  event.preventDefault(); sessionStorage.setItem("liszt-admin-token", tokenInput.value);
  discoveryStatus.innerHTML = '<div class="notice">Exploring same-site release links…</div>'; studioPreview.innerHTML = "";
  try {
    const preview = await apiRequest("/api/studios/preview", { method: "POST", body: JSON.stringify({ url: document.querySelector("#studio-url").value }) });
    discoveryStatus.innerHTML = preview.supported ? "" : `<div class="notice"><strong>Pending.</strong> Missing ${preview.missing.map(escapeHtml).join(", ")}.</div>`;
    studioPreview.innerHTML = `<article class="preview"><h3>${escapeHtml(preview.name)}</h3><p>${preview.pages.length} pages inspected · ${preview.scenes.length} recent scenes</p><ul>${preview.pages.slice(0, 8).map((page) => `<li><a href="${escapeHtml(page.url)}" target="_blank" rel="noreferrer">${escapeHtml(page.url)}</a> <small>${page.records} records</small></li>`).join("")}</ul><div class="preview-scenes">${preview.scenes.slice(0, 8).map((scene) => `<a href="${escapeHtml(scene.releaseUrl)}" target="_blank" rel="noreferrer">${scene.thumbnailUrl ? `<img src="${escapeHtml(scene.thumbnailUrl)}" alt="">` : ""}<span><strong>${escapeHtml(scene.title)}</strong><time>${escapeHtml(scene.releaseDate)}</time></span></a>`).join("")}</div><button id="confirm-studio" class="primary" type="button" ${preview.supported ? "" : "disabled"}>Add studio</button></article>`;
    document.querySelector("#confirm-studio").addEventListener("click", async () => {
      discoveryStatus.innerHTML = '<div class="notice">Saving studio…</div>';
      const { jobId } = await apiRequest("/api/studios", { method: "POST", body: JSON.stringify({ previewId: preview.previewId }) });
      let job;
      do { await new Promise((resolve) => setTimeout(resolve, 500)); job = await apiRequest(`/api/jobs/${jobId}`); discoveryStatus.innerHTML = `<div class="notice">${escapeHtml(job.state === "syncing" ? "Running first sync…" : job.state)}</div>`; } while (!["complete", "failed"].includes(job.state));
      if (job.state === "failed") throw new Error(job.error);
      applyCatalogue(job.catalogue); discoveryStatus.innerHTML = `<div class="notice"><strong>${job.duplicate ? "Already watched." : "Studio added."}</strong> ${escapeHtml(job.studio.name)} is now in the filter.</div>`;
    });
  } catch (error) { discoveryStatus.innerHTML = `<div class="notice"><strong>Discovery failed.</strong> ${escapeHtml(error.message)}</div>`; }
});
search.addEventListener("input", render);
sort.addEventListener("change", render);
studio.addEventListener("change", () => {
  const url = new URL(location.href);
  studio.value === "all" ? url.searchParams.delete("studio") : url.searchParams.set("studio", studio.value);
  history.replaceState(null, "", url);
  render();
});

function applyCatalogue(data) {
  scenes = data.scenes;
  const statuses = data.studios || [];
  sourceStatuses = statuses;
  const selectedStudio = studio.value;
  studio.replaceChildren(new Option("All studios", "all"));
  studio.insertAdjacentHTML("beforeend", statuses.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${scenes.filter((scene) => scene.studioId === item.id).length})</option>`).join(""));
  const requestedStudio = new URL(location.href).searchParams.get("studio");
  const desiredStudio = selectedStudio !== "all" ? selectedStudio : requestedStudio;
  if ([...studio.options].some((option) => option.value === desiredStudio)) studio.value = desiredStudio;
  notices.innerHTML = statuses.filter((item) => item.error).map((item) => `<div class="notice"><strong>${escapeHtml(item.name)} refresh failed.</strong> Showing retained data from ${item.lastSuccessfulRefresh ? escapeHtml(new Date(item.lastSuccessfulRefresh).toLocaleString()) : "the last available catalogue"}. ${escapeHtml(item.error)}</div>`).join("");
  lastChecked.textContent = data.lastChecked ? new Date(data.lastChecked).toLocaleString("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Not yet checked";
  renderSources();
  render();
}

async function loadCatalogue({ refreshSources = false } = {}) {
  const response = await fetch(refreshSources && refreshUrl ? refreshUrl : catalogueUrl, {
    method: refreshSources && refreshUrl ? "POST" : "GET",
    headers: refreshSources && refreshUrl ? { authorization: `Bearer ${sessionStorage.getItem("liszt-admin-token") || ""}` } : {},
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Catalogue unavailable");
  applyCatalogue(await response.json());
}

refresh.addEventListener("click", async () => {
  refresh.disabled = true;
  refresh.classList.add("refreshing");
  refresh.lastChild.textContent = refreshUrl ? " Refreshing sources…" : " Checking for updates…";
  try {
    await loadCatalogue({ refreshSources: true });
  } catch (error) {
    notices.innerHTML = `<div class="notice"><strong>Refresh failed.</strong> ${escapeHtml(error.message)} Please try again.</div>`;
  } finally {
    refresh.disabled = false;
    refresh.classList.remove("refreshing");
    refresh.lastChild.textContent = " Refresh data";
  }
});

try {
  await loadCatalogue();
} catch (error) {
  list.innerHTML = `<div class="empty"><span>!</span><h2>Catalogue unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
}
syncView();
