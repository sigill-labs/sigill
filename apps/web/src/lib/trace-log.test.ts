import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage, ServerMessage } from "@fidant/protocol";
import {
  createTraceLog,
  fromMessage,
  MAX_ENTRIES,
  type Role,
  record,
  recordAt,
  type SignalMessage,
  type TraceEvent,
  type TraceLog,
} from "./trace-log.ts";

const LINK = "abc123XXXXXXXXXXXXXXXX";
const OTHER = "zyx987YYYYYYYYYYYYYYYY";
const T0 = 1_000;

/** Feeds events in order, one millisecond apart, starting at T0. */
function play(role: Role, ...events: (TraceEvent | SignalMessage)[]): TraceLog {
  return events.reduce<TraceLog>((log, item, index) => {
    const event = Array.isArray(item) ? fromMessage(...item) : item;
    return event ? record(log, event, T0 + index) : log;
  }, createTraceLog(role));
}

const kinds = (log: TraceLog) => log.entries.map((entry) => entry.what.kind);

const host = (...links: string[]): SignalMessage => ["sent", { t: "host", links, turn: true }];
const joined = (urls: string[], link = LINK): SignalMessage => [
  "received",
  {
    t: "joined",
    link,
    attempt: OTHER,
    turn: true,
    iceServers: urls.map((url) =>
      url.startsWith("stun:") ? { urls: [url] } : { urls: [url], username: "u", credential: "c" },
    ),
  },
];
const relay = (link = LINK, data = "abcd"): SignalMessage => ["sent", { t: "relay", link, data }];

test("a host names each new link once, and drops the ones a later host leaves out", () => {
  const log = play("sender", { t: "socket-open" }, host(LINK, OTHER), host(LINK), host(LINK));
  assert.deepEqual(kinds(log), ["connected", "holdsLink", "holdsLink", "logHost", "logHost"]);
  const [, first, second, logged, again] = log.entries;
  assert.deepEqual(first?.what, { kind: "holdsLink", link: "abc123" });
  assert.deepEqual(first?.until, { kind: "stated", how: "connection" });
  assert.deepEqual(second?.what, { kind: "holdsLink", link: "zyx987" });
  assert.deepEqual(second?.until, { kind: "seen", at: T0 + 2 });
  assert.equal(second?.part, "server");
  assert.deepEqual(logged?.what, { kind: "logHost", links: 2 });
  assert.equal(logged?.part, "serverLog");
  assert.deepEqual(again?.what, { kind: "logHost", links: 1 });
});

test("a socket's first host is logged even when it names no link", () => {
  const log = play("sender", { t: "socket-open" }, host(), host());
  assert.deepEqual(kinds(log), ["connected", "logHost"]);
});

test("already-hosted adds the server's error log line and a not-taken line", () => {
  const log = play("sender", host(LINK), ["received", { t: "error", code: "already-hosted" }]);
  assert.deepEqual(kinds(log).slice(-2), ["logError", "alreadyHosted"]);
  assert.deepEqual(log.entries.at(-1)?.until, { kind: "stated", how: "notKept" });
});

test("joined with TURN URLs adds credentials; without them only the STUN line", () => {
  const withTurn = play("sender", joined(["stun:turn.example:3478", "turns:turn.example:443"]));
  assert.deepEqual(kinds(withTurn), [
    "paired",
    "logJoined",
    "credentials",
    "relayCredentials",
    "stunSees",
  ]);
  assert.deepEqual(withTurn.entries[3]?.until, { kind: "stated", how: "credential5m" });
  assert.deepEqual(withTurn.entries[4]?.until, { kind: "stated", how: "relay7d" });
  assert.equal(withTurn.entries[4]?.part, "relay");

  const stunOnly = play("recipient", joined(["stun:turn.example:3478"]));
  assert.deepEqual(kinds(stunOnly), ["paired", "logJoined", "stunSees"]);
  assert.deepEqual(kinds(play("recipient", joined([]))), ["paired", "logJoined"]);
});

test("a repeated joined says the server knows the route dropped, and the pairing ends when seen", () => {
  const log = play("recipient", joined([]), joined([]), ["received", { t: "host-gone" }]);
  assert.deepEqual(kinds(log), ["paired", "logJoined", "rejoined", "logJoined", "logHostGone"]);
  assert.deepEqual(log.entries[0]?.until, { kind: "seen", at: T0 + 2 });

  const left = play("sender", joined([]), ["received", { t: "left", link: LINK }]);
  assert.deepEqual(kinds(left), ["paired", "logJoined", "logLeft"]);
  assert.deepEqual(left.entries[0]?.until, { kind: "seen", at: T0 + 1 });

  const refused = play("sender", joined([]), [
    "sent",
    { t: "refuse", link: LINK, attempt: OTHER, reason: "used" },
  ]);
  assert.deepEqual(refused.entries.at(-1)?.what, {
    kind: "logRefused",
    reason: "used",
    link: "abc123",
  });
  assert.deepEqual(refused.entries[0]?.until, { kind: "seen", at: T0 + 1 });
});

test("consecutive relay messages for a link share one line each for the server and its log", () => {
  const log = play(
    "sender",
    relay(LINK, "aaaa"),
    ["received", { t: "relay", link: LINK, data: "bb" }],
    relay(OTHER, "c"),
    relay(LINK, "d"),
  );
  assert.deepEqual(kinds(log), ["relayed", "logRelay", "relayed", "logRelay"]);
  assert.deepEqual(log.entries[0]?.what, { kind: "relayed", link: "abc123", count: 3, bytes: 7 });
  assert.deepEqual(log.entries[1]?.what, { kind: "logRelay", link: "abc123", count: 3, bytes: 7 });
  assert.deepEqual(log.entries[2]?.what, { kind: "relayed", link: "zyx987", count: 1, bytes: 1 });
  assert.equal(log.entries[0]?.at, T0);

  const split = play(
    "sender",
    relay(),
    ["sent", { t: "path", link: LINK, path: "direct" }],
    relay(),
  );
  assert.deepEqual(kinds(split), ["relayed", "logRelay", "logPath", "relayed", "logRelay"]);
});

test("a dropped connection gets the stated hold; a clean close is seen", () => {
  const dropped = play("sender", { t: "socket-open" }, host(LINK, OTHER), joined([]), {
    t: "socket-closed",
    code: 1006,
  });
  assert.deepEqual(dropped.entries.at(-1)?.what, {
    kind: "logHostGone",
    link: "abc123",
    later: false,
  });
  assert.deepEqual(dropped.entries.at(-2)?.what, { kind: "logHostClosed", links: 2 });
  for (const entry of dropped.entries.filter((entry) => entry.part === "server")) {
    assert.deepEqual(entry.until, { kind: "stated", how: "dropped" });
    assert.equal(entry.open, undefined);
  }

  const clean = play("recipient", { t: "socket-open" }, joined([]), {
    t: "socket-closed",
    code: 1000,
  });
  assert.deepEqual(kinds(clean).at(-1), "logLeft");
  for (const entry of clean.entries.filter((entry) => entry.part === "server")) {
    assert.deepEqual(entry.until, { kind: "seen", at: T0 + 2 });
  }

  const heldRecipient = play("recipient", { t: "socket-open" }, joined([]), {
    t: "socket-closed",
    code: 1006,
  });
  // Not armed: the server has no hold, so it logs left at once. Armed: it keeps the place.
  assert.ok(kinds(heldRecipient).includes("logLeft"));
  const armedRecipient = play(
    "recipient",
    { t: "socket-open" },
    joined([]),
    resumeAnswer(true),
    closeSocket(1006),
  );
  assert.ok(!kinds(armedRecipient).includes("logLeft"));
});

test("a connection attempt that never opened adds nothing, and a new socket hosts afresh", () => {
  assert.deepEqual(kinds(play("sender", { t: "socket-closed", code: 1006 })), []);
  const log = play(
    "sender",
    { t: "socket-open" },
    host(LINK),
    { t: "socket-closed", code: 1000 },
    { t: "socket-open" },
    host(LINK),
  );
  assert.deepEqual(kinds(log).slice(-4), ["logHostClosed", "connected", "holdsLink", "logHost"]);
});

test("links, paths, the relay and delivery end as the page sees them", () => {
  const log = play(
    "sender",
    { t: "link-added", link: LINK },
    { t: "relay-added", link: LINK },
    { t: "path", path: "direct", link: LINK },
    { t: "path", path: "relay", link: LINK },
    { t: "delivered", secret: false },
    { t: "peer-closed", link: LINK },
    { t: "link-removed", link: LINK },
  );
  assert.deepEqual(kinds(log), [
    "linkKey",
    "relayAdded",
    "path",
    "path",
    "relayCarries",
    "delivered",
  ]);
  assert.deepEqual(log.entries[0]?.what, { kind: "linkKey", link: "abc123" });
  assert.deepEqual(log.entries[0]?.until, { kind: "seen", at: T0 + 6 });
  assert.deepEqual(log.entries[1]?.until, { kind: "seen", at: T0 + 5 });
  assert.deepEqual(log.entries[2]?.until, { kind: "seen", at: T0 + 3 });
  assert.deepEqual(log.entries[3]?.until, { kind: "seen", at: T0 + 5 });
  assert.deepEqual(log.entries[5]?.until, { kind: "stays" });
  assert.equal(log.entries[5]?.part, "peer");
  assert.deepEqual(play("sender", { t: "delivered", secret: true }).entries[0]?.until, {
    kind: "stated",
    how: "tab",
  });
});

test("a new transfer ends this browser's links and tokens and marks the log", () => {
  const log = play(
    "sender",
    { t: "link-added", link: LINK },
    ["received", { t: "resume", link: LINK, attempt: OTHER, token: OTHER }],
    { t: "new-transfer" },
  );
  assert.deepEqual(kinds(log), ["linkKey", "serverToken", "browserToken", "newTransfer"]);
  assert.deepEqual(log.entries[0]?.until, { kind: "seen", at: T0 + 2 });
  assert.deepEqual(log.entries[2]?.until, { kind: "seen", at: T0 + 2 });
  assert.deepEqual(log.entries[1]?.until, { kind: "stated", how: "attempt" });
});

test("a resume uses the browser's token and logs the server's answer", () => {
  const log = play(
    "recipient",
    ["received", { t: "resume", link: LINK, attempt: OTHER, token: OTHER }],
    ["sent", { t: "resume", link: LINK, attempt: OTHER, token: OTHER }],
    ["received", { t: "resume", link: LINK, attempt: OTHER }],
  );
  assert.deepEqual(kinds(log), ["serverToken", "browserToken", "logResume"]);
  assert.deepEqual(log.entries[1]?.until, { kind: "seen", at: T0 + 1 });
  assert.deepEqual(log.entries[2]?.what, { kind: "logResume", link: "abc123", refused: true });
});

test("no secret, address, name, token, credential or whole ID from any message reaches the log", () => {
  const id = (tag: string) => `${tag}${"Q".repeat(22 - tag.length)}`;
  const link = id("link00CANARYLINK");
  const canaries = {
    link,
    attempt: id("CANARYATTEMPT"),
    token: id("CANARYTOKEN"),
    mark: id("CANARYMARK"),
    secret: "CANARYSECRET",
    data: "CANARYDATA",
    to: "canary.to@example.se",
    masked: "c***@example.se",
    from: "CANARYFROM",
    code: "424242",
    username: "CANARYUSER",
    credential: "CANARYCREDENTIAL",
    turnHost: "canary-turn-host",
  };
  const sent = {
    host: { t: "host", links: [link], turn: true },
    join: { t: "join", link, attempt: canaries.attempt, token: canaries.token },
    relay: { t: "relay", link, data: canaries.data },
    refuse: { t: "refuse", link, attempt: canaries.attempt, reason: "busy" },
    path: { t: "path", link, path: "relay" },
    email: {
      t: "email",
      link,
      to: canaries.to,
      secret: canaries.secret,
      from: canaries.from,
      lang: "sv",
    },
    gate: { t: "gate", link, mark: canaries.mark },
    "send-code": { t: "send-code", link, mark: canaries.mark },
    code: { t: "code", link, code: canaries.code, mark: canaries.mark },
    resume: { t: "resume", link, attempt: canaries.attempt, token: canaries.token },
  } satisfies { [T in ClientMessage["t"]]: Extract<ClientMessage, { t: T }> };
  const received = {
    joined: {
      t: "joined",
      link,
      attempt: canaries.attempt,
      turn: true,
      iceServers: [
        { urls: [`stun:${canaries.turnHost}:3478`] },
        {
          urls: [`turns:${canaries.turnHost}:443`],
          username: canaries.username,
          credential: canaries.credential,
        },
      ],
    },
    left: { t: "left", link },
    relay: { t: "relay", link, data: canaries.data },
    refused: { t: "refused", reason: "used" },
    "host-gone": { t: "host-gone" },
    error: { t: "error", code: "already-hosted" },
    hello: { t: "hello", mail: true },
    email: { t: "email", link, status: "sent", mark: canaries.mark },
    gate: { t: "gate", link, to: canaries.masked },
    code: { t: "code", link, result: "wrong" },
    token: { t: "token", link, token: canaries.token },
    resume: { t: "resume", link, attempt: canaries.attempt, token: canaries.token },
  } satisfies { [T in ServerMessage["t"]]: Extract<ServerMessage, { t: T }> };

  for (const role of ["sender", "recipient"] as const) {
    const log = play(
      role,
      { t: "socket-open" },
      { t: "link-added", link },
      ...Object.values(sent).map((message): SignalMessage => ["sent", message]),
      ...Object.values(received).map((message): SignalMessage => ["received", message]),
      { t: "relay-added", link },
      { t: "path", path: "relay", link },
      { t: "peer-closed", link },
      { t: "link-removed", link },
      { t: "socket-closed", code: 1006 },
    );
    const text = JSON.stringify(log);
    for (const [name, value] of Object.entries(canaries)) {
      const forbidden = name === "link" ? value : value.slice(0, 8);
      assert.ok(!text.includes(forbidden), `${role} log holds the ${name}`);
    }
    assert.ok(text.includes('"link00"'), `${role} log names the link's prefix`);
  }
});

test("the log keeps the newest MAX_ENTRIES lines", () => {
  const events: TraceEvent[] = [];
  for (let index = 0; index < MAX_ENTRIES + 100; index++) {
    events.push({ t: "address-bar" });
  }
  const log = play("recipient", ...events);
  assert.equal(log.entries.length, MAX_ENTRIES);
  assert.equal(log.entries[0]?.at, T0 + 100);
  assert.equal(log.entries.at(-1)?.at, T0 + MAX_ENTRIES + 99);
});

test("recording leaves the old log as it was", () => {
  const before = play("sender", relay());
  const snapshot = JSON.stringify(before);
  record(before, fromMessage(...relay()) as TraceEvent, T0 + 5);
  assert.equal(JSON.stringify(before), snapshot);
});

test("recordAt records the event at the time it carries", () => {
  const log = createTraceLog("sender");
  assert.deepEqual(
    recordAt(log, { event: { t: "socket-open" }, at: T0 }),
    record(log, { t: "socket-open" }, T0),
  );
});

// Helpers for the tests below.
const open = { t: "socket-open" } as const;
const closeSocket = (code: number): TraceEvent => ({ t: "socket-closed", code });
const refuse = (attempt = OTHER, link = LINK): SignalMessage => [
  "sent",
  { t: "refuse", link, attempt, reason: "used" },
];
const left = (link = LINK): SignalMessage => ["received", { t: "left", link }];
const join = (link = LINK): SignalMessage => ["sent", { t: "join", link, attempt: OTHER }];
const refusedBy = (): SignalMessage => ["received", { t: "refused", reason: "busy" }];
const resumeAnswer = (token: boolean, link = LINK): SignalMessage => [
  "received",
  token
    ? { t: "resume", link, attempt: OTHER, token: OTHER }
    : { t: "resume", link, attempt: OTHER },
];
const resumeSent = (link = LINK): SignalMessage => [
  "sent",
  { t: "resume", link, attempt: OTHER, token: OTHER },
];
const alreadyHosted: SignalMessage = ["received", { t: "error", code: "already-hosted" }];

test("already-hosted makes the host's links and count uncertain, and no number is claimed", () => {
  const log = play("sender", open, host(LINK, OTHER), alreadyHosted);
  assert.deepEqual(kinds(log), [
    "connected",
    "holdsLinkMaybe",
    "holdsLinkMaybe",
    "logHost",
    "logError",
    "alreadyHosted",
  ]);
  assert.deepEqual(log.entries[3]?.what, { kind: "logHost", links: undefined });
  // Earlier, certain links stay certain.
  const later = play("sender", open, host(LINK), host(LINK, OTHER), alreadyHosted);
  assert.deepEqual(
    kinds(later).filter((kind) => kind.startsWith("holdsLink")),
    ["holdsLink", "holdsLinkMaybe"],
  );
  // A retry with nothing new may not be logged by the server, so the line is conditional too.
  const same = play("sender", open, host(LINK), host(LINK), alreadyHosted);
  assert.deepEqual(same.entries.filter((e) => e.what.kind === "logHost").length, 2);
  const unlogged = play("sender", open, host(LINK), alreadyHosted, host(LINK), alreadyHosted);
  assert.deepEqual(unlogged.entries.filter((e) => e.what.kind === "logHost").length, 2);
  // The close line has no count either.
  const closed = play("sender", open, host(LINK, OTHER), alreadyHosted, closeSocket(1000));
  assert.deepEqual(closed.entries.at(-1)?.what, { kind: "logHostClosed", links: undefined });
  // A later host that nothing refused counts again.
  const retry = play("sender", open, host(LINK, OTHER), alreadyHosted, host(LINK, OTHER));
  assert.deepEqual(retry.entries.at(-1)?.what, { kind: "logHost", links: 2 });
});

test("a refused that does not answer a restart join ends the recipient's pairing for good", () => {
  const log = play("recipient", open, joined([]), refusedBy(), closeSocket(1000));
  assert.deepEqual(kinds(log), ["connected", "paired", "logJoined", "logRefused"]);
  assert.deepEqual(log.entries[1]?.until, { kind: "seen", at: T0 + 2 });
  assert.deepEqual(log.entries[3]?.what, { kind: "logRefused", reason: "busy", link: "abc123" });
});

test("a refused that answers a restart join keeps the pairing, so a close logs left", () => {
  const log = play("recipient", open, join(), joined([]), join(), refusedBy(), closeSocket(1000));
  assert.deepEqual(kinds(log).slice(-2), ["logRefused", "logLeft"]);
  assert.equal(log.entries.find((e) => e.what.kind === "paired")?.until.kind, "seen");
  // A restart answered by joined is no longer outstanding.
  const answered = play("recipient", open, join(), joined([]), join(), joined([]), refusedBy());
  assert.equal(answered.entries.find((e) => e.what.kind === "paired")?.until.kind, "seen");
});

test("a first refused names the link the page joined", () => {
  const log = play("recipient", open, join(), refusedBy());
  assert.deepEqual(log.entries.at(-1)?.what, {
    kind: "logRefused",
    reason: "busy",
    link: "abc123",
  });
});

test("a resumed host side counts as hosted, so a host naming only those links logs nothing", () => {
  const log = play("sender", open, resumeSent(), resumeAnswer(true), host(LINK));
  assert.deepEqual(kinds(log), [
    "connected",
    "logResume",
    "holdsLink",
    "serverToken",
    "browserToken",
  ]);
  const changed = play("sender", open, resumeSent(), resumeAnswer(true), host(LINK, OTHER));
  assert.equal(changed.entries.at(-1)?.what.kind, "logHost");
  // A refused resume holds nothing, so the first host is logged.
  const refusedResume = play("sender", open, resumeSent(), resumeAnswer(false), host(LINK));
  assert.equal(refusedResume.entries.at(-1)?.what.kind, "logHost");
});

test("the sender's close and a dropping host log host-gone for each paired link", () => {
  const paired = (...tail: (TraceEvent | SignalMessage)[]) =>
    play("sender", open, host(LINK, OTHER), joined([]), ...tail);
  const clean = paired(closeSocket(1000));
  const gone = clean.entries.filter((e) => e.what.kind === "logHostGone");
  assert.equal(gone.length, 1);
  assert.deepEqual(gone[0]?.what, { kind: "logHostGone", link: "abc123", later: false });
  assert.deepEqual(clean.entries.find((e) => e.what.kind === "paired")?.until, {
    kind: "seen",
    at: T0 + 3,
  });
  // Without a pairing nothing is written.
  assert.equal(
    play("sender", open, host(LINK), closeSocket(1000)).entries.some(
      (e) => e.what.kind === "logHostGone",
    ),
    false,
  );
  // A host that drops the link.
  const dropped = paired(host(OTHER));
  assert.deepEqual(dropped.entries.find((e) => e.what.kind === "logHostGone")?.what, {
    kind: "logHostGone",
    link: "abc123",
    later: false,
  });
  assert.equal(dropped.entries.find((e) => e.what.kind === "paired")?.until.kind, "seen");
});

test("a dropped sender's host-gone line is written later when armed, and is taken back by a takeover", () => {
  const armedLog = play(
    "sender",
    open,
    host(LINK),
    joined([]),
    resumeAnswer(true),
    closeSocket(1006),
  );
  const gone = armedLog.entries.find((e) => e.what.kind === "logHostGone");
  assert.deepEqual(gone?.what, { kind: "logHostGone", link: "abc123", later: true });
  // Not armed: the server unhosts at once.
  const unarmed = play("sender", open, host(LINK), joined([]), closeSocket(1006));
  assert.deepEqual(unarmed.entries.find((e) => e.what.kind === "logHostGone")?.what, {
    kind: "logHostGone",
    link: "abc123",
    later: false,
  });
  // A takeover on a new socket means the server never lets go.
  const taken = play(
    "sender",
    open,
    host(LINK),
    joined([]),
    resumeAnswer(true),
    closeSocket(1006),
    open,
    resumeSent(),
    resumeAnswer(true),
  );
  assert.equal(
    taken.entries.some((e) => e.what.kind === "logHostGone"),
    false,
  );
});

test("a refusal counts only for the pairing it names, and a held recipient's left replaces it", () => {
  const stale = play("sender", joined([]), refuse("someOtherAttempt"));
  assert.deepEqual(kinds(stale), ["paired", "logJoined"]);
  assert.equal(stale.entries[0]?.until.kind, "stated");
  assert.deepEqual(
    play("sender", refuse()).entries.map((e) => e.what.kind),
    [],
  );
  const matched = play("sender", joined([]), refuse());
  assert.deepEqual(matched.entries.at(-1)?.what, {
    kind: "logRefused",
    reason: "used",
    link: "abc123",
  });
  const heldRecipient = play("sender", joined([]), refuse(), left());
  assert.deepEqual(kinds(heldRecipient), ["paired", "logJoined", "logLeft"]);
  // A later recipient's left is its own.
  const next = play("sender", joined([]), refuse(), joined([]), left());
  assert.deepEqual(kinds(next), [
    "paired",
    "logJoined",
    "logRefused",
    "paired",
    "logJoined",
    "logLeft",
  ]);
});
