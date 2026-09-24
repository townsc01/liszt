const DAY = 86_400_000;

export function normalizeTitle(value = "") {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function identity(scene) {
  return [scene.studio.toLowerCase(), scene.releaseDate, normalizeTitle(scene.title)].join("|");
}

function clean(scene) {
  return {
    id: scene.id || identity(scene),
    title: scene.title.trim(),
    releaseDate: scene.releaseDate,
    studio: scene.studio.trim(),
    performers: [...new Set((scene.performers || []).map((name) => name.trim()).filter(Boolean))],
    thumbnailUrl: scene.thumbnailUrl || "",
    releaseUrl: scene.releaseUrl || "",
    source: scene.source,
  };
}

/** Reconcile feeds with the studio record taking precedence over enrichment data. */
export function reconcile(studioScenes, tpdbScenes) {
  const records = new Map();
  for (const raw of [...tpdbScenes, ...studioScenes]) {
    const scene = clean(raw);
    const key = identity(scene);
    const current = records.get(key);
    if (!current) {
      records.set(key, scene);
      continue;
    }
    const studioRecord = scene.source === "studio" ? scene : current;
    const other = scene.source === "studio" ? current : scene;
    records.set(key, {
      ...other,
      ...studioRecord,
      performers: [...new Set([...studioRecord.performers, ...other.performers])],
      thumbnailUrl: studioRecord.thumbnailUrl || other.thumbnailUrl,
      releaseUrl: studioRecord.releaseUrl || other.releaseUrl,
      source: studioRecord.source,
    });
  }
  return [...records.values()].sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}

export function withinRollingWindow(scenes, now = new Date(), days = 90) {
  const earliest = new Date(now.getTime() - days * DAY);
  return scenes.filter((scene) => {
    const date = new Date(`${scene.releaseDate}T00:00:00Z`);
    return date <= now && date >= earliest;
  });
}
