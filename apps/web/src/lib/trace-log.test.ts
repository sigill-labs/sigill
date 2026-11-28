import assert from "node:assert/strict";
import { test } from "node:test";
import type { ClientMessage, ServerMessage } from "@fidant/protocol";
import {
  createTraceLog,
  fromMessage,
  MAX_ENTRIES,
  type Role,
  record,
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
  assert.deepEqual(refused.entries.at(-1)?.what, { kind: "logRefused", reason: "used" });
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
  assert.deepEqual(kinds(dropped).at(-1), "logHostClosed");
  assert.deepEqual(dropped.entries.at(-1)?.what, { kind: "logHostClosed", links: 2 });
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
  assert.ok(!kinds(heldRecipient).includes("logLeft"));
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
