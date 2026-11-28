import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { faviconHref, overallStatus } from "./favicon.ts";

const svg = (href: string) => decodeURIComponent(href.replace("data:image/svg+xml,", ""));

test("an open transfer outranks a finished one, and a finished one outranks none", () => {
  assert.equal(overallStatus(["idle", "idle", "idle"]), "idle");
  assert.equal(overallStatus(["idle", "done", "idle"]), "done");
  assert.equal(overallStatus(["done", "idle", "active"]), "active");
});

test("every icon is inline, so no change of status asks the server for anything", () => {
  const icons = (["idle", "active", "done", "insecure"] as const).map((s) => faviconHref(s));
  for (const href of icons) {
    assert.match(href, /^data:image\/svg\+xml,/);
    assert.ok(svg(href).endsWith("</svg>"));
  }
  assert.equal(new Set(icons).size, 4);
});

test("the idle icon is the drawing in public/favicon.svg, in its colours", () => {
  const file = readFileSync(new URL("../../public/favicon.svg", import.meta.url), "utf8");
  const icon = svg(faviconHref("idle"));
  for (const d of ['d="M11.25 24.25V12.75a5 5 0 0 1 10 0v.5"', 'cx="21.25" cy="19.75" r="2.5"']) {
    assert.ok(file.includes(d) && icon.includes(d), d);
  }
  for (const colour of ["#111", "#f5f5f5", "#fff"]) {
    assert.ok(file.includes(colour) && icon.includes(colour), colour);
  }
});

test("the logo follows the site's theme: black tile in light, light tile in dark", () => {
  const light = svg(faviconHref("idle", "light"));
  assert.ok(light.includes("rect{fill:#111}g{stroke:#fff}"));
  assert.ok(!light.includes("#f5f5f5") && !light.includes("prefers-color-scheme"));
  const dark = svg(faviconHref("idle", "dark"));
  assert.ok(dark.includes("rect{fill:#f5f5f5}g{stroke:#111}"));
  assert.ok(!dark.includes("#fff}") && !dark.includes("prefers-color-scheme"));
  const system = svg(faviconHref("idle", "system"));
  assert.ok(system.includes("@media (prefers-color-scheme:dark){rect{fill:#f5f5f5}"));
  assert.equal(faviconHref("idle"), faviconHref("idle", "system"));
});

test("a status icon looks the same in either theme", () => {
  for (const status of ["active", "done", "insecure"] as const) {
    assert.equal(faviconHref(status, "light"), faviconHref(status, "dark"));
  }
});

test("an open transfer shows only the header's green dot, a finished one the check", () => {
  const active = svg(faviconHref("active"));
  assert.ok(active.includes("#10b981"));
  assert.ok(!active.includes("M11.25") && !active.includes("<rect"));
  const done = svg(faviconHref("done"));
  assert.ok(done.includes("M9 16.5l5 5") && !done.includes("M11.25"));
});

test("the secure-connection screen shows a red stop sign, not the logo", () => {
  const icon = svg(faviconHref("insecure"));
  assert.ok(icon.includes("#dc2626"));
  assert.ok(!icon.includes("M11.25") && !icon.includes("#10b981"));
});
