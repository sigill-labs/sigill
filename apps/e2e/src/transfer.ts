import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { maskAddress } from "@fidant/protocol";
import type { Download, Page } from "@playwright/test";
import {
  canaryFile,
  chooseFile,
  expect,
  test as harness,
  type Leaks,
  type Observed,
  openTraces,
  recipientRow,
} from "./fixtures.ts";
import { base32Token, type CanaryFile, type SeededRandom } from "./leaks/canary.ts";
import type { Allowed } from "./leaks/needles.ts";
import { type Message, mailTo } from "./mail.ts";

export const MiB = 1024 * 1024;

/** Signaling must never carry these: SDP is encrypted before it is relayed. */
const sdpMarkers = ["v=0", "a=fingerprint", "a=ice-ufrag"];

export const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

export interface Demo {
  /** A recorded browser context named `name`, whose page saves files as Blob downloads. */
  open(name: string): Promise<Page>;
}

export const test = harness.extend<{ demo: Demo }>({
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

/** A watched canary file of exactly `size` bytes. */
export function makeFile(leaks: Leaks, canary: SeededRandom, size: number): CanaryFile {
  return leaks.watch(canaryFile(canary.fork("file"), { size }));
}

/** Opens the sender page, runs `setup` on it before it loads, types the sender's name if given, and chooses the file. */
export async function openSender(
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
  await page.getByRole("button", { name: /^Traces/ }).click();
  await expect(page.getByText(sha256Hex(file.bytes))).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  return page;
}

/** Adds a recipient on the sender page and returns their link, with its secret watched. Clicks the safety number button if `check`, else presses Enter, which must make a plain link. */
export async function addRecipient(
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
export async function receive(
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
  await expect(await openTraces(page)).toContainText(
    /Server, Memory, [^:]*: Paired this page with the sender's on link ID/,
  );
  if (sender) {
    await expect(await openTraces(sender)).toContainText(
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
export async function download(page: Page, file: CanaryFile): Promise<Buffer> {
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

export const NUMBER = /^\d{3} \d{3}$/;

/** The sender's dialog that asks about the safety number for `name`. */
export const checkDialog = (sender: Page, name: string) =>
  sender.getByRole("dialog", { name: `Safety number for ${name}` });

/** The safety number in the sender's dialog for `name`, once it shows. */
export async function senderNumber(sender: Page, name: string): Promise<string> {
  const number = checkDialog(sender, name).getByText(NUMBER);
  await expect(number).toBeVisible({ timeout: 30_000 });
  return (await number.textContent()) ?? "";
}

/** The safety number on the recipient page, once it shows. */
export async function recipientNumber(page: Page): Promise<string> {
  await expect(page.getByRole("heading", { name: "Safety number" })).toBeVisible({
    timeout: 30_000,
  });
  const number = page.getByText(NUMBER);
  await expect(number).toBeVisible();
  return (await number.textContent()) ?? "";
}

/** A made-up address for `first`, unique to this run, at a reserved domain. */
export const addressFor = (canary: SeededRandom, first: string) =>
  `${first.toLowerCase()}-${base32Token(canary.fork(`address ${first}`), 8).toLowerCase()}@example.com`;

export interface Emailed {
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
export async function addEmailed(
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
export async function requestCode(page: Page, to: string): Promise<string> {
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

export async function enterCode(page: Page, code: string): Promise<void> {
  await page.getByLabel("Code from the email").fill(code);
  await page.getByRole("button", { name: "Continue" }).click();
}

/** Watches the token the recipient page keeps for the link, which only its frames may carry. */
export async function watchToken(leaks: Leaks, page: Page, emailed: Emailed, name: string) {
  const token = await page.evaluate((id) => sessionStorage.getItem(`token:${id}`), emailed.linkId);
  expect(token).toMatch(/^[\w-]{22}$/);
  leaks.watchKey(`token for ${name}`, token ?? "", "K", {
    link: emailed.linkId,
    frames: ["received token", "sent join"],
  });
  return token ?? "";
}

/** Parsed `t` messages of type `type` that `actor` sent (or received) on /signal. */
export async function messages(
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
