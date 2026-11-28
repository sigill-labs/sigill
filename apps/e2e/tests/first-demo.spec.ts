import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  barText,
  breakableSender,
  canaryFile,
  canaryKey,
  chooseFile,
  continueToLinks,
  delivered,
  expect,
  expectStepAtTop,
  fakeSavePicker,
  test as harness,
  makeName,
  recipientRow,
} from "../src/fixtures.ts";
import { restartServer } from "../src/stack/server.ts";
import {
  addRecipient,
  type Demo,
  download,
  MiB,
  makeFile,
  messages,
  openSender,
  receive,
  sha256Hex,
  test,
} from "../src/transfer.ts";

// The first demo end to end: a sender page sends one file to named recipients, each recipient on
// their own link and in their own browser context. The harness's leak check runs after every test
// and searches everything the browsers sent and received and everything the server logged for the
// file, its name, type and size, the link secrets and the sender and recipient names.

// The 8 MiB transfer and its leak scan take longer than Playwright's default.
test.describe.configure({ timeout: 90_000 });

test("delivers a file to two recipients with a verified checksum", async ({
  demo,
  leaks,
  canary,
}) => {
  // Odd size so the last chunk is partial and padding is exercised.
  const file = makeFile(leaks, canary, 8 * MiB + 321);
  const from = makeName(leaks, canary, "David");
  const sender = await openSender(demo, file, from);
  const names = [makeName(leaks, canary, "Anna"), makeName(leaks, canary, "Erik")];
  const links: string[] = [];
  for (const name of names) {
    links.push(await addRecipient(leaks, sender, name));
  }
  // While links wait for delivery, the tab's icon is the header's green dot, not the logo.
  const tabIcon = (page: Page) => page.locator('link[rel="icon"][type="image/svg+xml"]');
  await expect(tabIcon(sender)).toHaveAttribute("href", /^data:image\/svg.*%2310b981/);

  const received = await Promise.all(
    links.map((link, i) => receive(demo, `recipient-${i + 1}`, link, file, "8.4 MB", from, sender)),
  );
  for (const { bytes } of received) {
    expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
  }

  for (const name of names) {
    await expect(delivered(sender, name)).toBeAttached();
  }
  // The tab's icon shows the check, on both sides.
  for (const page of [sender, ...received.map(({ page }) => page)]) {
    await expect(tabIcon(page)).toHaveAttribute("href", /^data:image\/svg.*M9%2016\.5l5/);
  }
  const cards = names.map((name) => recipientRow(sender, name));
  for (const scope of [...cards, ...received.map(({ page }) => page)]) {
    await expect(scope.getByText("Direct connection", { exact: true })).toBeVisible();
    // The send page shows the link at once; the receive page explains under "Why?".
    if (!cards.some((card) => card === scope)) {
      await scope.getByText("Why?", { exact: true }).click();
      await expect(
        scope.getByText("The file goes straight between the two devices."),
      ).toBeVisible();
    }
    await expect(scope.getByRole("link", { name: /More about how it works/ })).toHaveAttribute(
      "href",
      "/how#direct",
    );
  }
  // The send page has no "Why?" to open.
  await expect(sender.getByText("Why?", { exact: true })).toHaveCount(0);

  const panel = sender.getByRole("region", {
    name: "What our server has right now",
    includeHidden: true,
  });
  await expect(panel).toContainText("None. The file goes directly between browsers.");
  await expect(panel).toContainText(/[1-9]\d* setup messages? \(/);

  const recipientPanel = received[0]?.page.getByRole("region", {
    name: "What our server has right now",
  });
  if (!recipientPanel) {
    throw new Error("no recipient");
  }
  await expect(recipientPanel).toContainText(
    "Nothing about this page once it notices the connection has closed",
  );
  await expect(recipientPanel).toContainText(/[1-9]\d* setup messages? \(/);
});

// A chunk is 48 KiB in Chromium (min(48 KiB, maxMessageSize - 64)): empty, one byte short of a
// chunk, exactly one, and one byte over.
for (const size of [0, 48 * 1024 - 1, 48 * 1024, 48 * 1024 + 1]) {
  test(`delivers a ${size}-byte file with a verified checksum`, async ({ demo, leaks, canary }) => {
    const file = makeFile(leaks, canary, size);
    const sender = await openSender(demo, file);
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);

    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    const bytes = await download(recipient, file);
    expect(bytes.length).toBe(size);
    expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
    await expect(delivered(sender, name)).toBeAttached();
  });
}

test("Send another file clears the list and the file, keeps the name, and a new file delivers", async ({
  demo,
  leaks,
  canary,
}) => {
  const first = makeFile(leaks, canary, 1000);
  const from = makeName(leaks, canary, "David");
  const sender = await openSender(demo, first, from);
  const anna = makeName(leaks, canary, "Anna");
  const firstLink = await addRecipient(leaks, sender, anna);
  const again = sender.getByRole("button", { name: "Send another file" });
  // Only once nothing is on its way.
  await expect(again).toHaveCount(0);
  // Step 2's Continue leads to the links until one of them moves.
  const toLinks = sender
    .getByRole("region", { name: "Add recipients" })
    .getByRole("button", { name: "Continue" });
  await expect(toLinks).toBeEnabled();
  const recipient = await demo.open("recipient");
  await recipient.goto(firstLink);
  await expect(toLinks).toBeDisabled();
  await download(recipient, first);
  await expect(delivered(sender, anna)).toBeAttached();
  await expect(toLinks).toBeDisabled();

  await again.click();
  await expect(sender.getByLabel("Choose a file")).toBeFocused();
  await expect(sender.getByText(first.name)).toHaveCount(0);
  await expect(sender.getByRole("heading", { name: "Share the links" })).toHaveCount(0);
  await expect(sender.getByLabel("Your name")).toHaveValue(from);
  await expect(sender.getByLabel("Your name")).toBeEnabled();

  const second = leaks.watch(canaryFile(canary.fork("second file"), { size: 2000 }));
  await chooseFile(sender, { name: second.name, mimeType: second.mime, buffer: second.bytes });
  const bo = makeName(leaks, canary, "Bo");
  const secondLink = await addRecipient(leaks, sender, bo);
  expect(secondLink).not.toBe(firstLink);
  const { bytes } = await receive(demo, "recipient-2", secondLink, second, "2.0 KB", from);
  expect(sha256Hex(bytes)).toBe(sha256Hex(second.bytes));
  await expect(delivered(sender, bo)).toBeAttached();
  // The first link was dropped with the list.
  const late = await demo.open("recipient-3");
  await late.goto(firstLink);
  await expect(late.getByText("This link isn't active")).toBeVisible();
});

test("refuses used, unknown and malformed links", async ({ demo, leaks, canary, baseURL }) => {
  const file = makeFile(leaks, canary, 100_001);
  const sender = await openSender(demo, file);
  const name = makeName(leaks, canary, "Anna");
  const link = await addRecipient(leaks, sender, name);

  const first = await receive(demo, "recipient", link, file, "100 KB");
  expect(sha256Hex(first.bytes)).toBe(sha256Hex(file.bytes));
  await expect(delivered(sender, name)).toBeAttached();
  await first.page.context().close();

  const reopened = await demo.open("reopened");
  await reopened.goto(link);
  await expect(reopened.getByText("This link has already been used")).toBeVisible();

  // Well formed, but no sender hosts it: the server refuses.
  const unlistedSecret = canaryKey(canary.fork("unlisted secret")).text;
  leaks.watchKey("unlisted link secret", unlistedSecret);
  const linkId = canary.fork("unlisted link id").bytes(16).toString("base64url");
  const unlisted = await demo.open("unlisted");
  await unlisted.goto(`${baseURL}/r/${linkId}#${unlistedSecret}`);
  await expect(unlisted.getByText("This link isn't active")).toBeVisible();

  const malformed = await demo.open("malformed");
  await malformed.goto("/r/not-a-link#nope");
  await expect(malformed.getByText("This link doesn't work")).toBeVisible();
  await expect(
    malformed.getByRole("region", { name: "What our server has right now", includeHidden: true }),
  ).toHaveCount(0);
});

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

// No one joins here, so the sender receives no signaling and the demo fixture's frame checks don't apply.
harness("a held Enter on Remove removes only one recipient", async ({ actor, leaks, canary }) => {
  const demo: Demo = { open: async (name) => (await actor(name)).page };
  // A tall window, where the page ends soon after the last step unless that step leaves room for
  // the glides (continueToLinks checks step 2's, and step 3's is below).
  const sender = await openSender(demo, makeFile(leaks, canary, 10), "", (page) =>
    page.setViewportSize({ width: 1280, height: 1600 }),
  );
  const anna = makeName(leaks, canary, "Anna");
  const erik = makeName(leaks, canary, "Erik");
  // Step 1's Continue comes first; step 2 has its own.
  const proceed = sender.getByRole("button", { name: "Continue" }).first();
  const toLinks = sender
    .getByRole("region", { name: "Add recipients" })
    .getByRole("button", { name: "Continue" });
  const who = sender.getByLabel("Who is it for?");
  const links = sender.getByRole("heading", { name: "Share the links" });
  await expect(toLinks).toBeDisabled();
  // Where the name field sits in the window once filling has scrolled it into view. Step 1 gets
  // shorter when the list locks the file, so scrollY changes, but scroll anchoring keeps the view.
  const at = async () => (await who.boundingBox())?.y;
  await who.fill(anna);
  const before = await at();
  await addRecipient(leaks, sender, anna);
  // Step 2 is open and holds a link, so step 1's Continue has nothing left to do.
  await expect(proceed).toBeDisabled();
  // The first link opens step 3 and says so, but the page stays put and focus stays for the next name.
  await expect(links).toBeAttached();
  await expect(sender.getByRole("status").filter({ hasText: "Step 3 of 3" })).toHaveText(
    "Step 3 of 3: Share the links",
  );
  // The bottom bar, which named step 2, now tells the sender to keep the tab open.
  await expect(barText(sender, "Keep the tab open")).toBeInViewport();
  await expect(barText(sender, "Step 2 of 3: Add recipients")).toHaveCount(0);
  await expect(who).toBeFocused();
  expect(await at()).toBe(before);
  // Step 2's Continue glides to step 3 and moves on to its first button.
  await toLinks.click();
  await expectStepAtTop(links);
  await expect(sender.getByRole("button", { name: `Copy link for ${anna}` })).toBeFocused();
  await addRecipient(leaks, sender, erik);

  await sender.getByRole("button", { name: `Remove ${anna}` }).focus();
  await sender.keyboard.down("Enter");
  await expect(sender.getByRole("button", { name: `Remove ${erik}` })).toBeFocused();
  await sender.keyboard.down("Enter"); // auto-repeat while held
  await sender.keyboard.up("Enter");
  await expect(recipientRow(sender, anna)).toHaveCount(0);
  await expect(sender.getByRole("button", { name: `Copy link for ${erik}` })).toBeVisible();

  await sender.keyboard.down("Enter");
  await expect(recipientRow(sender, erik)).toHaveCount(0);
  await expect(who).toBeFocused();
  await sender.keyboard.down("Enter"); // the repeat lands on the empty name field
  await sender.keyboard.up("Enter");
  await expect(sender.getByText("Enter a name.")).toHaveCount(0);
  await expect(proceed).toBeEnabled();
  await expect(toLinks).toBeDisabled();
  await expect(links).toHaveCount(0);
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

test("the sender's name must fit with the file name, and stray drops are ignored", async ({
  demo,
  leaks,
  canary,
}) => {
  // A canary file whose name is padded to 884 characters: too long with a 100-character sender name, short enough with a short one.
  const base = canaryFile(canary.fork("long file name"), { size: 5, ext: "bin" });
  const file = leaks.watch({
    ...base,
    name: base.name.replace(/\.bin$/, `${"r".repeat(884 - base.name.length)}.bin`),
  });
  const page = await demo.open("sender");
  await page.goto("/send");
  await page.getByLabel("Your name").fill("x".repeat(100));
  await chooseFile(page, { name: file.name, mimeType: file.mime, buffer: file.bytes });
  // Focus moved on to step 2, so the status region says which file was taken.
  await expect(page.getByRole("status").filter({ hasText: "File chosen:" })).toHaveText(
    `File chosen: ${file.name}, 5 bytes`,
  );
  // Whether a dragover and a drop of what `fill` adds (nothing: no DataTransfer) onto `selector` are cancelled.
  const cancelled = async (selector: string, fill = "") => {
    const results = [];
    for (const type of ["dragover", "drop"]) {
      results.push(
        await page.evaluate(`(() => {
          const dt = ${fill ? "new DataTransfer()" : "null"};
          ${fill};
          const e = new DragEvent("${type}", { bubbles: true, cancelable: true, dataTransfer: dt });
          document.querySelector("${selector}").dispatchEvent(e);
          return e.defaultPrevented;
        })()`),
      );
    }
    return results;
  };
  const someFile = `dt.items.add(new File(["x"], "x.bin"))`;
  const text = `dt.setData("text/plain", "x")`;
  expect(await cancelled("#file", someFile)).toEqual([false, false]);
  expect(await cancelled("#file", text)).toEqual([true, true]);
  expect(await cancelled("#recipient-name", text)).toEqual([false, false]);
  expect(await cancelled("#recipient-name", someFile)).toEqual([true, true]);
  const name = makeName(leaks, canary, "Anna");
  await page.getByLabel("Who is it for?").fill(name);
  await page.getByRole("button", { name: "Add recipient", exact: true }).click();
  await expect(page.getByText("Your name and the file name are too long together")).toBeVisible();
  await expect(page.getByRole("list", { name: "Recipients" })).toHaveCount(0);

  const from = makeName(leaks, canary, "Al");
  await page.getByLabel("Your name").fill(from);
  await expect(page.getByText("Your name and the file name are too long together")).toHaveCount(0);
  const link = await addRecipient(leaks, page, name);
  await expect(page.getByLabel("Your name")).toBeDisabled();

  expect(await cancelled("#from", text)).toEqual([true, true]);
  expect(await cancelled("body")).toEqual([true, true]);

  const recipient = await demo.open("recipient");
  await recipient.goto(link);
  await expect(
    recipient.getByRole("heading", { name: `${from} wants to send you a file` }),
  ).toBeVisible();
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

test("the Why? link to /how keeps a transfer alive on both pages", async ({
  demo,
  leaks,
  canary,
}) => {
  const file = makeFile(leaks, canary, 100_001);
  const sender = await openSender(demo, file);
  const name = makeName(leaks, canary, "Anna");
  const link = await addRecipient(leaks, sender, name);

  const recipient = await demo.open("recipient");
  await recipient.goto(link);
  const download = recipient.getByRole("button", { name: "Download" });
  await expect(download).toBeVisible();
  const card = recipientRow(sender, name);
  const opened = card.getByText(`${name}'s link has been opened`);
  await expect(opened).toBeVisible();

  // A remounted receive page would rejoin from the same URL, so only node identity tells it apart.
  const kept = [await card.elementHandle(), await recipient.locator("#receive h1").elementHandle()];
  for (const [page, scope] of [
    [sender, card],
    [recipient, recipient],
  ] as const) {
    await expect(scope.getByText("Direct connection", { exact: true })).toBeVisible();
    const back = page.url();
    if (page === recipient) {
      await scope.getByText("Why?", { exact: true }).click();
    }
    await scope.getByRole("link", { name: "More about how it works" }).click();
    await expect(page).toHaveURL(/\/how#direct$/);
    await expect(page.locator("#direct h2")).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(back);
  }
  for (const node of kept) {
    expect(await node.evaluate((n) => n.isConnected)).toBe(true);
  }
  await expect(download).toBeVisible();
  await expect(opened).toBeVisible();

  const downloading = recipient.waitForEvent("download", { timeout: 60_000 });
  await download.click();
  await expect(recipient.getByText("this is exactly the file that was sent")).toBeVisible({
    timeout: 60_000,
  });
  const bytes = await readFile(await (await downloading).path());
  expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
  await expect(delivered(sender, name)).toBeAttached();
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

test.describe("through a server restart", () => {
  // The client's reconnect backoff and the recipient's rejoins add to the transfer time.
  test.describe.configure({ timeout: 120_000 });

  const lost = (sender: Page) => sender.getByText("Lost the connection to the server");
  const connecting = (page: Page) =>
    page.getByRole("heading", { name: "Connecting to the sender…" });

  /**
   * Runs in the recipient page: the sender's first offer never lands, so the first attempt stays
   * connecting. Sets `offerStalled` once it has.
   */
  const stallFirstOffer = () => {
    const native = RTCPeerConnection.prototype.setRemoteDescription;
    let stalled = false;
    RTCPeerConnection.prototype.setRemoteDescription = function (
      this: RTCPeerConnection,
      ...args: unknown[]
    ) {
      if (!stalled) {
        stalled = true;
        (globalThis as { offerStalled?: boolean }).offerStalled = true;
        return new Promise(() => {});
      }
      return Reflect.apply(native, this, args);
    } as RTCPeerConnection["setRemoteDescription"];
  };

  interface HostHold {
    holdHost?: boolean;
    releaseHost?: () => void;
    closeCodes?: number[];
  }

  /**
   * Runs in the sender page: while `holdHost` is set, keeps back the `host` frames the page sends,
   * as if the sender reconnected late. `releaseHost()` sends those whose socket is still open.
   * Records the close code of every socket that sent a frame in `closeCodes`, and an error event
   * before it as 1006, the code the signaling client then acts on.
   */
  const holdHosts = () => {
    const global = globalThis as HostHold;
    const native = WebSocket.prototype.send;
    const held: [WebSocket, string][] = [];
    const closeCodes: number[] = [];
    const watched = new WeakSet<WebSocket>();
    global.closeCodes = closeCodes;
    WebSocket.prototype.send = function (this: WebSocket, data) {
      if (!watched.has(this)) {
        watched.add(this);
        this.addEventListener("error", () => closeCodes.push(1006));
        this.addEventListener("close", (event) => closeCodes.push(event.code));
      }
      if (global.holdHost && typeof data === "string" && data.startsWith('{"t":"host"')) {
        held.push([this, data]);
        return;
      }
      native.call(this, data);
    };
    global.releaseHost = () => {
      global.holdHost = false;
      for (const [socket, data] of held.splice(0)) {
        if (socket.readyState === WebSocket.OPEN) {
          native.call(socket, data);
        }
      }
    };
  };

  test("a waiting sender re-hosts its links without reloading", async ({
    demo,
    observed,
    leaks,
    canary,
  }) => {
    const file = makeFile(leaks, canary, 100_001);
    const sender = await openSender(demo, file);
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    let navigations = 0;
    sender.on("framenavigated", (frame) => {
      if (frame === sender.mainFrame()) {
        navigations++;
      }
    });
    const hosts = async () =>
      (await observed("sender").records()).filter(
        (r) => r.type === "frame-sent" && !r.base64 && JSON.parse(r.payload).t === "host",
      ).length;
    await expect.poll(hosts).toBeGreaterThan(0);
    const before = await hosts();

    await restartServer();
    await expect.poll(hosts, { timeout: 30_000 }).toBeGreaterThan(before);

    const { bytes } = await receive(demo, "recipient", link, file, "100 KB", "", sender);
    expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
    await expect(delivered(sender, name)).toBeAttached();
    expect(navigations).toBe(0);
    await expect(lost(sender)).toHaveCount(0);
  });

  test("a recipient with an open channel downloads after the restart", async ({
    demo,
    leaks,
    canary,
  }) => {
    const file = makeFile(leaks, canary, 100_001);
    const sender = await openSender(demo, file);
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    await expect(recipient.getByRole("button", { name: "Download" })).toBeVisible();

    await restartServer();
    const bytes = await download(recipient, file);
    expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
    await expect(delivered(sender, name)).toBeAttached();
  });

  test("a recipient still connecting gets the file after the restart", async ({
    demo,
    leaks,
    canary,
  }) => {
    const file = makeFile(leaks, canary, 100_001);
    const sender = await openSender(demo, file);
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    const recipient = await demo.open("recipient");
    await recipient.addInitScript(stallFirstOffer);
    await recipient.goto(link);
    await expect(
      recipient.getByRole("heading", { name: "Connecting to the sender…" }),
    ).toBeVisible();
    await expect(
      recipientRow(sender, name).getByText(`Connecting through ${name}'s link…`),
    ).toBeVisible();
    // Restarting before the offer lands would stall the next attempt's offer instead.
    await recipient.waitForFunction(
      () => (globalThis as { offerStalled?: boolean }).offerStalled === true,
    );

    await restartServer();
    await expect(recipient.getByRole("button", { name: "Download" })).toBeVisible({
      timeout: 60_000,
    });
    const bytes = await download(recipient, file);
    expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
    await expect(delivered(sender, name)).toBeAttached();
  });

  test("recipients wait for a sender that hosts again late after the restart", async ({
    demo,
    observed,
    leaks,
    canary,
  }) => {
    const file = makeFile(leaks, canary, 100_001);
    const sender = await openSender(demo, file, "", (page) => page.addInitScript(holdHosts));
    const early = makeName(leaks, canary, "Anna");
    const late = makeName(leaks, canary, "Bert");
    const earlyLink = await addRecipient(leaks, sender, early);
    const lateLink = await addRecipient(leaks, sender, late);
    // One recipient is still connecting when the server restarts.
    const waiting = await demo.open("recipient");
    await waiting.addInitScript(stallFirstOffer);
    await waiting.goto(earlyLink);
    await waiting.waitForFunction(
      () => (globalThis as { offerStalled?: boolean }).offerStalled === true,
    );

    await sender.evaluate(() => {
      (globalThis as HostHold).holdHost = true;
    });
    await restartServer();
    const restarted = Date.now();
    // The other opens their link after the restart, before the sender has hosted it again.
    const opener = await demo.open("late-recipient");
    await opener.goto(lateLink);
    await expect(connecting(opener)).toBeVisible();
    await expect
      .poll(async () =>
        (await messages(observed, "late-recipient", "refused", "frame-received")).map(
          (m) => m.reason,
        ),
      )
      .toContain("starting");
    // Just over the 15 s that recipients used to wait before calling the link inactive (FID-88).
    await opener.waitForTimeout(16_000 - (Date.now() - restarted));
    for (const page of [waiting, opener]) {
      await expect(connecting(page)).toBeVisible();
      await expect(page.getByText("This link isn't active")).toHaveCount(0);
    }

    await sender.evaluate(() => (globalThis as HostHold).releaseHost?.());
    for (const page of [waiting, opener]) {
      await expect(page.getByRole("button", { name: "Download" })).toBeVisible({
        timeout: 30_000,
      });
      expect(sha256Hex(await download(page, file))).toBe(sha256Hex(file.bytes));
    }
    await expect(delivered(sender, early)).toBeAttached();
    await expect(delivered(sender, late)).toBeAttached();
    expect(await sender.evaluate(() => (globalThis as HostHold).closeCodes)).toEqual([4012]);
    await expect(lost(sender)).toHaveCount(0);
  });
});
