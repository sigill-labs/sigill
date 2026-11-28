// A log of the traces one page's transfer leaves, as data. The text for it lives under `traces`
// in the dictionaries.
//
// The page feeds it events as it sees them: its signaling socket opening and closing, each
// message it sends or receives, and what its peer connection does. Each event adds lines that say
// which part holds what, and until when. A line for something that lasts stays open until the
// event that ends it, which closes it with the time this page saw that; otherwise its end is what
// the server or relay is documented to do (apps/server/src/signaling.ts, docs/how-fidant-works.md).
//
// The log lives only in page memory and this module uses no network or storage API. It keeps link
// IDs only as the server logs them, their first 6 characters, and reads each message field by
// field, so a key, token, credential, address or name can never reach a line.

import type {
  ClientMessage,
  ConnectionPath,
  ErrorCode,
  RefusedReason,
  ServerMessage,
} from "@fidant/protocol";

/** The most lines a log keeps; older ones are dropped first. */
export const MAX_ENTRIES = 500;

/** How many characters of a link ID the server logs, and this log shows. */
const LINK_PREFIX = 6;

/** Which page keeps the log. */
export type Role = "sender" | "recipient";

/** Who holds a trace: our server, our server's log, our relay, this browser, the other browser, or the route between them. */
export type Part = "server" | "serverLog" | "relay" | "browser" | "peer" | "connection";

/** A path a connection that opened took. */
export type OpenPath = Exclude<ConnectionPath, "failed">;

/**
 * What a part is documented to do with a trace:
 * - `connection`: until this page's connection to the server closes, at once when it closes cleanly.
 * - `dropped`: the connection dropped, so the server lets go within a minute, and keeps a transfer's place up to 30 s.
 * - `log30d`: in our server's log for 30 days.
 * - `notKept`: passed on or made, and not kept.
 * - `tab`: while the tab is open.
 * - `credential5m`: usable for 5 minutes to start a relayed connection.
 * - `relay7d`: our relay keeps no log; a temporary one, only to fix a fault or stop abuse, for at most 7 days.
 * - `history`: until the browser's history is cleared.
 * - `peerConnection`: until the connection between the two browsers closes.
 * - `attempt`: until this transfer attempt ends.
 */
export type Stated =
  | "connection"
  | "dropped"
  | "log30d"
  | "notKept"
  | "tab"
  | "credential5m"
  | "relay7d"
  | "history"
  | "peerConnection"
  | "attempt";

/** When a trace goes away: seen by this page at `at`, as documented, or never on its own. */
export type Until =
  | { kind: "seen"; at: number }
  | { kind: "stated"; how: Stated }
  | { kind: "stays" };

/** What a part holds. `link` is always a 6-character prefix. */
export type What =
  // Our server
  | { kind: "connected" }
  | { kind: "holdsLink"; link: string }
  | { kind: "alreadyHosted" }
  | { kind: "paired"; link: string }
  | { kind: "rejoined"; link: string }
  | { kind: "credentials" }
  | { kind: "relayed"; link: string; count: number; bytes: number }
  | { kind: "serverToken"; link: string }
  // Our server's log
  | { kind: "logHost"; links: number }
  | { kind: "logJoined"; link: string }
  | { kind: "logRelay"; link: string; count: number; bytes: number }
  | { kind: "logRefused"; reason: RefusedReason }
  | { kind: "logLeft"; link: string }
  | { kind: "logHostGone" }
  | { kind: "logHostClosed"; links: number }
  | { kind: "logPath"; path: ConnectionPath }
  | { kind: "logResume"; link: string; refused: boolean }
  | { kind: "logError"; code: ErrorCode }
  // Our relay
  | { kind: "stunSees" }
  | { kind: "relayAdded" }
  | { kind: "relayCarries" }
  // This browser
  | { kind: "linkKey"; link: string }
  | { kind: "relayCredentials" }
  | { kind: "browserToken"; link: string }
  | { kind: "addressBar" }
  | { kind: "received"; secret: boolean }
  | { kind: "newTransfer" }
  // The other browser
  | { kind: "delivered"; secret: boolean }
  // The connection
  | { kind: "path"; path: OpenPath };

const PARTS: Record<What["kind"], Part> = {
  connected: "server",
  holdsLink: "server",
  alreadyHosted: "server",
  paired: "server",
  rejoined: "server",
  credentials: "server",
  relayed: "server",
  serverToken: "server",
  logHost: "serverLog",
  logJoined: "serverLog",
  logRelay: "serverLog",
  logRefused: "serverLog",
  logLeft: "serverLog",
  logHostGone: "serverLog",
  logHostClosed: "serverLog",
  logPath: "serverLog",
  logResume: "serverLog",
  logError: "serverLog",
  stunSees: "relay",
  relayAdded: "relay",
  relayCarries: "relay",
  linkKey: "browser",
  relayCredentials: "browser",
  browserToken: "browser",
  addressBar: "browser",
  received: "browser",
  newTransfer: "browser",
  delivered: "peer",
  path: "connection",
};

/**
 * One line. `at` is when this page saw the event, in ms since the epoch. `open` names a line that
 * a later event can close; it holds no more than the line itself.
 */
export type TraceEntry = {
  readonly at: number;
  readonly part: Part;
  readonly what: What;
  readonly until: Until;
  readonly open?: string;
};

/** A signaling message, reduced to what the log may show. */
export type Signal =
  // Sent
  | { t: "host"; links: string[] }
  | { t: "refuse"; link: string; reason: RefusedReason }
  | { t: "path"; path: ConnectionPath }
  | { t: "resume"; link: string }
  // Received
  | { t: "joined"; link: string; stun: boolean; turn: boolean }
  | { t: "left"; link: string }
  | { t: "refused"; reason: RefusedReason }
  | { t: "host-gone" }
  | { t: "error"; code: ErrorCode }
  | { t: "resume-answer"; link: string; token: boolean }
  // Either way
  | { t: "relay"; link: string; bytes: number };

/** What the page saw. `link` may be a whole link ID; the log keeps only its prefix. */
export type TraceEvent =
  | { t: "socket-open" }
  | { t: "socket-closed"; code: number }
  | { t: "signal"; signal: Signal }
  | { t: "link-added"; link: string }
  | { t: "link-removed"; link: string }
  | { t: "relay-added"; link?: string }
  | { t: "path"; path: OpenPath; link?: string }
  | { t: "peer-closed"; link?: string }
  | { t: "delivered"; secret: boolean }
  | { t: "address-bar" }
  | { t: "received"; secret: boolean }
  | { t: "new-transfer" };

export type TraceLog = {
  readonly role: Role;
  readonly entries: readonly TraceEntry[];
  /** The link prefixes the last `host` on this socket named; undefined before the first. */
  readonly hosted?: readonly string[];
  /** Links this page sent a `resume` for and has no answer to yet. */
  readonly resuming: readonly string[];
};

export function createTraceLog(role: Role): TraceLog {
  return { role, entries: [], resuming: [] };
}

function prefix(link: string): string {
  return link.slice(0, LINK_PREFIX);
}

/** A message the page sent or received, as `onMessage` reports it. */
export type SignalMessage = ["sent", ClientMessage] | ["received", ServerMessage];

/**
 * The event for a message, or undefined for one the log leaves out (hello and the email paths).
 * It copies only the fields it names, so a secret, token, credential, address or mark never
 * reaches the log.
 */
export function fromMessage(...[dir, message]: SignalMessage): TraceEvent | undefined {
  const signal = dir === "sent" ? fromSent(message) : fromReceived(message);
  return signal && { t: "signal", signal };
}

function fromSent(message: ClientMessage): Signal | undefined {
  switch (message.t) {
    case "host":
      return { t: "host", links: message.links.map(prefix) };
    case "relay":
      return { t: "relay", link: prefix(message.link), bytes: message.data.length };
    case "refuse":
      return { t: "refuse", link: prefix(message.link), reason: message.reason };
    case "path":
      return { t: "path", path: message.path };
    case "resume":
      return { t: "resume", link: prefix(message.link) };
    default:
      return undefined;
  }
}

function fromReceived(message: ServerMessage): Signal | undefined {
  switch (message.t) {
    case "joined": {
      const urls = message.iceServers.flatMap((server) => server.urls);
      return {
        t: "joined",
        link: prefix(message.link),
        stun: urls.some((url) => url.startsWith("stun:")),
        turn: urls.some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
      };
    }
    case "left":
      return { t: "left", link: prefix(message.link) };
    case "relay":
      return { t: "relay", link: prefix(message.link), bytes: message.data.length };
    case "refused":
      return { t: "refused", reason: message.reason };
    case "host-gone":
      return { t: "host-gone" };
    case "error":
      return { t: "error", code: message.code };
    case "resume":
      return {
        t: "resume-answer",
        link: prefix(message.link),
        token: message.token !== undefined,
      };
    default:
      return undefined;
  }
}

const SEEN_ON_CLOSE = new Set<What["kind"]>(["connected", "holdsLink", "paired", "serverToken"]);

/** Adds the lines for an event. Returns a new log; the old one is left as it was. */
export function record(log: TraceLog, event: TraceEvent, now: number): TraceLog {
  const entries = [...log.entries];
  let { hosted, resuming } = log;

  const add = (what: What, until: Until, open?: string) => {
    entries.push({ at: now, part: PARTS[what.kind], what, until, ...(open && { open }) });
  };
  const stated = (how: Stated): Until => ({ kind: "stated", how });
  const seen: Until = { kind: "seen", at: now };
  /** Ends every open line `match` picks, by default as seen now. */
  const close = (match: (entry: TraceEntry) => boolean, until: Until = seen) => {
    entries.forEach((entry, index) => {
      if (entry.open !== undefined && match(entry)) {
        entries[index] = { at: entry.at, part: entry.part, what: entry.what, until };
      }
    });
  };
  const closeKey = (key: string) => close((entry) => entry.open === key);
  const isOpen = (key: string) => entries.some((entry) => entry.open === key);

  switch (event.t) {
    case "socket-open":
      hosted = undefined;
      add({ kind: "connected" }, stated("connection"), "socket");
      break;
    case "socket-closed": {
      if (!isOpen("socket")) {
        break; // An attempt that never opened left nothing.
      }
      // Only a connection that dropped with no close frame is held (decision 0033).
      const held = event.code === 1006;
      if (hosted !== undefined && hosted.length > 0) {
        add({ kind: "logHostClosed", links: hosted.length }, stated("log30d"));
      }
      if (log.role === "recipient" && !held) {
        for (const entry of entries) {
          if (entry.open !== undefined && entry.what.kind === "paired") {
            add({ kind: "logLeft", link: entry.what.link }, stated("log30d"));
          }
        }
      }
      close((entry) => SEEN_ON_CLOSE.has(entry.what.kind), held ? stated("dropped") : seen);
      hosted = undefined;
      resuming = [];
      break;
    }
    case "signal":
      signal(event.signal);
      break;
    case "link-added":
      add(
        { kind: "linkKey", link: prefix(event.link) },
        stated("tab"),
        `key:${prefix(event.link)}`,
      );
      break;
    case "link-removed":
      closeKey(`key:${prefix(event.link)}`);
      break;
    case "relay-added": {
      const key = `relay:${prefix(event.link ?? "")}`;
      closeKey(key);
      add({ kind: "relayAdded" }, stated("peerConnection"), key);
      break;
    }
    case "path": {
      const key = `path:${prefix(event.link ?? "")}`;
      closeKey(key);
      add({ kind: "path", path: event.path }, stated("peerConnection"), key);
      if (event.path === "relay") {
        add({ kind: "relayCarries" }, stated("notKept"));
      }
      break;
    }
    case "peer-closed":
      closeKey(`path:${prefix(event.link ?? "")}`);
      closeKey(`relay:${prefix(event.link ?? "")}`);
      break;
    case "delivered":
      add(
        { kind: "delivered", secret: event.secret },
        event.secret ? stated("tab") : { kind: "stays" },
      );
      break;
    case "received":
      add(
        { kind: "received", secret: event.secret },
        event.secret ? stated("tab") : { kind: "stays" },
      );
      break;
    case "address-bar":
      add({ kind: "addressBar" }, stated("history"));
      break;
    case "new-transfer":
      close((entry) => entry.what.kind === "linkKey" || entry.what.kind === "browserToken");
      add({ kind: "newTransfer" }, stated("tab"));
      break;
  }

  function signal(message: Signal): void {
    switch (message.t) {
      case "host": {
        const before = hosted ?? [];
        const next = message.links;
        for (const link of next.filter((link) => !before.includes(link))) {
          add({ kind: "holdsLink", link }, stated("connection"), `host:${link}`);
        }
        for (const link of before.filter((link) => !next.includes(link))) {
          closeKey(`host:${link}`);
        }
        // The server logs a host only when its links change, or on a socket's first host.
        const changed =
          hosted === undefined ||
          next.length !== before.length ||
          next.some((link) => !before.includes(link));
        if (changed) {
          add({ kind: "logHost", links: next.length }, stated("log30d"));
        }
        hosted = next;
        break;
      }
      case "joined": {
        const key = `pair:${message.link}`;
        if (isOpen(key)) {
          add({ kind: "rejoined", link: message.link }, stated("log30d"));
        } else {
          add({ kind: "paired", link: message.link }, stated("connection"), key);
        }
        add({ kind: "logJoined", link: message.link }, stated("log30d"));
        if (message.turn) {
          add({ kind: "credentials" }, stated("notKept"));
          add({ kind: "relayCredentials" }, stated("credential5m"));
        }
        if (message.stun) {
          add({ kind: "stunSees" }, stated("relay7d"));
        }
        break;
      }
      case "relay":
        relay(message.link, message.bytes);
        break;
      case "refuse":
        closeKey(`pair:${message.link}`);
        add({ kind: "logRefused", reason: message.reason }, stated("log30d"));
        break;
      case "left":
        closeKey(`pair:${message.link}`);
        add({ kind: "logLeft", link: message.link }, stated("log30d"));
        break;
      case "refused":
        add({ kind: "logRefused", reason: message.reason }, stated("log30d"));
        break;
      case "host-gone":
        close((entry) => entry.what.kind === "paired");
        add({ kind: "logHostGone" }, stated("log30d"));
        break;
      case "error":
        add({ kind: "logError", code: message.code }, stated("log30d"));
        if (message.code === "already-hosted") {
          add({ kind: "alreadyHosted" }, stated("notKept"));
        }
        break;
      case "path":
        add({ kind: "logPath", path: message.path }, stated("log30d"));
        break;
      case "resume":
        closeKey(`token:${message.link}`);
        resuming = [...resuming, message.link];
        break;
      case "resume-answer": {
        const asked = resuming.includes(message.link);
        if (asked) {
          add({ kind: "logResume", link: message.link, refused: !message.token }, stated("log30d"));
        }
        if (message.token) {
          closeKey(`server-token:${message.link}`);
          closeKey(`token:${message.link}`);
          add(
            { kind: "serverToken", link: message.link },
            stated("attempt"),
            `server-token:${message.link}`,
          );
          add({ kind: "browserToken", link: message.link }, stated("tab"), `token:${message.link}`);
        }
        resuming = resuming.filter((link) => link !== message.link);
        break;
      }
    }
  }

  /**
   * Counts a relay message on the link's two lines, while only relay lines came after them. Each
   * message adds or updates both, so the trailing run holds at most one pair per link.
   */
  function relay(link: string, bytes: number) {
    let counted = false;
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      const what = entry?.what;
      if (!entry || (what?.kind !== "relayed" && what?.kind !== "logRelay")) {
        break;
      }
      if (what.link === link) {
        const sum = { count: what.count + 1, bytes: what.bytes + bytes };
        entries[index] = { ...entry, what: { ...what, ...sum } };
        counted = true;
      }
    }
    if (counted) {
      return;
    }
    add({ kind: "relayed", link, count: 1, bytes }, stated("notKept"));
    add({ kind: "logRelay", link, count: 1, bytes }, stated("log30d"));
  }

  return {
    role: log.role,
    entries: entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries,
    resuming,
    ...(hosted !== undefined && { hosted }),
  };
}
