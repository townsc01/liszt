const DAY = 86_400_000;

export function withinRollingWindow(scenes, now = new Date(), days = 90) {
  const earliest = new Date(now.getTime() - days * DAY);
  return scenes.filter((scene) => {
    const date = new Date(`${scene.releaseDate}T00:00:00Z`);
    return date <= now && date >= earliest;
  });
}

export function validateResult(adapter, result) {
  if (!result || !Array.isArray(result.scenes)) throw new Error("Adapter did not return a scenes array");
  if (!result.scenes.length && result.verifiedEmpty !== true) throw new Error("Suspicious empty extraction (not explicitly verified)");
  return result.scenes.map((scene) => {
    if (!scene.sourceSceneId || !scene.releaseDate || !scene.title) throw new Error("Scene is missing sourceSceneId, releaseDate, or title");
    return { ...scene, id: `${adapter.id}:${scene.sourceSceneId}`, studioId: adapter.id, studio: adapter.name,
      ...(adapter.creatorStudio ? { creatorStudio: true } : {}) };
  });
}
