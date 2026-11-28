import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { maskAddress } from "@fidant/protocol";
import type { Download, Locator, Page } from "@playwright/test";
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
  type Leaks,
  makeName,
  type Observed,
  recipientRow,
} from "../src/fixtures.ts";
import { commitTo, interpose, type Signal, signalsOf, tamperSignal } from "../src/interpose.ts";
import { base32Token, type CanaryFile, type SeededRandom } from "../src/leaks/canary.ts";
import type { Allowed } from "../src/leaks/needles.ts";
import { type Message, mailTo } from "../src/mail.ts";
import { serverStderrLog, serverStdoutLog } from "../src/paths.ts";
import { restartServer } from "../src/stack/server.ts";

// The first demo end to end: a sender page sends one file to named recipients, each recipient on
// their own link and in their own browser context. The harness's leak check runs after every test
// and searches everything the browsers sent and received and everything the server logged for the
// file, its name, type and size, the link secrets and the sender and recipient names.

const MiB = 1024 * 1024;

/** Signaling must never carry these: SDP is encrypted before it is relayed. */
const sdpMarkers = ["v=0", "a=fingerprint", "a=ice-ufrag"];

const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

interface Demo {
  /** A recorded browser context named `name`, whose page saves files as Blob downloads. */
  open(name: string): Promise<Page>;
}

const test = harness.extend<{ demo: Demo }>({
  demo: async ({ actor, observed }, use, testInfo) => {
    const names: string[] = [];
    const pageErrors: string[] = [];
    await use({
      async open(name) {
        const { context, page } = await actor(name);
        names.push(name);
        await context.addInitScript(() => {
          // Force the recipient's Blob fallback so the file arrives as a download.
          delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
        });
        page.on("pageerror", (error) => pageErrors.push(`${name}: ${error.message}`));
        return page;
      },
    });
    if (testInfo.status === "skipped") {
      return;
    }

    const frames: { type: string; text: string }[] = [];
    for (const name of names) {
      for (const record of await observed(name).records()) {
        if (record.type !== "frame-sent" && record.type !== "frame-received") {
          continue;
        }
        // Binary frames are recorded as base64.
        const text = record.base64
          ? Buffer.from(record.payload, "base64").toString()
          : record.payload;
        frames.push({ type: record.type, text });
      }
    }
    const sdp = frames.flatMap(({ type, text }) =>
      sdpMarkers.filter((marker) => text.includes(marker)).map((m) => `${m} in ${type}`),
    );
    expect(sdp, "plaintext SDP over signaling").toEqual([]);
    // Guards the checks above and the leak scan against a recorder that saw no signaling.
    expect(
      frames.some((f) => f.type === "frame-sent"),
      "captured sent frames",
    ).toBe(true);
    expect(
      frames.some((f) => f.type === "frame-received"),
      "captured received frames",
    ).toBe(true);
    expect(pageErrors, "uncaught page errors").toEqual([]);
  },
});

// The 8 MiB transfer and its leak scan take longer than Playwright's default.
test.describe.configure({ timeout: 90_000 });

/** A watched canary file of exactly `size` bytes. */
function makeFile(leaks: Leaks, canary: SeededRandom, size: number): CanaryFile {
  return leaks.watch(canaryFile(canary.fork("file"), { size }));
}

/** Opens the sender page, runs `setup` on it before it loads, types the sender's name if given, and chooses the file. */
async function openSender(
  demo: Demo,
  file: CanaryFile,
  from = "",
  setup?: (page: Page) => Promise<unknown>,
): Promise<Page> {
  const page = await demo.open("sender");
  await setup?.(page);
  await page.goto("/send");
  if (from) {
    await page.getByLabel("Your name").fill(from);
  }
  await chooseFile(page, {
    name: file.name,
    mimeType: file.mime,
    buffer: file.bytes,
  });
  // The traces panel, with the file's facts, is open beside the page on a wide screen.
  await expect(page.getByText(sha256Hex(file.bytes))).toBeVisible();
  return page;
}

/** Adds a recipient on the sender page and returns their link, with its secret watched. Clicks the safety number button if `check`, else presses Enter, which must make a plain link. */
async function addRecipient(
  leaks: Leaks,
  sender: Page,
  name: string,
  check = false,
): Promise<string> {
  const who = sender.getByLabel("Who is it for?");
  await who.fill(name);
  if (check) {
    await sender.getByRole("radio", { name: "Safety number" }).check();
    await sender
      .getByRole("button", { name: "Add recipient with safety number", exact: true })
      .click();
    // The choice stays for the next link; put it back for the helpers that press Enter.
    await sender.getByRole("radio", { name: "Link", exact: true }).check();
  } else {
    await who.press("Enter");
  }
  const link = (await sender.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
  const secret = new URL(link).hash.slice(1);
  expect(secret, `link secret for ${name}`).toMatch(/^[A-Za-z0-9_-]{43}$/);
  leaks.watchKey(`link secret for ${name}`, secret);
  return link;
}

/** Opens a link as `actor`, checks the offer, downloads, and returns the bytes of the automatic download. */
async function receive(
  demo: Demo,
  actor: string,
  link: string,
  file: CanaryFile,
  sizeText: string,
  from = "",
  sender?: Page,
) {
  const page = await demo.open(actor);
  await page.goto(link);
  const heading = from ? `${from} wants to send you a file` : "You've been sent a file";
  await expect(page.getByRole("heading", { name: heading })).toBeFocused();
  await expect(page.getByText("Name typed by the sender, not verified.")).toHaveCount(from ? 1 : 0);
  await expect(page.getByText(file.name)).toBeVisible();
  await expect(page.getByText(sizeText, { exact: true })).toBeVisible();
  await page.getByText("Technical details").click();
  await expect(page.getByText(`${file.size.toLocaleString("en-US")} bytes`)).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Traces" })).toContainText(
    /Server, Memory, [^:]*: Paired this page with the sender's on link ID/,
  );
  if (sender) {
    await expect(sender.getByRole("dialog", { name: "Traces" })).toContainText(
      /Server, Memory, [^:]*: Paired a recipient's page with link ID/,
    );
  }
  const bytes = await download(page, file);
  // The typed name is unverified, so it stays on the offer screen only.
  if (from) {
    await expect(page.getByText(from)).toHaveCount(0);
  }
  const again = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("link", { name: "Save file" }).click();
  expect(downloadName(page, await again)).toBe(file.name);
  return { page, bytes };
}

/** The download's name; WebKit on macOS decomposes its accents, so only WebKit's is normalized. */
function downloadName(page: Page, saved: Download): string {
  const name = saved.suggestedFilename();
  return page.context().browser()?.browserType().name() === "webkit" ? name.normalize() : name;
}

/** Clicks Download on the offer screen, waits for the verified file and returns its bytes. */
async function download(page: Page, file: CanaryFile): Promise<Buffer> {
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await page.getByRole("button", { name: "Download" }).click();
  await expect(page.getByText("this is exactly the file that was sent")).toBeVisible({
    timeout: 60_000,
  });
  const saved = await downloading;
  expect(downloadName(page, saved)).toBe(file.name);
  await expect(page.getByRole("heading", { name: "Download complete" })).toBeFocused();
  return readFile(await saved.path());
}

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

  // The drawer's trace log names each link by its server-side prefix, never the file.
  const prefix = (link: string) => `${new URL(link).pathname.replace(/^\/r\//, "").slice(0, 6)}…`;
  const senderTraces = sender.getByRole("dialog", { name: "Traces" });
  await expect(senderTraces).toContainText(/Passed on [1-9]\d* encrypted setup messages? \(/);
  for (const link of links) {
    await expect(senderTraces).toContainText(`link ID ${prefix(link)}`);
  }
  await expect(senderTraces).toContainText(/Connection, [^:]*: Route: direct, /);
  await expect(senderTraces).not.toContainText(file.name);
  // The Traces button counts the traces still kept, in its name.
  await expect(sender.getByRole("button", { name: /^Traces/ })).toHaveAccessibleName(
    /^Traces, \d+ still kept$/,
  );

  const recipientTraces = received[0]?.page.getByRole("dialog", { name: "Traces" });
  if (!recipientTraces) {
    throw new Error("no recipient");
  }
  // Once the transfer is done, this page's connection to our server has closed.
  await expect(recipientTraces).toContainText(
    /Server, Memory, lasted [^:]*: This page connected\./,
  );
  await expect(recipientTraces).toContainText(/Passed on [1-9]\d* encrypted setup messages? \(/);
  await expect(recipientTraces).toContainText(`link ID ${prefix(links[0] ?? "")}`);
  await expect(recipientTraces).not.toContainText(file.name);
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
  await expect(malformed.getByRole("button", { name: /^Traces/ })).toHaveCount(0);
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
  // The page never reached the server, so no trace names it.
  await expect(recipient.getByRole("dialog", { name: "Traces" })).not.toContainText(/\bServer,/);
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
  await expect(recipient.getByRole("dialog", { name: "Traces" })).toContainText(
    /Server, Memory, lasted [^:]*: This page connected\./,
  );
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

type Tamper = "flip" | "other";

/**
 * Runs in the sender page through addInitScript, so it may use nothing from this module. Alters
 * the frames the sender's data channels send, as a hostile path would deliver them. The server
 * and a TURN relay only see DTLS records, which they can't alter into well-formed frames, so
 * tampering below the app's AES-GCM layer, in the sender, stands in for a broken or hostile
 * transport. It reads only the plaintext header: byte 1 is the kind (see apps/web/src/lib/frames.ts).
 * `other` records the first channel that reaches END and, instead of sending that END, closes the
 * channel, so the transfer is never delivered and the link stays usable. On each later channel it sends the recorded frame at
 * the same index in place of its own, except INIT: an earlier transfer's META, CHUNKs and END
 * under this transfer's fresh transferId, on the same link.
 */
function tamperSender(mode: Tamper) {
  const INIT = 0;
  const CHUNK = 2;
  const END = 3;
  const send = RTCDataChannel.prototype.send;
  const sent = new Map<RTCDataChannel, Uint8Array[]>();
  let source: Uint8Array[] | undefined;
  let flipped = false;
  RTCDataChannel.prototype.send = function (this: RTCDataChannel, data: Uint8Array) {
    const out = (frame: Uint8Array) => Reflect.apply(send, this, [frame]);
    let frame: Uint8Array = data.slice();
    const kind = frame[1];
    if (mode === "other") {
      const own = sent.get(this) ?? [];
      sent.set(this, own);
      if (source && source !== own && kind !== INIT) {
        frame = source[own.length] ?? frame;
      }
      own.push(frame);
      if (kind === END && !source) {
        source = own;
        return this.close();
      }
      return out(frame);
    }
    if (kind === CHUNK && !flipped) {
      flipped = true;
      frame[10] = (frame[10] as number) ^ 1; // the first ciphertext byte, after the 10-byte header
    }
    return out(frame);
  } as RTCDataChannel["send"];
}

/** Counts `page`'s downloads; the returned check expects the invalid-data problem, no download and no delivery to `name`. */
function expectRefusal(page: Page) {
  let downloads = 0;
  page.on("download", () => downloads++);
  return async (sender: Page, name: string) => {
    await expect(page.getByText("Something went wrong with the transfer")).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/so nothing was saved\.$/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Download complete" })).toHaveCount(0);
    await expect(page.getByText("this is exactly the file that was sent")).toHaveCount(0);
    expect(downloads, "downloads").toBe(0);
    await expect(delivered(sender, name)).toHaveCount(0);
  };
}

/** Counts `page`'s downloads; the returned check expects the connect error well before the 30 s connect timeout, no offer, no download and no delivery to `name`. */
function expectNoConnection(page: Page) {
  let downloads = 0;
  page.on("download", () => downloads++);
  return async (sender: Page, name: string) => {
    await expect(page.getByText("Couldn't connect to the sender's computer")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByRole("button", { name: "Download" })).toHaveCount(0);
    expect(downloads, "downloads").toBe(0);
    await expect(delivered(sender, name)).toHaveCount(0);
  };
}

test.describe("a hostile path", () => {
  test("a recipient refuses a data channel frame that was tampered with", async ({
    demo,
    leaks,
    canary,
  }) => {
    const file = makeFile(leaks, canary, 100_001);
    const sender = await openSender(demo, file, "", (page) =>
      page.addInitScript(tamperSender, "flip" as const),
    );
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    const recipient = await demo.open("recipient");
    const refused = expectRefusal(recipient);
    await recipient.goto(link);
    const downloadButton = recipient.getByRole("button", { name: "Download" });
    await expect(downloadButton).toBeVisible({ timeout: 30_000 });
    await downloadButton.click();
    await refused(sender, name);
  });

  test("a recipient refuses an earlier transfer's frames replayed on its link", async ({
    demo,
    leaks,
    canary,
  }) => {
    const file = makeFile(leaks, canary, 100_001);
    const sender = await openSender(demo, file, "", (page) =>
      page.addInitScript(tamperSender, "other" as const),
    );
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);

    // Attempt 1 is recorded, and the sender closes the channel instead of sending END.
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    const downloadButton = recipient.getByRole("button", { name: "Download" });
    await expect(downloadButton).toBeVisible({ timeout: 30_000 });
    await downloadButton.click();
    await expect(recipient.getByText("The connection to the sender was lost")).toBeVisible();

    // Attempt 2 is the same link and tab: a fresh transferId, attempt 1's frames. Its META fails to open, so there is no offer to download.
    const refused = expectRefusal(recipient);
    await recipient.getByRole("button", { name: "Try again" }).click();
    await refused(sender, name);
  });

  // The server relays signals it can't open: changing or moving their sealed bytes makes them fail
  // to open in the browser, so a hostile server can't swap the DTLS fingerprint in the SDP.

  test("a recipient refuses a relayed signal with one character changed", async ({
    demo,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    const recipient = await demo.open("recipient");
    let changed = false;
    await tamperSignal(recipient, (message, sent) => {
      if (sent || changed || message.t !== "relay") {
        return message;
      }
      changed = true;
      const i = message.data.length >> 1;
      const other = message.data[i] === "A" ? "B" : "A";
      return { ...message, data: message.data.slice(0, i) + other + message.data.slice(i + 1) };
    });
    const failed = expectNoConnection(recipient);
    await recipient.goto(link);
    await failed(sender, name);
    expect(changed, "changed the sender's first signal").toBe(true);
  });

  test("a sender refuses its own offer reflected as the answer", async ({
    demo,
    observed,
    leaks,
    canary,
  }) => {
    let offer: string | undefined;
    let sentRelays = 0;
    let reflected = false;
    const sender = await openSender(demo, makeFile(leaks, canary, 10), "", (page) =>
      tamperSignal(page, (message, sent) => {
        if (message.t !== "relay") {
          return message;
        }
        if (sent) {
          // The first is the sender's version marker.
          if (++sentRelays === 2) {
            offer = message.data;
          }
          return message;
        }
        if (reflected || offer === undefined) {
          return message;
        }
        reflected = true;
        return { ...message, data: offer };
      }),
    );
    const warnings = async () =>
      (await observed("sender").records()).flatMap((r) => (r.type === "console" ? [r.text] : []));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    const recipient = await demo.open("recipient");
    const failed = expectNoConnection(recipient);
    await recipient.goto(link);
    await expect
      .poll(warnings, { timeout: 10_000 })
      .toContain("fidant: sender dropped a connection: bad-signal");
    await failed(sender, name);
    expect(reflected, "reflected the offer").toBe(true);
  });

  test("a sender refuses an answer that does not match the commitment", async ({
    demo,
    observed,
    leaks,
    canary,
  }) => {
    let signals: ReturnType<typeof signalsOf> | undefined;
    let attempt = "";
    let swapped = false;
    let received = 0;
    const kinds: string[] = [];
    const sender = await openSender(demo, makeFile(leaks, canary, 10), "", (page) =>
      tamperSignal(page, (message, sent, toPage) => {
        attempt = message.attempt ?? attempt;
        if (message.t !== "relay" || !signals) {
          return message;
        }
        if (sent) {
          void signals.open(attempt, "s", message.data).then(({ kind }) => kinds.push(kind));
          return message;
        }
        // The recipient's version marker comes first.
        if (swapped || ++received < 2) {
          return message;
        }
        // The recipient's commit, swapped for one to a certificate nobody has.
        swapped = true;
        const other = randomBytes(32)
          .toString("hex")
          .toUpperCase()
          .replace(/..(?!$)/g, "$&:");
        void signals
          .seal(attempt, "r", { kind: "commit", hash: commitTo(other) })
          .then((data) => toPage({ ...message, data }));
        return undefined;
      }),
    );
    const warnings = async () =>
      (await observed("sender").records()).flatMap((r) => (r.type === "console" ? [r.text] : []));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    signals = signalsOf(link);
    const recipient = await demo.open("recipient");
    const failed = expectNoConnection(recipient);
    await recipient.goto(link);
    await expect
      .poll(warnings, { timeout: 10_000 })
      .toContain("fidant: sender dropped a connection: bad-signal");
    await failed(sender, name);
    expect(kinds, "the sender took the swapped commit and offered").toContain("offer");
  });

  test("someone in the middle with an emailed link's key shows two different safety numbers and gets nothing", async ({
    demo,
    leaks,
    canary,
  }) => {
    test.skip(!process.env.FIDANT_E2E_MAILPIT, "needs Mailpit");
    const middle = await interpose(await demo.open("middle"));
    const sender = await openSender(demo, makeFile(leaks, canary, 100_001), "", (page) =>
      middle.takeOver(page, "sender"),
    );
    const name = makeName(leaks, canary, "Anna");
    const to = addressFor(canary, "Anna");
    const emailed = await addEmailed(leaks, sender, name, to, "", true);
    middle.start(emailed.link);
    const recipient = await demo.open("recipient");
    await middle.takeOver(recipient, "recipient");
    await recipient.goto(emailed.link);
    await enterCode(recipient, await requestCode(recipient, to));

    const card = recipientRow(sender, name);
    await expect(
      checkDialog(sender, name).getByText(
        `Ask ${name} to read the number on their screen. Does it match?`,
      ),
    ).toBeVisible({ timeout: 30_000 });
    await expect(recipient.getByText("Read this number to the sender.")).toBeVisible();
    const ours = await senderNumber(sender, name);
    const theirs = await recipientNumber(recipient);
    expect(theirs, "the recipient's number").not.toBe(ours);

    await checkDialog(sender, name).getByRole("button", { name: "It differs" }).click();
    await expect(card.getByText("The numbers didn't match, so nothing was sent.")).toBeVisible();
    await expect(
      recipient.getByRole("heading", { name: "The numbers didn't match" }),
    ).toBeVisible();
    for (const page of [sender, recipient]) {
      await expect(page.getByRole("button", { name: "Download" })).toHaveCount(0);
    }
    const fromSender = (await middle.frames()).filter((f) => f.from === "sender");
    expect(
      fromSender.map((f) => f.kind),
      "the middle got only INIT and CHECK from the sender, no META",
    ).toEqual([0, 4]);
  });
});

const NUMBER = /^\d{3} \d{3}$/;

/** The sender's dialog that asks about the safety number for `name`. */
const checkDialog = (sender: Page, name: string) =>
  sender.getByRole("dialog", { name: `Safety number for ${name}` });

/** The safety number in the sender's dialog for `name`, once it shows. */
async function senderNumber(sender: Page, name: string): Promise<string> {
  const number = checkDialog(sender, name).getByText(NUMBER);
  await expect(number).toBeVisible({ timeout: 30_000 });
  return (await number.textContent()) ?? "";
}

/** The safety number on the recipient page, once it shows. */
async function recipientNumber(page: Page): Promise<string> {
  await expect(page.getByRole("heading", { name: "Safety number" })).toBeVisible({
    timeout: 30_000,
  });
  const number = page.getByText(NUMBER);
  await expect(number).toBeVisible();
  return (await number.textContent()) ?? "";
}

/** Both pages show the same safety number; returns it. */
async function sameNumber(sender: Page, name: string, recipient: Page): Promise<string> {
  const theirs = await recipientNumber(recipient);
  await expect.poll(() => senderNumber(sender, name)).toBe(theirs);
  return theirs;
}

/** Presses Tab until `target` has focus, as a keyboard user would reach it. */
async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) {
      break;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target, "reached with Tab").toBeFocused();
}

/** The recipient says the numbers differ; both pages say so and nothing was offered. */
async function differ(sender: Page, name: string, recipient: Page): Promise<void> {
  await recipient.getByRole("button", { name: "They said it differs" }).click();
  await expect(recipient.getByRole("heading", { name: "The numbers didn't match" })).toBeVisible();
  await expect(
    recipientRow(sender, name).getByText("The numbers didn't match, so nothing was sent."),
  ).toBeVisible();
  await expect(recipient.getByRole("button", { name: "Download" })).toHaveCount(0);
}

test.describe("safety number", () => {
  test("an emailed recipient and the sender see the same safety number, and the file waits for both", async ({
    demo,
    leaks,
    canary,
  }) => {
    test.skip(!process.env.FIDANT_E2E_MAILPIT, "needs Mailpit");
    const file = makeFile(leaks, canary, 100_001);
    const sender = await openSender(demo, file);
    const name = makeName(leaks, canary, "Anna");
    const to = addressFor(canary, "Anna");
    const emailed = await addEmailed(leaks, sender, name, to, "", true);
    const recipient = await demo.open("recipient");
    await recipient.goto(emailed.link);
    await enterCode(recipient, await requestCode(recipient, to));
    await sameNumber(sender, name, recipient);
    await watchToken(leaks, recipient, emailed, name);
    await expect(recipient.getByRole("heading", { name: "Safety number" })).toBeFocused();
    await expect(recipient.getByText("Read this number to the sender.")).toBeVisible();
    await expect(
      checkDialog(sender, name).getByText(
        `Ask ${name} to read the number on their screen. Does it match?`,
      ),
    ).toBeVisible();

    await checkDialog(sender, name).getByRole("button", { name: "It matches" }).click();
    await expect(
      recipientRow(sender, name).getByText("You said it matches. It goes once they confirm too."),
    ).toBeVisible();
    // The sender's click alone sends nothing about the file.
    await expect(recipient.getByRole("button", { name: "Download" })).toHaveCount(0);
    await expect(recipient.getByRole("heading", { name: "Safety number" })).toBeVisible();

    await recipient.getByRole("button", { name: "They said it matches" }).click();
    await expect(recipient.getByRole("heading", { name: "You've been sent a file" })).toBeVisible({
      timeout: 30_000,
    });
    const bytes = await download(recipient, file);
    expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
    await expect(delivered(sender, name)).toBeAttached();
  });

  test("it differs: nothing is offered, and trying again gives a new number", async ({
    demo,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name, true);
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    const first = await sameNumber(sender, name, recipient);
    await differ(sender, name, recipient);

    await recipient.getByRole("button", { name: "Try again" }).click();
    const second = await sameNumber(sender, name, recipient);
    expect(second).not.toBe(first);
  });

  test("the recipient answers from the keyboard: focus stays and the wait is announced", async ({
    demo,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name, true);
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    await sameNumber(sender, name, recipient);
    expect(await recipient.locator("#receive [role=status]:empty").count()).toBeGreaterThan(0);

    await tabTo(recipient, recipient.getByRole("button", { name: "They said it matches" }));
    await recipient.keyboard.press("Enter");
    await expect(recipient.getByRole("heading", { name: "Safety number" })).toBeFocused();
    await expect(
      recipient.locator("[role=status]", {
        hasText: "Waiting for the sender to say it matches too.",
      }),
    ).toBeVisible();
  });

  test("the sender answers from the keyboard: the dialog names the recipient, focus goes to the card and the wait is announced", async ({
    demo,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name, true);
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    await sameNumber(sender, name, recipient);
    const card = recipientRow(sender, name);
    expect(await card.locator("[role=status]:empty").count()).toBeGreaterThan(0);

    const dialog = checkDialog(sender, name);
    await expect(dialog.getByRole("button", { name: `It differs for ${name}` })).toBeVisible();
    const matches = dialog.getByRole("button", { name: `It matches for ${name}` });
    // The answer buttons are disabled for the dialog's first half second, and Tab skips them until then.
    await expect(matches).toBeEnabled();
    await tabTo(sender, matches);
    await sender.keyboard.press("Enter");
    await expect(card.locator("[data-status]")).toBeFocused();
    await expect(
      card.locator("[role=status]", {
        hasText: "You said it matches. It goes once they confirm too.",
      }),
    ).toBeVisible();
  });

  test("the sender saying it differs stops both pages", async ({ demo, leaks, canary }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name, true);
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    await sameNumber(sender, name, recipient);
    await checkDialog(sender, name).getByRole("button", { name: "It differs" }).click();
    await expect(
      recipient.getByRole("heading", { name: "The numbers didn't match" }),
    ).toBeVisible();
    await expect(
      recipientRow(sender, name).getByText("The numbers didn't match, so nothing was sent."),
    ).toBeVisible();
    await expect(recipient.getByRole("button", { name: "Download" })).toHaveCount(0);
  });

  test("two recipients each see their own number", async ({ demo, leaks, canary }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const names = [makeName(leaks, canary, "Anna"), makeName(leaks, canary, "Erik")];
    // Both are added before either link is opened: the dialog is modal and shows one at a time.
    const links: string[] = [];
    for (const name of names) {
      links.push(await addRecipient(leaks, sender, name, true));
    }
    const pages: Page[] = [];
    const numbers: string[] = [];
    for (const [i, name] of names.entries()) {
      const page = await demo.open(`recipient-${i + 1}`);
      await page.goto(links[i] as string);
      pages.push(page);
      numbers.push(await sameNumber(sender, name, page));
      // Put it off, so the dialog is free for the next recipient.
      await checkDialog(sender, name).getByRole("button", { name: "Not now" }).click();
    }
    // Six digits from each connection's own fingerprints: a clash is one chance in a million.
    expect(numbers[0]).not.toBe(numbers[1]);
    // Reopening a card's check shows that recipient's number again.
    for (const [i, name] of names.entries()) {
      await recipientRow(sender, name)
        .getByRole("button", { name: `Compare number for ${name}` })
        .click();
      expect(await senderNumber(sender, name)).toBe(numbers[i]);
      await checkDialog(sender, name).getByRole("button", { name: "Not now" }).click();
    }
  });

  test("a recipient who reloads mid-check gets a new number on both sides", async ({
    demo,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name, true);
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    const first = await sameNumber(sender, name, recipient);
    await recipient.reload();
    const second = await sameNumber(sender, name, recipient);
    expect(second).not.toBe(first);
  });

  test("five failed checks, a reload among them, end the link", async ({ demo, leaks, canary }) => {
    test.setTimeout(120_000);
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name, true);
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    for (let i = 1; i <= 5; i++) {
      await sameNumber(sender, name, recipient);
      if (i === 2) {
        // A reload drops the attempt, which counts like a check that differs.
        await recipient.reload();
      } else if (i < 5) {
        await differ(sender, name, recipient);
        await recipient.getByRole("button", { name: "Try again" }).click();
      }
    }
    await recipient.getByRole("button", { name: "They said it differs" }).click();
    await expect(
      recipientRow(sender, name).getByText(
        "The check failed 5 times, so this link no longer works.",
      ),
    ).toBeVisible();
    await expect(recipientRow(sender, name).getByRole("button", { name: /^Copy/ })).toHaveCount(0);
    await recipient.getByRole("button", { name: "Try again" }).click();
    await expect(recipient.getByRole("heading", { name: "This link isn't active" })).toBeVisible();
  });

  test("an unconfirmed safety number ends 5 minutes after it opens", async ({
    demo,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10), "", (page) =>
      page.clock.install(),
    );
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name, true);
    const recipient = await demo.open("recipient");
    await recipient.goto(link);
    const number = await sameNumber(sender, name, recipient);
    await expect(recipient.getByText("The safety number expires after 5 minutes.")).toBeVisible();
    const card = recipientRow(sender, name);
    const expired = card.getByText("The safety number wasn't confirmed within 5 minutes");

    await sender.clock.fastForward(290_000);
    await expect(checkDialog(sender, name).getByText(number)).toBeVisible();
    await expect(expired).toHaveCount(0);
    await sender.clock.fastForward(10_000);
    await expect(expired).toBeVisible();
    await expect(checkDialog(sender, name)).toBeHidden();
    await expect(sender.getByText(number)).toHaveCount(0);
    await expect(
      recipient.getByRole("heading", { name: "The connection to the sender was lost" }),
    ).toBeVisible();
  });

  // Someone in the middle learns the recipient's number from its answer, before the channel opens,
  // so every new connection would be another guess: none may happen without the recipient's click.
  test("a recipient page doesn't reconnect by itself once it answered the sender's offer", async ({
    demo,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name, true);
    const recipient = await demo.open("recipient");
    let joins = 0;
    await recipient.routeWebSocket("/signal", (ws) => {
      const server = ws.connectToServer();
      let relays = 0;
      ws.onMessage((text) => {
        const message = JSON.parse(text.toString()) as Signal;
        joins += message.t === "join" ? 1 : 0;
        server.send(text);
        // The version marker, the commit, then the answer: drop the socket as soon as the answer went out.
        if (message.t === "relay" && ++relays === 3) {
          ws.close();
          server.close();
        }
      });
      server.onMessage((text) => ws.send(text));
    });
    await recipient.goto(link);
    await expect(recipient.getByText("Couldn't connect to the sender's computer")).toBeVisible({
      timeout: 10_000,
    });
    expect(joins, "joins").toBe(1);
  });

  test("a recipient page ignores a token it didn't ask for", async ({ demo, leaks, canary }) => {
    test.skip(!process.env.FIDANT_E2E_MAILPIT, "needs Mailpit");
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const emailed = await addEmailed(leaks, sender, name, addressFor(canary, "Anna"), "", true);
    const recipient = await demo.open("recipient");
    let joins = 0;
    let injected = false;
    await recipient.routeWebSocket("/signal", (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((text) => {
        joins += (JSON.parse(text.toString()) as Signal).t === "join" ? 1 : 0;
        server.send(text);
      });
      server.onMessage((text) => {
        ws.send(text);
        if ((JSON.parse(text.toString()) as Signal).t === "gate" && !injected) {
          injected = true;
          ws.send(JSON.stringify({ t: "token", link: emailed.linkId, token: "A".repeat(22) }));
        }
      });
    });
    await recipient.goto(emailed.link);
    await expect(
      recipient.getByRole("heading", { name: "Confirm your email to open this link" }),
    ).toBeVisible();
    await recipient.waitForTimeout(1000);
    await expect(
      recipient.getByRole("heading", { name: "Confirm your email to open this link" }),
    ).toBeVisible();
    expect(injected, "injected a token").toBe(true);
    expect(joins, "joins").toBe(0);
  });

  test("a copied link without the check shows no number", async ({ demo, leaks, canary }) => {
    const file = makeFile(leaks, canary, 100_001);
    const sender = await openSender(demo, file);
    const name = makeName(leaks, canary, "Anna");
    const link = await addRecipient(leaks, sender, name);
    const { page } = await receive(demo, "recipient", link, file, "100 KB");
    await expect(page.getByText(NUMBER)).toHaveCount(0);
    await expect(sender.getByText(NUMBER)).toHaveCount(0);
  });
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

/** A made-up address for `first`, unique to this run, at a reserved domain. */
const addressFor = (canary: SeededRandom, first: string) =>
  `${first.toLowerCase()}-${base32Token(canary.fork(`address ${first}`), 8).toLowerCase()}@example.com`;

interface Emailed {
  /** The link the server emailed: `/r/<linkId>#e.<mark>.<secret>`. */
  link: string;
  linkId: string;
  mark: string;
  secret: string;
  notice: Message;
}

/**
 * Adds `name` with the address `to` and waits for the notice. Watches the link's secret, the
 * server's value, the address and, if given, the sender's typed name `from` where decision 0012
 * lets them appear. `check` presses Enter, which must make a safety number link; false clicks the plain button.
 */
async function addEmailed(
  leaks: Leaks,
  sender: Page,
  name: string,
  to: string,
  from = "",
  check = false,
): Promise<Emailed> {
  await sender.getByLabel("Who is it for?").fill(name);
  // Emailing is opt-in; the choice stays ticked for the next recipient.
  await sender.getByLabel("Email the link for me (less private)").check();
  // Ticking email preselects the safety number, so the Add button and Enter use it.
  await expect(
    sender
      .locator("form")
      .filter({ has: sender.getByLabel("Who is it for?") })
      .locator("button[type=submit]")
      .first(),
  ).toHaveText("Add recipient and email link with safety number");
  const address = sender.getByLabel("Their email address");
  await address.fill(to);
  if (check) {
    await address.press("Enter");
  } else {
    await sender.getByRole("radio", { name: "Link", exact: true }).check();
    await sender.getByRole("button", { name: "Add recipient and email link", exact: true }).click();
  }
  await expect(
    recipientRow(sender, name).getByText(`Email sent to ${maskAddress(to)}`),
  ).toBeVisible();
  await expect(sender.getByLabel("Email the link for me (less private)")).toBeChecked();
  const link = (await sender.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
  const url = new URL(link);
  const [, mark = "", secret = ""] = /^#e\.([\w-]{22})\.([\w-]{43})$/.exec(url.hash) ?? [];
  await expect.poll(async () => (await mailTo(to)).length).toBe(1);
  const [notice] = await mailTo(to);
  if (!notice) {
    throw new Error(`no notice to ${to}`);
  }
  expect(notice.Text).toContain(link);
  const linkId = url.pathname.slice("/r/".length);
  const mail: Allowed["mail"] = { to, notice: notice.ID };
  leaks.watchKey(`link secret for ${name}`, secret, "K", {
    link: linkId,
    frames: ["sent email"],
    mail,
  });
  leaks.watchKey(`value for ${name}`, mark, "K", {
    link: linkId,
    frames: ["received email", "sent gate", "sent send-code", "sent code"],
    mail,
  });
  leaks.watchText(`address for ${name}`, to, {
    link: linkId,
    frames: ["sent email"],
    mail: { to },
  });
  if (from) {
    leaks.watchText(`typed name ${from}`, from, { link: linkId, frames: ["sent email"], mail });
  }
  return { link, linkId, mark, secret, notice };
}

/** Asks for a code on the recipient page and returns it from the one code mail to `to`. */
async function requestCode(page: Page, to: string): Promise<string> {
  await page.getByRole("button", { name: "Send me a code" }).click();
  await expect(page.getByText("Code sent. Check your email.")).toBeVisible();
  const codeMail = async () =>
    (await mailTo(to)).filter((mail) => mail.Subject === "Your Fidant code");
  await expect.poll(async () => (await codeMail()).length).toBe(1);
  const code = /Your code: (\d{6})/.exec((await codeMail())[0]?.Text ?? "")?.[1];
  if (!code) {
    throw new Error("no code in the code mail");
  }
  return code;
}

async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Watches the token the recipient page keeps for the link, which only its frames may carry. */
async function watchToken(leaks: Leaks, page: Page, emailed: Emailed, name: string) {
  const token = await page.evaluate((id) => sessionStorage.getItem(`token:${id}`), emailed.linkId);
  expect(token).toMatch(/^[\w-]{22}$/);
  leaks.watchKey(`token for ${name}`, token ?? "", "K", {
    link: emailed.linkId,
    frames: ["received token", "sent join"],
  });
  return token ?? "";
}

/** The server never logged these. The scan cannot look for a 6-digit code, so this does. */
async function expectNotLogged(values: string[]): Promise<void> {
  const logs = (await Promise.all([serverStdoutLog, serverStderrLog].map((p) => readFile(p)))).join(
    "\n",
  );
  for (const value of values) {
    // A code counts only as a whole number, not as part of a longer one.
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    expect(logs).not.toMatch(new RegExp(`(?<!\\d)${escaped}(?!\\d)`));
  }
}

/** Parsed `t` messages of type `type` that `actor` sent (or received) on /signal. */
async function messages(
  observed: (name: string) => Observed,
  actor: string,
  type: string,
  direction: "frame-sent" | "frame-received" = "frame-sent",
): Promise<Record<string, unknown>[]> {
  return (await observed(actor).records()).flatMap((record) => {
    if (record.type !== direction || record.base64) {
      return [];
    }
    const message = JSON.parse(record.payload) as Record<string, unknown>;
    return message.t === type ? [message] : [];
  });
}

/**
 * Hosts `link` as a plain link over a socket of the page's own, which stays open, then joins it
 * from another socket without a token. Returns the type of the server's answer to that join.
 */
function hostPlain(page: Page, link: string, attempt: string): Promise<string> {
  return page.evaluate(
    ([link, attempt]) =>
      new Promise<string>((resolve, reject) => {
        const url = `${location.origin.replace("https", "wss")}/signal`;
        const host = new WebSocket(url);
        (globalThis as { host?: WebSocket }).host = host;
        host.addEventListener("error", () => reject(new Error("host socket error")));
        host.addEventListener("open", () => {
          host.send(JSON.stringify({ t: "host", links: [link], turn: false }));
          const guest = new WebSocket(url);
          guest.addEventListener("error", () => reject(new Error("guest socket error")));
          guest.addEventListener("open", () =>
            guest.send(JSON.stringify({ t: "join", link, attempt })),
          );
          guest.addEventListener("message", (event) => {
            const { t } = JSON.parse(String(event.data)) as { t: string };
            if (t !== "hello") {
              resolve(t);
              guest.close();
            }
          });
        });
      }),
    [link, attempt] as const,
  );
}

test.describe("emailed links", () => {
  test.skip(!process.env.FIDANT_E2E_MAILPIT, "needs Mailpit");

  test("a recipient enters the emailed code and gets the file", async ({
    demo,
    observed,
    leaks,
    canary,
    baseURL,
  }) => {
    const file = makeFile(leaks, canary, 100_001);
    // Watched by addEmailed, with where the email may carry it.
    const from = `David-${base32Token(canary.fork("typed name"), 8)}`;
    const sender = await openSender(demo, file, from);
    const name = makeName(leaks, canary, "Anna");
    const to = addressFor(canary, "Anna");
    const masked = maskAddress(to);
    const emailed = await addEmailed(leaks, sender, name, to, from);
    expect(emailed.notice.HTML).toBe("");
    expect(emailed.notice.Text).toContain(
      `${from} (name typed by the sender, not verified) wants to send you a file or a secret.`,
    );

    const recipient = await demo.open("recipient");
    await recipient.goto(emailed.link);
    const codeStep = (page: Page) =>
      page.getByRole("heading", { name: "Confirm your email to open this link" });
    await expect(codeStep(recipient)).toBeVisible();
    await expect(recipient.getByText(`We'll email a code to ${masked}.`)).toBeVisible();
    await expect(recipient.getByText(from)).toHaveCount(0);
    const code = await requestCode(recipient, to);
    await expect(recipientRow(sender, name).getByText(`Code sent to ${masked}`)).toBeVisible();
    await enterCode(recipient, String((Number(code) + 1) % 1_000_000).padStart(6, "0"));
    await expect(recipient.getByText("That code is wrong. Try again.")).toBeVisible();
    await enterCode(recipient, code);
    await expect(
      recipient.getByRole("heading", { name: `${from} wants to send you a file` }),
    ).toBeVisible();
    const token = await watchToken(leaks, recipient, emailed, name);
    const verified = recipientRow(sender, name).getByText(
      `Verified with the code sent to ${masked}`,
    );
    await expect(verified).toBeVisible();

    // The token is this tab's: another tab gets the code step. The link without its marker
    // joins without a token, and the server refuses it.
    const tab = await recipient.context().newPage();
    await tab.goto(emailed.link);
    await expect(codeStep(tab)).toBeVisible();
    await tab.close();
    const stripped = await demo.open("stripped");
    await stripped.goto(`${baseURL}/r/${emailed.linkId}#${emailed.secret}`);
    await expect(stripped.getByText("This link no longer works")).toBeVisible();

    const bytes = await download(recipient, file);
    expect(sha256Hex(bytes)).toBe(sha256Hex(file.bytes));
    await expect(delivered(sender, name)).toBeAttached();
    await expect(verified).toBeVisible();

    // A reload joins with the tab's token, without a new code, and the sender refuses a used link.
    await recipient.reload();
    await expect(recipient.getByText("This link has already been used")).toBeVisible();
    const joins = await messages(observed, "recipient", "join");
    expect(joins.map((join) => join.token)).toEqual([token, token]);
    expect((await mailTo(to)).filter((mail) => mail.Subject === "Your Fidant code")).toHaveLength(
      1,
    );
    await expectNotLogged([to, code, token, emailed.mark]);
  });

  test("an emailed link stops working with its sender, even if someone hosts its ID", async ({
    demo,
    observed,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 100_001));
    const name = makeName(leaks, canary, "Anna");
    const to = addressFor(canary, "Anna");
    const emailed = await addEmailed(leaks, sender, name, to);
    const recipient = await demo.open("recipient");
    await recipient.goto(emailed.link);
    await enterCode(recipient, await requestCode(recipient, to));
    await expect(recipient.getByRole("button", { name: "Download" })).toBeVisible();
    await watchToken(leaks, recipient, emailed, name);
    await sender.close();
    await expect(recipient.getByText("The sender's page is closed")).toBeVisible();

    // The server forgot the link with the sender's socket, so a join without a token reaches
    // whoever hosts its ID now.
    const impostor = await demo.open("impostor");
    await impostor.goto("/");
    const attempt = canary.fork("attempt").bytes(16).toString("base64url");
    expect(await hostPlain(impostor, emailed.linkId, attempt)).toBe("joined");

    const joins = async (actor: string) => (await messages(observed, actor, "join")).length;
    const joined = await joins("recipient");
    await recipient.reload();
    await expect(recipient.getByText("This link no longer works")).toBeVisible();
    const fresh = await demo.open("fresh");
    await fresh.goto(emailed.link);
    await expect(fresh.getByText("This link no longer works")).toBeVisible();
    expect(await joins("recipient")).toBe(joined);
    expect(await joins("fresh")).toBe(0);
    const kept = await recipient.evaluate(
      (id) => sessionStorage.getItem(`token:${id}`),
      emailed.linkId,
    );
    expect(kept).toBeNull();
  });

  test("the code step survives a dropped connection and ends when the link stops working", async ({
    demo,
    observed,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const name = makeName(leaks, canary, "Anna");
    const to = addressFor(canary, "Anna");
    const emailed = await addEmailed(leaks, sender, name, to);
    const recipient = await demo.open("recipient");
    await recipient.addInitScript(() => {
      const sockets: WebSocket[] = [];
      const Native = window.WebSocket;
      window.WebSocket = class extends Native {
        constructor(...args: ConstructorParameters<typeof Native>) {
          super(...args);
          sockets.push(this);
        }
      };
      (window as unknown as { dropSockets: () => void }).dropSockets = () => {
        for (const socket of sockets) {
          socket.close();
        }
      };
    });
    await recipient.goto(emailed.link);
    const code = await requestCode(recipient, to);

    const gates = async () => (await messages(observed, "recipient", "gate")).length;
    const gatesBefore = await gates();
    await recipient.evaluate(() =>
      (window as unknown as { dropSockets: () => void }).dropSockets(),
    );
    await expect.poll(gates).toBeGreaterThan(gatesBefore);
    await expect(recipient.getByLabel("Code from the email")).toBeVisible();
    await enterCode(recipient, code);
    await expect(recipient.getByRole("button", { name: "Download" })).toBeVisible();

    const late = await demo.open("late");
    await late.goto(emailed.link);
    await expect(late.getByRole("button", { name: "Send me a code" })).toBeVisible();
    await sender.close();
    await expect(recipient.getByText("The sender's page is closed")).toBeVisible();
    await late.getByRole("button", { name: "Send me a code" }).click();
    await expect(late.getByText("This link no longer works")).toBeVisible();
  });

  test("a reconnect stops an emailed link and hosts only the plain ones again", async ({
    demo,
    observed,
    leaks,
    canary,
  }) => {
    const sender = await openSender(demo, makeFile(leaks, canary, 10));
    const plainName = makeName(leaks, canary, "Erik");
    const plain = new URL(await addRecipient(leaks, sender, plainName)).pathname.slice(3);
    const name = makeName(leaks, canary, "Anna");
    const to = addressFor(canary, "Anna");
    const emailed = await addEmailed(leaks, sender, name, to);
    const hosted = async () => (await messages(observed, "sender", "host")).map((m) => m.links);
    const before = (await hosted()).length;

    await restartServer();
    await expect
      .poll(async () => (await hosted()).length, { timeout: 30_000 })
      .toBeGreaterThan(before);
    const links = (await hosted()).at(-1);
    expect(links).toContain(plain);
    expect(links).not.toContain(emailed.linkId);
    await expect(
      recipientRow(sender, name).getByText(
        `The link emailed to ${maskAddress(to)} stopped working`,
      ),
    ).toBeVisible();
    await expect(sender.getByRole("button", { name: `Copy link for ${name}` })).toHaveCount(0);
    await expect(sender.getByRole("button", { name: `Copy link for ${plainName}` })).toBeVisible();
  });

  test("a text from /send/secret can be emailed and shows after the code", async ({
    demo,
    leaks,
    canary,
  }) => {
    const text = `${base32Token(canary.fork("text"), 40)} åäö`;
    leaks.watchContent("text", text);
    const sender = await demo.open("sender");
    await sender.goto("/send/secret");
    await sender.getByLabel("Your secret").fill(text);
    await continueToLinks(sender);
    await sender.getByLabel("Email the link for me (less private)").check();
    const email = sender.getByLabel("Their email address");
    await expect(email).toHaveId("secret-recipient-email");
    const name = makeName(leaks, canary, "Anna");
    const to = addressFor(canary, "Anna");
    await email.fill(to);
    await expect(sender.locator("#secret-email-notice")).toContainText(
      "anyone who can read that mailbox could receive the secret.",
    );
    const emailed = await addEmailed(leaks, sender, name, to);

    const recipient = await demo.open("recipient");
    await recipient.goto(emailed.link);
    await enterCode(recipient, await requestCode(recipient, to));
    await expect(
      recipient.getByRole("heading", { name: "You've been sent a secret" }),
    ).toBeVisible();
    await recipient.getByRole("button", { name: "Show", exact: true }).click();
    const shown = recipient.getByRole("region", { name: "The secret", exact: true });
    await expect(shown).toBeVisible();
    // Playwright's Firefox crashes the page on toHaveJSProperty after a role or label query.
    await expect.poll(() => shown.evaluate((el) => el.textContent)).toBe(text);
    await expect(delivered(sender, name)).toBeAttached();
  });
});

// The default stack runs Mailpit, so the branch without mail runs only where Mailpit is missing.
harness(
  "the send page offers an email field exactly when the server can send mail",
  async ({ actor, observed }) => {
    const { page } = await actor("sender");
    await page.goto("/send");
    const hello = async () => await messages(observed, "sender", "hello", "frame-received");
    await expect.poll(async () => (await hello()).length).toBe(1);
    const mail = (await hello())[0]?.mail;
    expect(mail).toBe(Boolean(process.env.FIDANT_E2E_MAILPIT));
    // The add form shows once a file is chosen. The address field appears only once the sender
    // chooses to have the link emailed.
    await chooseFile(page, {
      name: "a.bin",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("x"),
    });
    await expect(page.getByLabel("Who is it for?")).toBeVisible();
    const choice = page.getByLabel("Email the link for me (less private)");
    await expect(choice).toHaveCount(mail ? 1 : 0);
    await expect(page.getByLabel("Their email address")).toHaveCount(0);
    if (mail) {
      await expect(choice).not.toBeChecked();
      await choice.check();
      await expect(page.getByLabel("Their email address")).toHaveCount(1);
      await expect(
        page.getByRole("note").filter({ hasText: "Sending the link yourself avoids all of this." }),
      ).toBeVisible();
      // Having opted in, the sender can't add a recipient without an address.
      await page.getByLabel("Who is it for?").fill("Anna");
      await page
        .getByRole("button", {
          name: "Add recipient and email link with safety number",
          exact: true,
        })
        .click();
      await expect(
        page.getByText("Enter a valid email address, like name@example.com."),
      ).toBeVisible();
      await expect(page.getByLabel("Their email address")).toBeFocused();
      await expect(page.getByLabel("Link for Anna", { exact: true })).toHaveCount(0);
    }
  },
);
