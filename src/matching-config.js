/** Per-studio retrieval hints. These expand candidate pools; they never bypass the gate. */
export const matchingQueryConfig = Object.freeze({
  "mambo-perv": Object.freeze({ sceneCodePattern: /\bOB\d{3,}\b/i }),
});

export function configuredSceneCode(scene) {
  return String(scene.title || "").match(matchingQueryConfig[scene.studioId]?.sceneCodePattern)?.[0]?.toLowerCase() || null;
}
