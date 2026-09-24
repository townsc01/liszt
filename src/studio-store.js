import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

export async function readStudios(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

export async function addStudio(path, preview) {
  const studios = await readStudios(path);
  const key = new URL(preview.homepageUrl).origin.toLowerCase();
  const existing = studios.find((studio) => new URL(studio.homepageUrl).origin.toLowerCase() === key);
  if (existing) return { studio: existing, created: false };
  const slug = preview.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "studio";
  const studio = { id: `${slug}-${createHash("sha256").update(key).digest("hex").slice(0, 7)}`, name: preview.name, homepageUrl: preview.homepageUrl, addedAt: new Date().toISOString() };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, `${JSON.stringify([...studios, studio], null, 2)}\n`);
  await rename(temp, path);
  return { studio, created: true };
}
