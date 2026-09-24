import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const lustpress = spawn(join(root, "node_modules/.bin/bun"), ["build/index.js"], {
  cwd: join(root, "vendor/lustpress"),
  env: { ...process.env, PORT: "3001" },
  stdio: "inherit",
});
const liszt = spawn(process.execPath, [join(root, "src/server.js")], {
  cwd: root,
  env: { ...process.env, PORT: process.env.PORT || "10000", LUSTPRESS_URL: "http://127.0.0.1:3001" },
  stdio: "inherit",
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  lustpress.kill();
  liszt.kill();
  process.exitCode = code;
}

for (const child of [lustpress, liszt]) {
  child.on("error", (error) => { console.error(error); stop(1); });
  child.on("exit", (code) => stop(code || 1));
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
