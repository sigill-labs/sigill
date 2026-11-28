// Transfers that don't go to plan: a connection that fails, a declined offer, a recipient that can't
// connect or reach the server, a sender that goes offline, a transfer dropped halfway and resumed,
// a recipient who leaves, and a save dialog that is cancelled or fails.

import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  breakableSender,
  canaryKey,
  delivered,
  expect,
  fakeSavePicker,
  test as harness,
  makeName,
  recipientRow,
} from "../src/fixtures.ts";
import {
  addRecipient,
  type Demo,
  download,
  MiB,
  makeFile,
  openSender,
  sha256Hex,
  test,
} from "../src/transfer.ts";

// Each test's transfers and the leak scan after it can take longer than Playwright's default.
test.describe.configure({ timeout: 90_000 });

test("a sender whose connection setup fails logs why and lets the recipient try again", async ({
  demo,
  observed,
  leaks,
  canary,
}) => {
  const sender = await openSender(demo, makeFile(leaks, canary, 10), "", (page) =>
    page.addInitScript(() => {
      RTCPeerConnection.prototype.setLocalDescription = () =>
        Promise.reject(new DOMException("injected", "OperationError"));
    }),
  );
  const link = await addRecipient(leaks, sender, makeName(leaks, canary, "Anna"));
  const recipient = await demo.open("recipient");
  await recipient.goto(link);

  const logged = async () =>
    (await observed("sender").records()).flatMap((r) => (r.type === "console" ? [r.text] : []));
  await expect
    .poll(logged)
    .toContain("fidant: sender dropped a connection: setup-failed (OperationError)");
  expect((await logged()).filter((text) => text.includes("injected"))).toEqual([]);

  const refusals = async () =>
    (await observed("recipient").records()).flatMap((r) => {
      if (r.type !== "frame-received" || r.base64) {
        return [];
      }
      const message = JSON.parse(r.payload) as { t: string; reason?: string };
      return message.t === "refused" ? [message.reason] : [];
    });
  await expect.poll(refusals).toEqual(["drop"]);
  await expect(
    recipient.getByRole("heading", { name: "Couldn't connect to the sender's computer" }),
  ).toBeVisible();
  await expect(recipient.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(recipient.getByText("This link is busy")).toHaveCount(0);
});

test("a declined offer shows as declined, and the link can be reopened", async ({
  demo,
  leaks,
  canary,
}) => {
  const file = makeFile(leaks, canary, 100_001);
  const sender = await openSender(demo, file);
  const name = makeName(leaks, canary, "Erik");
  const link = await addRecipient(leaks, sender, name);

  const recipient = await demo.open("recipient");
  await recipient.goto(link);
  const opened = recipientRow(sender, name).getByText(`${name}'s link has been opened`);
  await expect(opened).toBeVisible();
  const decline = recipient.getByRole("button", { name: "Decline" });
  await expect(decline).toBeVisible();
  const offerHeading = await recipient.locator("#receive h1").elementHandle();
  // From the keyboard, so the browser would show a focus ring on the next focused element.
  await decline.focus();
  await recipient.keyboard.press("Enter");
  const declined = recipient.getByRole("heading", { name: "You declined the file" });
  await expect(declined).toBeFocused();
  // Script moved focus there to announce the step; a heading isn't a control, so no ring.
  await expect(declined).toHaveCSS("outline-style", "none");
  // A new heading node, not the offer's heading with new text, so screen readers announce it.
  expect(await offerHeading.evaluate((h) => h.isConnected)).toBe(false);
  await expect(
    recipientRow(sender, name).getByText(
      `${name}'s link was opened and the file was declined. The link still works.`,
    ),
  ).toBeVisible();
  await expect(sender.getByRole("button", { name: `Copy link for ${name}` })).toBeVisible();

  await recipient.getByRole("button", { name: "Show the file again" }).click();
  await expect(recipient.getByRole("button", { name: "Download" })).toBeVisible();
  await expect(opened).toBeVisible();
});

harness("a recipient gives up connecting after 30 seconds", async ({ actor, leaks, canary }) => {
  const demo: Demo = { open: async (name) => (await actor(name)).page };
  const sender = await openSender(demo, makeFile(leaks, canary, 10));
  const anna = makeName(leaks, canary, "Anna");
  const link = await addRecipient(leaks, sender, anna);

  const recipient = await demo.open("recipient");
  // The sender's offer never lands, so the data channel never opens.
  await recipient.addInitScript(() => {
    RTCPeerConnection.prototype.setRemoteDescription = () => new Promise(() => {});
  });
  await recipient.clock.install();
  await recipient.goto(link);
  await expect(recipient.getByRole("heading", { name: "Connecting to the sender…" })).toBeVisible();
  // The server tells the sender only after it sent `joined`, so the recipient's peer exists by now.
  await expect(
    recipientRow(sender, anna).getByText(`Connecting through ${anna}'s link…`),
  ).toBeVisible();

  await recipient.clock.fastForward(29_000);
  await expect(recipient.getByRole("heading", { name: "Connecting to the sender…" })).toBeVisible();
  await recipient.clock.fastForward(1_000);
  await expect(recipient.getByText("Couldn't connect to the sender's computer")).toBeVisible();
  await expect(recipient.getByRole("button", { name: "Try again" })).toBeVisible();
});

harness("a recipient whose browser has no WebRTC is told so", async ({ actor, leaks, canary }) => {
  const demo: Demo = { open: async (name) => (await actor(name)).page };
  const sender = await openSender(demo, makeFile(leaks, canary, 10));
  const link = await addRecipient(leaks, sender, makeName(leaks, canary, "Anna"));

  const recipient = await demo.open("recipient");
  await recipient.addInitScript(() => {
    delete (globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection;
  });
  await recipient.goto(link);
  await expect(
    recipient.getByRole("heading", { name: "This browser can't connect to the sender" }),
  ).toBeVisible();
  await expect(recipient.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

harness("a recipient who can't reach the server is told so", async ({ actor, leaks, canary }) => {
  const { page: recipient } = await actor("recipient");
  // Every socket closes before it opens, so the page keeps retrying and never reaches the server.
  await recipient.addInitScript(() => {
    const g = globalThis as { closes?: number };
    g.closes = 0;
    globalThis.WebSocket = class extends globalThis.WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener("close", () => {
          g.closes = (g.closes ?? 0) + 1;
        });
        this.close();
      }
    };
  });
  const secret = canaryKey(canary.fork("unreachable secret")).text;
  leaks.watchKey("unreachable link secret", secret);
  const linkId = canary.fork("unreachable link id").bytes(16).toString("base64url");
  await recipient.clock.install();
  await recipient.goto(`/r/${linkId}#${secret}`);
  await recipient.waitForFunction(() => ((globalThis as { closes?: number }).closes ?? 0) > 0);

  await recipient.clock.fastForward(30_000);
  await expect(recipient.getByRole("heading", { name: "Couldn't reach the server" })).toBeVisible();
  await expect(
    recipient.getByText("The server connects you to the sender. Check your internet connection."),
  ).toBeVisible();
  await expect(recipient.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(
    recipient.getByRole("region", { name: "What our server has right now", includeHidden: true }),
  ).toHaveCount(0);
});

test("a waiting recipient sees when the sender goes offline", async ({ demo, leaks, canary }) => {
  const file = makeFile(leaks, canary, 100_001);
  const sender = await openSender(demo, file);
  const link = await addRecipient(leaks, sender, makeName(leaks, canary, "Anna"));

  const recipient = await demo.open("recipient");
  await recipient.goto(link);
  await expect(recipient.getByRole("button", { name: "Download" })).toBeVisible();
  await sender.close();
  await expect(recipient.getByText("The sender's page is closed")).toBeVisible();
  await expect(
    recipient.getByRole("region", { name: "What our server has right now" }),
  ).toContainText("Nothing about this page once it notices the connection has closed");
});

test("a lost sender says whether the download can continue", async ({ demo, leaks, canary }) => {
  const file = makeFile(leaks, canary, 100_001);
  const sender = await openSender(demo, file, "", (page) => page.addInitScript(breakableSender));
  const stall = (stalled: boolean) =>
    sender.evaluate((on) => {
      (globalThis as { stalled?: boolean }).stalled = on;
    }, stalled);
  const cut = () => sender.evaluate(() => (globalThis as { cut?: () => void }).cut?.());

  /** Opens a link for `first` and, if `download`, starts a download the stalled sender never feeds. */
  const join = async (first: string, download: boolean) => {
    const link = await addRecipient(leaks, sender, makeName(leaks, canary, first));
    await stall(false);
    const page = await demo.open(first.toLowerCase());
    await page.goto(link);
    await expect(page.getByRole("button", { name: "Download" })).toBeVisible();
    if (download) {
      await stall(true);
      await page.getByRole("button", { name: "Download" }).click();
      await expect(page.getByRole("heading", { name: "Downloading…" })).toBeVisible();
    }
    return page;
  };

  // Before the download: nothing can have been saved.
  const anna = await join("Anna", false);
  await cut();
  await expect(anna.getByText("The connection to the sender was lost")).toBeVisible();
  await expect(anna.getByText("Nothing was saved.")).toBeVisible();

  // Mid-download, the connection drops while the sender's page stays open.
  const erik = await join("Erik", true);
  await cut();
  await expect(erik.getByText("The connection to the sender was lost")).toBeVisible();
  await expect(
    erik.getByText("Try again. The download continues where it stopped if it can."),
  ).toBeVisible();

  // Mid-download, the sender's page closes. Its pagehide closes the peers, so the drop arrives
  // at once instead of when ICE consent expires (about 15 s).
  const bo = await join("Bo", true);
  await sender.close();
  await expect(bo.getByText("The sender's page is closed")).toBeVisible({ timeout: 3_000 });
  await expect(bo.getByText("The file may not have been saved.")).toBeVisible();
});

for (const dialog of [false, true]) {
  test(`a transfer dropped halfway sends only the rest on Try again${dialog ? ", into the save dialog's file" : ""}`, async ({
    demo,
    leaks,
    canary,
  }) => {
    const CHUNK = 2;
    const CREDIT = 19;
    // Its own padded length, so exactly 128 CHUNKs of 48 KiB and no padding.
    const file = makeFile(leaks, canary, 6 * MiB);
    const sender = await openSender(demo, file, "", (page) => page.addInitScript(breakableSender));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    const card = recipientRow(sender, name);

    const recipient = await demo.open("recipient");
    await recipient.addInitScript(breakableSender);
    if (dialog) {
      await recipient.context().addInitScript(fakeSavePicker);
    }
    let downloads = 0;
    recipient.on("download", () => downloads++);
    const set = (page: Page, values: Record<string, unknown>) =>
      page.evaluate((v) => {
        Object.assign(globalThis, v);
      }, values);
    const sent = (page: Page, kind: number) =>
      page.evaluate((k) => (globalThis as { sent?: Record<number, number> }).sent?.[k] ?? 0, kind);
    const download = recipient.getByRole("button", { name: "Download" });
    const downloading = recipient.getByRole("heading", { name: "Downloading…" });

    await recipient.goto(link);
    await set(sender, { stallAt: 64 });
    await set(recipient, { pick: "ok", saved: [] });
    await download.click();
    await expect(downloading).toBeVisible();
    // The recipient tops up its credit once it has written 64 CHUNKs, and the sender sends no more.
    await expect.poll(() => sent(recipient, CREDIT), { timeout: 30_000 }).toBe(2);
    expect(await sent(sender, CHUNK)).toBe(64);

    await sender.evaluate(() => (globalThis as { cut?: () => void }).cut?.());
    await expect(
      recipient.getByText("Try again. The download continues where it stopped if it can."),
    ).toBeVisible();
    // Retrying before the sender sees the drop would find the link still busy.
    await expect(
      card.getByText(
        `The transfer through ${name}'s link was interrupted. The link can be opened again to retry.`,
      ),
    ).toBeVisible();
    await set(sender, { stalled: false });
    // The resumed view shows before ACCEPT goes out, so holding it keeps that view up to check.
    await set(recipient, { held: true });
    const saving = dialog ? undefined : recipient.waitForEvent("download", { timeout: 60_000 });
    await recipient.getByRole("button", { name: "Try again" }).click();
    await expect(downloading).toBeVisible();
    await expect(download).toHaveCount(0);
    await expect
      .poll(() =>
        recipient
          .getByRole("progressbar")
          .evaluate((progress) => (progress as HTMLProgressElement).value),
      )
      .toBe(3 * MiB);
    await recipient.evaluate(() => (globalThis as { release?: () => void }).release?.());

    await expect(recipient.getByText("this is exactly the file that was sent")).toBeVisible({
      timeout: 60_000,
    });
    await expect(delivered(sender, name)).toBeAttached();
    // Sending the whole file again would make it 192.
    expect(await sent(sender, CHUNK)).toBe(128);
    if (saving) {
      const bytes = await readFile(await (await saving).path());
      expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
    } else {
      expect(await recipient.evaluate(() => (globalThis as { saved?: string[] }).saved)).toEqual([
        "pick",
        ...Array<string>(128).fill("write"),
        "close",
      ]);
    }
    expect(downloads, "browser downloads").toBe(dialog ? 0 : 1);
  });
}

test("a recipient who leaves mid-download shows the sender's card as interrupted", async ({
  demo,
  leaks,
  canary,
}) => {
  const file = makeFile(leaks, canary, 100_001);
  const sender = await openSender(demo, file, "", (page) => page.addInitScript(breakableSender));
  const stall = (stalled: boolean) =>
    sender.evaluate((on) => {
      (globalThis as { stalled?: boolean }).stalled = on;
    }, stalled);
  const name = makeName(leaks, canary, "Anna");
  const link = await addRecipient(leaks, sender, name);
  const card = recipientRow(sender, name);

  const first = await demo.open("recipient-1");
  await first.goto(link);
  await expect(first.getByRole("button", { name: "Download" })).toBeVisible();
  await stall(true);
  await first.getByRole("button", { name: "Download" }).click();
  await expect(first.getByRole("heading", { name: "Downloading…" })).toBeVisible();
  await expect(card.getByText(`Sending through ${name}'s link`)).toBeVisible();

  // The receive page's pagehide closes its peer, so the sender notices at once instead of when
  // ICE consent expires (about 15 s).
  await first.close();
  await expect(
    card.getByText(
      `The transfer through ${name}'s link was interrupted. The link can be opened again to retry.`,
    ),
  ).toBeVisible({ timeout: 3_000 });

  await stall(false);
  const second = await demo.open("recipient-2");
  await second.goto(link);
  const bytes = await download(second, file);
  expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
  await expect(delivered(sender, name)).toBeAttached();
});

test("a recipient's save dialog can be cancelled, refused or fail without saving a partial file", async ({
  demo,
  leaks,
  canary,
}) => {
  // Three chunks, so a failure on the second write leaves a partial file to remove.
  const file = makeFile(leaks, canary, 100_001);
  const sender = await openSender(demo, file);
  const name = makeName(leaks, canary, "Anna");
  const link = await addRecipient(leaks, sender, name);
  const card = recipientRow(sender, name);

  const recipient = await demo.open("recipient");
  // Registered after the fixture's script, which deletes the browser's own picker. Chromium runs
  // init scripts in order; if it stopped, the page would save without the fake and no `pick` would
  // be logged below.
  await recipient.context().addInitScript(fakeSavePicker);
  let downloads = 0;
  recipient.on("download", () => downloads++);
  await recipient.goto(link);
  const button = recipient.getByRole("button", { name: "Download" });
  const tryAgain = recipient.getByRole("button", { name: "Try again" });
  const opened = card.getByText(`${name}'s link has been opened`);
  const waiting = card.getByText(`Waiting for ${name}'s link to be opened`);
  const interrupted = card.getByText(
    `The transfer through ${name}'s link was interrupted. The link can be opened again to retry.`,
  );
  /** Clicks Download on the open offer with the dialog doing `mode`, after clearing the log. */
  const pick = async (mode: string) => {
    await expect(opened).toBeVisible();
    await recipient.evaluate((m) => {
      Object.assign(globalThis, { pick: m, saved: [] });
    }, mode);
    await button.click();
  };
  const saved = () => recipient.evaluate(() => (globalThis as { saved?: string[] }).saved);
  const problem = (title: string, body: string) =>
    Promise.all([
      expect(recipient.getByRole("heading", { level: 1, name: title })).toBeVisible(),
      expect(recipient.getByText(body)).toBeVisible(),
      expect(tryAgain).toBeVisible(),
    ]);

  // Cancelled: the dialog opened and closed without a file, and the offer stays open.
  await pick("cancel");
  await expect.poll(saved).toEqual(["pick"]);
  await expect(button).toBeEnabled();
  await expect(opened).toBeVisible();
  await expect(tryAgain).toHaveCount(0);

  // Refused: nothing was created, and the link is free again.
  await pick("refuse");
  await problem("The file couldn't be created", "Try again, or choose another place to save it.");
  expect(await saved()).toEqual(["pick"]);
  // Retrying before the sender sees the drop would find the link still busy.
  await expect(waiting).toBeVisible();
  await tryAgain.click();

  // Out of space on the second write: the file is aborted and removed, never closed.
  await pick("fail");
  await problem("The file couldn't be saved", "Check that there's enough space on your disk.");
  expect(await saved()).toEqual(["pick", "write", "write", "abort", "remove"]);
  // The sender had started sending, so the drop shows as interrupted.
  await expect(interrupted).toBeVisible();
  await tryAgain.click();

  // Picked and written in full.
  await pick("ok");
  await expect(recipient.getByRole("heading", { name: "Download complete" })).toBeFocused({
    timeout: 60_000,
  });
  await expect(recipient.getByText("this is exactly the file that was sent")).toBeVisible();
  await expect(recipient.getByText("It's saved where you chose.")).toBeVisible();
  expect(await saved()).toEqual(["pick", "write", "write", "write", "close"]);
  await expect(delivered(sender, name)).toBeAttached();
  expect(downloads, "browser downloads").toBe(0);
});
