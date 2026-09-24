const list = document.querySelector("#list");
const empty = document.querySelector("#empty");
const search = document.querySelector("#search");
const sort = document.querySelector("#sort");
const count = document.querySelector("#count");
let scenes = [];

const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const parseDate = (value) => new Date(`${value}T12:00:00Z`);

function render() {
  const query = search.value.trim().toLowerCase();
  const filtered = scenes.filter((scene) => [scene.title, scene.studio, ...scene.performers].join(" ").toLowerCase().includes(query));
  filtered.sort((a, b) => sort.value === "title" ? a.title.localeCompare(b.title) : (sort.value === "oldest" ? 1 : -1) * a.releaseDate.localeCompare(b.releaseDate));
  const groups = new Map();
  for (const scene of filtered) {
    const month = parseDate(scene.releaseDate).toLocaleDateString("en", { month: "long", year: "numeric", timeZone: "UTC" });
    groups.set(month, [...(groups.get(month) || []), scene]);
  }
  count.textContent = `${filtered.length} ${filtered.length === 1 ? "release" : "releases"}`;
  empty.hidden = filtered.length > 0;
  list.hidden = filtered.length === 0;
  list.innerHTML = [...groups].map(([month, items]) => `
    <section class="month"><div class="month-heading"><h2>${escapeHtml(month)}</h2><span>${items.length} ${items.length === 1 ? "release" : "releases"}</span></div>
    ${items.map((scene, index) => {
      const date = parseDate(scene.releaseDate);
      const initials = scene.title.split(/\s+/).slice(0, 2).map((word) => word[0]).join("");
      return `<article class="row" style="animation-delay:${index * 45}ms">
        <time class="date" datetime="${scene.releaseDate}"><strong>${date.getUTCDate().toString().padStart(2, "0")}</strong><span>${date.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })}</span></time>
        <div class="thumb">${scene.thumbnailUrl ? `<img src="${escapeHtml(scene.thumbnailUrl)}" alt="">` : escapeHtml(initials)}</div>
        <div class="details"><h3>${escapeHtml(scene.title)}</h3><p>${escapeHtml(scene.studio)}</p></div>
        <div class="performers">${scene.performers.map(escapeHtml).join(" · ") || "Performers unlisted"}</div>
        <a class="link" href="${escapeHtml(scene.releaseUrl)}" target="_blank" rel="noreferrer" aria-label="Open ${escapeHtml(scene.title)} studio release">↗</a>
      </article>`;
    }).join("")}</section>`).join("");
}

search.addEventListener("input", render);
sort.addEventListener("change", render);

try {
  const response = await fetch("/api/scenes");
  if (!response.ok) throw new Error("Catalogue unavailable");
  const data = await response.json();
  scenes = data.scenes;
  document.querySelector("#last-checked").textContent = data.lastChecked
    ? new Date(data.lastChecked).toLocaleString("en", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
    : "Not yet checked";
  render();
} catch (error) {
  list.innerHTML = `<div class="empty"><span>!</span><h2>Catalogue unavailable</h2><p>${escapeHtml(error.message)}</p></div>`;
}
