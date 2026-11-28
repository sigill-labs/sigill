import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { en } from "./en.ts";
import { pickLanguage } from "./language.ts";
import { sv } from "./sv.ts";

/** Every key path with the type of its value, like "menu.send: string". */
function shape(value: unknown, path = ""): string[] {
  if (value === null || typeof value !== "object") {
    return [`${path}: ${typeof value}`];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    shape(child, path ? `${path}.${key}` : key),
  );
}

test("Swedish and English have the same keys", () => {
  assert.deepEqual(shape(sv).sort(), shape(en).sort());
});

test("every text problem overrides a file problem", () => {
  for (const key of Object.keys(en.secret.problems)) {
    assert.ok(key in en.receive.problems, key);
  }
});

test("pickLanguage prefers the stored choice, then a Swedish browser", () => {
  assert.equal(pickLanguage("en", "sv-SE"), "en");
  assert.equal(pickLanguage("sv", "en-US"), "sv");
  assert.equal(pickLanguage(null, "sv-SE"), "sv");
  assert.equal(pickLanguage(null, "sv"), "sv");
  assert.equal(pickLanguage(null, "SV-fi"), "sv");
  assert.equal(pickLanguage(null, "en-GB"), "en");
  assert.equal(pickLanguage(null, "svx"), "en");
  assert.equal(pickLanguage("de", "de-DE"), "en");
});

test("index.html's meta description is the English tagline", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(html.includes(`<meta name="description" content="${en.footer.tagline}" />`));
});

test("index.html's noscript text is the English noscript message", () => {
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  const noscript = html.match(/<noscript>([\s\S]*)<\/noscript>/)?.[1] ?? "";
  assert.ok(noscript.includes(`>${en.noscript}</p>`));
});

// Emailed links are off until verified transfers (FID-376), so the public pages say nothing about them.
// The send and receive strings stay, because they render only while mail is on.
test("the public pages don't mention emailed links", () => {
  const banned =
    /emailed|we email|us to email|emails it|email the link|mailbox|our mail service|mejlad|mejlar|mejla länk|email or code|mejl eller en kod|emailed codes|mejlade koder|vår mejltjänst|inkorg|brevlåd/i;
  for (const messages of [en, sv]) {
    const { landing, how, terms, security, technical, privacy } = messages;
    const text = JSON.stringify({ landing, how, terms, security, technical, privacy });
    assert.doesNotMatch(text, banned);
  }
});
