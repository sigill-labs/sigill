import assert from "node:assert/strict";
import { test } from "node:test";
import { describeTrace } from "../lib/format.ts";
import type { Part, Role, Stated, TraceEntry, Until, What } from "../lib/trace-log.ts";
import type { Lang } from "./language.ts";

// One line of each kind. Typed by kind, so a new kind fails the typecheck until it is added here.
const lines: { [K in What["kind"]]: Extract<What, { kind: K }>[] } = {
  connected: [{ kind: "connected" }],
  holdsLink: [{ kind: "holdsLink", link: "abc123" }],
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
  })),
  logLeft: [{ kind: "logLeft", link: "abc123" }],
  logHostGone: [{ kind: "logHostGone" }],
  logHostClosed: [
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
  relay7d: true,
  history: true,
  peerConnection: true,
  attempt: true,
};

const untils: Until[] = [
  { kind: "seen", at: new Date(2026, 10, 28, 14, 2, 40).getTime() },
  { kind: "stays" },
  ...Object.keys(stated).map((how) => ({ kind: "stated" as const, how: how as Stated })),
];

const parts: Part[] = ["server", "serverLog", "relay", "browser", "peer", "connection"];
const roles: Role[] = ["sender", "recipient"];
const langs: Lang[] = ["en", "sv"];

function check(text: string, label: string) {
  assert.ok(text.trim().length > 0, `${label} is empty`);
  assert.doesNotMatch(text, /undefined|NaN|\[object|\$\{/, label);
}

test("every kind of line reads in both languages", () => {
  const at = new Date(2026, 10, 28, 14, 2, 3).getTime();
  for (const lang of langs) {
    for (const role of roles) {
      for (const what of Object.values(lines).flat()) {
        for (const part of parts) {
          for (const until of untils) {
            const entry: TraceEntry = { at, part, what, until };
            const line = describeTrace(entry, role, lang);
            const label = `${lang} ${role} ${part} ${JSON.stringify(what)} ${JSON.stringify(until)}`;
            assert.equal(line.time, "14:02:03", label);
            check(line.part, label);
            check(line.what, label);
            check(line.until, label);
          }
        }
      }
    }
  }
});

test("lines show link IDs as their prefix and an ellipsis, and sizes in words", () => {
  const at = 0;
  const until: Until = { kind: "stated", how: "log30d" };
  const english = describeTrace(
    { at, part: "server", what: { kind: "holdsLink", link: "abc123" }, until },
    "sender",
    "en",
  );
  assert.equal(english.what, "Link ID abc123…, never the part of the link that unlocks it.");
  assert.equal(english.until, "kept in our server's log for 30 days");
  const relayed = describeTrace(
    { at, part: "server", what: { kind: "relayed", link: "abc123", count: 2, bytes: 9200 }, until },
    "recipient",
    "sv",
  );
  assert.match(relayed.what, /2 krypterade uppkopplingsmeddelanden \(9,2 KB\) för länk-ID abc123…/);
  const seen = describeTrace(
    {
      at,
      part: "server",
      what: { kind: "connected" },
      until: { kind: "seen", at: new Date(2026, 0, 1, 14, 2, 40).getTime() },
    },
    "sender",
    "en",
  );
  assert.equal(seen.until, "gone at 14:02:40");
});

test("the other browser is named by whose page it is", () => {
  const entry: TraceEntry = {
    at: 0,
    part: "peer",
    what: { kind: "delivered", secret: false },
    until: { kind: "stays" },
  };
  assert.equal(describeTrace(entry, "sender", "en").part, "The recipient's browser");
  assert.equal(describeTrace(entry, "sender", "en").until, "until they delete it");
  assert.equal(describeTrace(entry, "recipient", "sv").part, "Avsändarens webbläsare");
});
