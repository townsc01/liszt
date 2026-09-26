import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflowPath = new URL("../.github/workflows/catalogue-refresh.yml", import.meta.url);
const yaml = readFileSync(workflowPath, "utf8");

test("catalogue refresh workflow configuration", () => {
  assert.match(yaml, /name:\s*Refresh live catalogue/);
  assert.match(yaml, /cron:\s*['"]0 \*\/*6 \* \* \*['"]/);
  assert.match(yaml, /workflow_dispatch:/);
  assert.match(yaml, /contents:\s*write/);
  assert.match(yaml, /npm run sync/);
  assert.match(yaml, /npm run backfill:translate/);
  assert.match(yaml, /git add data\/catalogue\.json data\/translations\.json/);
  assert.match(yaml, /Refresh live catalogue \[skip ci\]/);
});
