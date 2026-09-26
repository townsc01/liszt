import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workflowPath = new URL("../.github/workflows/milestone-sync.yml", import.meta.url);
const yaml = readFileSync(workflowPath, "utf8");

const MAPPED = {
  "phase: new lanes": { title: "Phase 4 - New lanes", number: 31 },
  "phase: playback UX": { title: "Phase 3 - Playback UX", number: 32 },
  "phase: maintenance": { title: "Maintenance queue", number: 33 },
};
// Deliberately not 3/4/5: proves the workflow resolves titles instead of hardcoding numbers.
const MILESTONES = [
  { number: 1, title: "Phase 1 - Foundations: links and metadata" },
  { number: 31, title: "Phase 4 - New lanes" },
  { number: 32, title: "Phase 3 - Playback UX" },
  { number: 33, title: "Maintenance queue" },
  { number: 9, title: "Chris's hand-picked milestone" },
];

const blockAfter = (key) => yaml.split(new RegExp(`^${key}:\\s*$`, "m"))[1].split(/^\S/m)[0];

function runScript() {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => /^\s+run: \|\s*$/.test(line));
  assert.ok(start > -1, "workflow has a single run: | step");
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const script = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      script.push("");
      continue;
    }
    if (line.match(/^\s*/)[0].length <= baseIndent) break;
    script.push(line.slice(baseIndent + 2));
  }
  return script.join("\n");
}

const script = runScript();

function harness({ labels, milestoneNumber = null, milestones = MILESTONES }) {
  const dir = mkdtempSync(join(tmpdir(), "milestone-sync-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const log = join(dir, "calls.log");
  const realJq = execFileSync("bash", ["-c", "command -v jq"]).toString().trim();

  writeFileSync(join(bin, "jq"), `#!/usr/bin/env bash\nexec ${realJq} "$@"\n`);
  writeFileSync(
    join(bin, "gh"),
    `#!/usr/bin/env bash
echo "gh $*" >> "$GH_CALL_LOG"
endpoint=""
for arg in "$@"; do
  case "$arg" in repos/*) endpoint="$arg" ;; esac
done
case "$endpoint" in
  *"/milestones?"*) cat "$GH_MILESTONES_FILE" ;;
  *"/issues/"*) cat "$GH_ISSUE_FILE" ;;
  *) echo "unexpected endpoint: $endpoint" >&2; exit 3 ;;
esac
`,
  );
  chmodSync(join(bin, "jq"), 0o755);
  chmodSync(join(bin, "gh"), 0o755);

  const milestonesFile = join(dir, "milestones.json");
  const issueFile = join(dir, "issue.json");
  writeFileSync(milestonesFile, JSON.stringify(milestones.map((m) => ({ ...m, state: "open" }))));
  writeFileSync(
    issueFile,
    JSON.stringify({ number: 7, labels: labels.map((name) => ({ name })), milestone: milestoneNumber ? { number: milestoneNumber } : null }),
  );

  const scriptFile = join(dir, "script.sh");
  writeFileSync(scriptFile, script);

  try {
    const stdout = execFileSync("bash", [scriptFile], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_REPO: "test/repo",
        ISSUE_NUMBER: "7",
        GH_TOKEN: "unused",
        GH_CALL_LOG: log,
        GH_MILESTONES_FILE: milestonesFile,
        GH_ISSUE_FILE: issueFile,
      },
    });
    const calls = readFileSync(log, "utf8").split("\n").filter(Boolean);
    return { stdout, calls, writes: calls.filter((line) => /(^|\s)-X\s+PATCH(\s|$)/.test(line)) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("triggers are opened and labeled only, so a label removal cannot clear a milestone", () => {
  const on = blockAfter("on");
  assert.match(on, /types:\s*\[opened, labeled\]/);
  assert.doesNotMatch(on, /unlabeled/);
});

test("the job writes issues only", () => {
  const permissions = blockAfter("permissions");
  const keys = permissions.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => line.split(":")[0]);
  assert.deepEqual(keys, ["issues"]);
  assert.match(permissions, /issues:\s*write/);
});

test("a recognized phase label sets the milestone resolved by title, not a hardcoded number", () => {
  const { calls, writes } = harness({ labels: ["instinct", "phase: playback UX"] });
  assert.equal(writes.length, 1, "exactly one write");
  assert.match(writes[0], /issues\/7/);
  assert.match(writes[0], /milestone=32/);
  assert.ok(calls.some((line) => /milestones\?/.test(line)), "milestones are listed to resolve the number");
});

test("several recognized labels resolve by fixed precedence, not by label order", () => {
  const all = harness({ labels: ["phase: maintenance", "phase: playback UX", "phase: new lanes"] });
  assert.match(all.writes[0], /milestone=31/, "new lanes wins");
  const two = harness({ labels: ["phase: maintenance", "phase: playback UX"] });
  assert.match(two.writes[0], /milestone=32/, "playback UX beats maintenance");
  const one = harness({ labels: ["phase: maintenance"] });
  assert.match(one.writes[0], /milestone=33/);
});

test("an issue with no phase label is untouched", () => {
  const { writes, stdout } = harness({ labels: ["instinct", "bug"] });
  assert.equal(writes.length, 0);
  assert.match(stdout, /no recognized phase label/);
});

test("a manual milestone wins over the mapped one", () => {
  const { writes, stdout } = harness({ labels: ["phase: playback UX"], milestoneNumber: 9 });
  assert.equal(writes.length, 0);
  assert.match(stdout, /manual milestone/);
});

test("a phase migration moves between mapped milestones", () => {
  const { writes } = harness({ labels: ["phase: new lanes"], milestoneNumber: 32 });
  assert.equal(writes.length, 1);
  assert.match(writes[0], /milestone=31/);
});

test("re-running the same event makes zero writes", () => {
  const { writes, stdout } = harness({ labels: ["phase: playback UX"], milestoneNumber: 32 });
  assert.equal(writes.length, 0);
  assert.match(stdout, /already on/);
});

test("a missing target milestone leaves the issue untouched instead of failing", () => {
  const { writes, stdout } = harness({ labels: ["phase: playback UX"], milestones: MILESTONES.filter((m) => m.number !== 32) });
  assert.equal(writes.length, 0);
  assert.match(stdout, /not found/);
});
