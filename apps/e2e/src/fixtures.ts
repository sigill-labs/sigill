import { join } from "node:path";
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  expect,
  type Locator,
  type Page,
  type WebSocketRoute,
} from "@playwright/test";
import { parseStackOrigins } from "./hosts.ts";
import { failOnLeaks, type Leaks, LeakWatch } from "./leak-watch.ts";
import { base32Token, runSeed, SeededRandom } from "./leaks/canary.ts";
import { deleteSavedMail } from "./mail.ts";
import {
  assertActorName,
  type BlockedRecord,
  type ObservationRecord,
  testDirName,
} from "./observations.ts";
import { observationsDir } from "./paths.ts";
import { Recorder } from "./recorder.ts";

export { expect } from "@playwright/test";
export type { Leaks } from "./leak-watch.ts";
export { canaryFile, canaryKey } from "./leaks/canary.ts";

/** A browser context of its own, such as the sender or the recipient, with one page open. */
export interface Actor {
  context: BrowserContext;
  page: Page;
}

/** What the harness saw for one actor so far. */
export interface Observed {
  blocked: readonly BlockedRecord[];
  records(): Promise<ObservationRecord[]>;
}

interface Fixtures {
  /** Opens a recorded context named `name`, with its own observations file. */
  actor: (name: string) => Promise<Actor>;
  /** Looks up an actor's observations. The built-in `context` fixture is the actor "default". */
  observed: (name: string) => Observed;
  /**
   * Set with `test.use({ allowBlocked: true })` to keep requests outside the stack from failing
   * the test, for a test that checks the blocker itself. They are still aborted and recorded.
   */
  allowBlocked: boolean;
  /**
   * Set with `test.use({ remoteBrowsers: { sender: "ws://…" } })` to open those actors in a
   * browser served by `playwright run-server` at that endpoint, with the project's launch options.
   */
  remoteBrowsers: Record<string, string>;
  /** Put first in this test's remote browsers' `--host-resolver-rules`, where the first match wins. */
  hostRules: string;
  /** Registers this test's secrets. Its teardown fails the test if any of them leaked. */
  leaks: Leaks;
  /**
   * Random bytes for canaries, from the run seed and this test's title, so the same seed
   * (printed at the start of the run) makes the same canaries. Fork it per canary.
   */
  canary: SeededRandom;
  _leakWatch: LeakWatch;
  _recorders: Map<string, Recorder>;
  _actorContextOptions: BrowserContextOptions;
  _noUnrecordedContexts: undefined;
}

export const test = base.extend<Fixtures>({
  allowBlocked: [false, { option: true }],
  remoteBrowsers: [{}, { option: true }],
  hostRules: ["", { option: true }],

  // `_recorders` depends on this, so this is set up first and torn down last: the scan runs once
  // every context has closed and `_recorders` has completed and written the records.
  _leakWatch: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads dependencies from the pattern.
    async ({}, use, testInfo) => {
      const watch = await LeakWatch.start(testDirName(testInfo), process.env.FIDANT_E2E_REGISTRY);
      await use(watch);
      // check() saved this test's mail: delete it, so the next test does not take it for its own.
      await failOnLeaks(watch, () => deleteSavedMail(join(observationsDir, testDirName(testInfo))));
    },
    { auto: true },
  ],

  leaks: async ({ _leakWatch }, use) => {
    await use(_leakWatch);
  },

  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads dependencies from the pattern.
  canary: async ({}, use, testInfo) => {
    const seed = process.env.FIDANT_E2E_SEED;
    if (!seed) {
      throw new Error("FIDANT_E2E_SEED is not set. Run the suite through global setup.");
    }
    const path = [testInfo.project.name, ...testInfo.titlePath];
    await use(new SeededRandom(runSeed(seed)).fork(JSON.stringify(path)));
  },

  // Auto, so it is set up before any context and torn down after every context has closed.
  // Writing here means records that arrive while a context closes (websocket-close,
  // requestfailed, late blocks) still reach the file.
  _recorders: [
    async ({ allowBlocked, _leakWatch }, use, testInfo) => {
      const recorders = new Map<string, Recorder>();
      _leakWatch.recorders = recorders;
      await use(recorders);
      const dir = join(observationsDir, testDirName(testInfo));
      for (const recorder of recorders.values()) {
        await recorder.write(dir);
      }
      if (allowBlocked) {
        return;
      }
      const blocked = [...recorders.values()].flatMap((recorder) =>
        recorder.blocked.map(({ kind, url }) => `  ${recorder.actor} (${kind}): ${url}`),
      );
      if (blocked.length > 0) {
        throw new Error(
          `The browser tried to reach ${blocked.length} URL(s) outside the local stack. ` +
            `They were aborted:\n${blocked.join("\n")}`,
        );
      }
    },
    { auto: true },
  ],

  // Torn down after the recorded contexts have closed, so any context still open was made
  // without a recorder. It is closed here so it cannot leak into the next test.
  _noUnrecordedContexts: [
    async ({ browser, _recorders }, use) => {
      await use(undefined);
      const recorded = new Set([..._recorders.values()].map((recorder) => recorder.context));
      const unrecorded = browser.contexts().filter((context) => !recorded.has(context));
      if (unrecorded.length === 0) {
        return;
      }
      await Promise.all(unrecorded.map((context) => context.close()));
      throw new Error(
        `${unrecorded.length} browser context(s) in this test had no traffic recorder. ` +
          "Open contexts with the `actor()` fixture, or use the default `page` or `context`, " +
          "instead of calling `browser.newContext()`.",
      );
    },
    { auto: true },
  ],

  context: async ({ context, _recorders }, use) => {
    await record(_recorders, "default", context);
    await use(context);
  },

  // The same options Playwright gives the default context: `contextOptions` overlaid with the
  // individual `use` options, so actors never drift from the config. Video is not recorded.
  _actorContextOptions: async (
    {
      contextOptions,
      acceptDownloads,
      bypassCSP,
      clientCertificates,
      colorScheme,
      contrast,
      deviceScaleFactor,
      extraHTTPHeaders,
      forcedColors,
      geolocation,
      hasTouch,
      httpCredentials,
      ignoreHTTPSErrors,
      isMobile,
      javaScriptEnabled,
      locale,
      offline,
      permissions,
      proxy,
      reducedMotion,
      screen,
      storageState,
      timezoneId,
      userAgent,
      viewport,
      baseURL,
      serviceWorkers,
    },
    use,
  ) => {
    // Playwright passes only the options that are set, so unset ones are dropped below.
    const options: { [K in keyof BrowserContextOptions]: BrowserContextOptions[K] | undefined } = {
      acceptDownloads,
      bypassCSP,
      clientCertificates: clientCertificates?.length ? clientCertificates : undefined,
      colorScheme,
      contrast,
      deviceScaleFactor,
      extraHTTPHeaders,
      forcedColors,
      geolocation,
      hasTouch,
      httpCredentials,
      ignoreHTTPSErrors,
      isMobile,
      javaScriptEnabled,
      locale,
      offline,
      permissions,
      proxy,
      reducedMotion,
      screen,
      storageState,
      timezoneId,
      userAgent,
      viewport,
      baseURL,
      serviceWorkers,
    };
    const set = Object.entries(options).filter(([, value]) => value !== undefined);
    await use({ ...contextOptions, ...Object.fromEntries(set) });
  },

  actor: async (
    {
      browser,
      playwright,
      launchOptions,
      remoteBrowsers,
      hostRules,
      _actorContextOptions,
      _recorders,
    },
    use,
  ) => {
    const rules = "--host-resolver-rules=";
    const options = hostRules
      ? {
          ...launchOptions,
          args: launchOptions.args?.map((arg) =>
            arg.startsWith(rules) ? `${rules}${hostRules}, ${arg.slice(rules.length)}` : arg,
          ),
        }
      : launchOptions;
    const opened: BrowserContext[] = [];
    const remotes: Browser[] = [];
    await use(async (name) => {
      assertActorName(name);
      if (name === "default") {
        throw new Error('The actor name "default" is the built-in context.');
      }
      if (_recorders.has(name)) {
        throw new Error(`The actor "${name}" already exists.`);
      }
      const ws = remoteBrowsers[name];
      let target = browser;
      if (ws) {
        // run-server drops launch args unless started with --unsafe.
        target = await playwright.chromium.connect(ws, {
          headers: { "x-playwright-launch-options": JSON.stringify(options) },
        });
        remotes.push(target);
      }
      const context = await target.newContext(_actorContextOptions);
      opened.push(context);
      await record(_recorders, name, context);
      return { context, page: await context.newPage() };
    });
    // `_recorders` writes the records once these have closed.
    for (const context of opened) {
      await context.close();
    }
    for (const remote of remotes) {
      await remote.close();
    }
  },

  observed: async ({ _recorders }, use) => {
    await use((name) => {
      const recorder = _recorders.get(name);
      if (!recorder) {
        throw new Error(`No actor named "${name}" in this test.`);
      }
      return { blocked: recorder.blocked, records: () => recorder.records() };
    });
  },
});

async function record(
  recorders: Map<string, Recorder>,
  name: string,
  context: BrowserContext,
): Promise<void> {
  const recorder = new Recorder(name, parseStackOrigins(process.env.FIDANT_E2E_STACK_ORIGINS));
  recorders.set(name, recorder);
  await recorder.attach(context);
  await context.addInitScript(logPeerFailures);
}

/** Runs in the page through addInitScript, so it may use nothing from this module: logs why a peer connection call failed, every error the page builds and its cause, what a data channel refused, how often a channel opened and gained a message listener, and who closed a peer or channel after which frames, which the app keeps out of its console. */
function logPeerFailures() {
  const log = (text: string) => console.warn(`fidant-e2e: ${text}`);
  const native = (fn: unknown) =>
    typeof fn === "function" && Function.prototype.toString.call(fn).includes("[native code]");
  const NativeError = Error;
  const frames = (stack: string | undefined, skip: number, count: number) =>
    (stack ?? "")
      .split("\n")
      .slice(skip, skip + count)
      .map((line) => line.trim())
      .join(" | ");
  const stack = () => {
    const limit = NativeError.stackTraceLimit;
    NativeError.stackTraceLimit = 20;
    const lines = frames(new NativeError().stack, 3, 20);
    NativeError.stackTraceLimit = limit;
    return lines;
  };
  const describe = (error: unknown) =>
    error instanceof NativeError
      ? `${error.name}: ${error.message} | ${frames(error.stack, 1, 3)}`
      : String(error);
  const built = (args: unknown[]) => {
    const cause = (args[1] as { cause?: unknown } | undefined)?.cause;
    log(
      `error built: ${String(args[0])}${cause === undefined ? "" : ` (cause ${describe(cause)})`}`,
    );
  };
  globalThis.Error = new Proxy(NativeError, {
    construct(target, args: unknown[], newTarget: () => unknown) {
      built(args);
      return Reflect.construct(target, args, newTarget) as object;
    },
    apply(target, self, args: unknown[]) {
      built(args);
      return Reflect.apply(target, self, args) as object;
    },
  });
  const peer = RTCPeerConnection.prototype as unknown as Record<string, unknown>;
  for (const name of [
    "createOffer",
    "createAnswer",
    "setLocalDescription",
    "setRemoteDescription",
    "addIceCandidate",
  ]) {
    const method = peer[name];
    if (!native(method)) {
      continue;
    }
    peer[name] = function (this: RTCPeerConnection, ...args: unknown[]) {
      return (
        Reflect.apply(method as () => Promise<unknown>, this, args) as Promise<unknown>
      ).catch((error: unknown) => {
        const { name: kind, message } = error as Error;
        log(`${name} rejected: ${kind}: ${message}`);
        throw error;
      });
    };
  }
  // Frame headers only (kind, seq, length): the bytes after them are keys, names and file data.
  const trails = new WeakMap<RTCDataChannel, { in: string[]; out: string[] }>();
  const note = (channel: RTCDataChannel, way: "in" | "out", data: unknown) => {
    let entry: string = typeof data;
    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      const view =
        data instanceof ArrayBuffer
          ? new DataView(data)
          : new DataView(data.buffer, data.byteOffset, data.byteLength);
      entry =
        view.byteLength < 10
          ? `?:${view.byteLength}`
          : `${view.getUint8(1)}#${view.getUint32(6)}:${view.byteLength}`;
    }
    const trail = trails.get(channel) ?? { in: [], out: [] };
    trails.set(channel, trail);
    trail[way] = [...trail[way], entry].slice(-12);
  };
  const channelProto = RTCDataChannel.prototype;
  const listen = channelProto.addEventListener;
  const watched = new WeakSet<RTCDataChannel>();
  // FID-194: a second reader on one channel would explain a transfer that fails after it
  // accepted, so log each open and each message listener added or removed, with how many are live.
  // A per-page counter tags each channel, so the lines of several channels can be told apart.
  const tags = new WeakMap<RTCDataChannel, string>();
  let tagged = 0;
  const channelTag = (channel: RTCDataChannel) => {
    let known = tags.get(channel);
    if (known === undefined) {
      known = `c${++tagged}`;
      tags.set(channel, known);
    }
    return known;
  };
  const readers = new WeakMap<RTCDataChannel, Set<unknown>>();
  const onopen = Object.getOwnPropertyDescriptor(channelProto, "onopen");
  if (onopen?.set) {
    const { set } = onopen;
    Object.defineProperty(channelProto, "onopen", {
      ...onopen,
      set(this: RTCDataChannel, handler: unknown) {
        Reflect.apply(set, this, [
          typeof handler === "function"
            ? function (this: RTCDataChannel, event: Event) {
                log(`channel ${channelTag(this)} open in ${this.readyState}`);
                return Reflect.apply(handler, this, [event]) as unknown;
              }
            : handler,
        ]);
      },
    });
  }
  channelProto.addEventListener = function (this: RTCDataChannel, ...args: unknown[]) {
    if (args[0] === "message") {
      const live = readers.get(this) ?? new Set();
      readers.set(this, live);
      live.add(args[1]);
      log(`channel ${channelTag(this)} message listener added, ${live.size} live, ${stack()}`);
    }
    if (!watched.has(this)) {
      watched.add(this);
      Reflect.apply(listen, this, [
        "message",
        (event: MessageEvent) => note(this, "in", event.data),
      ]);
      Reflect.apply(listen, this, [
        "error",
        ({ error }: RTCErrorEvent) =>
          log(`channel error: ${error.errorDetail} ${error.sctpCauseCode ?? ""}: ${error.message}`),
      ]);
    }
    return Reflect.apply(listen, this, args);
  } as RTCDataChannel["addEventListener"];
  const unlisten = channelProto.removeEventListener;
  channelProto.removeEventListener = function (this: RTCDataChannel, ...args: unknown[]) {
    const live = readers.get(this);
    if (args[0] === "message" && live?.delete(args[1])) {
      log(`channel ${channelTag(this)} message listener removed, ${live.size} live`);
    }
    return Reflect.apply(unlisten, this, args);
  } as RTCDataChannel["removeEventListener"];
  const send = channelProto.send;
  channelProto.send = function (this: RTCDataChannel, data: unknown) {
    try {
      Reflect.apply(send, this, [data]);
    } catch (error) {
      log(`channel ${channelTag(this)} send() threw in ${this.readyState}: ${describe(error)}`);
      throw error;
    }
    note(this, "out", data);
  } as RTCDataChannel["send"];
  for (const [label, proto] of [
    ["peer", RTCPeerConnection.prototype],
    ["channel", channelProto],
  ] as const) {
    const close = proto.close;
    if (!native(close)) {
      continue;
    }
    proto.close = function (this: unknown) {
      const seen = this instanceof RTCDataChannel ? trails.get(this) : undefined;
      const trail =
        this instanceof RTCDataChannel
          ? seen
            ? ` after in ${seen.in.join(" ")} out ${seen.out.join(" ")}`
            : " after no frames"
          : "";
      const name = this instanceof RTCDataChannel ? `channel ${channelTag(this)}` : label;
      log(`${name} close() ${stack()}${trail}`);
      Reflect.apply(close, this, []);
    };
  }
}

/** A watched person's name, unique to this run. */
export function makeName(leaks: Leaks, canary: SeededRandom, first: string): string {
  const name = `${first}-${base32Token(canary.fork(`name ${first}`), 8)}`;
  leaks.watchText(`name ${first}`, name);
  return name;
}

export const recipientRow = (sender: Page, name: string) =>
  sender.getByRole("list", { name: "Recipients" }).getByRole("listitem").filter({ hasText: name });

export const delivered = (sender: Page, name: string) =>
  recipientRow(sender, name).getByText(`Delivered through ${name}'s link`);

/**
 * The page's Traces panel, opened with the bar's Traces button unless it is open already, since a
 * second press would close it. Closed until then; at the default 1280 px it opens beside the page,
 * not modal, so the page stays usable.
 */
export async function openTraces(page: Page): Promise<Locator> {
  const traces = page.getByRole("dialog", { name: "Traces" });
  if ((await traces.count()) === 0) {
    await page.getByRole("button", { name: /^Traces/ }).click();
  }
  return traces;
}

/** Chooses a file the send page accepts, by its path or as name, type and bytes, then waits for the page to move focus to "Your name" a frame later, which would otherwise take the text of a field being filled, and continues to step 2. */
export async function chooseFile(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const input = page.getByLabel("Choose a file");
  await input.focus();
  await input.setInputFiles(file);
  await expect(page.getByLabel("Your name")).toBeFocused();
  await continueToLinks(page);
}

/** The text the send page's bottom bar shows, which screen readers don't get from the bar itself. Its other texts are in the page but hidden, keeping their space. */
export const barText = (page: Page, text: string) =>
  page.locator("[data-page-bar]").getByText(text, { exact: true }).filter({ visible: true });

/** Clicks Continue in step 1, which reveals step 2, and waits for the frame that focuses its name field. Step 2 is absent until then, and the bottom bar names step 1 until it opens. */
export async function continueToLinks(page: Page): Promise<void> {
  const heading = page.getByRole("heading", { name: "Add recipients" });
  await expect(heading).toHaveCount(0);
  await expect(barText(page, "Step 2 of 3: Add recipients")).toHaveCount(0);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(barText(page, "Step 2 of 3: Add recipients")).toBeInViewport();
  await expect(page.getByRole("textbox", { name: "Who is it for?" })).toBeFocused();
  await expectStepAtTop(heading);
  await expect(page.getByRole("heading", { name: "Share the links" })).toHaveCount(0);
}

/** Expects the glide to the step that `heading` heads to have ended with the step's top at its scroll margin, and the heading just under the header. */
export async function expectStepAtTop(heading: Locator): Promise<void> {
  await expect
    .poll(() =>
      heading.evaluate((element) => {
        const step = element.closest("section");
        const header = document.querySelector("header");
        if (!step || !header) {
          return "no step or no header";
        }
        const off =
          step.getBoundingClientRect().top - parseFloat(getComputedStyle(step).scrollMarginTop);
        const below = element.getBoundingClientRect().top - header.getBoundingClientRect().bottom;
        return Math.abs(off) <= 2 && below >= 0 && below <= 120
          ? "at the top"
          : `step ${off}px from its scroll margin, heading ${below}px below the header`;
      }),
    )
    .toBe("at the top");
}

/** Runs in the page through addInitScript, so it may use nothing from this module: `cut()` closes its peers, `stalled` (set after `stallAt` CHUNKs) drops what its channels send, `held` queues it for `release()`, and `sent` counts frames by kind. */
export function breakableSender() {
  const g = globalThis as {
    cut?: () => void;
    stalled?: boolean;
    stallAt?: number;
    held?: boolean;
    release?: () => void;
    sent?: Record<number, number>;
  };
  const CHUNK = 2;
  const sent: Record<number, number> = {};
  const queue: Array<() => void> = [];
  g.sent = sent;
  g.release = () => {
    g.held = false;
    for (const flush of queue.splice(0)) {
      flush();
    }
  };
  const peers: RTCPeerConnection[] = [];
  const Native = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class extends Native {
    constructor(config?: RTCConfiguration) {
      super(config);
      peers.push(this);
    }
  };
  g.cut = () => {
    for (const peer of peers) {
      peer.close();
    }
  };
  const send = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (this: RTCDataChannel, ...args: unknown[]) {
    if (g.stalled) {
      return;
    }
    const out = () => {
      Reflect.apply(send, this, args);
      const [frame] = args;
      const kind = frame instanceof Uint8Array ? (frame[1] ?? -1) : -1;
      sent[kind] = (sent[kind] ?? 0) + 1;
      if (kind === CHUNK && sent[kind] === g.stallAt) {
        g.stalled = true;
      }
    };
    if (g.held) {
      queue.push(out);
    } else {
      out();
    }
  } as RTCDataChannel["send"];
}

/**
 * Runs in the page through addInitScript, so it may use nothing from this module. Simulates a route
 * that drops under an open peer connection (decision 0031) without touching the network:
 * `dropRoute()` makes every peer report "disconnected" and queues what its channels send, until
 * that peer's local ICE password changed in a stable signaling state, the end of an ICE restart.
 * Then it lets the queue go and reports the browser's own state again. `holdAt` queues the
 * channels' frames from that CHUNK on, so a transfer is still in flight, and sets `held`.
 */
export function breakableRoute() {
  const g = globalThis as { dropRoute?: () => void; holdAt?: number; held?: boolean };
  const CHUNK = 2;
  let chunks = 0;
  const queue: Array<() => void> = [];
  const release = () => {
    g.held = false;
    for (const flush of queue.splice(0)) {
      flush();
    }
  };
  const peers: RTCPeerConnection[] = [];
  const Native = globalThis.RTCPeerConnection;
  globalThis.RTCPeerConnection = class extends Native {
    constructor(config?: RTCConfiguration) {
      super(config);
      peers.push(this);
    }
  };
  // Firefox's dispatchEvent reaches listeners but not the onconnectionstatechange handler, so the
  // handler is called directly, once, in every engine.
  const announce = (pc: RTCPeerConnection) => {
    const event = new Event("connectionstatechange");
    const handler = pc.onconnectionstatechange;
    pc.onconnectionstatechange = null;
    pc.dispatchEvent(event);
    pc.onconnectionstatechange = handler;
    handler?.call(pc, event);
  };
  const pwdOf = (pc: RTCPeerConnection) =>
    /^a=ice-pwd:(\S+)/m.exec(pc.currentLocalDescription?.sdp ?? "")?.[1];
  g.dropRoute = () => {
    g.held = true;
    for (const pc of peers) {
      const before = pwdOf(pc);
      Object.defineProperty(pc, "connectionState", {
        configurable: true,
        get: () => "disconnected",
      });
      const lift = () => {
        if (pc.signalingState !== "stable" || pwdOf(pc) === before) {
          return;
        }
        pc.removeEventListener("signalingstatechange", lift);
        Reflect.deleteProperty(pc, "connectionState");
        release();
        announce(pc);
      };
      pc.addEventListener("signalingstatechange", lift);
      announce(pc);
    }
  };
  const send = RTCDataChannel.prototype.send;
  RTCDataChannel.prototype.send = function (this: RTCDataChannel, ...args: unknown[]) {
    const out = () => Reflect.apply(send, this, args);
    if (g.held) {
      queue.push(out);
      return;
    }
    out();
    const [frame] = args;
    if (frame instanceof Uint8Array && frame[1] === CHUNK && ++chunks === g.holdAt) {
      g.held = true;
    }
  } as RTCDataChannel["send"];
}

/** A page's /signal sockets, passed through to the server until one is cut. */
export interface CuttableSignal {
  /**
   * Cuts the page's first socket the way a lost network does: the page side closes, while the
   * server side stays open and hears nothing more. Resolves once the page side is closed.
   */
  cut(): Promise<void>;
  /** Stops forwarding in both directions without closing the page side: the socket is dead but looks open. */
  silence(): void;
  /** The `t` of each message the page sent into a cut or silenced socket, which the server never saw. */
  swallowed(): string[];
  /** When the server closed the cut socket's server side, or undefined while it is open. */
  serverClosedAt(): number | undefined;
}

/** Routes `page`'s /signal sockets through Playwright so that `cut()` can drop the first one. */
export async function cuttableSignal(page: Page): Promise<CuttableSignal> {
  const sockets: { page: WebSocketRoute; server: WebSocketRoute; cut: boolean }[] = [];
  let closedAt: number | undefined;
  const swallowed: string[] = [];
  await page.routeWebSocket("/signal", (ws) => {
    const server = ws.connectToServer();
    const socket = { page: ws, server, cut: false };
    sockets.push(socket);
    ws.onMessage((message) => {
      if (!socket.cut) {
        server.send(message);
      } else if (typeof message === "string") {
        try {
          swallowed.push(String((JSON.parse(message) as { t?: unknown }).t));
        } catch {
          swallowed.push("?");
        }
      }
    });
    server.onMessage((message) => {
      if (!socket.cut) {
        ws.send(message);
      }
    });
  });
  return {
    silence() {
      const [first] = sockets;
      if (!first) {
        throw new Error("The page opened no /signal socket to silence.");
      }
      first.cut = true;
    },
    async cut() {
      const [first] = sockets;
      if (!first) {
        throw new Error("The page opened no /signal socket to cut.");
      }
      first.cut = true;
      // A handler of its own stops Playwright from passing a close on to the other side.
      first.page.onClose(() => {});
      first.server.onClose(() => {
        closedAt = Date.now();
      });
      await first.page.close({ code: 1006 });
    },
    swallowed: () => [...swallowed],
    serverClosedAt: () => closedAt,
  };
}

/**
 * Runs in the recipient page through addInitScript, so it may use nothing from this module. A
 * save dialog that does what `globalThis.pick` says: `cancel` closes it, `refuse` is denied, `fail`
 * picks a file whose second write runs out of space, and anything else picks a file that takes
 * every write. Each write it takes adds its bytes to `globalThis.written`, and each call is logged
 * to `globalThis.saved`, starting with the dialog itself (`pick`).
 */
export function fakeSavePicker() {
  const g = globalThis as {
    pick?: string;
    saved?: string[];
    written?: number;
    showSaveFilePicker?: unknown;
  };
  const log = (call: string) => g.saved?.push(call);
  g.showSaveFilePicker = async () => {
    log("pick");
    const mode = g.pick;
    if (mode === "cancel") {
      throw new DOMException("The user aborted a request.", "AbortError");
    }
    if (mode === "refuse") {
      throw new DOMException("Not allowed.", "NotAllowedError");
    }
    let writes = 0;
    return {
      createWritable: async () => ({
        write: async (data: Uint8Array) => {
          log("write");
          if (mode === "fail" && ++writes === 2) {
            throw new DOMException("No space left.", "QuotaExceededError");
          }
          g.written = (g.written ?? 0) + data.byteLength;
        },
        close: async () => log("close"),
        abort: async () => log("abort"),
      }),
      remove: async () => log("remove"),
    };
  };
}

/** Lets `context`'s pages at `origin` read and write the clipboard, with the permissions each engine has. Playwright's Firefox needs none. */
export async function allowClipboard(context: BrowserContext, origin: string): Promise<void> {
  const permissions: Record<string, string[]> = {
    chromium: ["clipboard-read", "clipboard-write"],
    webkit: ["clipboard-read"],
  };
  const engine = context.browser()?.browserType().name() ?? "";
  await context.grantPermissions(permissions[engine] ?? [], { origin });
}

/** Opens a footer menu by its button name, picks one of its radio options and waits for the menu to close. */
export async function choose(page: Page, menu: string, option: string): Promise<void> {
  await page.locator("footer").getByRole("button", { name: menu }).click();
  await page.getByRole("menuitemradio", { name: option }).click();
  await expect(page.getByRole("menu")).toBeHidden();
}
