// A server restart, like a deploy or a crash: a waiting sender hosts its links again, and
// recipients with an open channel, still connecting or waiting for a late sender get the file.
// Specs run one at a time in file-name order, and for 60 s after a restart the server answers
// `starting` instead of `unknown` for a link nobody hosts (decision 0018). So a spec that expects
// "This link isn't active" for such a link must sort before every spec that restarts the server
// (src/spec-order.test.ts checks it).

import type { Page } from "@playwright/test";
import { delivered, expect, makeName, recipientRow } from "../src/fixtures.ts";
import { restartServer } from "../src/stack/server.ts";
import {
  addRecipient,
  download,
  makeFile,
  messages,
  openSender,
  receive,
  sha256Hex,
  test,
} from "../src/transfer.ts";

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
