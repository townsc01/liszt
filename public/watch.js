import { topVideoLink } from "./scene-video.js";

const content = document.querySelector("#watch-content");

function showUnavailable() {
  content.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = "Video unavailable";
  const message = document.createElement("p");
  message.textContent = "This scene has no verified video available to play.";
  content.append(heading, message);
  document.title = "Video unavailable · Liszt";
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

async function showScene(scene, videoLink) {
  content.replaceChildren();
  const eyebrow = document.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Watch · " + scene.studio;
  const heading = document.createElement("h1");
  heading.textContent = scene.title;
  const metadata = document.createElement("p");
  metadata.className = "watch-metadata";
  const date = new Date(`${scene.releaseDate}T12:00:00Z`);
  const releaseDate = Number.isNaN(date.getTime()) ? scene.releaseDate : date.toLocaleDateString("en", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  metadata.textContent = [releaseDate, ...(Array.isArray(scene.performers) ? scene.performers : [])].filter(Boolean).join(" · ");

  const player = document.createElement("div");
  player.className = "watch-player";
  const showPlayerMessage = (message) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    player.replaceChildren(paragraph);
  };
  const loading = document.createElement("p");
  loading.textContent = "Resolving stream…";
  player.append(loading);

  const links = document.createElement("div");
  links.className = "watch-links";
  const sxyprn = document.createElement("a");
  sxyprn.href = videoLink.url;
  sxyprn.target = "_blank";
  sxyprn.rel = "noopener noreferrer";
  sxyprn.textContent = `Open on ${videoLink.source === "eporner" ? "Eporner" : "Sxyprn"} ↗`;
  links.append(sxyprn);
  const source = safeExternalUrl(scene.releaseUrl);
  if (source) {
    const sourceLink = document.createElement("a");
    sourceLink.href = source;
    sourceLink.target = "_blank";
    sourceLink.rel = "noopener noreferrer";
    sourceLink.textContent = "Source record ↗";
    links.append(sourceLink);
  }
  content.append(eyebrow, heading, metadata, player, links);
  document.title = `${scene.title} · Liszt`;
  try {
    if (videoLink.source === "eporner") {
      const iframe = document.createElement("iframe");
      iframe.src = videoLink.embedUrl;
      iframe.allowFullscreen = true;
      iframe.setAttribute("aria-label", `Video player for ${scene.title}`);
      player.replaceChildren(iframe);
      return;
    }
    const videoUrl = `/api/video?scene=${encodeURIComponent(scene.id)}`;
    const response = await fetch(`/api/video/resolve?scene=${encodeURIComponent(scene.id)}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Video unavailable");
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = videoUrl;
    video.setAttribute("aria-label", `Video player for ${scene.title}`);
    const timeout = setTimeout(() => showPlayerMessage("Video did not load here. Open it on Sxyprn using the link below."), 90_000);
    video.addEventListener("loadedmetadata", () => clearTimeout(timeout), { once: true });
    video.addEventListener("error", () => {
      clearTimeout(timeout);
      showPlayerMessage("Video could not play here. Open it on Sxyprn using the link below.");
    }, { once: true });
    player.replaceChildren(video);
  } catch {
    showPlayerMessage("Video could not load here. Open it on Sxyprn using the link below.");
  }
}

try {
  const id = new URL(location.href).searchParams.get("scene");
  if (!id) throw new Error("Missing scene");
  const response = await fetch("/api/scenes", { cache: "no-store" });
  if (!response.ok) throw new Error("Catalogue unavailable");
  const catalogue = await response.json();
  const scene = Array.isArray(catalogue.scenes) ? catalogue.scenes.find((item) => item.id === id) : null;
  const videoLink = topVideoLink(scene);
  if (scene && videoLink) await showScene(scene, videoLink);
  else showUnavailable();
} catch {
  showUnavailable();
}
