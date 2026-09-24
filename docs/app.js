const list = document.querySelector("#list");
const empty = document.querySelector("#empty");
const search = document.querySelector("#search");
const sort = document.querySelector("#sort");
const studio = document.querySelector("#studio");
const count = document.querySelector("#count");
const notices = document.querySelector("#notices");
let scenes = [];

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
search.addEventListener("input", render);
sort.addEventListener("change", render);
studio.addEventListener("change", () => {
  const url = new URL(location.href);
  studio.value === "all" ? url.searchParams.delete("studio") : url.searchParams.set("studio", studio.value);
  history.replaceState(null, "", url);
  render();
});
try {
  const response = await fetch("./catalogue.json", { cache: "no-store" });
  if (!response.ok) throw new Error("Catalogue unavailable");
  const data = await response.json();
  scenes = data.scenes;
  const statuses = data.studios || [];
  studio.insertAdjacentHTML("beforeend", statuses.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${scenes.filter((scene) => scene.studioId === item.id).length})</option>`).join(""));
  const requestedStudio = new URL(location.href).searchParams.get("studio");
  if ([...studio.options].some((option) => option.value === requestedStudio)) studio.value = requestedStudio;
  notices.innerHTML = statuses.filter((item) => item.error).map((item) => `<div class="notice"><strong>${escapeHtml(item.name)} refresh failed.</strong> Showing retained data from ${item.lastSuccessfulRefresh ? escapeHtml(new Date(item.lastSuccessfulRefresh).toLocaleString()) : "the last available catalogue"}. ${escapeHtml(item.error)}</div>`).join("");
  document.querySelector("#last-checked").textContent = data.lastChecked ? new Date(data.lastChecked).toLocaleString("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Not yet checked";
  render();
} catch (error) {
  list.innerHTML = `<div class="empty"><span>!</span><h2>Catalogue unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
}
