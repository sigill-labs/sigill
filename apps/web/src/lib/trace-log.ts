// A log of the traces one page's transfer leaves, as data. The text for it lives under `traces`
// in the dictionaries.
//
// The page feeds it events as it sees them: its signaling socket opening and closing, each
// message it sends or receives, and what its peer connection does. Each event adds lines that say
// who holds what, and until when. A line for something that lasts stays open until the
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
import type { OpenPath } from "./peer.ts";

/** The most lines a log keeps; older ones are dropped first. */
export const MAX_ENTRIES = 500;

/** How many characters of a link ID the server logs, and this log shows. */
const LINK_PREFIX = 6;

/** Which page keeps the log. */
export type Role = "sender" | "recipient";

/**
 * What a holder is documented to do with a trace:
 * - `connection`: until this page's connection to the server closes, at once when it closes cleanly.
 * - `dropped`: the connection dropped, so the server lets go within a minute, and keeps a transfer's place up to 30 s.
 * - `log30d`: in our server's log for 30 days.
 * - `notKept`: passed on or made, and not kept.
 * - `tab`: while the tab is open.
 * - `credential5m`: usable for 5 minutes to start a relayed connection.
 * - `relayNoLog`: our relay keeps no log of it; a temporary log, only to fix a fault or stop abuse, for at most 7 days.
 * - `relayAllocation`: while the relay's allocation lasts, which can outlast the connection between the two browsers; a temporary relay log, only to fix a fault or stop abuse, for at most 7 days.
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
  | "relayNoLog"
  | "relayAllocation"
  | "history"
  | "peerConnection"
  | "attempt";

/** When a trace goes away: seen by this page at `at`, as documented, or never on its own. */
export type Until =
  | { kind: "seen"; at: number }
  | { kind: "stated"; how: Stated }
  | { kind: "stays" };

/** What a holder holds. `link` is always a 6-character prefix. */
export type What =
  // Our server
  | { kind: "connected" }
  | { kind: "holdsLink"; link: string }
  | { kind: "holdsLinkMaybe"; link: string }
  | { kind: "alreadyHosted" }
  | { kind: "paired"; link: string }
  | { kind: "rejoined"; link: string }
  | { kind: "credentials" }
  | { kind: "relayed"; link: string; count: number; bytes: number }
  | { kind: "serverToken"; link: string }
  // Our server's log
  /** `links` is undefined when another connection held a link, so the server's count is not known here. */
  | { kind: "logHost"; links: number | undefined }
  | { kind: "logJoined"; link: string }
  | { kind: "logRelay"; link: string; count: number; bytes: number }
  | { kind: "logRefused"; reason: RefusedReason; link: string }
  /** `later`: our server writes it if a dropped recipient's page doesn't take its place back within the hold. */
  | { kind: "logLeft"; link: string; later: boolean }
  /** `later`: our server writes it when it lets go of a dropped connection's links, if the recipient is still there. */
  | { kind: "logHostGone"; link: string; later: boolean }
  | { kind: "logHostClosed"; links: number | undefined }
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

/** Who holds a trace: our server, our relay, a browser by its role, or the route between the browsers. */
export type Who = "server" | "relay" | Role | "connection";

/** Where a holder keeps a trace: in memory, in a log, in the address bar and history, or on disk. */
export type Where = "memory" | "log" | "addressBar" | "disk";

/** A holder relative to the page: this page's browser, or the other one. */
type Holder = Exclude<Who, Role> | "page" | "peer";

// Keyed by kind, so a new kind fails the typecheck until it is placed here. A received or
// delivered secret stays in memory, so placeOf moves it off disk. The route between the browsers
// is kept nowhere, so it has no `where`, and the new-transfer marker has no holder.
const PLACES: Record<What["kind"], { holder: Holder; where?: Where } | undefined> = {
  connected: { holder: "server", where: "memory" },
  holdsLink: { holder: "server", where: "memory" },
  holdsLinkMaybe: { holder: "server", where: "memory" },
  alreadyHosted: { holder: "server", where: "memory" },
  paired: { holder: "server", where: "memory" },
  // The server knows of the drop from its log, which shows the page joining twice.
  rejoined: { holder: "server", where: "log" },
  credentials: { holder: "server", where: "memory" },
  relayed: { holder: "server", where: "memory" },
  serverToken: { holder: "server", where: "memory" },
  logHost: { holder: "server", where: "log" },
  logJoined: { holder: "server", where: "log" },
  logRelay: { holder: "server", where: "log" },
  logRefused: { holder: "server", where: "log" },
  logLeft: { holder: "server", where: "log" },
  logHostGone: { holder: "server", where: "log" },
  logHostClosed: { holder: "server", where: "log" },
  logPath: { holder: "server", where: "log" },
  logResume: { holder: "server", where: "log" },
  logError: { holder: "server", where: "log" },
  stunSees: { holder: "relay", where: "memory" },
  relayAdded: { holder: "relay", where: "memory" },
  relayCarries: { holder: "relay", where: "memory" },
  linkKey: { holder: "page", where: "memory" },
  relayCredentials: { holder: "page", where: "memory" },
  browserToken: { holder: "page", where: "memory" },
  addressBar: { holder: "page", where: "addressBar" },
  received: { holder: "page", where: "disk" },
  newTransfer: undefined,
  delivered: { holder: "peer", where: "disk" },
  path: { holder: "connection" },
};

/** Who holds a line's trace and where, on the page of `role`; undefined for the new-transfer marker. */
export function placeOf(what: What, role: Role): { who: Who; where?: Where } | undefined {
  const place = PLACES[what.kind];
  if (place === undefined) {
    return undefined;
  }
  const who: Who =
    place.holder === "page"
      ? role
      : place.holder === "peer"
        ? role === "sender"
          ? "recipient"
          : "sender"
        : place.holder;
  const secret = (what.kind === "received" || what.kind === "delivered") && what.secret;
  const where = secret ? "memory" : place.where;
  return where === undefined ? { who } : { who, where };
}

/** How long a trace lasts: as long as this page saw it last, as documented, or until deleted. */
export type Duration =
  | { kind: "lasted"; ms: number }
  | { kind: "stated"; how: Stated }
  | { kind: "stays" };

export function duration(entry: TraceEntry): Duration {
  const { until } = entry;
  return until.kind === "seen" ? { kind: "lasted", ms: Math.max(0, until.at - entry.at) } : until;
}

/**
 * One line. `at` is when this page saw the event, in ms since the epoch. `open` names a line that
 * a later event can close; it holds no more than the line itself.
 */
export type TraceEntry = {
  readonly at: number;
  readonly what: What;
  readonly until: Until;
  readonly open?: string;
};

/** How many traces the log still shows as left: every line but the new-transfer marker that this page hasn't seen end and that isn't kept to begin with (passed on, or seen by a relay that keeps no log). */
export function tracesLeft(log: TraceLog): number {
  return log.entries.filter(
    (entry) =>
      entry.what.kind !== "newTransfer" &&
      entry.until.kind !== "seen" &&
      !(
        entry.until.kind === "stated" &&
        (entry.until.how === "notKept" || entry.until.how === "relayNoLog")
      ),
  ).length;
}

/** A signaling message, reduced to what the log may show. */
export type Signal =
  // Sent
  | { t: "host"; links: string[] }
  | { t: "join"; link: string }
  | { t: "refuse"; link: string; attempt: number; reason: RefusedReason }
  | { t: "path"; path: ConnectionPath }
  | { t: "resume"; link: string }
  // Received
  | { t: "joined"; link: string; attempt: number; stun: boolean; turn: boolean }
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

/**
 * What the model needs to tell what the server did, beyond the lines. It is page memory like the
 * lines and is never rendered. Attempt IDs are not keys, but only a tag of each is kept, so no
 * ID is in the log even here.
 */
export type Tracking = {
  /** The tag of the attempt each link's pairing joined with, by link prefix. */
  readonly attempts: Readonly<Record<string, number>>;
  /** Links whose attempt the server holds a resume token for, so a dropped side is held. */
  readonly armed: readonly string[];
  /** The link prefix of the last `join` this page sent. */
  readonly lastJoin?: string;
  /** Links this page sent a repeated `join` for (decision 0031) and has no `joined` for yet. */
  readonly restarting: readonly string[];
  /** Links whose `refuse` this page just sent, with a `refused` line that a `left` would undo. */
  readonly refusing: readonly string[];
  /** Links the last `host` named that were not in the host before it, and whether it was logged. */
  readonly lastHost?: { readonly fresh: readonly string[]; readonly logged: boolean };
  /** True after an `already-hosted` answer: the server holds an unknown part of what `hosted` names. */
  readonly uncertain: boolean;
};

export type TraceLog = {
  readonly role: Role;
  readonly entries: readonly TraceEntry[];
  /** The link prefixes the last `host` on this socket named; undefined before the first. */
  readonly hosted?: readonly string[];
  /** Links this page sent a `resume` for and has no answer to yet. */
  readonly resuming: readonly string[];
  readonly tracking: Tracking;
};

const NO_TRACKING: Tracking = {
  attempts: {},
  armed: [],
  restarting: [],
  refusing: [],
  uncertain: false,
};

export function createTraceLog(role: Role): TraceLog {
  return { role, entries: [], resuming: [], tracking: NO_TRACKING };
}

/** `record` as a `useReducer` reducer: the page stamps each event, so the reducer stays pure. */
export function recordAt(
  log: TraceLog,
  { event, at }: { event: TraceEvent; at: number },
): TraceLog {
  return record(log, event, at);
}

function prefix(link: string): string {
  return link.slice(0, LINK_PREFIX);
}

/**
 * A 32-bit tag of an attempt ID (FNV-1a), enough to tell this page's pairings apart. The log keeps
 * the tag and never the ID.
 */
function tag(attempt: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < attempt.length; index++) {
    hash = Math.imul(hash ^ attempt.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
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
    case "join":
      return { t: "join", link: prefix(message.link) };
    case "relay":
      return { t: "relay", link: prefix(message.link), bytes: message.data.length };
    case "refuse":
      return {
        t: "refuse",
        link: prefix(message.link),
        attempt: tag(message.attempt),
        reason: message.reason,
      };
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
        attempt: tag(message.attempt),
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

const SEEN_ON_CLOSE = new Set<What["kind"]>([
  "connected",
  "holdsLink",
  "holdsLinkMaybe",
  "paired",
  "serverToken",
]);

/** Adds the lines for an event. Returns a new log; the old one is left as it was. */
export function record(log: TraceLog, event: TraceEvent, now: number): TraceLog {
  const entries = [...log.entries];
  let { hosted, resuming } = log;
  let { attempts, armed, lastJoin, restarting, refusing, lastHost, uncertain } = log.tracking;

  const add = (what: What, until: Until, open?: string) => {
    entries.push({ at: now, what, until, ...(open && { open }) });
  };
  const stated = (how: Stated): Until => ({ kind: "stated", how });
  const seen: Until = { kind: "seen", at: now };
  /** Ends every open line `match` picks, by default as seen now. */
  const close = (match: (entry: TraceEntry) => boolean, until: Until = seen) => {
    entries.forEach((entry, index) => {
      if (entry.open !== undefined && match(entry)) {
        entries[index] = { at: entry.at, what: entry.what, until };
      }
    });
  };
  const closeKey = (key: string) => close((entry) => entry.open === key);
  const isOpen = (key: string) => entries.some((entry) => entry.open === key);
  const without = (links: readonly string[], link: string) => links.filter((it) => it !== link);
  const lastIndex = (match: (what: What) => boolean) => {
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry && match(entry.what)) {
        return index;
      }
    }
    return -1;
  };
  /** Ends a link's pairing as seen. Returns whether it was open. */
  const unpair = (link: string) => {
    const was = isOpen(`pair:${link}`);
    closeKey(`pair:${link}`);
    armed = without(armed, link);
    return was;
  };
  /** The sender's server line for a link whose recipient it tells that the sender is gone. */
  const hostGone = (link: string, later: boolean) => {
    if (unpair(link)) {
      add({ kind: "logHostGone", link, later }, stated("log30d"));
    }
  };

  switch (event.t) {
    case "socket-open":
      hosted = undefined;
      uncertain = false;
      lastHost = undefined;
      restarting = [];
      add({ kind: "connected" }, stated("connection"), "socket");
      break;
    case "socket-closed": {
      if (!isOpen("socket")) {
        break; // An attempt that never opened left nothing.
      }
      // Only a connection that dropped with no close frame is held (decision 0033).
      const held = event.code === 1006;
      if (hosted !== undefined && (hosted.length > 0 || uncertain)) {
        // After `already-hosted` the server holds only some of the links, and possibly none.
        add(
          { kind: "logHostClosed", links: uncertain ? undefined : hosted.length },
          stated("log30d"),
        );
      }
      // The server tells a link's recipient that the sender is gone when it unhosts the link: at
      // once on a clean close, and after the hold on a dropped one when the attempt is armed.
      for (const link of hosted ?? []) {
        const pair = entries.find((entry) => entry.open === `pair:${link}`);
        if (pair) {
          add({ kind: "logHostGone", link, later: held && armed.includes(link) }, stated("log30d"));
        }
      }
      if (log.role === "recipient") {
        for (const entry of entries) {
          // A dropped connection is held only while the attempt is armed.
          if (
            entry.open !== undefined &&
            entry.what.kind === "paired" &&
            !(held && armed.includes(entry.what.link))
          ) {
            add({ kind: "logLeft", link: entry.what.link, later: false }, stated("log30d"));
          }
        }
        // A held recipient is let go after the hold, unless this page takes its place back.
        if (held) {
          for (const entry of entries) {
            if (
              entry.open !== undefined &&
              entry.what.kind === "paired" &&
              armed.includes(entry.what.link)
            ) {
              add({ kind: "logLeft", link: entry.what.link, later: true }, stated("log30d"));
            }
          }
        }
      }
      close((entry) => SEEN_ON_CLOSE.has(entry.what.kind), held ? stated("dropped") : seen);
      if (!held) {
        armed = [];
      }
      hosted = undefined;
      uncertain = false;
      lastHost = undefined;
      restarting = [];
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
      add({ kind: "relayAdded" }, stated("relayAllocation"), key);
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
      // Not the relay's line: its allocation can outlast the connection, until its lifetime runs out.
      closeKey(`path:${prefix(event.link ?? "")}`);
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
      attempts = {};
      armed = [];
      lastJoin = undefined;
      restarting = [];
      refusing = [];
      add({ kind: "newTransfer" }, stated("tab"));
      break;
  }

  function signal(message: Signal): void {
    switch (message.t) {
      case "host": {
        const before = hosted ?? [];
        const next = message.links;
        const fresh = next.filter((link) => !before.includes(link));
        for (const link of fresh) {
          add({ kind: "holdsLink", link }, stated("connection"), `host:${link}`);
        }
        for (const link of before.filter((link) => !next.includes(link))) {
          closeKey(`host:${link}`);
          // Dropping a link unhosts it, which tells its recipient, if any.
          hostGone(link, false);
        }
        // The server logs a host only when the links it holds change, or when the socket was not
        // yet a host. A socket that took links over with `resume` is a host already. After an
        // `already-hosted` answer the held set is unknown, and a retry that all took is a change.
        const changed =
          hosted === undefined ||
          uncertain ||
          next.length !== before.length ||
          next.some((link) => !before.includes(link));
        if (changed) {
          add({ kind: "logHost", links: next.length }, stated("log30d"));
        }
        lastHost = { fresh, logged: changed };
        uncertain = false;
        hosted = next;
        break;
      }
      case "joined": {
        const key = `pair:${message.link}`;
        attempts = { ...attempts, [message.link]: message.attempt };
        refusing = without(refusing, message.link);
        restarting = without(restarting, message.link);
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
          add({ kind: "stunSees" }, stated("relayNoLog"));
        }
        break;
      }
      case "relay":
        relay(message.link, message.bytes);
        break;
      case "join":
        lastJoin = message.link;
        // A join while paired asks for a restart, which a refusal leaves bound (decision 0031).
        if (isOpen(`pair:${message.link}`)) {
          restarting = [...without(restarting, message.link), message.link];
        }
        break;
      case "refuse":
        // The server ignores a refusal of an attempt that is not the bound one, as a late refusal
        // is, and a held recipient leaves instead, which the `left` that follows corrects.
        if (isOpen(`pair:${message.link}`) && attempts[message.link] === message.attempt) {
          unpair(message.link);
          add({ kind: "logRefused", reason: message.reason, link: message.link }, stated("log30d"));
          refusing = [...without(refusing, message.link), message.link];
        }
        break;
      case "left": {
        unpair(message.link);
        restarting = without(restarting, message.link);
        if (refusing.includes(message.link)) {
          // The recipient was held, so the server wrote `left` and no `refused`.
          const index = lastIndex(
            (what) => what.kind === "logRefused" && what.link === message.link,
          );
          if (index >= 0) {
            entries.splice(index, 1);
          }
          refusing = without(refusing, message.link);
        }
        add({ kind: "logLeft", link: message.link, later: false }, stated("log30d"));
        break;
      }
      case "refused":
        // The server deletes the recipient on a refusal, except one that answers a repeated join
        // (or the join it replays after a takeover), which keeps the binding.
        {
          const open = entries.flatMap((entry) =>
            entry.open?.startsWith("pair:") ? [entry.open.slice("pair:".length)] : [],
          );
          const link = lastJoin ?? open[0];
          if (restarting.length === 0) {
            for (const it of open) {
              unpair(it);
            }
          }
          if (link !== undefined) {
            add({ kind: "logRefused", reason: message.reason, link }, stated("log30d"));
          }
        }
        break;
      case "host-gone": {
        restarting = [];
        const link =
          lastJoin ?? entries.find((entry) => entry.open?.startsWith("pair:"))?.open?.slice(5);
        if (link !== undefined) {
          unpair(link);
          add({ kind: "logHostGone", link, later: false }, stated("log30d"));
        }
        break;
      }
      case "error":
        add({ kind: "logError", code: message.code }, stated("log30d"));
        if (message.code === "already-hosted") {
          add({ kind: "alreadyHosted" }, stated("notKept"));
          if (lastHost) {
            // The server took the links no other connection holds and says nothing of which it
            // skipped, so what the host just opened is no longer certain, nor its count.
            for (const link of lastHost.fresh) {
              entries.forEach((entry, index) => {
                if (entry.open === `host:${link}` && entry.what.kind === "holdsLink") {
                  entries[index] = { ...entry, what: { kind: "holdsLinkMaybe", link } };
                }
              });
            }
            const index = lastHost.logged ? lastIndex((what) => what.kind === "logHost") : -1;
            const at = entries[index];
            if (at) {
              entries[index] = { ...at, what: { kind: "logHost", links: undefined } };
            } else {
              add({ kind: "logHost", links: undefined }, stated("log30d"));
            }
            lastHost = undefined;
            uncertain = true;
          }
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
          if (!armed.includes(message.link)) {
            armed = [...armed, message.link];
          }
          if (asked) {
            // The server rebound this side of the pairing to this socket, which the old socket's
            // close had ended on this page, so the pairing is open again. A page that never saw
            // the pairing has nothing to reopen.
            const was = entries.some(
              (entry) => entry.what.kind === "paired" && entry.what.link === message.link,
            );
            if (was && !isOpen(`pair:${message.link}`)) {
              add(
                { kind: "paired", link: message.link },
                stated("connection"),
                `pair:${message.link}`,
              );
            }
          }
          if (asked && log.role === "recipient") {
            // The old socket's tentative line is not written: the server no longer lets go.
            const index = lastIndex(
              (what) => what.kind === "logLeft" && what.later && what.link === message.link,
            );
            if (index >= 0) {
              entries.splice(index, 1);
            }
          }
          if (asked && log.role === "sender") {
            // The server made this socket a host of the link when it took the sender's side over.
            hosted = [...without(hosted ?? [], message.link), message.link];
            if (!isOpen(`host:${message.link}`)) {
              add(
                { kind: "holdsLink", link: message.link },
                stated("connection"),
                `host:${message.link}`,
              );
            }
            // The old socket's tentative line is not written: the server no longer lets go.
            const index = lastIndex(
              (what) => what.kind === "logHostGone" && what.later && what.link === message.link,
            );
            if (index >= 0) {
              entries.splice(index, 1);
            }
          }
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
    tracking: {
      attempts,
      armed,
      restarting,
      refusing,
      uncertain,
      ...(lastJoin !== undefined && { lastJoin }),
      ...(lastHost !== undefined && { lastHost }),
    },
    ...(hosted !== undefined && { hosted }),
  };
}
