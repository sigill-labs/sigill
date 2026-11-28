import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { canaryFile, canaryKey, chooseFile, expect, test } from "../src/fixtures.ts";
import { base32Token } from "../src/leaks/canary.ts";
import type { Allowed } from "../src/leaks/needles.ts";
import type { Finding } from "../src/leaks/scan.ts";
import { injectMail, mailTo } from "../src/mail.ts";

// The detector's self-test: each case leaks a canary from the page to the real stack on purpose
// and checks that the scan finds it, with the right class, label, observation point and view.
// The requests are same-origin, so the CSP allows them; the server answers 404 or 405, which does
// not matter, because the browser records what it sent.
//
// A server-log leak cannot be forced here without changing the server, whose stdout carries only
// allowlisted events. The log checks are covered by the unit tests of checkServerLog in
// src/leaks/server-log.test.ts; src/leaks/captures.test.ts shows each log line becomes a capture
// that the canary scan searches like any other.

/** Small canaries keep the suite fast. Sizes stay six digits, so the size check applies. */
const fileOptions = { max: 200_000 };

interface Expected {
  class: Finding["class"];
  label: string;
  /** The end of the point, such as `request.url`, after the actor's file and record number. */
  field: string;
  view: RegExp;
}

function expectFinding(findings: Finding[], expected: Expected): void {
  const point = new RegExp(
    `^observations/.+/default\\.jsonl#\\d+ ${escapeRegExp(expected.field)}$`,
  );
  const match = findings.find(
    (finding) =>
      finding.class === expected.class &&
      finding.label === expected.label &&
      point.test(finding.point) &&
      expected.view.test(finding.view),
  );
  expect(match, `${JSON.stringify(expected)} in:\n${summary(findings)}`).toBeDefined();
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const summary = (findings: Finding[]) =>
  findings.map((f) => `  ${f.class} ${f.label} ${f.point} ${f.view}`).join("\n") || "  (none)";

/** Loads the app, so the page has the stack's origin for same-origin requests. */
async function open(page: Page): Promise<void> {
  await page.goto("/");
}

/**
 * Opens the real /signal endpoint and sends one relay message carrying `data`. The page has not
 * joined the link, so the server answers `not-on-link` after its hello; the frame was sent all
 * the same, and waiting for the answer means its record is in.
 */
async function relay(page: Page, link: string, data: string): Promise<string> {
  return page.evaluate(
    ([link, data]) =>
      new Promise<string>((resolve, reject) => {
        const socket = new WebSocket(`${location.origin.replace("https", "wss")}/signal`);
        socket.addEventListener("open", () =>
          socket.send(JSON.stringify({ t: "relay", link, data })),
        );
        socket.addEventListener("message", (event) => {
          if (JSON.parse(String(event.data)).t === "hello") {
            return;
          }
          resolve(String(event.data));
          socket.close();
        });
        socket.addEventListener("error", () => reject(new Error("websocket error")));
      }),
    [link, data] as const,
  );
}

/**
 * POSTs `{"data": base64}`, gzip-compressed in the page. Random bytes do not compress, so gzip
 * would store them as they are, and the raw view would catch them. Base64 text compresses, so
 * only the gzip view holds it.
 */
async function postGzip(page: Page, base64: string): Promise<void> {
  await page.evaluate(async (data) => {
    const json = new Blob([JSON.stringify({ data })]);
    const body = await new Response(
      json.stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer();
    await fetch("/upload", { method: "POST", body });
  }, base64);
}

const sha256Hex = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

test.describe("the detector catches", () => {
  test("a fragment secret in a query string", async ({ page, leaks, canary }) => {
    leaks.expectLeaks();
    const key = canaryKey(canary.fork("key"));
    leaks.watchKey("fragment secret", key);
    await open(page);
    await page.evaluate((text) => fetch(`/?k=${text}`), key.text);
    const findings = await leaks.scan();
    expectFinding(findings, {
      class: "K",
      label: "fragment secret text",
      field: "request.url",
      view: /^raw$/,
    });
    // The text is also base64url, so its bytes turn up in a decoded view.
    expectFinding(findings, {
      class: "K",
      label: "fragment secret",
      field: "request.url",
      view: /^base64/,
    });
  });

  test("a name token in a request header", async ({ page, leaks, canary }) => {
    leaks.expectLeaks();
    const file = leaks.watch(canaryFile(canary.fork("file"), fileOptions));
    await open(page);
    // Header values are byte strings; the name's non-ASCII letters all fit in latin1.
    await page.evaluate((name) => fetch("/", { headers: { "x-test": name } }), file.name);
    expectFinding(await leaks.scan(), {
      class: "M",
      label: "file#1 name",
      field: "request.headers.x-test",
      view: /^raw$/,
    });
  });

  test("file bytes as base64 in a JSON body", async ({ page, leaks, canary }) => {
    leaks.expectLeaks();
    const file = leaks.watch(canaryFile(canary.fork("file"), fileOptions));
    await open(page);
    await page.evaluate(
      (data) => fetch("/upload", { method: "POST", body: JSON.stringify({ data }) }),
      file.bytes.toString("base64"),
    );
    expectFinding(await leaks.scan(), {
      class: "C",
      label: "file#1",
      field: "request.body",
      // Base64 text needles (0001) now catch this directly, so the raw view matches too.
      view: /^(raw|base64@\d)$/,
    });
  });

  test("a key in a websocket frame to /signal", async ({ page, leaks, canary }) => {
    leaks.expectLeaks();
    const key = canaryKey(canary.fork("key"));
    leaks.watchKey("fragment secret", key);
    const link = canary.fork("link").bytes(16).toString("base64url");
    await open(page);
    // A well-formed relay message: the key goes as the opaque base64url payload.
    const answer = await relay(page, link, key.text);
    expect(JSON.parse(answer)).toEqual({ t: "error", code: "not-on-link" });
    expectFinding(await leaks.scan(), {
      class: "K",
      label: "fragment secret text",
      field: "frame-sent.payload",
      view: /^raw$/,
    });
  });

  test("file bytes as base64 in a gzip-compressed body", async ({ page, leaks, canary }) => {
    leaks.expectLeaks();
    const file = leaks.watch(canaryFile(canary.fork("file"), fileOptions));
    await open(page);
    await postGzip(page, file.bytes.toString("base64"));
    expectFinding(await leaks.scan(), {
      class: "C",
      label: "file#1",
      field: "request.body",
      view: /^gzip(>base64@\d)?$/,
    });
  });

  test("a key in a console message", async ({ page, leaks, canary }) => {
    leaks.expectLeaks();
    const key = canaryKey(canary.fork("key"));
    leaks.watchKey("fragment secret", key);
    await open(page);
    const logged = page.waitForEvent("console", (message) => message.text() === key.text);
    await page.evaluate((text) => console.log(text), key.text);
    await logged;
    expectFinding(await leaks.scan(), {
      class: "K",
      label: "fragment secret text",
      field: "console.text",
      view: /^raw$/,
    });
  });
});

test.describe("an emailed link", () => {
  test.skip(!process.env.FIDANT_E2E_MAILPIT, "needs Mailpit");

  test("may carry its secrets in its two carriers, and in any other mail they are caught", async ({
    page,
    leaks,
    canary,
  }) => {
    const to = `anna-${base32Token(canary.fork("address"), 8).toLowerCase()}@example.com`;
    await page.goto("/send");
    await chooseFile(page, {
      name: "a.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("x"),
    });
    await page.getByLabel("Who is it for?").fill("Anna");
    await page.getByLabel("Email the link for me (less private)").check();
    await page.getByLabel("Their email address").fill(to);
    await page.getByRole("radio", { name: "Link", exact: true }).check();
    await page.getByRole("button", { name: "Add recipient and email link", exact: true }).click();
    // Shown once the server has emailed it: the link with the server's value before the secret.
    const link = new URL(
      (await page.getByLabel("Link for Anna", { exact: true }).textContent()) ?? "",
    );
    const [, mark = "", secret = ""] = /^#e\.([\w-]{22})\.([\w-]{43})$/.exec(link.hash) ?? [];
    const linkId = link.pathname.slice("/r/".length);
    await expect.poll(async () => (await mailTo(to)).length).toBe(1);
    const [notice] = await mailTo(to);
    if (!notice) {
      throw new Error("no notice");
    }
    expect(notice.Text).toContain(link.href);
    const mail: Allowed["mail"] = { to, notice: notice.ID };
    leaks.watchKey("link secret", secret, "K", { link: linkId, frames: ["sent email"], mail });
    leaks.watchKey("value", mark, "K", {
      link: linkId,
      frames: ["received email", "sent gate", "sent send-code", "sent code"],
      mail,
    });
    leaks.watchText("address", to, { link: linkId, frames: ["sent email"], mail: { to } });
    // The registering frame and the notice carry all three, and the scan allows them there.
    expect(await leaks.scan()).toEqual([]);

    const header = await injectMail({ to, subject: secret, text: "Hello" });
    const copy = await injectMail({ to, subject: notice.Subject, text: notice.Text });
    const code = await injectMail({
      to,
      subject: "Your Fidant code",
      text: `Your code: 123456\n\n${secret}`,
    });
    const other = await injectMail({ to: "bob@example.com", subject: "Hi", text: `Mail ${to}` });
    const found = (await leaks.scan()).map(
      (f) => `${f.label.replace(/ text$/, "")} @ ${f.point.replace(/^.*\/mail\//, "")}`,
    );
    expect([...new Set(found)].sort()).toEqual(
      [
        `address @ ${other}.eml body`,
        `link secret @ ${code}.eml body`,
        `link secret @ ${copy}.eml body`,
        `link secret @ ${header}.eml headers`,
        `value @ ${copy}.eml body`,
      ].sort(),
    );
    expect(await leaks.check()).toMatch(/Leak check failed/);
    leaks.expectLeaks();
  });
});

test.describe("the detector stays quiet on", () => {
  test("the same requests carrying unrelated data", async ({ page, leaks, canary }) => {
    // The canaries are watched but never sent. No expectLeaks: the teardown must pass too.
    const file = leaks.watch(canaryFile(canary.fork("file"), fileOptions));
    leaks.watchKey("fragment secret", canaryKey(canary.fork("key")));
    const other = canaryFile(canary.fork("other"), { size: file.size + 7 });
    const otherKey = canaryKey(canary.fork("other key"));
    const link = canary.fork("link").bytes(16).toString("base64url");
    await open(page);
    await page.evaluate(
      async ({ key, name, data, hex, hash, size, window, lookup }) => {
        await fetch(`/?k=${key}`);
        await fetch("/", { headers: { "x-test": name } });
        await fetch("/upload", { method: "POST", body: JSON.stringify({ data }) });
        await fetch("/upload", { method: "POST", body: hex });
        await fetch(`/?h=${hash}`);
        await fetch(`/files/${encodeURIComponent(name.normalize("NFD"))}`);
        await fetch(`/?k=${window}`);
        await fetch(`/lookup/${lookup}`);
        await fetch("/", { headers: { "x-size": String(size) } });
        console.log(key);
      },
      {
        key: otherKey.text,
        name: other.name,
        data: other.bytes.toString("base64"),
        hex: other.bytes.toString("hex"),
        hash: sha256Hex(other.bytes),
        size: other.size,
        window: otherKey.bytes.subarray(5, 21).toString("base64url"),
        lookup: sha256Hex(Buffer.from(otherKey.text)),
      },
    );
    await relay(page, link, otherKey.text);
    await postGzip(page, other.bytes.toString("base64"));
    expect(await leaks.scan()).toEqual([]);
    expect(await leaks.check()).toBeUndefined();
  });
});

test("a leak fails the test by default", async ({ page, leaks, canary }) => {
  const key = canaryKey(canary.fork("key"));
  leaks.watchKey("fragment secret", key);
  await open(page);
  await page.evaluate((text) => fetch(`/?k=${text}`), key.text);
  // check() is the verdict the teardown throws when expectLeaks() was not called.
  const report = await leaks.check();
  expect(report).toMatch(/Leak check failed/);
  expect(report).toContain("fragment secret");
  // Now the deliberate leak is expected: the teardown passes and the sweep skips this test.
  leaks.expectLeaks();
});
