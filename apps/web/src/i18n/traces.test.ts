import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTrace } from "../lib/format.ts";
import {
  placeOf,
  type Role,
  type Stated,
  type TraceEntry,
  type Until,
  type What,
} from "../lib/trace-log.ts";
import type { Lang } from "./language.ts";

// One line of each kind. Typed by kind, so a new kind fails the typecheck until it is added here.
const lines: { [K in What["kind"]]: Extract<What, { kind: K }>[] } = {
  connected: [{ kind: "connected" }],
  holdsLink: [{ kind: "holdsLink", link: "abc123" }],
  holdsLinkMaybe: [{ kind: "holdsLinkMaybe", link: "abc123" }],
  alreadyHosted: [{ kind: "alreadyHosted" }],
  paired: [{ kind: "paired", link: "abc123" }],
  rejoined: [{ kind: "rejoined", link: "abc123" }],
  credentials: [{ kind: "credentials" }],
  relayed: [
    { kind: "relayed", link: "abc123", count: 1, bytes: 1 },
    { kind: "relayed", link: "abc123", count: 12, bytes: 9200 },
  ],
  serverToken: [{ kind: "serverToken", link: "abc123" }],
  logHost: [
    { kind: "logHost", links: undefined },
    { kind: "logHost", links: 0 },
    { kind: "logHost", links: 1 },
    { kind: "logHost", links: 3 },
  ],
  logJoined: [{ kind: "logJoined", link: "abc123" }],
  logRelay: [
    { kind: "logRelay", link: "abc123", count: 1, bytes: 1 },
    { kind: "logRelay", link: "abc123", count: 12, bytes: 9200 },
  ],
  logRefused: (["used", "busy", "unknown", "drop", "starting"] as const).map((reason) => ({
    kind: "logRefused" as const,
    reason,
    link: "abc123",
  })),
  logLeft: [
    { kind: "logLeft", link: "abc123", later: false },
    { kind: "logLeft", link: "abc123", later: true },
  ],
  logHostGone: [
    { kind: "logHostGone", link: "abc123", later: false },
    { kind: "logHostGone", link: "abc123", later: true },
  ],
  logHostClosed: [
    { kind: "logHostClosed", links: undefined },
    { kind: "logHostClosed", links: 1 },
    { kind: "logHostClosed", links: 2 },
  ],
  logPath: (["direct", "stun", "relay", "failed"] as const).map((path) => ({
    kind: "logPath" as const,
    path,
  })),
  logResume: [
    { kind: "logResume", link: "abc123", refused: false },
    { kind: "logResume", link: "abc123", refused: true },
  ],
  logError: (
    ["bad-message", "wrong-role", "already-hosted", "already-joined", "not-on-link"] as const
  ).map((code) => ({ kind: "logError" as const, code })),
  stunSees: [{ kind: "stunSees" }],
  relayAdded: [{ kind: "relayAdded" }],
  relayCarries: [{ kind: "relayCarries" }],
  linkKey: [{ kind: "linkKey", link: "abc123" }],
  relayCredentials: [{ kind: "relayCredentials" }],
  browserToken: [{ kind: "browserToken", link: "abc123" }],
  addressBar: [{ kind: "addressBar" }],
  received: [
    { kind: "received", secret: false },
    { kind: "received", secret: true },
  ],
  newTransfer: [{ kind: "newTransfer" }],
  delivered: [
    { kind: "delivered", secret: false },
    { kind: "delivered", secret: true },
  ],
  path: (["direct", "stun", "relay"] as const).map((path) => ({ kind: "path" as const, path })),
};

const stated: Record<Stated, true> = {
  connection: true,
  dropped: true,
  log30d: true,
  notKept: true,
  tab: true,
  credential5m: true,
  relayNoLog: true,
  relayAllocation: true,
  history: true,
  peerConnection: true,
  attempt: true,
};

const untils: Until[] = [
  { kind: "seen", at: new Date(2026, 10, 28, 14, 2, 40).getTime() },
  { kind: "stays" },
  ...Object.keys(stated).map((how) => ({ kind: "stated" as const, how: how as Stated })),
];

const roles: Role[] = ["sender", "recipient"];
const langs: Lang[] = ["en", "sv"];

function check(text: string, label: string) {
  assert.ok(text.trim().length > 0, `${label} is empty`);
  assert.doesNotMatch(text, /undefined|NaN|\[object|\$\{/, label);
}

test("every kind of line reads in both languages, with who holds it, where and for how long", () => {
  const at = new Date(2026, 10, 28, 14, 2, 3).getTime();
  for (const lang of langs) {
    for (const role of roles) {
      for (const what of Object.values(lines).flat()) {
        for (const until of untils) {
          const line = describeTrace({ at, what, until }, role, lang);
          const label = `${lang} ${role} ${JSON.stringify(what)} ${JSON.stringify(until)}`;
          assert.equal(line.time, "14:02:03", label);
          if (what.kind === "newTransfer") {
            assert.equal(line.who, undefined, label);
          } else {
            check(line.who?.text ?? "", label);
          }
          // Only the route between the browsers, and the marker, are kept nowhere.
          if (what.kind === "path" || what.kind === "newTransfer") {
            assert.equal(line.where, undefined, label);
          } else {
            check(line.where ?? "", label);
          }
          check(line.what, label);
          check(line.duration, label);
        }
      }
    }
  }
});

test("each documented end reads as a short duration", () => {
  const expected: Record<Lang, Record<Stated, string>> = {
    en: {
      connection: "while connected",
      dropped: "about 1 min",
      log30d: "30 days",
      notKept: "not kept",
      tab: "until tab closes",
      credential5m: "5 min",
      relayNoLog: "not kept; a fault log up to 7 days",
      relayAllocation: "while the allocation lasts; a fault log up to 7 days",
      history: "until history is cleared",
      peerConnection: "while connected",
      attempt: "until transfer ends",
    },
    sv: {
      connection: "under anslutningen",
      dropped: "ungefär 1 min",
      log30d: "30 dagar",
      notKept: "sparas inte",
      tab: "tills fliken stängs",
      credential5m: "5 min",
      relayNoLog: "sparas inte; en fellogg högst 7 dagar",
      relayAllocation: "medan allokeringen finns; en fellogg högst 7 dagar",
      history: "tills historiken rensas",
      peerConnection: "under anslutningen",
      attempt: "tills överföringen slutar",
    },
  };
  const what: What = { kind: "connected" };
  for (const lang of langs) {
    for (const how of Object.keys(stated) as Stated[]) {
      const line = describeTrace({ at: 0, what, until: { kind: "stated", how } }, "sender", lang);
      assert.equal(line.duration, expected[lang][how], `${lang} ${how}`);
    }
  }
  const delivered: What = { kind: "delivered", secret: false };
  assert.equal(
    describeTrace({ at: 0, what: delivered, until: { kind: "stays" } }, "sender", "en").duration,
    "until deleted",
  );
  assert.equal(
    describeTrace({ at: 0, what: delivered, until: { kind: "stays" } }, "sender", "sv").duration,
    "tills den raderas",
  );
});

test("a trace this page saw end says how long it lasted", () => {
  const at = new Date(2026, 0, 1, 14, 2, 11).getTime();
  const lasted = (ms: number, lang: Lang) =>
    describeTrace(
      { at, what: { kind: "connected" }, until: { kind: "seen", at: at + ms } },
      "sender",
      lang,
    ).duration;
  assert.equal(lasted(29_400, "en"), "lasted 29 s");
  assert.equal(lasted(29_400, "sv"), "varade 29 s");
  assert.equal(lasted(0, "en"), "lasted under 1 s");
  assert.equal(lasted(4 * 60_000 + 59_000, "en"), "lasted 4 min");
  assert.equal(lasted(65 * 60_000, "sv"), "varade 1 h 5 min");
});

test("lines show link IDs as their prefix and an ellipsis, and sizes in words", () => {
  const at = 0;
  const until: Until = { kind: "stated", how: "log30d" };
  const english = describeTrace(
    { at, what: { kind: "holdsLink", link: "abc123" }, until },
    "sender",
    "en",
  );
  assert.equal(english.what, "Link ID abc123…, never the part of the link that unlocks it.");
  assert.deepEqual(english.who, { kind: "server", text: "Server" });
  assert.equal(english.where, "Memory");
  assert.equal(english.duration, "30 days");
  const relayed = describeTrace(
    { at, what: { kind: "relayed", link: "abc123", count: 2, bytes: 9200 }, until },
    "recipient",
    "sv",
  );
  assert.match(relayed.what, /2 krypterade uppkopplingsmeddelanden \(9,2 KB\) för länk-ID abc123…/);
});

test("the browsers are named by their role, relative to this page", () => {
  const delivered: What = { kind: "delivered", secret: false };
  assert.deepEqual(placeOf(delivered, "sender"), { who: "recipient", where: "disk" });
  assert.deepEqual(placeOf(delivered, "recipient"), { who: "sender", where: "disk" });
  assert.deepEqual(placeOf({ kind: "linkKey", link: "abc123" }, "recipient"), {
    who: "recipient",
    where: "memory",
  });
  assert.deepEqual(placeOf({ kind: "addressBar" }, "recipient"), {
    who: "recipient",
    where: "addressBar",
  });
  const entry: TraceEntry = { at: 0, what: delivered, until: { kind: "stays" } };
  assert.equal(describeTrace(entry, "sender", "en").who?.text, "Recipient");
  assert.equal(describeTrace(entry, "recipient", "sv").who?.text, "Avsändare");
});

test("a received or delivered secret stays in memory, a file on disk", () => {
  assert.equal(placeOf({ kind: "received", secret: false }, "recipient")?.where, "disk");
  assert.equal(placeOf({ kind: "received", secret: true }, "recipient")?.where, "memory");
  assert.equal(placeOf({ kind: "delivered", secret: true }, "sender")?.where, "memory");
});

test("server log lines are the server's log, its state its memory, and the relay's memory", () => {
  assert.deepEqual(placeOf({ kind: "logJoined", link: "abc123" }, "sender"), {
    who: "server",
    where: "log",
  });
  assert.deepEqual(placeOf({ kind: "paired", link: "abc123" }, "sender"), {
    who: "server",
    where: "memory",
  });
  assert.deepEqual(placeOf({ kind: "relayCarries" }, "sender"), { who: "relay", where: "memory" });
  assert.deepEqual(placeOf({ kind: "path", path: "relay" }, "sender"), { who: "connection" });
  assert.equal(placeOf({ kind: "newTransfer" }, "sender"), undefined);
});
