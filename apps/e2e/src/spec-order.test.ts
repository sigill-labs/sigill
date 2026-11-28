import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

// The specs run one at a time, file by file, in the order Playwright sorts their names
// (`localeCompare`). For 60 s after `restartServer()` the server answers `starting` instead of
// `unknown` for a link nobody hosts (decision 0018), so a spec that expects "This link isn't
// active" must run before every spec that restarts the server.
//
// The guard reads the source text and knows two things only. A spec "expects a refused link" when
// a statement (text up to a `;`, comments removed) contains the literal English title
// "This link isn't active" and neither `toHaveCount(0)` nor `.not.`. A spec "restarts the server"
// when it imports a module whose path ends in `stack/server.ts`, in any import form. So every
// restart must come from a spec that imports that module itself: no file under src/ outside
// src/stack/ may import it, or a wrapper could restart without the spec showing it.

const tests = new URL("../tests/", import.meta.url);
const entries = readdirSync(tests, { withFileTypes: true });
const specs = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b));

/** Removes `/* ... *\/` blocks and `//` comments, leaving `://` inside strings alone. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const code = (url: URL) => stripComments(readFileSync(url, "utf8"));
/** An import, re-export or dynamic import of a module path that ends in `stack/server.ts`. */
const importsServerModule = (text: string) => /["'][^"'\n]*stack\/server\.ts["']/.test(text);

const restarts = specs.filter((name) => importsServerModule(code(new URL(name, tests))));
const refuses = specs.filter((name) =>
  code(new URL(name, tests))
    .split(";")
    .some(
      (statement) =>
        statement.includes("This link isn't active") && !/toHaveCount\(0\)|\.not\./.test(statement),
    ),
);

test("the guard sees every spec and every restart", () => {
  assert.deepEqual(
    entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
    [],
    "Playwright orders each directory on its own, which this guard doesn't model",
  );
  const src = new URL("./", import.meta.url);
  const wrappers = readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
    (name) =>
      name.endsWith(".ts") &&
      !name.endsWith(".test.ts") &&
      !name.startsWith("stack/") &&
      importsServerModule(code(new URL(name, src))),
  );
  assert.deepEqual(wrappers, [], "only a spec may import stack/server.ts");
  assert.ok(refuses.includes("delivery.spec.ts"), "delivery.spec.ts should expect a refused link");
  assert.ok(
    refuses.includes("safety-number.spec.ts"),
    "safety-number.spec.ts should expect a refused link",
  );
  assert.ok(
    restarts.includes("sent-by-email.spec.ts"),
    "sent-by-email.spec.ts should import stack/server.ts",
  );
  assert.ok(
    restarts.includes("server-restart.spec.ts"),
    "server-restart.spec.ts should import stack/server.ts",
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
