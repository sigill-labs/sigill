// The safety number: both pages show the same number, each side confirms it from the mouse or the
// keyboard, and a number that differs, expires or fails five times sends nothing. A recipient page
// never reconnects or skips the check by itself.

import type { Locator, Page } from "@playwright/test";
import { delivered, expect, makeName, openTraces, recipientRow } from "../src/fixtures.ts";
import type { Signal } from "../src/interpose.ts";
import {
  addEmailed,
  addRecipient,
  addressFor,
  checkDialog,
  download,
  enterCode,
  makeFile,
  NUMBER,
  openSender,
  receive,
  recipientNumber,
  requestCode,
  senderNumber,
  sha256Hex,
  test,
  watchToken,
} from "../src/transfer.ts";

// Each test's transfers and the leak scan after it can take longer than Playwright's default.
test.describe.configure({ timeout: 90_000 });

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
    // The Traces panel, open beside the page on this wide screen, leaves Escape to the dialog.
    // openSender closed it; it slides out first.
    await expect(sender.getByRole("dialog", { name: "Traces" })).toHaveCount(0);
    const traces = await openTraces(sender);
    await expect(traces).toBeVisible();
    const pages: Page[] = [];
    const numbers: string[] = [];
    for (const [i, name] of names.entries()) {
      const page = await demo.open(`recipient-${i + 1}`);
      await page.goto(links[i] as string);
      pages.push(page);
      numbers.push(await sameNumber(sender, name, page));
      // Put it off, so the dialog is free for the next recipient: once with Escape, once with the button.
      if (i === 0) {
        await sender.keyboard.press("Escape");
      } else {
        await checkDialog(sender, name).getByRole("button", { name: "Not now" }).click();
      }
      await expect(checkDialog(sender, name)).toHaveCount(0);
    }
    await expect(traces).toBeVisible();
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
