// A hostile path between sender and recipient: tampered or replayed data channel frames, altered or
// reflected signals, and someone in the middle with an emailed link's key. Each is refused, with
// nothing downloaded or delivered.

import { randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";
import { delivered, expect, makeName, recipientRow } from "../src/fixtures.ts";
import { commitTo, interpose, signalsOf, tamperSignal } from "../src/interpose.ts";
import {
  addEmailed,
  addRecipient,
  addressFor,
  checkDialog,
  enterCode,
  makeFile,
  openSender,
  recipientNumber,
  requestCode,
  senderNumber,
  test,
} from "../src/transfer.ts";

// The 8 MiB transfer and its leak scan take longer than Playwright's default.
test.describe.configure({ timeout: 90_000 });

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
