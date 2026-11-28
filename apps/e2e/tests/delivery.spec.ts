import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import {
  barText,
  canaryFile,
  canaryKey,
  chooseFile,
  delivered,
  expect,
  expectStepAtTop,
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
  receive,
  sha256Hex,
  test,
} from "../src/transfer.ts";

// Delivering a file end to end: a sender page sends one file to named recipients, each recipient on
// their own link and in their own browser context. The other transfer specs beside this one cover
// interruptions, a hostile path, the safety number, a server restart and emailed links. The harness's leak check runs after every test
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
