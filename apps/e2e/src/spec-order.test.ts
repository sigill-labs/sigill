import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// The specs run one at a time, file by file, in the order Playwright sorts their names
// (`localeCompare`). For 60 s after `restartServer()` the server answers `starting` instead of
// `unknown` for a link nobody hosts (decision 0018), so a spec that expects "This link isn't
// active" must run before every spec that restarts the server.

const tests = new URL("../tests/", import.meta.url);
const specs = readdirSync(tests)
  .filter((name) => name.endsWith(".spec.ts"))
  .sort((a, b) => a.localeCompare(b));
const source = (name: string) => readFileSync(new URL(name, tests), "utf8");

const restarts = specs.filter((name) => /\brestartServer\(/.test(source(name)));
const refuses = specs.filter((name) =>
  /This link isn't active"(?: \})?\)\)\.toBeVisible\(/.test(source(name)),
);

test("the guard finds the specs it orders", () => {
  assert.ok(restarts.includes("server-restart.spec.ts"), "no spec restarts the server");
  assert.ok(refuses.includes("delivery.spec.ts"), "no spec expects a refused link");
});

test("every spec that expects a refused link runs before every spec that restarts the server", () => {
  const late = refuses.flatMap((refusing) =>
    restarts
      .filter((restarting) => specs.indexOf(restarting) < specs.indexOf(refusing))
      .map((restarting) => `${refusing} runs after ${restarting}`),
  );
  assert.deepEqual(late, []);
});
