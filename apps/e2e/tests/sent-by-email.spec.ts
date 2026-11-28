// Emailed links: a recipient enters the emailed code and gets the file, an emailed link stops
// working with its sender, and the send page offers an email field only when the server can send
// mail. Most tests need Mailpit and skip without it.

import { readFile } from "node:fs/promises";
import { maskAddress } from "@fidant/protocol";
import type { Page } from "@playwright/test";
import {
  chooseFile,
  continueToLinks,
  delivered,
  expect,
  test as harness,
  makeName,
  recipientRow,
} from "../src/fixtures.ts";
import { base32Token } from "../src/leaks/canary.ts";
import { mailTo } from "../src/mail.ts";
import { serverStderrLog, serverStdoutLog } from "../src/paths.ts";
import { restartServer } from "../src/stack/server.ts";
import {
  addEmailed,
  addRecipient,
  addressFor,
  download,
  enterCode,
  makeFile,
  messages,
  openSender,
  receive,
  requestCode,
  sha256Hex,
  test,
  watchToken,
} from "../src/transfer.ts";

// The 8 MiB transfer and its leak scan take longer than Playwright's default.
test.describe.configure({ timeout: 90_000 });

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
