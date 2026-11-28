import { constants, createHash, privateDecrypt } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
// ponytail: relative import, not a workspace dependency on the server, for one small function.
import { relaySecret } from "../../server/src/relay-secret.ts";
import {
  type Actor,
  canaryFile,
  chooseFile,
  expect,
  type Observed,
  openTraces,
  test,
} from "../src/fixtures.ts";
import { coturnLog, serverStderrLog, serverStdoutLog } from "../src/paths.ts";

// Recipients may use only relay candidates, once over UDP and once over TCP; the leak check scans coturn's log.

test.skip(!process.env.FIDANT_E2E_TURN_URLS, "coturn not found; brew install coturn");

// The server checks each relay at startup, and again after every restart, so `loc` is up soon.
test.beforeAll(async ({ playwright }) => {
  const request = await playwright.request.newContext({ ignoreHTTPSErrors: true });
  const status = `${process.env.FIDANT_E2E_BASE_URL}/relay-status`;
  await expect
    .poll(async () => (await request.get(status)).json(), { timeout: 15_000 })
    .toContainEqual({ id: "loc", up: true });
  await request.dispose();
});

type Transport = "udp" | "tcp";

const loopbackRelay =
  "Firefox pairs the local coturn's 127.0.0.1 relay candidates with no LAN candidate and ends ICE at once, before the sender falls back to the relay";

const sha256Hex = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

/** What a run log has written since `start` bytes. */
const since = async (file: string, start: number) => (await readFile(file)).subarray(start);
const sizeOf = async (file: string) => (await readFile(file).catch(() => Buffer.alloc(0))).length;
/** Whether the server logged `line` since `start` bytes. */
const logged = async (start: number, line: string) =>
  (await since(serverStdoutLog, start)).toString().split("\n").includes(line);
/** coturn's successful allocations since `start` bytes, without the server's relay checks. */
const allocations = async (start: number) =>
  (await since(coturnLog, start))
    .toString()
    .split("\n")
    .filter((line) => line.includes("ALLOCATE processed, success"))
    .filter((line) => !/user <\d+:probe>/.test(line));

/** The signaling messages of type `t` that an actor sent or received so far. */
const signals = async (seen: Observed, type: "frame-sent" | "frame-received", t: string) =>
  (await seen.records()).flatMap((record) => {
    if (record.type !== type) {
      return [];
    }
    const message = JSON.parse(record.payload) as Record<string, unknown>;
    return message.t === t ? [message] : [];
  });

/** A list the page's peer connections kept (see `watchPeers`). */
const peerList = (page: Page, key: "iceUrls" | "peerStates" | "relayPaths") =>
  page.evaluate((k) => (globalThis as Record<string, unknown>)[k] as string[] | undefined, key);

/**
 * Init script: keeps every peer connection's ICE URLs and states, and, once it connects, the type
 * and relay protocol of its selected local candidate (`relay/udp`, `host/` and so on). With a
 * `relay` transport it allows only relay candidates, from the TURN URLs for that transport, also
 * when the app adds the relay later through setConfiguration.
 */
function watchPeers(relay: Transport | null) {
  delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  const Native = globalThis.RTCPeerConnection;
  const urls: string[] = [];
  const states: string[] = [];
  const paths: string[] = [];
  Object.assign(globalThis, { iceUrls: urls, peerStates: states, relayPaths: paths });
  const watched = (config: RTCConfiguration): RTCConfiguration => {
    for (const server of config.iceServers ?? []) {
      urls.push(...[server.urls].flat());
    }
    const iceServers = (config.iceServers ?? [])
      .map((server) => ({
        ...server,
        urls: [server.urls].flat().filter((url) => url.endsWith(`?transport=${relay}`)),
      }))
      .filter((server) => server.urls.length > 0);
    return relay ? { ...config, iceServers, iceTransportPolicy: "relay" } : config;
  };
  globalThis.RTCPeerConnection = class extends Native {
    constructor(config: RTCConfiguration = {}) {
      super(watched(config));
      states.push(this.connectionState);
      this.addEventListener("connectionstatechange", async () => {
        states.push(this.connectionState);
        if (this.connectionState !== "connected") {
          return;
        }
        const reports = [...(await this.getStats()).values()];
        const pairId = reports.find((r) => r.type === "transport")?.selectedCandidatePairId;
        const pair = reports.find((r) => r.id === pairId);
        const local = reports.find((r) => r.id === pair?.localCandidateId);
        paths.push(`${local?.candidateType}/${local?.relayProtocol ?? ""}`);
      });
    }
    override setConfiguration(config: RTCConfiguration = {}) {
      super.setConfiguration(watched(config));
    }
  };
}

/**
 * Opens an actor whose peer connections may only use relay candidates reached over `transport`,
 * and keeps their ICE URLs.
 */
async function relayOnly(
  open: (name: string) => Promise<Actor>,
  name: string,
  transport: Transport,
): Promise<Page> {
  const { context, page } = await open(name);
  await context.addInitScript(watchPeers, transport);
  return page;
}

for (const transport of ["udp", "tcp"] as const) {
  test(`a transfer forced through the TURN relay over ${transport}`, async ({
    actor,
    leaks,
    canary,
    browserName,
  }) => {
    test.skip(browserName === "firefox", loopbackRelay);
    const stdoutStart = await sizeOf(serverStdoutLog);
    const coturnStart = await sizeOf(coturnLog);
    const file = leaks.watch(canaryFile(canary.fork("file"), { size: 300_001 }));

    const sender = await relayOnly(actor, "sender", transport);
    await sender.goto("/send");
    await chooseFile(sender, {
      name: file.name,
      mimeType: file.mime,
      buffer: file.bytes,
    });
    await sender.getByLabel("Who is it for?").fill("Anna");
    await sender.getByRole("button", { name: "Add recipient", exact: true }).click();
    const link = (await sender.getByLabel("Link for Anna", { exact: true }).textContent()) ?? "";
    leaks.watchKey("link secret", new URL(link).hash.slice(1));

    const recipient = await relayOnly(actor, "recipient", transport);
    await recipient.goto(link);
    const downloading = recipient.waitForEvent("download", { timeout: 60_000 });
    const downloadButton = recipient.getByRole("button", { name: "Download" });
    await expect(downloadButton).toBeVisible({ timeout: 45_000 });
    await downloadButton.click();
    await expect(recipient.getByText("this is exactly the file that was sent")).toBeVisible({
      timeout: 30_000,
    });
    const download = await downloading;
    expect(sha256Hex(await readFile(await download.path()))).toBe(sha256Hex(file.bytes));

    for (const page of [sender, recipient]) {
      const log = await openTraces(page);
      await expect(log).toContainText(/Connection, [^:]*: Route: through our relay\./);
      await expect(log).toContainText(
        "Relay, Memory, not kept: Carries the encrypted data between the two browsers.",
      );
      await expect(log).not.toContainText("Route: direct");
      // The log and the Why? text also say "through our relay".
      await expect(page.getByText("Through our relay", { exact: true })).toBeVisible();
      // The send page shows the link at once; the receive page explains under "Why?".
      if (page === recipient) {
        await page.getByText("Why?", { exact: true }).click();
        await expect(
          page.getByText("So the file goes through our relay in Stockholm."),
        ).toBeVisible();
      }
      await expect(page.getByRole("link", { name: /More about how it works/ })).toHaveAttribute(
        "href",
        "/how#relay",
      );
      // The only ICE servers the page was given are the local coturn's.
      const urls = await peerList(page, "iceUrls");
      expect(urls?.length).toBeGreaterThan(0);
      expect(new Set(urls)).toEqual(new Set(process.env.FIDANT_E2E_TURN_URLS?.split(",")));
      // WebKit's stats name no protocol; watchPeers offers only this transport's TURN URLs.
      const path = browserName === "webkit" ? "relay/" : `relay/${transport}`;
      await expect.poll(() => peerList(page, "relayPaths")).toEqual([path]);
    }

    // The sender reports the path, so the server logs it, about a second after the channel opens.
    await expect.poll(() => logged(stdoutStart, '{"event":"path","path":"relay"}')).toBe(true);
    // coturn allocated relay addresses for the browsers.
    expect((await allocations(coturnStart)).length).toBeGreaterThan(0);
  });
}

test("the relay list: the wrong secret is down, each relay gets its own sealed secret", async ({
  page,
  request,
}) => {
  const status = await request.get("/relay-status");
  expect(status.headers()["content-type"]).toBe("application/json");
  expect(status.headers()["cache-control"]).toBe("no-store");
  expect(await status.json()).toEqual([
    { id: "bad", up: false },
    { id: "loc", up: true },
  ]);

  const master = (await readFile(process.env.FIDANT_E2E_RELAY_MASTER_FILE ?? "", "utf8")).trim();
  const keys = dirname(process.env.FIDANT_E2E_RELAYS_FILE ?? "");
  const secrets: Record<string, string> = { master };
  for (const id of ["bad", "loc"]) {
    const response = await request.get(`/relay-secret/${id}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("text/plain; charset=utf-8");
    expect(response.headers()["cache-control"]).toBe("no-store");
    const body = await response.text();
    expect(/^[A-Za-z0-9+/]+={0,2}\n$/.test(body), `${id}'s hand-out is base64 and LF`).toBe(true);
    const opened = privateDecrypt(
      {
        key: await readFile(join(keys, `${id}.key`)),
        padding: constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256",
      },
      Buffer.from(body, "base64"),
    ).toString();
    secrets[id] = relaySecret(master, id);
    expect(opened === secrets[id], `${id}'s hand-out opens to ${id}'s secret`).toBe(true);
  }
  expect((await request.get("/relay-secret/nope")).status()).toBe(404);

  // Neither route logs, so an upgrade on a wrong path writes a line that proves the log is current.
  const stdoutStart = await sizeOf(serverStdoutLog);
  await page.goto("/");
  await page.evaluate(
    () =>
      new Promise((done) => {
        new WebSocket(`wss://${location.host}/not-signal`).onclose = done;
      }),
  );
  await expect
    .poll(() => logged(stdoutStart, '{"event":"upgrade-rejected","reason":"path"}'))
    .toBe(true);
  const logs = (
    await Promise.all([serverStdoutLog, serverStderrLog].map((log) => readFile(log, "utf8")))
  ).join("\n");
  for (const [name, secret] of Object.entries(secrets)) {
    expect(logs.includes(secret), `the ${name} secret in the server logs`).toBe(false);
  }
});

test("a sender who refuses the relay: no credentials, no bytes, plain words on both pages", async ({
  actor,
  observed,
  leaks,
  canary,
  browserName,
}) => {
  test.skip(browserName === "firefox", loopbackRelay);
  const stdoutStart = await sizeOf(serverStdoutLog);
  const coturnStart = await sizeOf(coturnLog);
  const file = leaks.watch(canaryFile(canary.fork("file"), { size: 100_001 }));

  const { context, page: sender } = await actor("sender");
  await context.addInitScript(watchPeers, null);
  await sender.clock.install();
  await sender.goto("/send");
  await chooseFile(sender, {
    name: file.name,
    mimeType: file.mime,
    buffer: file.bytes,
  });
  await sender.getByText("Connection options", { exact: true }).click();
  const allowRelay = sender.getByLabel("Use our relay if needed");
  await allowRelay.uncheck();
  await sender.getByLabel("Who is it for?").fill("Anna");
  await sender.getByRole("button", { name: "Add recipient", exact: true }).click();
  const link = (await sender.getByLabel("Link for Anna", { exact: true }).textContent()) ?? "";
  leaks.watchKey("link secret", new URL(link).hash.slice(1));
  const hostTurn = async () =>
    (await signals(observed("sender"), "frame-sent", "host")).at(-1)?.turn;
  await expect.poll(hostTurn).toBe(false);

  const recipient = await relayOnly(actor, "recipient", "udp");
  await recipient.goto(link);
  for (const page of [sender, recipient]) {
    await expect.poll(async () => (await peerList(page, "peerStates"))?.length).toBeGreaterThan(0);
  }
  // The sender gives up on the refused connection after its 20 s setup timeout.
  await sender.clock.fastForward(20_000);
  await expect(
    recipient.getByRole("heading", { name: "Couldn't connect directly to the sender" }),
  ).toBeVisible();
  await expect(recipient.getByText("The sender doesn't allow our relay")).toBeVisible();
  await expect(
    sender.getByRole("list", { name: "Recipients" }).getByText("couldn't connect directly"),
  ).toBeVisible();

  await expect(recipient.getByRole("button", { name: "Download" })).toHaveCount(0);
  for (const page of [sender, recipient]) {
    const states = await peerList(page, "peerStates");
    expect(states?.length, "peer connections made").toBeGreaterThan(0);
    expect(states).not.toContain("connected");
    const urls = await peerList(page, "iceUrls");
    expect(
      urls?.every((url) => url.startsWith("stun:")),
      `only stun: URLs, got ${urls}`,
    ).toBe(true);
  }

  // No relay credentials, before the recovery below legitimately hands them out.
  for (const name of ["sender", "recipient"]) {
    const joined = await signals(observed(name), "frame-received", "joined");
    expect(joined.length, `joined frames for ${name}`).toBeGreaterThan(0);
    for (const message of joined) {
      expect(message.turn).toBe(false);
      const urls = (message.iceServers as RTCIceServer[]).flatMap((server) => [server.urls].flat());
      expect(urls.length, "the stun: URL").toBeGreaterThan(0);
      expect(
        urls.every((url) => url.startsWith("stun:")),
        `only stun: URLs, got ${urls}`,
      ).toBe(true);
      expect(JSON.stringify(message)).not.toMatch(/username|credential/);
    }
  }
  expect(await allocations(coturnStart)).toEqual([]);
  await expect.poll(() => logged(stdoutStart, '{"event":"path","path":"failed"}')).toBe(true);

  await allowRelay.check();
  await expect.poll(hostTurn).toBe(true);
  await recipient.getByRole("button", { name: "Try again" }).click();
  const download = recipient.getByRole("button", { name: "Download" });
  await expect(download).toBeVisible({ timeout: 30_000 });
  const downloading = recipient.waitForEvent("download", { timeout: 60_000 });
  await download.click();
  await expect(recipient.getByText("this is exactly the file that was sent")).toBeVisible({
    timeout: 30_000,
  });
  expect(sha256Hex(await readFile(await (await downloading).path()))).toBe(sha256Hex(file.bytes));
  await expect(recipient.getByText("Through our relay", { exact: true })).toBeVisible();
});

test("a sender who refuses the relay and fails setup shows the refused relay", async ({
  actor,
  leaks,
  canary,
}) => {
  const file = leaks.watch(canaryFile(canary.fork("file"), { size: 10_001 }));
  const { context, page: sender } = await actor("sender");
  await context.addInitScript(() => {
    RTCPeerConnection.prototype.setLocalDescription = () =>
      Promise.reject(new DOMException("injected", "OperationError"));
  });
  await sender.goto("/send");
  await chooseFile(sender, {
    name: file.name,
    mimeType: file.mime,
    buffer: file.bytes,
  });
  await sender.getByText("Connection options", { exact: true }).click();
  await sender.getByLabel("Use our relay if needed").uncheck();
  await sender.getByLabel("Who is it for?").fill("Anna");
  await sender.getByRole("button", { name: "Add recipient", exact: true }).click();
  const link = (await sender.getByLabel("Link for Anna", { exact: true }).textContent()) ?? "";
  leaks.watchKey("link secret", new URL(link).hash.slice(1));

  const recipient = await relayOnly(actor, "recipient", "udp");
  await recipient.goto(link);
  await expect(recipient.getByText("The sender doesn't allow our relay")).toBeVisible({
    timeout: 20_000,
  });
  await expect(recipient.getByText("Couldn't connect to the sender's computer")).toHaveCount(0);
});
