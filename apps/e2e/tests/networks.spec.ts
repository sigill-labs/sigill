import {
  constants,
  createHash,
  generateKeyPairSync,
  publicEncrypt,
  randomBytes,
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { setTimeout as sleep } from "node:timers/promises";
import type { Page } from "@playwright/test";
// ponytail: relative imports, not a workspace dependency on the server, for two small functions and a limit.
import { relaySecret } from "../../server/src/relay-secret.ts";
import { LIMITS } from "../../server/src/signaling.ts";
import { turnCredentials } from "../../server/src/turn.ts";
import {
  type Actor,
  canaryFile,
  canaryKey,
  chooseFile,
  continueToLinks,
  delivered as deliveredRow,
  expect,
  type Leaks,
  makeName,
  type Observed,
  test,
} from "../src/fixtures.ts";
import { readPeerConnections, recordPeerConnections, selectedPair } from "../src/ice.ts";
import { base32Token } from "../src/leaks/canary.ts";
import { checkServerLog, serverLogAllowlist } from "../src/leaks/server-log.ts";
import { boxJournal, boxSyslog, serverStdoutLog, signalLog } from "../src/paths.ts";
import { winningJournald } from "../src/stack/box.ts";
import {
  albIp,
  applyRelaySecret,
  boxOrigin,
  captureEdge,
  clientAddresses,
  cutRoute,
  inBox,
  inRelay,
  inSignal,
  pagesIp,
  pauseRelay,
  type RouterMode,
  relayHost,
  relayIp,
  remoteBrowsers,
  renumberSiteB,
  restoreRoute,
  restoreSiteB,
  resumeRelay,
  routerAIp,
  routerBNewIp,
  routerMode,
  sendToRelay,
  serverIp,
  signalClients,
  signalHost,
  signalLogs,
  turnIp,
} from "../src/stack/networks.ts";

// Transfers between browsers in Docker networks behind NAT routers (networks/compose.yaml).
// Run with `pnpm e2e:networks`. Sites: a1 and a2 share site A, b1 is alone in site B.

type Site = keyof typeof remoteBrowsers;

interface Scenario {
  title: string;
  sender: Site;
  recipient: Site;
  /** The mode of router-b. router-a stays a cone NAT. */
  routerB: RouterMode;
  /**
   * The selected candidate pair as `local/remote` for the sender, then the recipient, such as
   * `srflx/srflx srflx/srflx`. A remote candidate is prflx when the peer's check arrives before
   * its candidate does over signaling, so rows accept prflx wherever the remote side is direct.
   * A local relay candidate carries its transport to the TURN server, such as `relay+tls`.
   * Both pages gather a relay candidate where the path has one and never elsewhere, as peer.ts
   * adds TURN only as a fallback.
   * `none`: the row pauses coturn, so the browsers cannot connect at all.
   */
  path: RegExp | "none";
  /** Send a larger file and check that both sides report progress honestly along the way. */
  progress?: true;
  /** Share a secret from /send/secret instead of a file. Not with `progress`. */
  secret?: true;
  /** Both browsers are in site A: check that only signaling and STUN crossed its edge. */
  staysInSite?: true;
}

const scenarios: Scenario[] = [
  {
    title: "same network",
    sender: "a1",
    recipient: "a2",
    routerB: "cone",
    path: /^host\/(host|prflx) host\/(host|prflx)$/,
    staysInSite: true,
  },
  {
    title: "home routers (cone)",
    sender: "a1",
    recipient: "b1",
    routerB: "cone",
    path: /^srflx\/(srflx|prflx) srflx\/(srflx|prflx)$/,
  },
  {
    title: "symmetric NAT",
    sender: "a1",
    recipient: "b1",
    routerB: "symmetric",
    path: /relay/,
  },
  {
    title: "UDP blocked",
    sender: "a1",
    recipient: "b1",
    routerB: "udp-blocked",
    path: / relay\+tls\/\S+$/,
  },
  {
    title: "only TCP 443",
    sender: "a1",
    recipient: "b1",
    routerB: "tcp-443",
    path: / relay\+tls\/\S+$/,
  },
  {
    title: "a secret through the relay (only TCP 443)",
    sender: "a1",
    recipient: "b1",
    routerB: "tcp-443",
    path: / relay\+tls\/\S+$/,
    secret: true,
  },
  {
    title: "relay down",
    sender: "a1",
    recipient: "b1",
    routerB: "symmetric",
    path: "none",
  },
  {
    title: "slow lossy link",
    sender: "a1",
    recipient: "b1",
    routerB: "lossy",
    path: /^srflx\/(srflx|prflx) srflx\/(srflx|prflx)$/,
    progress: true,
  },
];

const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** The selected pair of the page's last peer connection, as `local/remote` candidate types. */
async function pathOf(page: Page): Promise<string> {
  const pairs = (await readPeerConnections(page)).map((pc) => selectedPair(pc.stats));
  const pair = pairs.findLast((p) => p?.local && p.remote);
  if (!pair) {
    return "none";
  }
  const transport = pair.relayProtocol ? `+${pair.relayProtocol}` : "";
  return `${pair.local}${transport}/${pair.remote}`;
}

/** Watches the ICE password of every peer connection the page made. */
async function watchIcePasswords(leaks: Leaks, name: string, page: Page): Promise<void> {
  for (const pc of await readPeerConnections(page)) {
    // Recorded only once the connection is up.
    if (pc.pwd) {
      leaks.watchKey(`${name} ICE pwd`, pc.pwd);
    }
  }
}

/** The recorder saw each browser's traffic, so the leak scan had something to scan. */
async function expectSignaling(observed: (name: string) => Observed, baseURL: string | undefined) {
  for (const name of ["sender", "recipient"]) {
    const records = await observed(name).records();
    const types = new Set(records.map((record) => record.type));
    expect(
      records.some((r) => r.type === "request" && r.url.startsWith(`${baseURL}/`)),
      `${name} page request`,
    ).toBe(true);
    expect(
      records.some((r) => r.type === "websocket-open" && new URL(r.url).pathname === "/signal"),
      `${name} websocket-open on /signal`,
    ).toBe(true);
    expect(types.has("frame-sent"), `${name} frame-sent`).toBe(true);
    expect(types.has("frame-received"), `${name} frame-received`).toBe(true);
  }
}

const verifiedText = "this is exactly the file that was sent";

/**
 * Samples both pages until the recipient shows the verified text, and checks that progress was
 * honest: the recipient's bar never went back or past the file, showed at least three values in
 * between, and the sender said delivered only once the recipient had verified the file.
 */
async function expectHonestProgress(
  sender: Page,
  recipient: Page,
  size: number,
  name: string,
): Promise<void> {
  const bar = recipient.getByLabel("Download progress", { exact: true });
  const delivered = deliveredRow(sender, name);
  const verified = recipient.getByText(verifiedText);
  const values: number[] = [];
  const deadline = Date.now() + 60_000;
  for (;;) {
    // Sender first: the recipient's verified text never goes away, so a delivered sender
    // followed by an unverified recipient means the sender was early.
    const senderDelivered = (await delivered.count()) > 0;
    const recipientVerified = await verified.isVisible();
    expect(
      senderDelivered && !recipientVerified,
      "sender delivered before recipient verified",
    ).toBe(false);
    if (recipientVerified) {
      break;
    }
    const value = (
      await bar.evaluateAll((els) => els.map((el) => (el as HTMLProgressElement).value))
    )[0];
    if (value !== undefined) {
      expect(value, "progress went back").toBeGreaterThanOrEqual(values.at(-1) ?? 0);
      expect(value, "progress past the file").toBeLessThanOrEqual(size);
      values.push(value);
    }
    expect(Date.now(), "recipient verified in time").toBeLessThan(deadline);
    await sleep(150);
  }
  const between = new Set(values.filter((v) => v > 0 && v < size));
  expect(
    between.size,
    `distinct values between 0 and size: ${values.join(",")}`,
  ).toBeGreaterThanOrEqual(3);
  await expect(delivered).toBeAttached();
}

const sizeOf = async (file: string) => (await readFile(file).catch(() => Buffer.alloc(0))).length;

test.describe.configure({ timeout: 90_000 });

test("the leak scan sees what reaches coturn", async ({ leaks, canary }) => {
  const file = leaks.watch(canaryFile(canary.fork("file"), { size: 4_001 }));
  const key = canaryKey(canary.fork("key"));
  leaks.watchKey("planted key", key.text);
  await sendToRelay(Buffer.concat([file.bytes.subarray(1000, 1200), Buffer.from(key.text)]));

  const found = (await leaks.scan())
    .filter((finding) => finding.point === "observations/run/coturn.pcap")
    .map((finding) => finding.label);
  expect(found).toEqual(expect.arrayContaining(["file#1", "planted key text"]));
  leaks.expectLeaks();
});

for (const row of scenarios) {
  test.describe(row.title, () => {
    test.use({
      remoteBrowsers: {
        sender: remoteBrowsers[row.sender],
        recipient: remoteBrowsers[row.recipient],
      },
    });

    const path = row.path;
    if (path === "none") {
      // Paused, not stopped: coturn keeps its address, so packets to it go unanswered.
      test.afterEach(resumeRelay);

      test("says it couldn't connect, and nothing goes another way", async ({
        actor,
        observed,
        leaks,
        canary,
        baseURL,
      }) => {
        await routerMode("router-b", row.routerB);
        await pauseRelay();
        const stdoutStart = await sizeOf(serverStdoutLog);
        const file = leaks.watch(canaryFile(canary.fork("file"), { size: 300_001 }));
        const name = makeName(leaks, canary, "Anna");

        const sender = await actor("sender");
        await recordPeerConnections(sender.context);
        await sender.page.goto("/send");
        await chooseFile(sender.page, {
          name: file.name,
          mimeType: file.mime,
          buffer: file.bytes,
        });
        await sender.page.getByLabel("Who is it for?").fill(name);
        await sender.page.getByRole("button", { name: "Add recipient", exact: true }).click();
        const link =
          (await sender.page.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
        leaks.watchKey("link secret", new URL(link).hash.slice(1));

        const recipient = await actor("recipient");
        await recordPeerConnections(recipient.context);
        let downloads = 0;
        recipient.page.on("download", () => downloads++);
        await recipient.page.goto(link);
        // Exact: the problem's title alone, not a longer text that contains it.
        await expect(
          recipient.page.getByText("Couldn't connect to the sender's computer", { exact: true }),
        ).toBeVisible({ timeout: 45_000 });
        await expect(recipient.page.getByRole("button", { name: "Download" })).toHaveCount(0);
        expect(downloads).toBe(0);
        expect(await pathOf(sender.page)).toBe("none");
        expect(await pathOf(recipient.page)).toBe("none");
        // The sender learns someone tried, and the link stays on offer.
        await expect(
          sender.page
            .getByRole("list", { name: "Recipients" })
            .getByText(`${name}'s link was opened but couldn't connect to your computer.`),
        ).toBeVisible({ timeout: 30_000 });
        await expect(sender.page.getByLabel(`Link for ${name}`, { exact: true })).toBeVisible();

        // The sender reported the failed path; no fallback carried the file.
        await expect
          .poll(async () =>
            (await readFile(serverStdoutLog))
              .subarray(stdoutStart)
              .toString()
              .split("\n")
              .includes('{"event":"path","path":"failed"}'),
          )
          .toBe(true);
        await expectSignaling(observed, baseURL);
      });
      return;
    }

    const what = row.secret ? "shares the secret" : "transfers the file";
    test(`${what} on the expected path`, async ({ actor, observed, leaks, canary, baseURL }) => {
      await routerMode("router-b", row.routerB);
      if (row.secret && row.progress) {
        throw new Error(`${row.title}: a secret has no progress`);
      }
      // ponytail: 512 KiB: SCTP over this link moves about 50 KB/s, and it still shows 10 steps.
      const size = row.progress ? 512 * 1024 + 1 : 300_001;
      const name = makeName(leaks, canary, "Anna");
      const edge = row.staysInSite ? await captureEdge("router-a") : undefined;

      try {
        const sender = await actor("sender");
        await recordPeerConnections(sender.context);
        // The secret's text, or the file's SHA-256.
        let sent: string;
        if (row.secret) {
          sent = base32Token(canary.fork("text"), 64);
          leaks.watchContent("text", sent);
          await sender.page.goto("/send/secret");
          await sender.page.getByLabel("Your secret").fill(sent);
          await continueToLinks(sender.page);
        } else {
          const file = leaks.watch(canaryFile(canary.fork("file"), { size }));
          sent = sha256Hex(file.bytes);
          await sender.page.goto("/send");
          await chooseFile(sender.page, {
            name: file.name,
            mimeType: file.mime,
            buffer: file.bytes,
          });
        }
        await sender.page.getByLabel("Who is it for?").fill(name);
        await sender.page.getByRole("button", { name: "Add recipient", exact: true }).click();
        const link =
          (await sender.page.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
        leaks.watchKey("link secret", new URL(link).hash.slice(1));

        const recipient = await actor("recipient");
        await recordPeerConnections(recipient.context);
        await recipient.page.goto(link);
        if (row.secret) {
          const show = recipient.page.getByRole("button", { name: "Show", exact: true });
          await expect(show).toBeVisible({ timeout: 45_000 });
          await show.click();
          await expect(
            recipient.page.getByRole("region", { name: "The secret", exact: true }),
          ).toHaveJSProperty("textContent", sent, { timeout: 60_000 });
          await expect(deliveredRow(sender.page, name)).toBeAttached();
        } else {
          const downloading = recipient.page.waitForEvent("download", { timeout: 60_000 });
          const downloadButton = recipient.page.getByRole("button", { name: "Download" });
          await expect(downloadButton).toBeVisible({ timeout: 45_000 });
          await downloadButton.click();
          if (row.progress) {
            await expectHonestProgress(sender.page, recipient.page, size, name);
          }
          await expect(recipient.page.getByText(verifiedText)).toBeVisible({ timeout: 60_000 });
          // path() is not available from a remote browser.
          const download = await downloading;
          expect(sha256Hex(await buffer(await download.createReadStream()))).toBe(sent);
        }

        await expect
          .poll(async () => `${await pathOf(sender.page)} ${await pathOf(recipient.page)}`)
          .toMatch(path);
        for (const [name, page] of [
          ["sender", sender.page],
          ["recipient", recipient.page],
        ] as const) {
          const gathered = (await readPeerConnections(page)).flatMap((pc) => pc.gathered);
          expect(gathered.includes("relay"), `${name} gathered ${gathered}`).toBe(
            path.source.includes("relay"),
          );
        }
        await watchIcePasswords(leaks, "sender", sender.page);
        await watchIcePasswords(leaks, "recipient", recipient.page);

        if (edge) {
          await edge.stop();
          // TLS to the server, and STUN Binding to coturn: a UDP payload with STUN's magic cookie at
          // byte 4 and the Binding method in its type, whatever the class. DTLS never has the cookie,
          // and TURN messages, whose Send and Data indications carry peer data, have other methods.
          const signaling = `tcp and host ${serverIp} and port 443`;
          const stun = `udp and host ${turnIp} and port 3478 and udp[12:4] = 0x2112a442 and udp[8:2] & 0x3eef = 0x0001`;
          expect(await edge.read(signaling), "signaling crossed the edge").not.toEqual([]);
          expect(await edge.read(stun), "STUN crossed the edge").not.toEqual([]);
          // ARP and link-scope IPv6 multicast (ff02::/16, such as router
          // solicitations on CI's runners) stay on the link and carry no peer traffic.
          const link = "arp or (ip6 and dst net ff02::/16)";
          expect(await edge.read(`not (${link}) and not (${signaling}) and not (${stun})`)).toEqual(
            [],
          );
        }
      } finally {
        await edge?.stop();
      }

      await expectSignaling(observed, baseURL);
    });
  });
}

// Decision 0031: a route that drops mid-transfer and comes back is recovered by an ICE restart on
// the same connection. The sender refuses the relay, so only the restored route can carry the file.
test.describe("a route cut mid-transfer", () => {
  test.use({ remoteBrowsers: { sender: remoteBrowsers.a1, recipient: remoteBrowsers.b1 } });

  test("is recovered by an ICE restart, and the file arrives without starting over", async ({
    actor,
    observed,
    leaks,
    canary,
    baseURL,
  }) => {
    await routerMode("router-b", "lossy");
    const size = 1024 * 1024 + 1;
    const file = leaks.watch(canaryFile(canary.fork("file"), { size }));
    const name = makeName(leaks, canary, "Anna");

    const sender = await actor("sender");
    await recordPeerConnections(sender.context);
    await sender.page.goto("/send");
    await chooseFile(sender.page, { name: file.name, mimeType: file.mime, buffer: file.bytes });
    await sender.page.getByText("Connection options", { exact: true }).press("Enter");
    await sender.page.getByLabel("Use our relay if needed").uncheck();
    await sender.page.getByLabel("Who is it for?").fill(name);
    await sender.page.getByRole("button", { name: "Add recipient", exact: true }).click();
    const link =
      (await sender.page.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
    leaks.watchKey("link secret", new URL(link).hash.slice(1));

    const recipient = await actor("recipient");
    await recordPeerConnections(recipient.context);
    await recipient.page.goto(link);
    const downloading = recipient.page.waitForEvent("download", { timeout: 60_000 });
    const downloadButton = recipient.page.getByRole("button", { name: "Download" });
    await expect(downloadButton).toBeVisible({ timeout: 45_000 });
    await downloadButton.click();

    const joins = async () =>
      (await observed("recipient").records()).flatMap((record) =>
        record.type === "frame-sent" && JSON.parse(record.payload).t === "join"
          ? [record.payload]
          : [],
      );
    const received = async () =>
      (
        await recipient.page
          .getByLabel("Download progress", { exact: true })
          .evaluateAll((els) => els.map((el) => (el as HTMLProgressElement).value))
      )[0] ?? 0;
    const verified = recipient.page.getByText(verifiedText);

    // Samples until the recipient verified the file: its progress must never go back.
    const progress = expectHonestProgress(sender.page, recipient.page, size, name);
    // Awaited below, after the route is back.
    progress.catch(() => {});
    await expect.poll(received, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await joins()).toHaveLength(1);
    // The containers are shared across the run, so the route comes back whatever happens here.
    let stalled = 0;
    try {
      await cutRoute();
      // The recipient's browser reports the drop and its page joins again. Restored at once: the
      // sender's page must get that `joined` before its own browser reports `failed`.
      await expect
        .poll(async () => (await joins()).length, { timeout: 30_000 })
        .toBeGreaterThanOrEqual(2);
      // The route is cut, so nothing more arrives: the level to beat once it is back.
      stalled = await received();
    } finally {
      await restoreRoute();
    }

    // Connected again on the same connection.
    await expect
      .poll(
        async () => {
          const events = (await readPeerConnections(recipient.page))[0]?.events ?? [];
          const dropped = events.findIndex((event) => event.state === "disconnected");
          return dropped !== -1 && events.at(-1)?.state === "connected";
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    // The rest of the file arrives over the restored route, on top of what came before the cut.
    // Not "still unfinished": that would race the transfer's own speed.
    await expect.poll(received, { timeout: 30_000 }).toBeGreaterThan(stalled);

    await progress;
    await expect(verified).toBeVisible();
    const download = await downloading;
    expect(sha256Hex(await buffer(await download.createReadStream()))).toBe(sha256Hex(file.bytes));
    await expect(
      sender.page.getByText(`The transfer through ${name}'s link was interrupted`),
    ).toHaveCount(0);

    // One attempt: the same `join` again, never a new one.
    const sentJoins = await joins();
    expect(sentJoins.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sentJoins).size, "every join is the first one again").toBe(1);

    for (const [who, page] of [
      ["sender", sender.page],
      ["recipient", recipient.page],
    ] as const) {
      // One connection per page, which got a new ICE password: the restart, not a new attempt
      // and not a route that came back by itself.
      const connections = await readPeerConnections(page);
      expect(connections.length, `${who} peer connections`).toBe(1);
      const events = connections[0]?.events ?? [];
      const before = events.find((event) => event.state === "connected")?.pwd;
      const after = events.at(-1);
      expect(before, `${who} ICE password before the cut`).toBeTruthy();
      expect(after?.state, `${who} ends connected`).toBe("connected");
      expect(after?.pwd, `${who} ICE password after the cut`).toBeTruthy();
      expect(after?.pwd, `${who} ICE password after the cut`).not.toBe(before);
      for (const pwd of new Set(events.map((event) => event.pwd))) {
        if (pwd) {
          leaks.watchKey(`${who} ICE pwd`, pwd);
        }
      }
      const gathered = (await readPeerConnections(page)).flatMap((pc) => pc.gathered);
      expect(gathered, `${who} gathered`).not.toContain("relay");
    }
    await expect
      .poll(async () => `${await pathOf(sender.page)} ${await pathOf(recipient.page)}`)
      .toMatch(/^srflx\/(srflx|prflx) srflx\/(srflx|prflx)$/);
    await expectSignaling(observed, baseURL);
  });
});

// Decision 0033: site B's public address changes mid-transfer, so b1's signaling socket and its
// peer-to-peer flow both die at once. Its page takes its attempt back on a new socket, and the
// sender's ICE restart (0031) finds the new address. On the pages of the edge function, so b1's
// socket goes through alb, the stand-in for the load balancer, as it will on fidant.se.
test.describe("a public address that changes mid-transfer", () => {
  test.use({
    baseURL: boxOrigin,
    hostRules: `MAP fidant.se ${pagesIp}`,
    remoteBrowsers: { sender: remoteBrowsers.a1, recipient: remoteBrowsers.b1 },
  });

  test("is recovered by a socket takeover and an ICE restart, without starting over", async ({
    actor,
    observed,
    leaks,
    canary,
    baseURL,
  }) => {
    await routerMode("router-b", "lossy");
    // As in the route cut: about 20 s over `lossy`, so the change lands mid-transfer, and the
    // outage still fits the 60 s download wait and expectHonestProgress's deadline.
    const size = 1024 * 1024 + 1;
    const file = leaks.watch(canaryFile(canary.fork("file"), { size }));
    const name = makeName(leaks, canary, "Anna");

    const sender = await actor("sender");
    await recordPeerConnections(sender.context);
    await sender.page.goto("/send");
    await chooseFile(sender.page, { name: file.name, mimeType: file.mime, buffer: file.bytes });
    // Only the new address can carry the rest of the file, not a relay.
    await sender.page.getByText("Connection options", { exact: true }).press("Enter");
    await sender.page.getByLabel("Use our relay if needed").uncheck();
    await sender.page.getByLabel("Who is it for?").fill(name);
    await sender.page.getByRole("button", { name: "Add recipient", exact: true }).click();
    const link =
      (await sender.page.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
    leaks.watchKey("link secret", new URL(link).hash.slice(1));

    const recipient = await actor("recipient");
    await recordPeerConnections(recipient.context);
    await recipient.page.goto(link);
    const downloading = recipient.page.waitForEvent("download", { timeout: 60_000 });
    const downloadButton = recipient.page.getByRole("button", { name: "Download" });
    await expect(downloadButton).toBeVisible({ timeout: 45_000 });
    await downloadButton.click();

    const frames = async (who: string, direction: "frame-sent" | "frame-received") =>
      (await observed(who).records()).flatMap((record) =>
        record.type === direction && !record.base64
          ? [JSON.parse(record.payload) as Record<string, unknown> & { t: string }]
          : [],
      );
    const sockets = async (who: string) =>
      (await observed(who).records()).filter((record) => record.type === "websocket-open");
    const received = async () =>
      (
        await recipient.page
          .getByLabel("Download progress", { exact: true })
          .evaluateAll((els) => els.map((el) => (el as HTMLProgressElement).value))
      )[0] ?? 0;

    const progress = expectHonestProgress(sender.page, recipient.page, size, name);
    // Awaited below, once the file is in.
    progress.catch(() => {});
    await expect.poll(received, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await sockets("recipient")).toHaveLength(1);

    // The routers are shared across the run, so site B gets its address back whatever happens.
    const edge = await captureEdge("router-b");
    let stalled = 0;
    try {
      await renumberSiteB();
      // A new socket from the new address, which took the attempt back.
      await expect
        .poll(async () => (await sockets("recipient")).length, { timeout: 45_000 })
        .toBe(2);
      stalled = await received();
      await expect
        .poll(
          async () =>
            (await frames("recipient", "frame-sent")).filter((m) => m.t === "resume").length,
          {
            timeout: 15_000,
          },
        )
        .toBe(1);
      // The rest of the file arrives over the new address, on top of what came before.
      await expect.poll(received, { timeout: 45_000 }).toBeGreaterThan(stalled);
      await progress;
      await edge.stop();

      // 0033's assumption: the old TCP connection's next segment, now from the new address,
      // matched nothing at alb and got a reset (RFC 9293, section 3.10.7.1).
      expect(
        await edge.read(
          `tcp and src host ${albIp} and src port 443 and dst host ${routerBNewIp} and tcp[tcpflags] & tcp-rst != 0`,
        ),
        "a reset from alb to the new address",
      ).not.toEqual([]);
      // The new socket and the peer-to-peer flow left from the new address.
      expect(
        await edge.read(`tcp and src host ${routerBNewIp} and dst host ${albIp} and dst port 443`),
        "signaling from the new address",
      ).not.toEqual([]);
      expect(
        await edge.read(`udp and src host ${routerBNewIp} and dst host ${routerAIp}`),
        "peer-to-peer from the new address",
      ).not.toEqual([]);

      // Checked before site B gets its address back: the recipient's page keeps its connection
      // open for a few seconds after the file, and the restore would break its route again.
      await expect(recipient.page.getByText(verifiedText)).toBeVisible();
      const download = await downloading;
      expect(sha256Hex(await buffer(await download.createReadStream()))).toBe(
        sha256Hex(file.bytes),
      );
      await expect(recipient.page.getByRole("button", { name: "Try again" })).toHaveCount(0);
      await expect(
        sender.page.getByText(`The transfer through ${name}'s link was interrupted`),
      ).toHaveCount(0);
      for (const who of ["sender", "recipient"]) {
        const hosts = new Set((await sockets(who)).map((record) => new URL(record.url).host));
        expect([...hosts], `${who} socket hosts`).toEqual([signalHost]);
      }
      expect(await sockets("sender"), "sender sockets").toHaveLength(1);

      // One attempt: every join is the first one again, and every message names one attempt.
      const sentByRecipient = await frames("recipient", "frame-sent");
      const joins = sentByRecipient.filter((m) => m.t === "join").map((m) => JSON.stringify(m));
      expect(new Set(joins).size, "every join is the first one again").toBe(1);
      const got = {
        sender: await frames("sender", "frame-received"),
        recipient: await frames("recipient", "frame-received"),
      };
      expect(
        got.recipient.filter((m) => m.t === "host-gone"),
        "host-gone",
      ).toHaveLength(0);
      const attempts = new Set(
        [...got.sender, ...got.recipient, ...sentByRecipient]
          .filter((m) => ["join", "joined", "resume"].includes(m.t))
          .map((m) => m.attempt),
      );
      expect([...attempts], "attempt IDs").toHaveLength(1);

      for (const [who, page] of [
        ["sender", sender.page],
        ["recipient", recipient.page],
      ] as const) {
        // One connection per page, which got a new ICE password: the restart, not a new attempt.
        const connections = await readPeerConnections(page);
        expect(connections.length, `${who} peer connections`).toBe(1);
        const events = connections[0]?.events ?? [];
        const before = events.find((event) => event.state === "connected")?.pwd;
        const after = events.at(-1);
        expect(before, `${who} ICE password before the change`).toBeTruthy();
        expect(after?.state, `${who} ends connected`).toBe("connected");
        expect(after?.pwd, `${who} ICE password after the change`).toBeTruthy();
        expect(after?.pwd, `${who} ICE password after the change`).not.toBe(before);
        for (const pwd of new Set(events.map((event) => event.pwd))) {
          if (pwd) {
            leaks.watchKey(`${who} ICE pwd`, pwd);
          }
        }
        expect(
          connections.flatMap((pc) => pc.gathered),
          `${who} gathered`,
        ).not.toContain("relay");
      }
      await expect
        .poll(async () => `${await pathOf(sender.page)} ${await pathOf(recipient.page)}`)
        .toMatch(/^srflx\/(srflx|prflx) srflx\/(srflx|prflx)$/);
    } finally {
      try {
        await edge.stop();
      } finally {
        await restoreSiteB();
      }
    }

    // Each resume token may appear only in the `resume` frames about its link, and the signaling
    // container logs a `resumed` line but never a token.
    const tokens = [
      ...(await frames("sender", "frame-received")),
      ...(await frames("recipient", "frame-received")),
    ].flatMap((m) =>
      m.t === "resume" && typeof m.token === "string"
        ? [{ token: m.token, link: String(m.link) }]
        : [],
    );
    expect(tokens, "resume tokens handed out").toHaveLength(3);
    let lines: string[] = [];
    await expect
      .poll(async () => {
        const logs = await signalLogs();
        await writeFile(signalLog, logs);
        lines = logs.split("\n").filter(Boolean);
        return lines.some((line) => line.startsWith('{"event":"resumed"'));
      })
      .toBe(true);
    expect(checkServerLog(lines, serverLogAllowlist)).toEqual([]);
    for (const [index, { token, link: id }] of tokens.entries()) {
      leaks.watchKey(`resume token ${index}`, token, "K", {
        link: id,
        frames: ["received resume", "sent resume"],
      });
      expect(
        lines.some((line) => line.includes(token)),
        `resume token ${index} in the log`,
      ).toBe(false);
    }
    await expectSignaling(observed, baseURL);
  });
});

/**
 * One `journalctl -o json --all` entry. MESSAGE is a byte array when it is not valid UTF-8 text;
 * without --all it would also be null when over 4096 bytes.
 */
interface JournalEntry {
  MESSAGE?: string | number[] | null;
  _SYSTEMD_UNIT?: string;
}

/** A missing MESSAGE throws, so a line the checks cannot read fails the test instead of passing them. */
const messageOf = (entry: JournalEntry) => {
  if (typeof entry.MESSAGE === "string") {
    return entry.MESSAGE;
  }
  if (Array.isArray(entry.MESSAGE)) {
    return Buffer.from(entry.MESSAGE).toString("utf8");
  }
  throw new Error(`journal entry without MESSAGE: ${JSON.stringify(entry).slice(0, 200)}`);
};

/** Matches the address on its own, so 198.51.100.2 does not match 198.51.100.20. */
const addressPattern = (ip: string) => new RegExp(`(?<![\\d.])${ip.replaceAll(".", "\\.")}(?!\\d)`);

// The POC box (networks/box): what its journal and /var/log/syslog hold after one relayed
// transfer. /privacy promises the journal is the only log store and keeps lines 29 days.
test.describe("the box", () => {
  test.use({
    baseURL: boxOrigin,
    remoteBrowsers: { sender: remoteBrowsers.a1, recipient: remoteBrowsers.b1 },
  });

  test("logs a relayed transfer only to its journal, within the allowlist", async ({
    actor,
    observed,
    leaks,
    canary,
    baseURL,
  }) => {
    await routerMode("router-b", "symmetric");
    const file = leaks.watch(canaryFile(canary.fork("file"), { size: 300_001 }));
    const name = makeName(leaks, canary, "Anna");

    const sender = await actor("sender");
    await recordPeerConnections(sender.context);
    await sender.page.goto("/send");
    await chooseFile(sender.page, {
      name: file.name,
      mimeType: file.mime,
      buffer: file.bytes,
    });
    await sender.page.getByLabel("Who is it for?").fill(name);
    await sender.page.getByRole("button", { name: "Add recipient", exact: true }).click();
    const link =
      (await sender.page.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
    leaks.watchKey("link secret", new URL(link).hash.slice(1));

    const recipient = await actor("recipient");
    await recordPeerConnections(recipient.context);
    await recipient.page.goto(link);
    const downloading = recipient.page.waitForEvent("download", { timeout: 60_000 });
    const downloadButton = recipient.page.getByRole("button", { name: "Download" });
    await expect(downloadButton).toBeVisible({ timeout: 45_000 });
    await downloadButton.click();
    await expect(recipient.page.getByText(verifiedText)).toBeVisible({ timeout: 60_000 });
    const download = await downloading;
    expect(sha256Hex(await buffer(await download.createReadStream()))).toBe(sha256Hex(file.bytes));
    // Only turn.fidant.se is offered, and Chrome resolves it for TCP only, so this is TURN over TLS.
    await expect
      .poll(async () => `${await pathOf(sender.page)} ${await pathOf(recipient.page)}`)
      .toMatch(/relay\+tls\//);
    await watchIcePasswords(leaks, "sender", sender.page);
    await watchIcePasswords(leaks, "recipient", recipient.page);
    await expectSignaling(observed, baseURL);
    const userAgents = await Promise.all(
      [sender.page, recipient.page].map((page) => page.evaluate(() => navigator.userAgent)),
    );

    // The path report is the last line the server logs for a transfer.
    let journal = "";
    const entries = () =>
      journal
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as JournalEntry);
    const fidantLines = () =>
      entries()
        .filter((entry) => entry._SYSTEMD_UNIT === "fidant.service")
        .map(messageOf);
    await expect
      .poll(async () => {
        journal = await inBox(
          ..."journalctl -o json --all --no-pager -u fidant -u haproxy -u caddy -u coturn".split(
            " ",
          ),
        );
        // The decoded messages as plain lines, which is what the leak scanner reads; JSON
        // escapes and decimal byte arrays would hide a canary from it. Kept on every attempt.
        // A binary MESSAGE goes in as hex: the scanner reads logs as UTF-8, which would mangle
        // raw file bytes, and it matches hex views.
        await writeFile(
          boxJournal,
          `${entries()
            .map((entry) =>
              Array.isArray(entry.MESSAGE)
                ? Buffer.from(entry.MESSAGE).toString("hex")
                : messageOf(entry),
            )
            .join("\n")}\n`,
        );
        return fidantLines().some((line) => line.startsWith('{"event":"path"'));
      })
      .toBe(true);

    // Straight to rsyslog's socket: journald forwards nothing, so this proves rsyslog writes.
    const probe = randomBytes(8).toString("hex");
    await inBox("logger", "-u", "/run/systemd/journal/syslog", "-t", "fidant-e2e-probe", probe);
    let syslog = "";
    await expect
      .poll(async () => {
        syslog = await inBox("cat", "/var/log/syslog");
        await writeFile(boxSyslog, syslog);
        return syslog.includes(probe);
      })
      .toBe(true);

    const services =
      /\s(node|haproxy|caddy|turnserver|coturn)(\[\d+\])?:|(fidant|haproxy|caddy|coturn)\.service/;
    expect(syslog.split("\n").filter((line) => services.test(line))).toEqual([]);

    const { files, settings } = winningJournald(
      await inBox("systemd-analyze", "cat-config", "systemd/journald.conf"),
    );
    expect(files).toEqual(
      expect.arrayContaining([
        "/usr/lib/systemd/journald.conf.d/syslog.conf",
        "/etc/systemd/journald.conf.d/zz-retention.conf",
      ]),
    );
    expect(Object.fromEntries(settings)).toMatchObject({
      ForwardToSyslog: "no",
      MaxRetentionSec: "29day",
      MaxFileSec: "1day",
    });

    // Every line of the app server is an allowlisted JSON object; the banner goes only to a TTY.
    const lines = fidantLines();
    expect(checkServerLog(lines, serverLogAllowlist)).toEqual([]);
    const events = new Set(lines.map((line) => (JSON.parse(line) as { event: string }).event));
    expect([...events]).toEqual(expect.arrayContaining(["joined", "path"]));

    const addresses = await clientAddresses();
    expect(addresses.length).toBeGreaterThan(0);
    const messages = entries().map(messageOf);
    for (const ip of addresses) {
      expect(
        messages.filter((m) => addressPattern(ip).test(m)),
        ip,
      ).toEqual([]);
    }
    for (const agent of [...userAgents, "Mozilla/"]) {
      expect(
        messages.filter((m) => m.includes(agent)),
        agent,
      ).toEqual([]);
    }
  });
});

/** The types of the candidates a page gathers with `server`, and the codes of its candidate errors. */
function gather(page: Page, server: RTCIceServer): Promise<{ types: string[]; errors: number[] }> {
  return page.evaluate(async (iceServer) => {
    // A certificate of our own, and the wait for it: see relayedChannel.
    const certificates = [
      await RTCPeerConnection.generateCertificate({
        name: "ECDSA",
        namedCurve: "P-256",
      } as EcKeyGenParams),
    ];
    const pc = new RTCPeerConnection({ iceServers: [iceServer], certificates });
    await pc.getStats();
    const types: string[] = [];
    const errors: number[] = [];
    pc.addEventListener("icecandidate", ({ candidate }) => {
      if (candidate?.type) {
        types.push(candidate.type);
      }
    });
    pc.addEventListener("icecandidateerror", (event) => errors.push(event.errorCode));
    const complete = new Promise<void>((resolve) => {
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          resolve();
        }
      });
    });
    pc.createDataChannel("probe");
    await pc.setLocalDescription();
    await complete;
    pc.close();
    return { types, errors };
  }, server);
}

type RelayGlobals = typeof globalThis & {
  relay?: { pc: RTCPeerConnection; channel?: RTCDataChannel; received?: Promise<string> };
};

/** Opens both peers on the app's origin, a secure context, recording their peer connections. */
async function relayPeers(actor: (name: string) => Promise<Actor>): Promise<[Page, Page]> {
  const open = async (name: string) => {
    const { context, page } = await actor(name);
    await recordPeerConnections(context);
    await page.goto("/");
    return page;
  };
  return [await open("sender"), await open("recipient")];
}

/** Connects the two pages over a relay-only data channel and sends 64 KiB through it. */
async function relayedChannel(
  sender: Page,
  recipient: Page,
  ice: RTCIceServer,
): Promise<{ path: string; echoed: boolean }> {
  const config: RTCConfiguration = { iceServers: [ice], iceTransportPolicy: "relay" };
  // Each callback runs in a page, so it repeats the helpers it needs.
  // Each connection gets a certificate made beforehand and waits for a getStats round trip before
  // its first description. Chromium hands even a supplied certificate to the transport
  // asynchronously, and an offer set before it arrives fails with "Fingerprint provided but no
  // identity available" (FID-274, FID-194).
  const offer = await sender.evaluate(async (config) => {
    const certificates = [
      await RTCPeerConnection.generateCertificate({
        name: "ECDSA",
        namedCurve: "P-256",
      } as EcKeyGenParams),
    ];
    const pc = new RTCPeerConnection({ ...config, certificates });
    await pc.getStats();
    (globalThis as RelayGlobals).relay = { pc, channel: pc.createDataChannel("relay") };
    await pc.setLocalDescription();
    while (pc.iceGatheringState !== "complete") {
      await new Promise((done) => pc.addEventListener("icegatheringstatechange", done));
    }
    return { type: "offer" as const, sdp: pc.localDescription?.sdp ?? "" };
  }, config);
  const answer = await recipient.evaluate(
    async ({ config, offer }) => {
      const certificates = [
        await RTCPeerConnection.generateCertificate({
          name: "ECDSA",
          namedCurve: "P-256",
        } as EcKeyGenParams),
      ];
      const pc = new RTCPeerConnection({ ...config, certificates });
      await pc.getStats();
      const received = new Promise<string>((resolve) => {
        pc.addEventListener("datachannel", ({ channel }) => {
          channel.binaryType = "arraybuffer";
          channel.addEventListener("message", async ({ data }) => {
            const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
            resolve(Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""));
          });
        });
      });
      (globalThis as RelayGlobals).relay = { pc, received };
      await pc.setRemoteDescription(offer);
      await pc.setLocalDescription();
      while (pc.iceGatheringState !== "complete") {
        await new Promise((done) => pc.addEventListener("icegatheringstatechange", done));
      }
      return { type: "answer" as const, sdp: pc.localDescription?.sdp ?? "" };
    },
    { config, offer },
  );
  const sent = await sender.evaluate(async (answer) => {
    const relay = (globalThis as RelayGlobals).relay;
    const channel = relay?.channel;
    if (!relay || !channel) {
      throw new Error("no channel");
    }
    await relay.pc.setRemoteDescription(answer);
    await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error(`not open: ${relay.pc.connectionState}`)), 20_000);
      channel.addEventListener("open", resolve);
    });
    const bytes = crypto.getRandomValues(new Uint8Array(64 * 1024));
    channel.send(bytes);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  }, answer);
  const received = await recipient.evaluate(() =>
    Promise.race([
      (globalThis as RelayGlobals).relay?.received,
      new Promise<string>((resolve) => setTimeout(() => resolve("nothing"), 20_000)),
    ]),
  );
  await expect.poll(() => pathOf(sender)).not.toBe("none");
  const path = await pathOf(sender);
  for (const page of [sender, recipient]) {
    await page.evaluate(() => (globalThis as RelayGlobals).relay?.pc.close());
  }
  return { path, echoed: sent === received };
}

/** TURN on the relay box, with credentials for `secret`. */
const relayIce = (transport: "udp" | "tcp" | "tls", secret: string): RTCIceServer => ({
  urls:
    transport === "tls"
      ? `turns:${relayHost}:443?transport=tcp`
      : // By address: Chrome resolves names through --host-resolver-rules for TCP only.
        `turn:${relayIp}:3478?transport=${transport}`,
  ...turnCredentials(secret, Date.now()),
});

/** The process ID of the relay box's coturn, which changes when coturn restarts. */
const coturnPid = () => inRelay("systemctl", "show", "-p", "MainPID", "--value", "coturn");

// The standalone relay (networks/relay), set up by apps/infra/relay/install.sh as on a new server.
test.describe("the relay box", () => {
  test.use({ remoteBrowsers: { sender: remoteBrowsers.a1, recipient: remoteBrowsers.b1 } });
  test.beforeAll(() => routerMode("router-b", "cone"));

  test("comes up from install.sh with its key and firewall", async () => {
    expect(await inRelay("systemctl", "is-active", "coturn")).toBe("active\n");
    expect(
      await inRelay(
        "stat",
        "-c",
        "%a %U:%G",
        "/etc/fidant-relay/relay.key",
        "/etc/turnserver.conf",
      ),
    ).toBe("600 root:root\n640 root:turnserver\n");
    expect(
      await inRelay(
        ..."openssl pkey -pubin -in /etc/fidant-relay/relay.pub -noout -text".split(" "),
      ),
    ).toMatch(/Public-Key: \(3072 bit\)/);
    const ufw = await inRelay("ufw", "status");
    expect(ufw).toMatch(/^Status: active/);
    for (const rule of ["22/tcp", "80/tcp", "443/tcp", "3478/tcp", "3478/udp", "49152:65535/udp"]) {
      expect(ufw).toContain(rule);
    }
    expect(await inRelay("ss", "-lnu")).toMatch(/:3478\b/);
    const pins = "Restart,RestartUSec,StartLimitIntervalUSec";
    // Sorted: the order of the lines is systemd's.
    expect(
      (await inRelay("systemctl", "show", "-p", pins, "coturn")).trim().split("\n").sort(),
    ).toEqual(["Restart=on-failure", "RestartUSec=5s", "StartLimitIntervalUSec=0"]);
  });

  // Until it is handed a secret, the relay answers STUN and refuses every allocation.
  test("refuses relaying before it has a secret", async ({ actor }) => {
    const server = {
      // By address: Chrome resolves names through --host-resolver-rules for TCP only.
      urls: [`stun:${relayIp}:3478`, `turn:${relayIp}:3478?transport=udp`],
      ...turnCredentials(randomBytes(32).toString("hex"), Date.now()),
    };
    for (const name of ["sender", "recipient"]) {
      const { page } = await actor(name);
      const { types, errors } = await gather(page, server);
      expect(types, name).toContain("srflx");
      expect(types, name).not.toContain("relay");
      expect(errors, name).toContain(401);
    }
    expect(await inRelay("systemctl", "show", "-p", "NRestarts", "--value", "coturn")).toBe("0\n");
  });

  test("keeps certbot's log for 29 days like the journal", async () => {
    const dir = "/var/log/letsencrypt";
    await inRelay(
      "sh",
      "-c",
      `install -d -m 700 ${dir} && touch -d '40 days ago' ${dir}/fidant-old && touch ${dir}/fidant-new`,
    );
    await inRelay("systemd-tmpfiles", "--clean");
    const left = (await inRelay("ls", dir)).split("\n");
    expect(left).toContain("fidant-new");
    expect(left).not.toContain("fidant-old");
    expect(await inRelay("systemctl", "is-enabled", "logrotate.timer")).toBe("enabled\n");
  });

  test.describe("with a secret", () => {
    let secret = "";
    const rotated = randomBytes(32).toString("hex");
    test.beforeAll(async () => {
      secret = randomBytes(32).toString("hex");
      await applyRelaySecret(secret);
    });

    test("relays over UDP", async ({ actor }) => {
      const [sender, recipient] = await relayPeers(actor);
      const { path, echoed } = await relayedChannel(sender, recipient, relayIce("udp", secret));
      expect(echoed).toBe(true);
      expect(path).toMatch(/^relay\+udp\/(relay|prflx)$/);
    });

    test("relays over TCP", async ({ actor }) => {
      const [sender, recipient] = await relayPeers(actor);
      const { path, echoed } = await relayedChannel(sender, recipient, relayIce("tcp", secret));
      expect(echoed).toBe(true);
      expect(path).toMatch(/^relay\+tcp\//);
    });

    test("accepts the new and the previous secret after a rotation, then drops the old one after 24 hours", async ({
      actor,
    }) => {
      const [sender, recipient] = await relayPeers(actor);
      // Re-applying the same secret writes nothing: each write blocks new allocations.
      const written = () => inRelay("stat", "-c", "%y", "/var/lib/fidant-relay/turndb");
      const before = await written();
      await applyRelaySecret(secret);
      expect(await written()).toBe(before);
      try {
        await applyRelaySecret(rotated);
        const state = ["current", "previous", "previous-since"].map(
          (f) => `/var/lib/fidant-relay/${f}`,
        );
        expect(await inRelay("stat", "-c", "%a %U:%G", ...state)).toBe("600 root:root\n".repeat(3));
        for (const credentials of [secret, rotated]) {
          const { echoed } = await relayedChannel(sender, recipient, relayIce("udp", credentials));
          expect(echoed).toBe(true);
        }
        await inRelay("sh", "-c", "echo 0 >/var/lib/fidant-relay/previous-since");
        await applyRelaySecret(rotated);
        const { types, errors } = await gather(sender, relayIce("udp", secret));
        expect(types).not.toContain("relay");
        expect(errors).toContain(401);
      } finally {
        await applyRelaySecret(secret);
      }
    });

    test("applies a hand-out when previous-since is empty, missing, garbage, zero-led, in the future or oversized", async () => {
      const dir = "/var/lib/fidant-relay";
      const stored = () =>
        inRelay("sqlite3", `${dir}/turndb`, "SELECT value FROM turn_secret ORDER BY value");
      try {
        const future = "echo $(( $(date +%s) + 100000 )) >";
        // Oversized: 11 digits, and 20, which is past what the shell's arithmetic can read.
        const oversized = ["echo 99999999999 >", "echo 99999999999999999999 >"];
        for (const lose of [": >", "rm", "echo x >", "echo 08 >", future, ...oversized]) {
          // A crash in a rotation to `rotated`, after current moved to previous.
          await inRelay(
            "sh",
            "-c",
            `mv ${dir}/current ${dir}/previous && ${lose} ${dir}/previous-since`,
          );
          await applyRelaySecret(rotated);
          expect(await stored(), lose).toBe(`${[secret, rotated].sort().join("\n")}\n`);
          // The relay's own clock, read after the script wrote the file, so no allowance.
          const times = await inRelay("sh", "-c", `cat ${dir}/previous-since; date +%s`);
          expect(times, lose).toMatch(/^\d{10}\n\d{10}\n$/);
          const [since, now] = times.split("\n").map(Number);
          expect(since, lose).toBeLessThanOrEqual(now ?? 0);
          await applyRelaySecret(secret);
        }
      } finally {
        await applyRelaySecret(secret);
      }
    });

    test("keeps its current secret when the hand-out can't be opened", async ({ actor }) => {
      const seal = (key: string, plaintext: string) =>
        publicEncrypt(
          { key, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
          Buffer.from(plaintext),
        ).toString("base64");
      const otherKey = generateKeyPairSync("rsa", { modulusLength: 3072 }).publicKey;
      const foreign = `${seal(otherKey.export({ type: "spki", format: "pem" }).toString(), secret)}\n`;
      const notHex = `${seal(await inRelay("cat", "/etc/fidant-relay/relay.pub"), "x".repeat(64))}\n`;
      /** What `script` prints on stdout and stderr when fed `body`, then its exit code. */
      const feed = (script: string, body: string) =>
        inRelay("sh", "-c", `printf '%s' '${body}' | ${script} 2>&1; echo "exit $?"`);
      const cannotOpen = "fidant-relay: cannot open the secret\nexit 1\n";

      expect(await feed("fidant-relay-apply-secret", "not base64\n")).toBe(cannotOpen);
      expect(await feed("fidant-relay-apply-secret", foreign)).toBe(cannotOpen);
      expect(await feed("fidant-relay-apply-secret", notHex)).toBe(
        "fidant-relay: not a secret\nexit 1\n",
      );
      // What fidant.se answers for the hand-out's path until it serves hand-outs: its page.
      const page = '<!doctype html>\n<html lang="en"><title>Fidant</title></html>\n';
      expect(await feed("fidant-relay-secret -", page)).toBe("exit 0\n");
      // A hand-out's shape, 512 characters and a newline, gets past the fetch's check.
      expect(foreign).toHaveLength(513);
      expect(await feed("fidant-relay-secret -", foreign)).toBe(cannotOpen);
      expect(await inRelay("cat", "/var/lib/fidant-relay/current")).toBe(`${secret}\n`);

      const [sender, recipient] = await relayPeers(actor);
      const { echoed } = await relayedChannel(sender, recipient, relayIce("udp", secret));
      expect(echoed).toBe(true);
    });

    test("keeps its key and secret when install.sh runs again", async ({ actor }) => {
      const state = () =>
        inRelay(
          "sh",
          "-c",
          "sha256sum /etc/fidant-relay/relay.pub; cat /var/lib/fidant-relay/current",
        );
      const before = await state();
      expect(before).toContain(secret);
      await inRelay("sh", "-c", "set -a; . /relay-config/env; sh /relay/install.sh");
      expect(await state()).toBe(before);

      const [sender, recipient] = await relayPeers(actor);
      const { echoed } = await relayedChannel(sender, recipient, relayIce("udp", secret));
      expect(echoed).toBe(true);
    });

    test("relays over TLS on 443", async ({ actor }) => {
      await routerMode("router-b", "tcp-443");
      try {
        const [sender, recipient] = await relayPeers(actor);
        const { path, echoed } = await relayedChannel(sender, recipient, relayIce("tls", secret));
        expect(echoed).toBe(true);
        expect(path).toMatch(/^relay\+tls\//);
      } finally {
        await routerMode("router-b", "cone");
      }
    });

    test("reloads a renewed certificate without dropping coturn", async ({ actor }) => {
      const tls = "/etc/fidant-relay/tls";
      // As certbot does, live/ links into archive/. The run's key keeps the SPKI pin matching.
      await inRelay(
        "sh",
        "-c",
        `mkdir -p /tmp/archive /tmp/lineage /tmp/mismatch && cp ${tls}/turn.key /tmp/archive/privkey1.pem \
          && openssl req -x509 -key /tmp/archive/privkey1.pem -days 1 -subj /CN=${relayHost} \
            -addext subjectAltName=DNS:${relayHost} -out /tmp/archive/fullchain1.pem \
          && ln -sf /tmp/archive/privkey1.pem /tmp/lineage/privkey.pem \
          && ln -sf /tmp/archive/fullchain1.pem /tmp/lineage/fullchain.pem \
          && ln -sf /tmp/archive/fullchain1.pem /tmp/mismatch/fullchain.pem \
          && openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:prime256v1 -out /tmp/mismatch/privkey.pem`,
      );
      const installed = (lineage: string) =>
        inRelay(
          "sh",
          "-c",
          `RENEWED_LINEAGE=${lineage} fidant-relay-cert-installed 2>&1; echo "exit $?"`,
        );
      const files = () => inRelay("sh", "-c", `ls ${tls}; sha256sum ${tls}/*`);
      const fingerprint = "openssl x509 -noout -fingerprint -sha256";
      const served = () =>
        inRelay(
          "sh",
          "-c",
          `openssl s_client -connect 127.0.0.1:443 </dev/null 2>/dev/null | ${fingerprint}`,
        );

      const before = await files();
      expect(await installed("/tmp/mismatch")).toBe(
        "fidant-relay: the certificate and key in /tmp/mismatch don't match\nexit 1\n",
      );
      expect(await files()).toBe(before);

      const running = await coturnPid();
      expect(await installed("/tmp/lineage")).toBe("exit 0\n");
      expect(await coturnPid()).toBe(running);
      await inRelay("cmp", "/tmp/lineage/fullchain.pem", `${tls}/turn.crt`);
      expect(await inRelay("stat", "-c", "%a %U:%G", `${tls}/turn.key`)).toBe(
        "640 root:turnserver\n",
      );
      const renewed = await inRelay("sh", "-c", `${fingerprint} -in /tmp/lineage/fullchain.pem`);
      await expect.poll(served).toBe(renewed);

      const [sender, recipient] = await relayPeers(actor);
      const { path, echoed } = await relayedChannel(sender, recipient, relayIce("tls", secret));
      expect(echoed).toBe(true);
      expect(path).toMatch(/^relay\+tls\//);
    });

    test("installs a first certificate whose deploy hook didn't finish", async ({ actor }) => {
      const tls = "/etc/fidant-relay/tls";
      const saved = "/tmp/first-cert";
      const lineage = `/etc/letsencrypt/live/${relayHost}`;
      const fingerprint = "openssl x509 -noout -fingerprint -sha256";
      const served = () =>
        inRelay(
          "sh",
          "-c",
          `timeout 5 openssl s_client -connect 127.0.0.1:443 </dev/null 2>/dev/null | ${fingerprint} 2>/dev/null || true`,
        );
      try {
        await inRelay(
          "sh",
          "-c",
          `mkdir ${saved} && mv ${tls}/turn.crt ${tls}/turn.key ${saved}/ && systemctl restart coturn`,
        );
        await expect.poll(() => inRelay("ss", "-lnu")).toMatch(/:3478\b/);
        expect(await served()).toBe("");
        const running = await coturnPid();
        // As certbot leaves it when the hook never ran: live/ links to the files.
        await inRelay(
          "sh",
          "-c",
          `mkdir -p ${lineage} && ln -s ${saved}/turn.crt ${lineage}/fullchain.pem \
            && ln -s ${saved}/turn.key ${lineage}/privkey.pem`,
        );
        expect(await inRelay("sh", "-c", 'fidant-relay-cert 2>&1; echo "exit $?"')).toBe(
          "exit 0\n",
        );
        expect(await coturnPid()).not.toBe(running);
        await inRelay("cmp", `${saved}/turn.crt`, `${tls}/turn.crt`);
        const certificate = await inRelay("sh", "-c", `${fingerprint} -in ${saved}/turn.crt`);
        await expect.poll(served).toBe(certificate);

        const [sender, recipient] = await relayPeers(actor);
        const { path, echoed } = await relayedChannel(sender, recipient, relayIce("tls", secret));
        expect(echoed).toBe(true);
        expect(path).toMatch(/^relay\+tls\//);
      } finally {
        await inRelay(
          "sh",
          "-c",
          `for f in turn.crt turn.key; do [ -e ${saved}/$f ] && mv ${saved}/$f ${tls}/; done; \
            rm -rf /etc/letsencrypt/live ${saved}; systemctl restart coturn`,
        );
      }
    });

    test("maps its DNS name to external-ip only when the name points elsewhere", async ({
      actor,
    }) => {
      const line = () => inRelay("sh", "-c", "grep '^external-ip=' /etc/turnserver.conf || true");
      // /etc/hosts is a bind mount, so it is rewritten in place. No ip: the name doesn't resolve.
      const resolveTo = (ip?: string) =>
        inRelay(
          "sh",
          "-c",
          `{ cat /tmp/hosts; ${ip ? `echo '${ip} ${relayHost}'` : ":"}; } >/etc/hosts \
            && fidant-relay-address`,
        );
      const elsewhere = `external-ip=198.51.100.99/${relayIp}\n`;
      expect(await inRelay("systemctl", "is-active", "fidant-relay-address.timer")).toBe(
        "active\n",
      );
      await inRelay("cp", "/etc/hosts", "/tmp/hosts");
      try {
        let running = await coturnPid();
        const inode = () => inRelay("stat", "-c", "%i", "/etc/turnserver.conf");
        const before = await inode();
        await resolveTo("198.51.100.99");
        expect(await line()).toBe(elsewhere);
        expect(await coturnPid()).not.toBe(running);
        // Replaced, never truncated in place: a crash mid-write would leave coturn with no auth.
        expect(await inode()).not.toBe(before);
        expect(await inRelay("stat", "-c", "%a %U:%G", "/etc/turnserver.conf")).toBe(
          "640 root:turnserver\n",
        );
        expect(await inRelay("sh", "-c", "ls /etc/turnserver.conf*")).toBe(
          "/etc/turnserver.conf\n",
        );
        await inRelay("sh", "-c", "set -a; . /relay-config/env; sh /relay/install.sh");
        expect(await line()).toBe(elsewhere);

        running = await coturnPid();
        await resolveTo("198.51.100.99");
        expect(await coturnPid()).toBe(running);
        await resolveTo();
        expect(await line()).toBe(elsewhere);
        expect(await coturnPid()).toBe(running);
        // A loopback answer, as from an installer's `127.0.1.1 <hostname>` line, counts as none.
        await resolveTo("127.0.1.1");
        expect(await line()).toBe(elsewhere);
        expect(await coturnPid()).toBe(running);

        await resolveTo(relayIp);
        expect(await line()).toBe("");
        expect(await coturnPid()).not.toBe(running);
      } finally {
        // Restoring /etc/hosts alone would leave a line behind: the name then doesn't resolve.
        await resolveTo(relayIp);
        await resolveTo();
      }
      expect(await line()).toBe("");

      const [sender, recipient] = await relayPeers(actor);
      const { echoed } = await relayedChannel(sender, recipient, relayIce("udp", secret));
      expect(echoed).toBe(true);
    });

    test("asks Let's Encrypt for a certificate only once its name resolves", async () => {
      const marker = "/tmp/certbot-ran";
      await inRelay(
        "sh",
        "-c",
        `printf '#!/bin/sh\\ntouch ${marker}\\n' >/tmp/certbot && chmod +x /tmp/certbot && cp /etc/hosts /tmp/hosts-cert`,
      );
      const run = () =>
        inRelay(
          "sh",
          "-c",
          `rm -f ${marker}; PATH=/tmp:$PATH fidant-relay-cert; echo "exit $?"; ls ${marker} 2>&1; true`,
        );
      try {
        expect(await run()).toMatch(/^exit 0\n.*No such file/);
        await inRelay("sh", "-c", `echo '${relayIp} ${relayHost}' >>/etc/hosts`);
        expect(await run()).toBe(`exit 0\n${marker}\n`);
        await inRelay("fidant-relay-address");
        expect(await inRelay("sh", "-c", "grep '^external-ip=' /etc/turnserver.conf || true")).toBe(
          "",
        );
      } finally {
        await inRelay("sh", "-c", `cat /tmp/hosts-cert >/etc/hosts; rm -f /tmp/certbot ${marker}`);
      }
    });

    test("keeps secrets and client addresses out of its journal", async () => {
      // A hand-out of the current secret, sealed on the relay, so argv holds only file names.
      await inRelay(
        "sh",
        "-c",
        `tr -d '\\n' </var/lib/fidant-relay/current | openssl pkeyutl -encrypt -pubin \
          -inkey /etc/fidant-relay/relay.pub -pkeyopt rsa_padding_mode:oaep \
          -pkeyopt rsa_oaep_md:sha256 -pkeyopt rsa_mgf1_md:sha256 | base64 -w0 >/tmp/hand-out \
          && echo 'not a hand-out' >/tmp/garbage`,
      );
      // Through a unit, so what apply prints lands in the journal.
      const apply = (body: string) =>
        inRelay(
          "sh",
          "-c",
          `systemd-run --wait --collect --quiet sh -c 'fidant-relay-apply-secret <${body}'; echo "exit $?"`,
        );
      expect(await apply("/tmp/hand-out")).toBe("exit 0\n");
      expect(await apply("/tmp/garbage")).toBe("exit 1\n");
      let lines: string[] = [];
      // The timer's fetch (10 s after install) got no hand-out from the server and exited cleanly.
      await expect
        .poll(
          async () => {
            lines = (await inRelay("journalctl", "-o", "export", "--no-pager")).split("\n");
            return [
              "MESSAGE=Finished fidant-relay-secret.service",
              "MESSAGE=fidant-relay: cannot open the secret",
            ].every((start) => lines.some((line) => line.startsWith(start)));
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      for (const value of [secret, rotated]) {
        expect(lines.filter((line) => line.includes(value))).toEqual([]);
      }
      const addresses = await clientAddresses();
      expect(addresses.length).toBeGreaterThan(0);
      for (const ip of addresses) {
        expect(
          lines.filter((line) => addressPattern(ip).test(line)),
          ip,
        ).toEqual([]);
      }
    });

    test("takes its secret from the server's hand-out, which then finds it up", async () => {
      test.setTimeout(240_000);
      const master = await readFile(
        join(process.env.FIDANT_E2E_COTURN_DIR ?? "", "relay-master"),
        "utf8",
      );
      const derived = relaySecret(master.trim(), "sto");
      const status = async () =>
        JSON.parse(
          await inRelay(
            ..."curl -fsS --max-time 10 --cacert /tmp/app.pem".split(" "),
            `https://${serverIp}/relay-status`,
          ),
        ) as { id: string; up: boolean }[];
      const marker = randomBytes(8).toString("hex");
      try {
        // The relay's timer can't verify the server's self-signed certificate, so pin it.
        await inRelay(
          "sh",
          "-c",
          `timeout 5 openssl s_client -connect ${serverIp}:443 </dev/null 2>/dev/null \
            | openssl x509 >/tmp/app.pem`,
        );
        expect(await inRelay("cat", "/var/lib/fidant-relay/current")).toBe(`${secret}\n`);
        expect(await status()).toContainEqual({ id: "sto", up: false });

        // As the timer runs it, plus a line from the same unit that shows its output is journaled.
        await inRelay(
          "sh",
          "-c",
          `systemd-run --wait --collect --quiet --setenv=CURL_CA_BUNDLE=/tmp/app.pem \
            sh -c 'fidant-relay-secret; echo "fidant-e2e ${marker} exit $?"'`,
        );
        const hash = createHash("sha256").update(`${derived}\n`).digest("hex");
        expect(await inRelay("sha256sum", "/var/lib/fidant-relay/current")).toBe(
          `${hash}  /var/lib/fidant-relay/current\n`,
        );
        // The server checks each relay once a minute.
        await expect
          .poll(status, { timeout: 150_000, intervals: [5_000] })
          .toContainEqual({ id: "sto", up: true });

        let lines: string[] = [];
        await expect
          .poll(
            async () => {
              lines = (await inRelay("journalctl", "-o", "export", "--no-pager")).split("\n");
              return lines.includes(`MESSAGE=fidant-e2e ${marker} exit 0`);
            },
            { timeout: 20_000 },
          )
          .toBe(true);
        for (const value of [master.trim(), derived, secret]) {
          expect(lines.filter((line) => line.includes(value))).toEqual([]);
        }
      } finally {
        await applyRelaySecret(secret);
      }
    });
  });
});

// The signaling image (apps/server/Dockerfile) behind the load balancer stand-in (networks/alb).
test.describe("the signaling image", () => {
  test.beforeAll(() => routerMode("router-b", "cone"));
  const origin = "https://fidant.se";
  const agent = `fidant-e2e-${randomBytes(8).toString("hex")}`;

  test("runs read-only as node with the master only in its file", async ({ leaks }) => {
    const master = (
      await readFile(join(process.env.FIDANT_E2E_COTURN_DIR ?? "", "relay-master"), "utf8")
    ).trim();
    leaks.watchKey("relay master", master);
    const file = "/run/fidant/relay-master";
    expect(await inSignal("stat", "-c", "%a %U", file)).toBe("600 node\n");
    const hash = createHash("sha256").update(`${master}\n`).digest("hex");
    expect(await inSignal("sha256sum", file)).toBe(`${hash}  ${file}\n`);
    expect(await inSignal("stat", "-c", "%U", "/proc/1")).toBe("node\n");
    expect((await inSignal("cat", "/proc/1/cmdline")).split("\0")).toEqual([
      "node",
      "apps/server/src/main.ts",
      "",
    ]);
    // Booleans only, so a failure doesn't print the master.
    const environ = (await inSignal("cat", "/proc/1/environ")).split("\0");
    expect(environ.some((entry) => entry.startsWith("RELAY_MASTER="))).toBe(false);
    expect(environ.some((entry) => entry.includes(master))).toBe(false);
    expect(environ.some((entry) => entry.startsWith("RELAY_MASTER_FILE="))).toBe(true);
    // The entrypoint passes the master to both, so neither may show it in a process's arguments.
    expect(await inSignal("sh", "-c", "type printf [")).toBe(
      "printf is a shell builtin\n[ is a shell builtin\n",
    );
    expect(
      await inSignal("sh", "-c", "touch /app/x 2>/dev/null && echo writable || echo read-only"),
    ).toBe("read-only\n");
    expect(await inSignal("ls", "/app/apps")).toBe("server\n");
    expect(await inSignal("ls", "/app/packages")).toBe("protocol\n");
  });

  test("answers /relay-status with JSON and 404 elsewhere", async () => {
    const get = (path: string, ...flags: string[]) =>
      inRelay("curl", "-sk", "--max-time", "5", ...flags, `https://${albIp}${path}`);
    expect(JSON.parse(await get("/relay-status"))).toEqual([
      { id: "net", up: expect.any(Boolean) },
    ]);
    for (const path of ["/", "/send", "/r/x"]) {
      expect(await get(path, "-o", "/dev/null", "-w", "%{http_code}"), path).toBe("404");
    }
  });

  // From b1, so a1's count is still empty when the next test fills it.
  test("accepts PUBLIC_ORIGIN and refuses another origin", async () => {
    for (const [from, code] of [
      [origin, 101],
      ["https://elsewhere.test", 403],
    ] as const) {
      const clients = await signalClients("b1", 1, { origin: from, agent });
      await clients.release();
      expect(clients.codes, from).toEqual([code]);
    }
  });

  test("counts each client by its own address, not a forged entry, and logs neither", async () => {
    const forged = Array.from(
      { length: LIMITS.socketsPerAddress + 1 },
      (_, index) => `203.0.113.${index}`,
    );
    const a = await signalClients("a1", LIMITS.socketsPerAddress + 1, {
      origin,
      agent,
      forwardedFor: (index) => forged[index] ?? "",
    });
    try {
      expect(a.codes).toEqual([...Array<number>(LIMITS.socketsPerAddress).fill(101), 429]);
      // router-a's address, which is full, before alb appends router-b's.
      const b = await signalClients("b1", 1, { origin, agent, forwardedFor: () => "198.51.100.2" });
      await b.release();
      expect(b.codes).toEqual([101]);
    } finally {
      await a.release();
    }

    let lines: string[] = [];
    await expect
      .poll(async () => {
        const logs = await signalLogs();
        await writeFile(signalLog, logs);
        lines = logs.split("\n").filter(Boolean);
        return (
          lines.some((line) => line.startsWith('{"event":"listening"')) &&
          lines.includes('{"event":"upgrade-rejected","reason":"address"}')
        );
      })
      .toBe(true);
    expect(checkServerLog(lines, serverLogAllowlist)).toEqual([]);
    const addresses = await clientAddresses();
    expect(addresses.length).toBeGreaterThan(0);
    for (const ip of [...addresses, ...forged, albIp, "10.89.3.2"]) {
      expect(
        lines.filter((line) => addressPattern(ip).test(line)),
        ip,
      ).toEqual([]);
    }
    for (const text of [agent, "Mozilla/"]) {
      expect(
        lines.filter((line) => line.includes(text)),
        text,
      ).toEqual([]);
    }
  });
});

// The pages CDN stand-in (networks/pages): the edge function over the web build the release uploads.
test.describe("pages from the edge function", () => {
  test.use({
    baseURL: boxOrigin,
    hostRules: `MAP fidant.se ${pagesIp}`,
    remoteBrowsers: { sender: remoteBrowsers.a1, recipient: remoteBrowsers.b1 },
  });

  test("open signaling on the image's name, and a direct transfer completes", async ({
    actor,
    observed,
    leaks,
    canary,
    baseURL,
  }) => {
    await routerMode("router-b", "cone");
    const file = leaks.watch(canaryFile(canary.fork("file"), { size: 300_001 }));
    const name = makeName(leaks, canary, "Anna");

    const sender = await actor("sender");
    await recordPeerConnections(sender.context);
    const page = await sender.page.goto("/send");
    expect(page?.headers()["content-security-policy"]).toContain(
      `connect-src 'self' wss://${signalHost}`,
    );
    await chooseFile(sender.page, { name: file.name, mimeType: file.mime, buffer: file.bytes });
    await sender.page.getByLabel("Who is it for?").fill(name);
    await sender.page.getByRole("button", { name: "Add recipient", exact: true }).click();
    const link =
      (await sender.page.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
    leaks.watchKey("link secret", new URL(link).hash.slice(1));
    expect(new URL(link).origin).toBe(boxOrigin);

    const recipient = await actor("recipient");
    await recordPeerConnections(recipient.context);
    await recipient.page.goto(link);
    const downloading = recipient.page.waitForEvent("download", { timeout: 60_000 });
    const downloadButton = recipient.page.getByRole("button", { name: "Download" });
    await expect(downloadButton).toBeVisible({ timeout: 45_000 });
    await downloadButton.click();
    await expect(recipient.page.getByText(verifiedText)).toBeVisible({ timeout: 60_000 });
    const download = await downloading;
    expect(sha256Hex(await buffer(await download.createReadStream()))).toBe(sha256Hex(file.bytes));
    await expect
      .poll(async () => `${await pathOf(sender.page)} ${await pathOf(recipient.page)}`)
      .toMatch(/^srflx\/(srflx|prflx) srflx\/(srflx|prflx)$/);
    await watchIcePasswords(leaks, "sender", sender.page);
    await watchIcePasswords(leaks, "recipient", recipient.page);
    await expectSignaling(observed, baseURL);
    for (const who of ["sender", "recipient"]) {
      const sockets = (await observed(who).records()).filter((r) => r.type === "websocket-open");
      expect([...new Set(sockets.map((r) => new URL(r.url).host))], who).toEqual([signalHost]);
    }

    expect(await sender.page.evaluate(() => fetch("/signal").then((r) => r.status))).toBe(404);
    const answer = (format: string, path: string, ...curl: string[]) =>
      inRelay(
        "curl",
        "-sk",
        ...curl,
        "--max-time",
        "5",
        "--resolve",
        `${new URL(boxOrigin).host}:443:${pagesIp}`,
        "-o",
        "/dev/null",
        "-w",
        format,
        `${boxOrigin}${path}`,
      );
    const status = (path: string, ...curl: string[]) => answer("%{http_code}", path, ...curl);
    const guarded = (path: string) => answer("%{http_code} %{size_download}", path);
    expect(await status("/relay-secret/net")).toBe("200");
    expect(await status("/relay-secret/sto")).toBe("404");
    expect(await guarded("/relay-secret/%2e%2e/relay-status")).toBe("404 0");
    expect(await guarded("//relay-secret/net")).toBe("404 0");
    expect(await status("/relay-secret/net", "-X", "POST")).toBe("403");

    let lines: string[] = [];
    await expect
      .poll(async () => {
        const logs = await signalLogs();
        await writeFile(signalLog, logs);
        lines = logs.split("\n").filter(Boolean);
        return lines.some((line) => line.startsWith('{"event":"path"'));
      })
      .toBe(true);
    expect(checkServerLog(lines, serverLogAllowlist)).toEqual([]);
    expect(lines.some((line) => line.startsWith('{"event":"joined"'))).toBe(true);
  });
});
