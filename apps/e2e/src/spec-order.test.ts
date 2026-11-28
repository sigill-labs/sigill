import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// The specs run one at a time, file by file, in the order Playwright sorts their names
// (`localeCompare`). For 60 s after `restartServer()` the server answers `starting` instead of
// `unknown` for a link nobody hosts (decision 0018), so a spec that expects "This link isn't
// active" must run before every spec that restarts the server.

const tests = new URL("../tests/", import.meta.url);
const entries = readdirSync(tests, { withFileTypes: true });
const specs = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));
const source = (name: string) => readFileSync(new URL(name, tests), "utf8");

/** A spec restarts the server when it imports `restartServer` at all. */
const restarts = specs.filter((name) => /\brestartServer\b/.test(source(name)));
/** A spec expects a refused link when any code line names the page, unless it checks it is absent. */
const refuses = specs.filter((name) =>
  source(name)
    .split("\n")
    .some(
      (line) =>
        line.includes("This link isn't active") &&
        !line.trimStart().startsWith("//") &&
        !/toHaveCount\(0\)|\.not\./.test(line),
    ),
);

test("the guard sees every spec and every restart", () => {
  assert.deepEqual(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    [],
    "Playwright orders each directory on its own, which this guard doesn't model",
  );
  // A spec must call restartServer itself, so the check above sees it.
  const src = new URL("./", import.meta.url);
  const wrappers = readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
    (name) =>
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      name !== "stack/server.ts" &&
      /\bimport\b[^;]*\brestartServer\b/.test(readFileSync(new URL(name, src), "utf8")),
  );
  assert.deepEqual(wrappers, []);
  assert.deepEqual(
    [refuses.includes("delivery.spec.ts"), refuses.includes("safety-number.spec.ts")],
    [true, true],
  );
  assert.deepEqual(
    [restarts.includes("sent-by-email.spec.ts"), restarts.includes("server-restart.spec.ts")],
    [true, true],
  );
});

test("every spec that expects a refused link runs before every spec that restarts the server", () => {
  const late = refuses.flatMap((refusing) =>
    restarts
      .filter((restarting) => specs.indexOf(restarting) < specs.indexOf(refusing))
      .map((restarting) => `${refusing} runs after ${restarting}`),
  );
  assert.deepEqual(late, []);
});
