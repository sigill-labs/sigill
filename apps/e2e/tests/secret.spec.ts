import type { Download, Page } from "@playwright/test";
import {
  type Actor,
  allowClipboard,
  breakableSender,
  continueToLinks,
  delivered,
  expect,
  type Leaks,
  makeName,
  recipientRow,
  test,
} from "../src/fixtures.ts";
import { base32Token, type SeededRandom } from "../src/leaks/canary.ts";

/** A watched text, unique to this run, long enough that any 16 bytes of it count. */
function makeText(leaks: Leaks, canary: SeededRandom): string {
  const random = canary.fork("text");
  const text = `${base32Token(random, 40)}\n${base32Token(random, 40)} åäö €`;
  leaks.watchContent("text", text);
  return text;
}

/** Fills the text and the sender's name on /send/secret, continues to step 2, adds a recipient and returns their link, with its secret watched. */
async function share(leaks: Leaks, sender: Page, text: string, from: string, name: string) {
  await sender.getByLabel("Your secret").fill(text);
  await expect(sender.getByLabel("Your secret")).toHaveAttribute("writingsuggestions", "false");
  if (from) {
    await sender.locator("#secret-from").fill(from);
  }
  await continueToLinks(sender);
  return addLink(leaks, sender, name);
}

/** Adds a recipient on /send/secret and returns their link, with its secret watched. With `check`, the link has the safety number on. */
async function addLink(leaks: Leaks, sender: Page, name: string, check = false) {
  await sender.locator("#secret-recipient-name").fill(name);
  await sender
    .getByRole("button", {
      name: check ? "Add with safety number" : "Add",
      exact: true,
    })
    .click();
  const link = (await sender.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
  const secret = new URL(link).hash.slice(1);
  expect(secret, `link secret for ${name}`).toMatch(/^[A-Za-z0-9_-]{43}$/);
  leaks.watchKey(`link secret for ${name}`, secret);
  return link;
}

/** Opens `link` as the recipient, with the clipboard allowed and save pickers and downloads counted. */
async function openRecipient(
  actor: (name: string) => Promise<Actor>,
  link: string,
  name = "recipient",
) {
  const { context, page } = await actor(name);
  await allowClipboard(context, new URL(link).origin);
  await context.addInitScript(() => {
    const g = globalThis as {
      showSaveFilePicker?: (...args: unknown[]) => unknown;
      pickerCalls?: number;
    };
    const picker = g.showSaveFilePicker;
    g.pickerCalls = 0;
    if (picker) {
      g.showSaveFilePicker = (...args) => {
        g.pickerCalls = (g.pickerCalls ?? 0) + 1;
        return Reflect.apply(picker, globalThis, args);
      };
    }
  });
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.goto(link);
  return { page, downloads };
}

test("a text goes from /send/secret to the recipient, who shows and copies it", async ({
  actor,
  leaks,
  canary,
  browserName,
}) => {
  const body = makeText(leaks, canary);
  // Starts with a byte order mark, which Blob.text() would drop on the recipient's side.
  const text = `\uFEFF${body}`;
  leaks.watchContent("text with its byte order mark", text);
  // WebKit ends the box's selected text with a line break, and on macOS its clipboard drops the mark.
  const selected = browserName === "webkit" ? `${text}\n` : text;
  const copied = browserName === "webkit" && process.platform === "darwin" ? body : text;
  const from = makeName(leaks, canary, "David");
  const name = makeName(leaks, canary, "Anna");

  const { page: sender } = await actor("sender");
  await sender.goto("/send");
  const entry = sender
    .getByRole("navigation", { name: "What to send" })
    .filter({ visible: true })
    .getByRole("link", { name: "Secret" });
  await entry.click();
  await expect(sender).toHaveURL(/\/send\/secret$/);
  await expect(sender).toHaveTitle("Share a secret – Fidant");
  await expect(entry).toHaveAttribute("aria-current", "page");
  const field = sender.getByLabel("Your secret");
  await expect(field).toHaveId("secret-text");
  // Playwright's Firefox crashes the page on toHaveJSProperty after a role or label query.
  await expect
    .poll(() => field.evaluate((el) => (el as HTMLTextAreaElement).spellcheck))
    .toBe(false);
  await expect.poll(() => field.evaluate((el) => (el as HTMLElement).translate)).toBe(false);
  for (const [attribute, value] of [
    ["autocomplete", "off"],
    ["autocorrect", "off"],
    ["autocapitalize", "off"],
  ] as const) {
    await expect(field).toHaveAttribute(attribute, value);
  }
  const link = await share(leaks, sender, text, from, name);
  await expect(field).toBeVisible();
  await expect.poll(() => field.evaluate((el) => (el as HTMLTextAreaElement).value)).toBe(text);
  // The file page stays mounted and hidden, with a panel of its own.
  const senderPanel = sender.locator("main:not([hidden] *)").getByRole("region", {
    name: "What our server has right now",
    includeHidden: true,
  });
  await expect(senderPanel).toContainText("None. The secret goes directly between browsers.");
  await expect(senderPanel).toContainText("never the part that unlocks the secret");
  await expect(senderPanel).not.toContainText(/\bfiles?\b/i);

  const { page, downloads } = await openRecipient(actor, link);
  await expect(page.getByRole("heading", { name: `${from} sent you a secret` })).toBeFocused();
  const recipientPanel = page.getByRole("region", {
    name: "What our server has right now",
  });
  await expect(recipientPanel).toContainText("None. The secret goes directly between browsers.");
  await expect(recipientPanel).not.toContainText(/\bfiles?\b/i);
  await expect(page.getByText("Name typed by the sender, not verified.")).toBeVisible();
  const show = page.getByRole("button", { name: "Show", exact: true });
  await expect(show).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("secret.txt");
  await show.click();

  const shown = page.getByRole("region", { name: "The secret", exact: true });
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((el) => el.textContent)).toBe(text);
  await expect.poll(() => shown.evaluate((el) => (el as HTMLElement).translate)).toBe(false);
  await expect(shown).toHaveAttribute("tabindex", "0");
  // Browsers save form controls' values with the session, so none may hold the text.
  const [firstLine = body] = body.split("\n");
  const values = await page
    .locator("input, textarea, select")
    .evaluateAll((controls) => controls.map((control) => (control as HTMLInputElement).value));
  expect(values.filter((value) => value.includes(firstLine))).toEqual([]);
  await expect(page.locator("body")).not.toContainText("secret.txt");
  // Select-all inside the box takes only the text, not the page's headings and buttons.
  await shown.focus();
  await page.keyboard.press("ControlOrMeta+A");
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(selected);
  // A Cyrillic layout gives "ф" for the A key. Shift or Alt with A, and Ctrl+Q on AZERTY
  // (the A key giving "q"), are other shortcuts.
  const keyDown = (init: {
    key: string;
    code: string;
    ctrlKey: true;
    shiftKey?: true;
    altKey?: true;
  }) =>
    shown.evaluate((box, init) => {
      getSelection()?.removeAllRanges();
      const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
      box.dispatchEvent(event);
      return { prevented: event.defaultPrevented, selected: getSelection()?.toString() };
    }, init);
  expect(await keyDown({ key: "ф", code: "KeyA", ctrlKey: true })).toEqual({
    prevented: true,
    selected,
  });
  for (const extra of [{ shiftKey: true as const }, { altKey: true as const }]) {
    expect(await keyDown({ key: "A", code: "KeyA", ctrlKey: true, ...extra })).toEqual({
      prevented: false,
      selected: "",
    });
  }
  expect(await keyDown({ key: "q", code: "KeyA", ctrlKey: true })).toEqual({
    prevented: false,
    selected: "",
  });

  // The canary repeats under --repeat-each, so a clipboard left by an earlier run would pass.
  await page.evaluate(() => navigator.clipboard.writeText("not the text"));
  await page.getByRole("button", { name: "Copy secret" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(copied);

  const details = page.locator("details").filter({ hasText: "Technical details" });
  await details.getByText("Technical details").click();
  await expect(details.getByText("Encryption", { exact: true })).toBeVisible();
  await expect(details).not.toContainText("SHA-256");
  await expect(details).not.toContainText("Size");
  await expect(details).not.toContainText("bytes");

  await expect(delivered(sender, name)).toBeAttached();
  expect(await page.evaluate(() => (globalThis as { pickerCalls?: number }).pickerCalls)).toBe(0);
  expect(downloads).toEqual([]);
});

test("a pasted text over 10,000 characters stays whole and can't be shared until shortened", async ({
  actor,
  leaks,
  canary,
}) => {
  const long = base32Token(canary.fork("long text"), 12_000);
  leaks.watchContent("long text", long);
  const { page: sender } = await actor("sender");
  await sender.goto("/send/secret");
  const field = sender.getByLabel("Your secret");
  const error = sender.locator("#secret-text-error");
  const live = error.locator("[role=status]");
  const add = sender.getByRole("button", { name: "Add", exact: true });
  await expect(live).toBeAttached();
  await expect(live).toBeEmpty();
  // Step 2 stays once shown, so the secret can grow too long after Continue.
  await field.fill("x");
  await continueToLinks(sender);
  await field.fill("");

  await field.focus();
  // The editing path a paste takes; maxlength used to cut it here without a word.
  await sender.keyboard.insertText(long);
  await expect(field).toHaveValue(long);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(error).toHaveText("12,000 of 10,000 characters. Shorten the secret to share it.");
  await expect(live).toHaveText("Shorten the secret to share it.");
  await expect(field).toHaveAccessibleDescription(
    "12,000 of 10,000 characters. Shorten the secret to share it. Up to 10,000 characters.",
  );
  await expect(add).toBeDisabled();
  // Step 1's Continue; step 2's comes after it.
  await expect(sender.getByRole("button", { name: "Continue" }).first()).toBeDisabled();
  await expect(sender.locator("#secret-recipient-name")).toBeDisabled();
  await expect(sender.locator("#secret-recipient-hint")).toHaveText(
    "Shorten the secret to share it.",
  );
  await expect(sender.getByText("Write or paste the secret first.")).toHaveCount(0);

  await field.fill(long.slice(0, 10_000));
  await expect(field).toHaveAttribute("aria-invalid", "false");
  await expect(error).toBeEmpty();
  await expect(field).toHaveAccessibleDescription("Up to 10,000 characters.");
  await expect(add).toBeEnabled();
});

test("a long text grows both boxes to two thirds of the window, and a short one keeps six rows", async ({
  actor,
  leaks,
  canary,
}) => {
  const random = canary.fork("long lines");
  const lines = Array.from({ length: 160 }, () => base32Token(random, 64));
  const long = lines.join("\n").slice(0, 10_000);
  leaks.watchContent("long text", long);
  const box = async (locator: ReturnType<Page["locator"]>) =>
    await locator.evaluate((el) => ({
      height: el.getBoundingClientRect().height,
      line: Number.parseFloat(getComputedStyle(el).lineHeight),
      window: innerHeight,
      scrolls: el.scrollHeight > el.clientHeight,
    }));

  const { page: sender } = await actor("sender");
  // A phone's window for the sender, a laptop's for the recipient.
  await sender.setViewportSize({ width: 390, height: 844 });
  await sender.goto("/send/secret");
  const field = sender.getByLabel("Your secret");
  await field.fill("one line");
  // Six lines, the padding and the border: the height the box had before it grew.
  const short = await box(field);
  expect(short.height).toBeCloseTo(6 * short.line + 18, 0);
  expect(short.scrolls).toBe(false);
  const link = await share(leaks, sender, long, "", makeName(leaks, canary, "Anna"));
  const grown = await box(field);
  expect(grown.height).toBeCloseTo(grown.window * 0.66, 0);
  expect(grown.scrolls).toBe(true);

  const { page } = await openRecipient(actor, link);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Show", exact: true }).click();
  const shown = page.getByRole("region", { name: "The secret", exact: true });
  await expect.poll(() => shown.evaluate((el) => el.textContent)).toBe(long);
  const received = await box(shown);
  expect(received.height).toBeCloseTo(received.window * 0.66, 0);
  expect(received.scrolls).toBe(true);
});

test("declining a text keeps the link working", async ({ actor, leaks, canary }) => {
  const text = makeText(leaks, canary);
  const name = makeName(leaks, canary, "Erik");
  const { page: sender } = await actor("sender");
  await sender.goto("/send/secret");
  const link = await share(leaks, sender, text, "", name);

  const { page } = await openRecipient(actor, link);
  const offer = page.getByRole("heading", { name: "You've been sent a secret" });
  await expect(offer).toBeFocused();
  await expect(page.getByText("Name typed by the sender, not verified.")).toHaveCount(0);
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("heading", { name: "You declined the secret" })).toBeFocused();
  await expect(
    recipientRow(sender, name).getByText(
      `${name}'s link was opened and the secret was declined. The link still works.`,
    ),
  ).toBeVisible();

  await page.getByRole("button", { name: "Show the secret again" }).click();
  await expect(offer).toBeVisible();
  await page.getByRole("button", { name: "Show", exact: true }).click();
  const shown = page.getByRole("region", { name: "The secret", exact: true });
  await expect(shown).toBeVisible();
  await expect.poll(() => shown.evaluate((el) => el.textContent)).toBe(text);
  await expect(delivered(sender, name)).toBeAttached();
});

test("a recipient who loses the sender during the offer sees the text wording", async ({
  actor,
  leaks,
  canary,
}) => {
  const text = makeText(leaks, canary);
  const { page: sender } = await actor("sender");
  await sender.addInitScript(breakableSender);
  await sender.goto("/send/secret");

  const ida = await share(leaks, sender, text, "", makeName(leaks, canary, "Ida"));
  const { page: cut } = await openRecipient(actor, ida, "ida");
  await expect(cut.getByRole("button", { name: "Show", exact: true })).toBeVisible();
  await sender.evaluate(() => (globalThis as { cut?: () => void }).cut?.());
  await expect(cut.getByText("The connection to the sender was lost")).toBeVisible();
  await expect(cut.getByText("The secret wasn't shown.", { exact: true })).toBeVisible();
  await expect(cut.getByText("Nothing was saved.")).toHaveCount(0);

  const greta = await addLink(leaks, sender, makeName(leaks, canary, "Greta"));
  const { page: closed } = await openRecipient(actor, greta, "greta");
  await expect(closed.getByRole("button", { name: "Show", exact: true })).toBeVisible();
  await sender.close();
  await expect(closed.getByText("The sender's page is closed")).toBeVisible();
  await expect(closed.getByText("The secret comes straight from their browser")).toBeVisible();
  await expect(closed.getByText("The file comes straight from their browser")).toHaveCount(0);
});

for (const check of [false, true]) {
  test(`a connection too small to carry a text in one chunk fails the card and sends ${check ? "only INIT and CHECK, after the check" : "nothing"}`, async ({
    actor,
    leaks,
    canary,
  }) => {
    const text = makeText(leaks, canary);
    const name = makeName(leaks, canary, "Hugo");
    const { page: sender } = await actor("sender");
    await sender.addInitScript(() => {
      const g = globalThis as { sent?: number };
      g.sent = 0;
      Object.defineProperty(RTCSctpTransport.prototype, "maxMessageSize", { get: () => 32_831 });
      const send = RTCDataChannel.prototype.send;
      RTCDataChannel.prototype.send = function (this: RTCDataChannel, ...args: unknown[]) {
        g.sent = (g.sent ?? 0) + 1;
        Reflect.apply(send, this, args);
      } as RTCDataChannel["send"];
    });
    await sender.goto("/send/secret");
    await sender.getByLabel("Your secret").fill(text);
    await continueToLinks(sender);
    const link = await addLink(leaks, sender, name, check);

    const { page } = await openRecipient(actor, link);
    if (check) {
      // As for a file: INIT goes and the check runs, so the link's holder can't tell a secret from a file before both confirm.
      await expect(page.getByRole("heading", { name: "Safety number" })).toBeVisible();
      await sender
        .getByRole("dialog", { name: `Safety number for ${name}` })
        .getByRole("button", { name: "It matches" })
        .click();
      await page.getByRole("button", { name: "They said it matches" }).click();
    }
    await expect(
      recipientRow(sender, name).getByText(
        `The secret wasn't sent through ${name}'s link, because its length would have shown on this connection. The link still works.`,
      ),
    ).toBeVisible();
    expect(await sender.evaluate(() => (globalThis as { sent?: number }).sent)).toBe(check ? 2 : 0);
    await expect(page.getByRole("button", { name: "Show", exact: true })).toHaveCount(0);
  });
}

test("a sender who loses the server sees the text wording", async ({ actor }) => {
  const { page: sender } = await actor("sender");
  await sender.addInitScript(() => {
    const g = globalThis as {
      serverOpen?: boolean;
      serverClosed?: boolean;
      dropServer?: () => void;
    };
    const sockets: WebSocket[] = [];
    let dropped = false;
    globalThis.WebSocket = class extends globalThis.WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
        // Closed here, not on open: an open would let the page clear its lost-server timer.
        if (dropped) {
          this.close();
        }
        this.addEventListener("open", () => {
          g.serverOpen = true;
        });
        this.addEventListener("close", () => {
          g.serverClosed = true;
        });
      }
    };
    g.dropServer = () => {
      dropped = true;
      for (const socket of sockets) {
        socket.close();
      }
    };
  });
  await sender.clock.install();
  await sender.goto("/send/secret");
  await sender.waitForFunction(() => (globalThis as { serverOpen?: boolean }).serverOpen === true);
  await sender.evaluate(() => (globalThis as { dropServer?: () => void }).dropServer?.());
  await sender.waitForFunction(
    () => (globalThis as { serverClosed?: boolean }).serverClosed === true,
  );
  // The page waits LOST_AFTER_MS (10 s) before it says so.
  await sender.clock.fastForward(10_000);
  await expect(sender.getByRole("alert")).toHaveText(
    "Lost the connection to the server. Trying to reconnect… Secrets already on their way can finish. Nobody new can connect until it's back, so keep this page open.",
  );
  // It is a bar just below the header, and nothing on the page lies under it.
  const header = await sender.getByRole("banner").boundingBox();
  const bar = await sender.getByRole("alert").boundingBox();
  const title = await sender.getByRole("heading", { level: 1 }).boundingBox();
  expect(header && bar && title).toBeTruthy();
  if (header && bar && title) {
    expect(bar.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
    expect(bar.y).toBeLessThanOrEqual(header.y + header.height + 1);
    expect(bar.width).toBe(header.width);
    expect(title.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  }
});

test("a recipient whose browser can't read the received text is told so, with nothing to copy", async ({
  actor,
  leaks,
  canary,
}) => {
  const text = makeText(leaks, canary);
  const name = makeName(leaks, canary, "Jon");
  const { page: sender } = await actor("sender");
  await sender.goto("/send/secret");
  const link = await share(leaks, sender, text, "", name);

  const { page } = await openRecipient(actor, link);
  const show = page.getByRole("button", { name: "Show", exact: true });
  await expect(show).toBeVisible();
  // decodeText is the only Blob.arrayBuffer() caller on the recipient's side.
  await page.evaluate(() => {
    Blob.prototype.arrayBuffer = () =>
      new Promise((_, reject) => {
        (globalThis as { failRead?: () => void }).failRead = () => reject(new Error("unreadable"));
      });
  });
  await show.click();
  await page.waitForFunction(
    () => (globalThis as { failRead?: () => void }).failRead !== undefined,
  );
  await expect(page.getByRole("button", { name: "Copy secret" })).toBeDisabled();
  await page.evaluate(() => (globalThis as { failRead?: () => void }).failRead?.());
  await expect(page.getByRole("heading", { name: "The secret couldn't be shown" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Copy secret" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  await expect(delivered(sender, name)).toBeAttached();
});
