import assert from "node:assert/strict";
import { test } from "node:test";
import { type EmailStatus, MAX_LINKS } from "@fidant/protocol";
import { createLink, type Link } from "./link.ts";
import {
  armedLinks,
  CHECK_ATTEMPTS,
  CHECK_DIFFERS,
  CHECK_EXPIRED,
  CHECK_LIMIT,
  CHECK_TIMEOUT_MS,
  CHECKSUM_MISMATCH,
  emailBound,
  findRecipient,
  hostedLinks,
  INTERRUPTED,
  initialSenderState,
  RECIPIENT_OUTDATED,
  type Recipient,
  refusesRelay,
  SENDER_OUTDATED,
  SETUP_TIMEOUT_MS,
  type SenderAction,
  type SenderEffect,
  type SenderState,
  TOO_SMALL_FOR_TEXT,
  unmarked,
  update,
} from "./sender-state.ts";

const ORIGIN = "https://192.168.1.5:8443";
/** Attempt IDs, one per join. */
const A = "attemptAAAAAAAAAAAAAAA";
const B = "attemptBBBBBBBBBBBBBBB";
const TURN = [{ urls: ["turn:127.0.0.1:3478"], username: "1700000000", credential: "hmac" }];

/** Applies actions in order and collects every effect. */
function run(
  state: SenderState,
  ...actions: SenderAction[]
): { state: SenderState; effects: SenderEffect[] } {
  const effects: SenderEffect[] = [];
  for (const action of actions) {
    const result = update(state, action);
    state = result.state;
    effects.push(...result.effects);
  }
  return { state, effects };
}

function withRecipient(name = "Anna") {
  const link = createLink(ORIGIN);
  const { state } = run(initialSenderState, { type: "add", link, name });
  return { state, linkId: link.linkId, link };
}

function statusOf(state: SenderState, linkId: string) {
  return findRecipient(state, linkId)?.status;
}

function joined(linkId: string, attempt: string, turn = true): SenderAction {
  return { type: "joined", linkId, attempt, iceServers: [], turn, allowRelay: true };
}

test("add creates a waiting recipient from a link and keeps insertion order", () => {
  const a = createLink(ORIGIN);
  const b = createLink(ORIGIN);
  const { state, effects } = run(
    initialSenderState,
    { type: "add", link: a, name: "Anna" },
    { type: "add", link: b, name: "Erik" },
  );
  assert.deepEqual(effects, []);
  assert.deepEqual(state.recipients, [
    { name: "Anna", ...a, status: "waiting", bytesSent: 0 },
    { name: "Erik", ...b, status: "waiting", bytesSent: 0 },
  ]);
  assert.deepEqual(initialSenderState.recipients, [], "initial state untouched");
});

test("add ignores a duplicate link ID and stops at MAX_LINKS", () => {
  const { state, link } = withRecipient();
  assert.equal(update(state, { type: "add", link, name: "Other" }).state, state);

  let full = initialSenderState;
  for (let i = 0; i < MAX_LINKS; i++) {
    full = update(full, { type: "add", link: createLink(ORIGIN), name: `R${i}` }).state;
  }
  assert.equal(full.recipients.length, MAX_LINKS);
  const extra = update(full, { type: "add", link: createLink(ORIGIN), name: "Extra" });
  assert.equal(extra.state, full);
});

test("a relay refused by the sender or the server starts without TURN servers", () => {
  // The server sends STUN and TURN URLs in one entry with the credential.
  const mixed = {
    urls: ["stun:127.0.0.1:3478", "turn:127.0.0.1:3478?transport=udp"],
    username: "1700000000",
    credential: "hmac",
  };
  for (const [turn, allowRelay] of [
    [false, true],
    [true, false],
  ] as const) {
    const { state: s0, linkId } = withRecipient();
    const joined = update(s0, {
      type: "joined",
      linkId,
      attempt: A,
      iceServers: [mixed, ...TURN],
      turn,
      allowRelay,
    });
    assert.deepEqual(joined.effects, [
      { type: "start", linkId, attempt: A, iceServers: [{ urls: ["stun:127.0.0.1:3478"] }] },
    ]);
    // The backstop keys on the same choice: a relay path still ends the attempt.
    const relayed = update(joined.state, { type: "path", linkId, attempt: A, path: "relay" });
    assert.equal(findRecipient(relayed.state, linkId)?.noRelay, true, `turn ${turn}`);
  }
});

test("a full delivery walks waiting → connecting → offered → receiving → delivered", () => {
  const { state: s0, linkId } = withRecipient();

  const s1 = update(s0, {
    type: "joined",
    linkId,
    attempt: A,
    iceServers: TURN,
    turn: true,
    allowRelay: true,
  });
  assert.equal(statusOf(s1.state, linkId), "connecting");
  assert.deepEqual(s1.effects, [{ type: "start", linkId, attempt: A, iceServers: TURN }]);
  assert.equal(statusOf(s0, linkId), "waiting", "previous state not mutated");

  const s2 = update(s1.state, { type: "channel-open", linkId });
  assert.equal(statusOf(s2.state, linkId), "offered");
  assert.deepEqual(s2.effects, []);

  const s3 = update(s2.state, { type: "accepted", linkId });
  assert.equal(statusOf(s3.state, linkId), "receiving");
  assert.deepEqual(s3.effects, []);

  const s4 = update(s3.state, { type: "progress", linkId, bytesSent: 4096 });
  assert.equal(findRecipient(s4.state, linkId)?.bytesSent, 4096);
  assert.equal(findRecipient(s3.state, linkId)?.bytesSent, 0, "previous state not mutated");

  const s5 = update(s4.state, { type: "receipt", linkId, match: true });
  assert.equal(statusOf(s5.state, linkId), "delivered");
  assert.equal(findRecipient(s5.state, linkId)?.bytesSent, 4096);
  assert.deepEqual(s5.effects, [{ type: "close", linkId }]);
});

test("a join after delivery is refused as used and changes nothing", () => {
  const { state: s0, linkId } = withRecipient();
  const { state } = run(
    s0,
    joined(linkId, A),
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "receipt", linkId, match: true },
  );
  const result = update(state, joined(linkId, A));
  assert.equal(result.state, state);
  assert.deepEqual(result.effects, [{ type: "refuse", linkId, attempt: A, reason: "used" }]);
});

test("a join while connecting, offered or receiving is refused as busy", () => {
  const { state: s0, linkId } = withRecipient();
  const steps: SenderAction[] = [
    joined(linkId, A),
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
  ];
  let state = s0;
  for (const step of steps) {
    state = update(state, step).state;
    const result = update(state, joined(linkId, B));
    assert.equal(result.state, state, `after ${step.type}`);
    assert.deepEqual(result.effects, [{ type: "refuse", linkId, attempt: B, reason: "busy" }]);
  }
});

test("a join again with the active attempt restarts it and refuses nothing", () => {
  const { state: s0, linkId } = withRecipient();
  const again: SenderAction = {
    type: "joined",
    linkId,
    attempt: A,
    iceServers: TURN,
    turn: true,
    allowRelay: true,
  };
  let state = s0;
  for (const step of [
    joined(linkId, A),
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "progress", linkId, bytesSent: 7 },
  ] satisfies SenderAction[]) {
    state = update(state, step).state;
    const result = update(state, again);
    assert.equal(result.state, state, `after ${step.type}`);
    assert.deepEqual(result.effects, [{ type: "restart", linkId, iceServers: TURN }]);
  }
  // The safety number still stands between the channel and the file.
  const checked = withChecked();
  const checking = run(checked.state, joined(checked.linkId, A), {
    type: "channel-open",
    linkId: checked.linkId,
  }).state;
  const result = update(checking, { ...again, linkId: checked.linkId });
  assert.equal(result.state, checking);
  assert.deepEqual(
    result.effects.map((effect) => effect.type),
    ["restart"],
  );
});

test("a join again after the attempt ended starts nothing", () => {
  const { state: s0, linkId } = withRecipient();
  const again = joined(linkId, A);
  const receiving = run(
    s0,
    again,
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "progress", linkId, bytesSent: 7 },
  ).state;

  const delivered = update(receiving, { type: "receipt", linkId, match: true }).state;
  const used = update(delivered, again);
  assert.equal(used.state, delivered);
  assert.deepEqual(used.effects, [{ type: "refuse", linkId, attempt: A, reason: "used" }]);

  // A join again that crossed the sender's refusal reaches the server after it unbound the
  // attempt, so it pairs as a first join. The recipient ended that attempt: it is refused with
  // "drop" and starts nothing, while a new attempt (Try again, a reload) starts as usual.
  const refused = run(s0, joined(linkId, A, false), { type: "channel-open", linkId }).state;
  const connecting = run(s0, again).state;
  const checking = withChecked();
  const ended: Record<string, SenderState> = {
    dropped: update(receiving, { type: "dropped", linkId }).state,
    timeout: update(connecting, { type: "timeout", linkId }).state,
    left: update(connecting, { type: "left", linkId }).state,
    "server-lost": update(connecting, { type: "server-lost" }).state,
    unsendable: update(connecting, { type: "unsendable", linkId }).state,
    outdated: update(connecting, { type: "outdated", linkId, older: "recipient" }).state,
    mismatch: update(receiving, { type: "receipt", linkId, match: false }).state,
    declined: run(s0, again, { type: "channel-open", linkId }, { type: "declined", linkId }).state,
    relayed: update(refused, { type: "path", linkId, attempt: A, path: "relay" }).state,
  };
  for (const [how, state] of Object.entries(ended)) {
    const result = update(state, again);
    assert.equal(result.state, state, how);
    assert.deepEqual(result.effects, [{ type: "refuse", linkId, attempt: A, reason: "drop" }], how);
    const next = update(state, joined(linkId, B));
    assert.deepEqual(next.effects, [{ type: "start", linkId, attempt: B, iceServers: [] }], how);
    assert.equal(statusOf(next.state, linkId), "connecting", how);
  }
  // A check recipient: the crossed join costs none of its CHECK_ATTEMPTS.
  const differed = run(
    checking.state,
    joined(checking.linkId, A),
    { type: "channel-open", linkId: checking.linkId },
    { type: "check-differs", linkId: checking.linkId },
  ).state;
  const crossed = update(differed, joined(checking.linkId, A));
  assert.equal(crossed.state, differed);
  assert.deepEqual(crossed.effects, [
    { type: "refuse", linkId: checking.linkId, attempt: A, reason: "drop" },
  ]);
  assert.equal(findRecipient(differed, checking.linkId)?.checkFailures, 1);

  const removed = update(receiving, { type: "remove", linkId }).state;
  assert.deepEqual(update(removed, again).effects, [
    { type: "refuse", linkId, attempt: A, reason: "unknown" },
  ]);

  const checked = withChecked();
  let locked = checked.state;
  for (let i = 0; i < CHECK_ATTEMPTS; i++) {
    locked = run(locked, joined(checked.linkId, `${A}${i}`), {
      type: "timeout",
      linkId: checked.linkId,
    }).state;
  }
  assert.deepEqual(update(locked, joined(checked.linkId, A)).effects, [
    { type: "refuse", linkId: checked.linkId, attempt: A, reason: "used" },
  ]);
});

test("a join again under a refused relay restarts with only STUN URLs, and a relay path still ends it", () => {
  const mixed = {
    urls: ["stun:127.0.0.1:3478", "turn:127.0.0.1:3478?transport=udp"],
    username: "1700000000",
    credential: "hmac",
  };
  const stun = [{ urls: ["stun:127.0.0.1:3478"] }];
  // [the first join's relay, then the server's `turn` and the sender's checkbox at the join again]
  for (const [first, turn, allowRelay] of [
    [false, false, true],
    [false, true, false],
    [true, true, false],
    [true, false, true],
  ] as const) {
    const { state: s0, linkId } = withRecipient();
    const { state } = run(s0, joined(linkId, A, first), { type: "channel-open", linkId });
    const result = update(state, {
      type: "joined",
      linkId,
      attempt: A,
      iceServers: [mixed, ...TURN],
      turn,
      allowRelay,
    });
    const label = `${first} ${turn} ${allowRelay}`;
    assert.deepEqual(result.effects, [{ type: "restart", linkId, iceServers: stun }], label);
    assert.deepEqual(
      findRecipient(result.state, linkId),
      { ...findRecipient(state, linkId), turn: false },
      label,
    );
    const relayed = update(result.state, { type: "path", linkId, attempt: A, path: "relay" });
    assert.equal(findRecipient(relayed.state, linkId)?.noRelay, true, label);
    assert.deepEqual(relayed.effects, [
      { type: "refuse", linkId, attempt: A, reason: "drop" },
      { type: "close", linkId },
    ]);
  }
  // The sender allows the relay by the time the recipient joins again: the peer decides what it uses.
  const { state: s0, linkId } = withRecipient();
  const { state } = run(s0, joined(linkId, A, false), { type: "channel-open", linkId });
  const allowed = update(state, {
    type: "joined",
    linkId,
    attempt: A,
    iceServers: TURN,
    turn: true,
    allowRelay: true,
  });
  assert.deepEqual(allowed.effects, [{ type: "restart", linkId, iceServers: TURN }]);
  assert.equal(findRecipient(allowed.state, linkId)?.turn, true);
});

test("a join for a link ID not on the list is refused as unknown", () => {
  const { state } = withRecipient();
  const stranger = createLink(ORIGIN).linkId;
  const result = update(state, joined(stranger, A));
  assert.equal(result.state, state);
  assert.deepEqual(result.effects, [
    { type: "refuse", linkId: stranger, attempt: A, reason: "unknown" },
  ]);
});

test("a drop before delivery returns the recipient to waiting and frees the link", () => {
  for (const reached of ["connecting", "offered", "receiving"] as const) {
    const { state: s0, linkId } = withRecipient();
    const steps: SenderAction[] = [
      joined(linkId, A),
      { type: "channel-open", linkId },
      { type: "accepted", linkId },
      { type: "progress", linkId, bytesSent: 1 << 20 },
    ];
    const count = { connecting: 1, offered: 2, receiving: 4 }[reached];
    const { state } = run(s0, ...steps.slice(0, count));
    assert.equal(statusOf(state, linkId), reached);

    const dropped = update(state, { type: "dropped", linkId });
    assert.deepEqual(findRecipient(dropped.state, linkId), {
      ...findRecipient(s0, linkId),
      status: "waiting",
      bytesSent: 0,
      ended: A,
      ...(reached === "connecting" && { noConnect: true }),
      ...(reached === "receiving" && { error: INTERRUPTED }),
    });
    assert.deepEqual(
      dropped.effects,
      [
        { type: "refuse", linkId, attempt: A, reason: "drop" },
        { type: "close", linkId },
      ],
      "the server unbinds a joiner that may still be connected",
    );

    const again = update(dropped.state, joined(linkId, B));
    assert.equal(findRecipient(again.state, linkId)?.error, undefined);
    assert.equal(statusOf(again.state, linkId), "connecting", "the same link starts over");
    assert.deepEqual(again.effects, [{ type: "start", linkId, attempt: B, iceServers: [] }]);
  }
});

test("a drop or timeout refuses the attempt that started the connection, not a later joiner", () => {
  const { state: s0, linkId } = withRecipient();
  const connecting = run(s0, joined(linkId, A)).state;
  assert.equal(findRecipient(connecting, linkId)?.attempt, A);
  // B joins while A is still on: B is refused with its own attempt, A stays stored.
  const busy = update(connecting, joined(linkId, B));
  assert.deepEqual(busy.effects, [{ type: "refuse", linkId, attempt: B, reason: "busy" }]);
  assert.equal(findRecipient(busy.state, linkId)?.attempt, A);
  // A late drop of A refuses A, so the server leaves whoever joined since alone.
  for (const type of ["dropped", "timeout"] as const) {
    const ended = update(busy.state, { type, linkId });
    assert.deepEqual(ended.effects, [
      { type: "refuse", linkId, attempt: A, reason: "drop" },
      { type: "close", linkId },
    ]);
    assert.equal(findRecipient(ended.state, linkId)?.attempt, undefined, type);
  }
  // Once A was dropped, B's join starts a connection that stores B.
  const dropped = update(busy.state, { type: "dropped", linkId }).state;
  const next = run(dropped, joined(linkId, B), { type: "dropped", linkId });
  assert.deepEqual(next.effects, [
    { type: "start", linkId, attempt: B, iceServers: [] },
    { type: "refuse", linkId, attempt: B, reason: "drop" },
    { type: "close", linkId },
  ]);
});

test("a channel that does not open in time is dropped and its joiner refused", () => {
  assert.equal(SETUP_TIMEOUT_MS, 20_000);
  const { state: s0, linkId } = withRecipient();
  const connecting = run(s0, joined(linkId, A)).state;
  const result = update(connecting, { type: "timeout", linkId });
  assert.deepEqual(findRecipient(result.state, linkId), {
    ...findRecipient(s0, linkId),
    ended: A,
    noConnect: true,
  });
  assert.deepEqual(result.effects, [
    { type: "refuse", linkId, attempt: A, reason: "drop" },
    { type: "close", linkId },
  ]);

  const again = update(result.state, joined(linkId, B));
  assert.equal(statusOf(again.state, linkId), "connecting", "the real recipient can join");
  assert.deepEqual(again.effects, [{ type: "start", linkId, attempt: B, iceServers: [] }]);
});

test("a timeout after the channel opened is ignored", () => {
  const { state: s0, linkId } = withRecipient();
  const offered = run(s0, joined(linkId, A), { type: "channel-open", linkId }).state;
  const receiving = run(offered, { type: "accepted", linkId }).state;
  const delivered = run(receiving, { type: "receipt", linkId, match: true }).state;
  for (const state of [s0, offered, receiving, delivered]) {
    const result = update(state, { type: "timeout", linkId });
    assert.equal(result.state, state);
    assert.deepEqual(result.effects, []);
  }
});

test("left while connecting returns the recipient to waiting", () => {
  const { state: s0, linkId } = withRecipient();
  const { state } = run(s0, joined(linkId, A));
  const result = update(state, { type: "left", linkId });
  assert.deepEqual(findRecipient(result.state, linkId), {
    ...findRecipient(s0, linkId),
    ended: A,
    noConnect: true,
  });
  assert.deepEqual(result.effects, [{ type: "close", linkId }]);
});

test("server-lost resets connecting recipients without blaming the relay", () => {
  const a = withRecipient("Anna");
  const b = withRecipient("Erik");
  const c = withRecipient("Mia");
  const d = withRecipient("Olle");
  let state = initialSenderState;
  state = run(state, { type: "add", link: a.link, name: "Anna" }).state;
  state = run(state, { type: "add", link: b.link, name: "Erik" }).state;
  state = run(state, { type: "add", link: c.link, name: "Mia" }).state;
  state = run(state, { type: "add", link: d.link, name: "Olle" }).state;
  state = run(state, joined(a.linkId, A, false), joined(b.linkId, A), joined(c.linkId, A), {
    type: "channel-open",
    linkId: c.linkId,
  }).state;
  const offered = findRecipient(state, c.linkId);
  const result = update(state, { type: "server-lost" });
  for (const id of [a.linkId, b.linkId]) {
    const after = findRecipient(result.state, id);
    assert.equal(after?.status, "waiting");
    assert.equal(after?.noRelay, undefined);
  }
  assert.deepEqual(result.effects, [
    { type: "close", linkId: a.linkId },
    { type: "close", linkId: b.linkId },
  ]);
  assert.equal(findRecipient(result.state, c.linkId), offered);
  assert.equal(statusOf(result.state, d.linkId), "waiting");
  assert.equal(update(result.state, { type: "server-lost" }).state, result.state);
});

/** An emailed recipient whose server answered with a mark, so the server holds its email binding. */
function emailed(name: string) {
  const link = createLink(ORIGIN);
  const { state } = run(
    initialSenderState,
    { type: "add", link, name, email: `${name.toLowerCase()}@example.se` },
    { type: "email", linkId: link.linkId, status: "sent", mark: "m".repeat(22) },
  );
  return { link, recipient: findRecipient(state, link.linkId) as Recipient };
}

test("armedLinks names the hosted links whose current attempt a held token is for", () => {
  const a = createLink(ORIGIN);
  const b = createLink(ORIGIN);
  const c = createLink(ORIGIN);
  const { state } = run(
    initialSenderState,
    { type: "add", link: a, name: "Anna" },
    { type: "add", link: b, name: "Erik" },
    { type: "add", link: c, name: "Mia" },
    joined(a.linkId, A),
    { type: "channel-open", linkId: a.linkId },
    joined(b.linkId, B),
    { type: "channel-open", linkId: b.linkId },
  );
  const tokens = new Map([
    [a.linkId, { attempt: A }],
    // A token for another attempt than the current one, and one for a link without an attempt.
    [b.linkId, { attempt: A }],
    [c.linkId, { attempt: A }],
    [createLink(ORIGIN).linkId, { attempt: A }],
  ]);
  assert.deepEqual(armedLinks(state, tokens), [a.linkId]);
  assert.deepEqual(armedLinks(state, new Map()), []);
  // Delivery keeps the attempt, so the server may still hold it; an unbound link is not hosted.
  const delivered = run(
    state,
    { type: "accepted", linkId: a.linkId },
    { type: "receipt", linkId: a.linkId, match: true },
  ).state;
  assert.deepEqual(armedLinks(delivered, tokens), [a.linkId]);
  const unbound = {
    recipients: state.recipients.map((r) =>
      r.linkId === a.linkId ? { ...r, unbound: true as const } : r,
    ),
  };
  assert.deepEqual(armedLinks(unbound, tokens), []);
});

test("server-lost leaves an armed recipient as it is, and resume-refused then does what it would have", () => {
  const anna = emailed("Anna");
  const erik = emailed("Erik");
  let state: SenderState = {
    recipients: [
      { ...anna.recipient, status: "receiving", attempt: A, turn: true, bytesSent: 5 },
      { ...erik.recipient, status: "receiving", attempt: B, turn: true, bytesSent: 5 },
    ],
  };
  const lost = update(state, { type: "server-lost", armed: [anna.link.linkId] });
  assert.deepEqual(lost.effects, []);
  // The card shows no interruption while the next socket takes the attempt back.
  assert.equal(findRecipient(lost.state, anna.link.linkId), state.recipients[0]);
  assert.equal(findRecipient(lost.state, erik.link.linkId)?.unbound, true);
  assert.deepEqual(hostedLinks(lost.state), [anna.link.linkId]);
  // A takeover that succeeds changes nothing more; a refused one unbinds the link.
  state = lost.state;
  const refused = update(state, { type: "resume-refused", linkId: anna.link.linkId });
  assert.deepEqual(refused.effects, []);
  const after = findRecipient(refused.state, anna.link.linkId);
  assert.equal(after?.unbound, true);
  assert.equal(after?.status, "receiving");
  assert.equal(after?.error, undefined);
  assert.deepEqual(hostedLinks(refused.state), []);
  // Once unbound, a second refusal changes nothing.
  assert.equal(
    update(refused.state, { type: "resume-refused", linkId: anna.link.linkId }).state,
    refused.state,
  );
});

test("resume-refused sends a connecting recipient back to waiting and closes it, as server-lost does", () => {
  const { state: s0, linkId } = withRecipient();
  const connecting = run(s0, joined(linkId, A)).state;
  const kept = update(connecting, { type: "server-lost", armed: [linkId] });
  assert.equal(kept.state, connecting);
  assert.deepEqual(kept.effects, []);
  const refused = update(connecting, { type: "resume-refused", linkId });
  assert.deepEqual(refused, update(connecting, { type: "server-lost" }));
  assert.equal(statusOf(refused.state, linkId), "waiting");
  assert.deepEqual(refused.effects, [{ type: "close", linkId }]);
});

test("left once the channel is open is ignored; a receipt after it still delivers", () => {
  const { state: s0, linkId } = withRecipient();
  const offered = run(s0, joined(linkId, A), { type: "channel-open", linkId }).state;
  const leftOffered = update(offered, { type: "left", linkId });
  assert.equal(leftOffered.state, offered);
  assert.deepEqual(leftOffered.effects, []);

  const receiving = run(offered, { type: "accepted", linkId }).state;
  const leftReceiving = update(receiving, { type: "left", linkId });
  assert.equal(leftReceiving.state, receiving);
  assert.deepEqual(leftReceiving.effects, []);

  const delivered = update(leftReceiving.state, { type: "receipt", linkId, match: true });
  assert.equal(statusOf(delivered.state, linkId), "delivered");
  assert.deepEqual(delivered.effects, [{ type: "close", linkId }]);

  // A decline that arrives after `left` still counts too.
  const declined = update(leftOffered.state, { type: "declined", linkId });
  assert.equal(statusOf(declined.state, linkId), "declined");
});

test("a decline marks the recipient declined and the next join retries", () => {
  const { state: s0, linkId } = withRecipient();
  const { state } = run(s0, joined(linkId, A), { type: "channel-open", linkId });
  const result = update(state, { type: "declined", linkId });
  assert.equal(statusOf(result.state, linkId), "declined");
  assert.deepEqual(result.effects, [{ type: "close", linkId }]);

  const retry = update(result.state, joined(linkId, B));
  assert.equal(statusOf(retry.state, linkId), "connecting");
  assert.deepEqual(retry.effects, [{ type: "start", linkId, attempt: B, iceServers: [] }]);
});

test("a mismatching receipt fails the transfer and the next join retries", () => {
  const { state: s0, linkId } = withRecipient();
  const { state } = run(
    s0,
    joined(linkId, A),
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "progress", linkId, bytesSent: 100 },
  );
  const failed = update(state, { type: "receipt", linkId, match: false });
  const recipient = findRecipient(failed.state, linkId);
  assert.equal(recipient?.status, "failed");
  assert.equal(recipient?.error, CHECKSUM_MISMATCH);
  assert.equal(recipient?.bytesSent, 0);
  assert.deepEqual(failed.effects, [{ type: "close", linkId }]);

  const retry = update(failed.state, joined(linkId, B));
  const retried = findRecipient(retry.state, linkId);
  assert.equal(retried?.status, "connecting");
  assert.equal(retried && "error" in retried, false, "error cleared");
  assert.deepEqual(retry.effects, [{ type: "start", linkId, attempt: B, iceServers: [] }]);
});

test("unsendable fails a connecting recipient, frees the link and the next join retries", () => {
  const { state: s0, linkId } = withRecipient();
  const original = findRecipient(s0, linkId);
  const connecting = update(s0, joined(linkId, A, false)).state;
  const failed = update(connecting, { type: "unsendable", linkId });
  assert.deepEqual(findRecipient(failed.state, linkId), {
    ...original,
    status: "failed",
    bytesSent: 0,
    ended: A,
    error: TOO_SMALL_FOR_TEXT,
  });
  assert.deepEqual(failed.effects, [
    { type: "refuse", linkId, attempt: A, reason: "drop" },
    { type: "close", linkId },
  ]);

  const offered = update(connecting, { type: "channel-open", linkId }).state;
  const late = update(offered, { type: "unsendable", linkId });
  assert.equal(late.state, offered);
  assert.deepEqual(late.effects, []);

  const retry = update(failed.state, joined(linkId, B));
  const retried = findRecipient(retry.state, linkId);
  assert.equal(retried?.status, "connecting");
  assert.equal(retried?.error, undefined);
  assert.deepEqual(retry.effects, [{ type: "start", linkId, attempt: B, iceServers: [] }]);
});

test("events that do not fit the current status are ignored", () => {
  const { state: waiting, linkId } = withRecipient();
  const outOfPlace: Exclude<SenderAction, { type: "add" | "server-lost" | "reset" }>[] = [
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "progress", linkId, bytesSent: 10 },
    { type: "receipt", linkId, match: true },
    { type: "dropped", linkId },
    { type: "left", linkId },
    { type: "timeout", linkId },
    { type: "declined", linkId },
    { type: "unsendable", linkId },
    { type: "outdated", linkId, older: "sender" },
    { type: "resume-refused", linkId },
  ];
  for (const action of outOfPlace) {
    const result = update(waiting, action);
    assert.equal(result.state, waiting, action.type);
    assert.deepEqual(result.effects, [], action.type);
  }

  const connecting = update(waiting, joined(linkId, A)).state;
  for (const action of [
    { type: "accepted", linkId },
    { type: "declined", linkId },
    { type: "receipt", linkId, match: true },
  ] satisfies SenderAction[]) {
    assert.equal(update(connecting, action).state, connecting, action.type);
  }

  const stranger = createLink(ORIGIN).linkId;
  for (const action of outOfPlace) {
    const result = update(waiting, { ...action, linkId: stranger });
    assert.equal(result.state, waiting);
    assert.deepEqual(result.effects, []);
  }
});

test("path records the current attempt's path through offered, receiving and delivered", () => {
  const { state: s0, linkId } = withRecipient();
  const steps: SenderAction[] = [
    { type: "joined", linkId, attempt: A, iceServers: TURN, turn: true, allowRelay: true },
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "receipt", linkId, match: true },
  ];
  let state = s0;
  for (const [i, step] of steps.entries()) {
    state = update(state, step).state;
    if (i === 0) {
      continue;
    }
    const result = update(state, { type: "path", linkId, attempt: A, path: "relay" });
    assert.equal(findRecipient(result.state, linkId)?.path, "relay", `after ${step.type}`);
    assert.equal(statusOf(result.state, linkId), statusOf(state, linkId), `after ${step.type}`);
    assert.deepEqual(result.effects, []);
  }

  const delivered = run(
    s0,
    ...steps.slice(0, 2),
    { type: "path", linkId, attempt: A, path: "direct" },
    ...steps.slice(2),
  ).state;
  assert.equal(statusOf(delivered, linkId), "delivered");
  assert.equal(findRecipient(delivered, linkId)?.path, "direct", "delivery keeps the path");
});

test("a path for another attempt is ignored", () => {
  const { state: s0, linkId } = withRecipient();
  const offered = run(s0, joined(linkId, B), { type: "channel-open", linkId }).state;
  const late = update(offered, { type: "path", linkId, attempt: A, path: "relay" });
  assert.equal(late.state, offered);
  assert.deepEqual(late.effects, []);

  for (const state of [s0, update(offered, { type: "declined", linkId }).state]) {
    const result = update(state, { type: "path", linkId, attempt: B, path: "relay" });
    assert.equal(result.state, state, "no attempt to match once reset");
  }
});

test("a drop, a decline or a failed receipt clears the path, so the next join starts without one", () => {
  const ends = ["dropped", "declined", "receipt"] as const;
  for (const end of ends) {
    const { state: s0, linkId } = withRecipient();
    const steps: SenderAction[] = [
      joined(linkId, A),
      { type: "channel-open", linkId },
      { type: "path", linkId, attempt: A, path: "stun" },
    ];
    if (end === "receipt") {
      steps.push({ type: "accepted", linkId });
    }
    const withPath = run(s0, ...steps).state;
    assert.equal(findRecipient(withPath, linkId)?.path, "stun", end);
    const action: SenderAction =
      end === "receipt" ? { type: end, linkId, match: false } : { type: end, linkId };
    const ended = update(withPath, action).state;
    const recipient = findRecipient(ended, linkId);
    assert.equal(recipient && "path" in recipient, false, `${end} clears the path`);

    const rejoined = findRecipient(update(ended, joined(linkId, B)).state, linkId);
    assert.equal(rejoined?.status, "connecting", end);
    assert.equal(rejoined && "path" in rejoined, false, `the join after ${end} has no path`);
  }
});

test("an attempt that ends while connecting under a refused relay marks the recipient noRelay", () => {
  for (const end of ["dropped", "timeout", "left"] as const) {
    const { state: s0, linkId } = withRecipient();
    const connecting = run(s0, joined(linkId, A, false)).state;
    assert.equal(findRecipient(connecting, linkId)?.turn, false, end);

    const ended = update(connecting, { type: end, linkId });
    assert.deepEqual(
      findRecipient(ended.state, linkId),
      { ...findRecipient(s0, linkId), ended: A, noRelay: true },
      end,
    );
    assert.deepEqual(
      ended.effects,
      end === "left"
        ? [{ type: "close", linkId }]
        : [
            { type: "refuse", linkId, attempt: A, reason: "drop" },
            { type: "close", linkId },
          ],
      end,
    );

    const rejoined = update(ended.state, {
      type: "joined",
      linkId,
      attempt: B,
      iceServers: TURN,
      turn: true,
      allowRelay: true,
    });
    const recipient = findRecipient(rejoined.state, linkId);
    assert.equal(recipient?.status, "connecting", end);
    assert.equal(recipient?.turn, true, end);
    assert.equal(recipient && "noRelay" in recipient, false, `the join after ${end} clears it`);
  }
});

test("noRelay is not set under an allowed relay, or once the channel opened", () => {
  const cases: Array<{ turn: boolean; steps: Array<"channel-open" | "accepted"> }> = [
    { turn: true, steps: [] },
    { turn: false, steps: ["channel-open"] },
    { turn: false, steps: ["channel-open", "accepted"] },
  ];
  for (const { turn, steps } of cases) {
    const { state: s0, linkId } = withRecipient();
    const { state } = run(s0, joined(linkId, A, turn), ...steps.map((type) => ({ type, linkId })));
    for (const end of ["dropped", "timeout", "left"] as const) {
      const recipient = findRecipient(update(state, { type: end, linkId }).state, linkId);
      assert.equal(recipient && "noRelay" in recipient, false, `${end} after ${steps}, ${turn}`);
    }
  }
});

test("an attempt that ends while connecting under an allowed relay marks the recipient noConnect", () => {
  for (const end of ["dropped", "timeout", "left"] as const) {
    const { state: s0, linkId } = withRecipient();
    const connecting = run(s0, joined(linkId, A, true)).state;
    const ended = update(connecting, { type: end, linkId }).state;
    assert.deepEqual(
      findRecipient(ended, linkId),
      { ...findRecipient(s0, linkId), ended: A, noConnect: true },
      end,
    );

    const recipient = findRecipient(update(ended, joined(linkId, B)).state, linkId);
    assert.equal(recipient?.status, "connecting", end);
    assert.equal(recipient && "noConnect" in recipient, false, `the join after ${end} clears it`);
  }
  // Not once the channel opened, and not when our own server dropped.
  const { state: s0, linkId } = withRecipient();
  const open = run(s0, joined(linkId, A, true), { type: "channel-open", linkId }).state;
  const dropped = findRecipient(update(open, { type: "dropped", linkId }).state, linkId);
  assert.equal(dropped && "noConnect" in dropped, false);
  const connecting = run(s0, joined(linkId, A, true)).state;
  const lost = findRecipient(update(connecting, { type: "server-lost" }).state, linkId);
  assert.equal(lost && "noConnect" in lost, false);
});

test("a busy join keeps the relay choice of the attempt in progress", () => {
  const { state: s0, linkId } = withRecipient();
  const { state, effects } = run(s0, joined(linkId, A, false), {
    type: "joined",
    linkId,
    attempt: B,
    iceServers: TURN,
    turn: true,
    allowRelay: true,
  });
  assert.deepEqual(effects.at(-1), { type: "refuse", linkId, attempt: B, reason: "busy" });
  assert.equal(findRecipient(state, linkId)?.turn, false);
  assert.equal(
    findRecipient(update(state, { type: "timeout", linkId }).state, linkId)?.noRelay,
    true,
  );
});

test("a relay path under a refused relay ends the attempt like a timeout", () => {
  for (const steps of [["channel-open"], ["channel-open", "accepted"]] as const) {
    const { state: s0, linkId } = withRecipient();
    const { state } = run(s0, joined(linkId, A, false), ...steps.map((type) => ({ type, linkId })));
    const result = update(state, { type: "path", linkId, attempt: A, path: "relay" });
    assert.deepEqual(
      findRecipient(result.state, linkId),
      { ...findRecipient(s0, linkId), ended: A, noRelay: true },
      `after ${steps}`,
    );
    assert.deepEqual(result.effects, [
      { type: "refuse", linkId, attempt: A, reason: "drop" },
      { type: "close", linkId },
    ]);
  }
});

test("a relay path only records the path when the relay was allowed or the file delivered", () => {
  const { state: s0, linkId } = withRecipient();
  const offered = (turn: boolean) =>
    run(s0, joined(linkId, A, turn), { type: "channel-open", linkId }).state;

  const allowed = update(offered(true), { type: "path", linkId, attempt: A, path: "relay" });
  assert.equal(findRecipient(allowed.state, linkId)?.path, "relay");
  assert.equal(statusOf(allowed.state, linkId), "offered");
  assert.deepEqual(allowed.effects, []);

  for (const path of ["direct", "stun"] as const) {
    const result = update(offered(false), { type: "path", linkId, attempt: A, path });
    assert.equal(findRecipient(result.state, linkId)?.path, path);
    assert.equal(statusOf(result.state, linkId), "offered");
    assert.deepEqual(result.effects, []);
  }

  const delivered = run(
    offered(false),
    { type: "accepted", linkId },
    { type: "receipt", linkId, match: true },
  ).state;
  const late = update(delivered, { type: "path", linkId, attempt: A, path: "relay" });
  assert.equal(statusOf(late.state, linkId), "delivered");
  assert.equal(findRecipient(late.state, linkId)?.path, "relay");
  assert.deepEqual(late.effects, []);

  const stale = update(offered(false), { type: "path", linkId, attempt: B, path: "relay" });
  assert.equal(statusOf(stale.state, linkId), "offered");
  assert.deepEqual(stale.effects, []);
});

test("refusesRelay is true only for a relay path on the active attempt that refused it", () => {
  const { state: s0, linkId } = withRecipient();
  const offered = (turn: boolean) => {
    const found = findRecipient(
      run(s0, joined(linkId, A, turn), { type: "channel-open", linkId }).state,
      linkId,
    );
    assert.ok(found);
    return found;
  };
  const refused = offered(false);
  assert.equal(refusesRelay(refused, A, "relay"), true);
  assert.equal(refusesRelay(refused, A, "direct"), false);
  assert.equal(refusesRelay(refused, A, "stun"), false);
  assert.equal(refusesRelay(offered(true), A, "relay"), false, "relay allowed");
  assert.equal(refusesRelay(refused, B, "relay"), false, "stale attempt");

  const delivered = findRecipient(
    run(
      s0,
      joined(linkId, A, false),
      { type: "channel-open", linkId },
      { type: "accepted", linkId },
      { type: "receipt", linkId, match: true },
    ).state,
    linkId,
  );
  assert.ok(delivered);
  assert.equal(delivered.turn, false);
  assert.equal(refusesRelay(delivered, A, "relay"), false, "delivered");
});

test("remove drops a recipient and closes its connection if active", () => {
  const { state: s0, linkId } = withRecipient();
  const idle = update(s0, { type: "remove", linkId });
  assert.deepEqual(idle.state.recipients, []);
  assert.deepEqual(idle.effects, []);

  const active = update(update(s0, joined(linkId, A)).state, {
    type: "remove",
    linkId,
  });
  assert.deepEqual(active.state.recipients, []);
  assert.deepEqual(active.effects, [{ type: "close", linkId }]);

  const afterRemove = update(idle.state, joined(linkId, A));
  assert.deepEqual(afterRemove.effects, [
    { type: "refuse", linkId, attempt: A, reason: "unknown" },
  ]);
});

test("reset empties the list and closes only the active connections", () => {
  const { state: s0, linkId } = withRecipient();
  const other = createLink(ORIGIN);
  const two = update(update(s0, joined(linkId, A)).state, {
    type: "add",
    link: other,
    name: "Bo",
  }).state;
  const reset = update(two, { type: "reset" });
  assert.deepEqual(reset.state.recipients, []);
  assert.deepEqual(reset.effects, [{ type: "close", linkId }]);
  assert.deepEqual(hostedLinks(reset.state), []);

  const empty = update(reset.state, { type: "reset" });
  assert.equal(empty.state, reset.state);
  assert.deepEqual(empty.effects, []);

  const afterReset = update(reset.state, joined(linkId, B));
  assert.deepEqual(afterReset.effects, [{ type: "refuse", linkId, attempt: B, reason: "unknown" }]);
});

test("hostedLinks lists every recipient, delivered ones included", () => {
  const a = createLink(ORIGIN);
  const b = createLink(ORIGIN);
  const { state } = run(
    initialSenderState,
    { type: "add", link: a, name: "Anna" },
    { type: "add", link: b, name: "Erik" },
    joined(a.linkId, A),
    { type: "channel-open", linkId: a.linkId },
    { type: "accepted", linkId: a.linkId },
    { type: "receipt", linkId: a.linkId, match: true },
  );
  assert.equal(statusOf(state, a.linkId), "delivered");
  assert.deepEqual(hostedLinks(state), [a.linkId, b.linkId]);
  assert.deepEqual(hostedLinks(initialSenderState), []);
});

test("effects never contain a recipient name or secret", () => {
  const name = `Anna-${crypto.randomUUID()}`;
  const link = createLink(ORIGIN);
  const { linkId } = link;
  const stranger = createLink(ORIGIN).linkId;
  const { effects } = run(
    initialSenderState,
    { type: "add", link, name },
    joined(stranger, A),
    joined(linkId, A),
    joined(linkId, A),
    { type: "channel-open", linkId },
    { type: "declined", linkId },
    joined(linkId, A),
    joined(linkId, B),
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "dropped", linkId },
    joined(linkId, `${A}1`),
    { type: "unsendable", linkId },
    joined(linkId, `${A}2`),
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "receipt", linkId, match: false },
    joined(linkId, `${A}3`),
    { type: "channel-open", linkId },
    { type: "accepted", linkId },
    { type: "receipt", linkId, match: true },
    joined(linkId, A),
    { type: "remove", linkId },
  );
  assert.ok(effects.length >= 10);
  for (const effect of effects) {
    const text = JSON.stringify(effect);
    assert.ok(!text.includes(name), text);
    assert.ok(!text.includes(link.secret), text);
    assert.ok(!text.includes(link.url), text);
    assert.deepEqual(
      Object.keys(effect).sort(),
      {
        refuse: ["attempt", "linkId", "reason", "type"],
        start: ["attempt", "iceServers", "linkId", "type"],
        restart: ["iceServers", "linkId", "type"],
      }[effect.type as string] ?? ["linkId", "type"],
    );
  }
});

test("add with an email starts its mail at sending and keeps both through attempts", () => {
  const link = createLink(ORIGIN);
  const { linkId } = link;
  const email = "anna@example.se";
  const added = run(initialSenderState, { type: "add", link, name: "Anna", email });
  assert.deepEqual(added.effects, []);
  assert.deepEqual(added.state.recipients, [
    { name: "Anna", ...link, status: "waiting", bytesSent: 0, email, mail: "sending" },
  ]);

  const { state, effects } = run(
    added.state,
    { type: "email", linkId, status: "sent" },
    { type: "joined", linkId, attempt: A, iceServers: [], turn: true, allowRelay: true },
    { type: "dropped", linkId },
  );
  assert.ok(effects.every((effect) => !JSON.stringify(effect).includes(email)));
  assert.equal(statusOf(state, linkId), "waiting");
  assert.equal(findRecipient(state, linkId)?.email, email);
  assert.equal(findRecipient(state, linkId)?.mail, "sent");
});

test("email keeps the latest status, except that verified stays and a notice reply never replaces a code", () => {
  const link = createLink(ORIGIN);
  const { linkId } = link;
  const added = run(initialSenderState, {
    type: "add",
    link,
    name: "Anna",
    email: "anna@example.se",
  }).state;
  const mailAfter = (...statuses: EmailStatus[]) =>
    findRecipient(
      run(added, ...statuses.map((status): SenderAction => ({ type: "email", linkId, status })))
        .state,
      linkId,
    )?.mail;

  assert.equal(mailAfter("sent", "verifying", "verified"), "verified");
  assert.equal(mailAfter("limit"), "limit");
  assert.equal(
    mailAfter("sent", "verifying", "verified", "verifying"),
    "verified",
    "another browser asking for a code does not hide that someone verified",
  );
  assert.equal(mailAfter("failed", "verifying"), "verifying", "a timed-out notice arrived");
  assert.equal(mailAfter("failed", "verifying", "verified"), "verified");
  for (const late of ["sent", "failed", "limit"] as const) {
    assert.equal(mailAfter("verifying", late), "verifying", `a late ${late} after a code`);
    assert.equal(mailAfter("verifying", "verified", late), "verified", `a late ${late}`);
  }

  const verified = run(added, { type: "email", linkId, status: "verified" }).state;
  const late = update(verified, { type: "email", linkId, status: "verifying" });
  assert.equal(late.state, verified);
  assert.deepEqual(late.effects, []);
});

test("email is ignored for an unknown link and for a recipient without an address", () => {
  const { state, linkId } = withRecipient();
  const plain = update(state, { type: "email", linkId, status: "sent" });
  assert.equal(plain.state, state);
  assert.deepEqual(plain.effects, []);
  assert.equal(findRecipient(state, linkId)?.mail, undefined);

  const stranger = createLink(ORIGIN).linkId;
  const unknown = update(state, { type: "email", linkId: stranger, status: "verified" });
  assert.equal(unknown.state, state);
  assert.deepEqual(unknown.effects, []);
});

test("a mark makes the recipient's link the one the server emailed; a refusal keeps it plain", () => {
  const mark = "MMMMMMMMMMMMMMMMMMMMMM";
  const after = (...actions: Omit<Extract<SenderAction, { type: "email" }>, "linkId">[]) => {
    const link = createLink(ORIGIN);
    const { linkId } = link;
    const { state } = run(
      initialSenderState,
      { type: "add", link, name: "Anna", email: "anna@example.se" },
      ...actions.map((action): SenderAction => ({ ...action, linkId })),
    );
    return { link, recipient: findRecipient(state, linkId) };
  };

  for (const status of ["sent", "failed"] as const) {
    const { link, recipient } = after(
      { type: "email", status, mark },
      { type: "email", status: "verifying" },
    );
    assert.equal(recipient?.mark, mark);
    assert.equal(recipient?.url, `${ORIGIN}/r/${link.linkId}#e.${mark}.${link.secret}`);
    assert.equal(recipient?.mail, "verifying");
  }
  const { link: early, recipient: late } = after(
    { type: "email", status: "verifying" },
    { type: "email", status: "sent", mark },
  );
  assert.equal(late?.mail, "verifying", "the notice reply came after a code");
  assert.equal(late?.url, `${ORIGIN}/r/${early.linkId}#e.${mark}.${early.secret}`);
  // A refusal without a mark comes after the server got the secret, so the page swaps in a
  // fresh link (see "a link whose email the server refused ..." below).
  for (const status of ["limit", "failed"] as const) {
    const { link, recipient } = after({ type: "email", status });
    assert.equal(recipient?.mark, undefined);
    assert.equal(recipient?.url, link.url, "without a fresh link, the page's own failure");
  }
  const { link, recipient } = after();
  assert.equal(recipient?.url, link.url);
});

test("a link whose email the server refused is not offered for sharing by hand (FID-237)", () => {
  for (const status of ["limit", "failed"] as const) {
    const link = createLink(ORIGIN);
    const fresh = createLink(ORIGIN);
    // By now the send page has sent this link's secret to the server in the `email` message.
    const { state, effects } = run(
      initialSenderState,
      { type: "add", link, name: "Anna", email: "anna@example.se" },
      { type: "email", linkId: link.linkId, status, fresh },
    );
    assert.deepEqual(effects, []);
    for (const recipient of state.recipients) {
      // What RecipientList shows Copy and Share for.
      const shareable =
        recipient.status === "waiting" && !unmarked(recipient) && !recipient.unbound;
      assert.ok(
        !(shareable && recipient.url.includes(link.secret)),
        "the card offers the link whose secret the server received",
      );
    }
    assert.deepEqual(state.recipients, [
      {
        name: "Anna",
        ...fresh,
        status: "waiting",
        bytesSent: 0,
        email: "anna@example.se",
        mail: status,
      },
    ]);
    assert.deepEqual(hostedLinks(state), [fresh.linkId], "the old link ID is no longer hosted");
    const stranger = update(state, joined(link.linkId, A));
    assert.deepEqual(stranger.effects, [
      { type: "refuse", linkId: link.linkId, attempt: A, reason: "unknown" },
    ]);
  }
});

test("a refused email ends a join on the old link and refuses it as unknown", () => {
  const link = createLink(ORIGIN);
  const fresh = createLink(ORIGIN);
  const { state, effects } = run(
    initialSenderState,
    { type: "add", link, name: "Anna", email: "anna@example.se" },
    joined(link.linkId, A),
    { type: "email", linkId: link.linkId, status: "failed", fresh },
  );
  assert.deepEqual(effects.slice(1), [
    { type: "refuse", linkId: link.linkId, attempt: A, reason: "unknown" },
    { type: "close", linkId: link.linkId },
  ]);
  assert.equal(statusOf(state, fresh.linkId), "waiting");
  assert.equal(findRecipient(state, fresh.linkId)?.attempt, undefined);
});

test("the page's own failure keeps its link, and a failure with a mark stays the emailed link", () => {
  const mark = "MMMMMMMMMMMMMMMMMMMMMM";
  const link = createLink(ORIGIN);
  const added = run(initialSenderState, {
    type: "add",
    link,
    name: "Anna",
    email: "anna@example.se",
  }).state;
  // The socket was closed, so no `email` message left the page: no fresh link.
  const own = update(added, { type: "email", linkId: link.linkId, status: "failed" }).state;
  assert.deepEqual(hostedLinks(own), [link.linkId]);
  assert.equal(findRecipient(own, link.linkId)?.url, link.url);
  assert.equal(findRecipient(own, link.linkId)?.mail, "failed");

  // The server took the link and its notice failed: the marked link is still the emailed one.
  const fresh = createLink(ORIGIN);
  const marked = update(added, {
    type: "email",
    linkId: link.linkId,
    status: "failed",
    mark,
    fresh,
  }).state;
  assert.deepEqual(hostedLinks(marked), [link.linkId]);
  assert.equal(findRecipient(marked, link.linkId)?.mark, mark);
  assert.equal(findRecipient(marked, fresh.linkId), undefined);
  // And a refusal after a mark changes nothing about the link.
  const late = update(marked, { type: "email", linkId: link.linkId, status: "limit", fresh });
  assert.deepEqual(hostedLinks(late.state), [link.linkId]);
});

test("a verifying or verified reply before the notice reply still counts as bound on server-lost", () => {
  for (const status of ["verifying", "verified"] as const) {
    const link = createLink(ORIGIN);
    const { state } = run(
      initialSenderState,
      { type: "add", link, name: "Anna", email: "anna@example.se" },
      { type: "email", linkId: link.linkId, status },
    );
    const recipient = findRecipient(state, link.linkId);
    assert.equal(recipient?.mark, undefined);
    assert.ok(emailBound(recipient as Recipient));
    assert.ok(unmarked(recipient as Recipient));
    const lost = update(state, { type: "server-lost" }).state;
    assert.deepEqual(hostedLinks(lost), []);
  }
});

test("a failed reply without a mark leaves a plain link hosted: the fresh one from the server's, the same one from the page's own", () => {
  const link = createLink(ORIGIN);
  const fresh = createLink(ORIGIN);
  const added = run(initialSenderState, {
    type: "add",
    link,
    name: "Anna",
    email: "anna@example.se",
  }).state;
  const cases = [
    [update(added, { type: "email", linkId: link.linkId, status: "failed", fresh }).state, fresh],
    [update(added, { type: "email", linkId: link.linkId, status: "failed" }).state, link],
  ] as const;
  for (const [state, hosted] of cases) {
    assert.ok(!emailBound(findRecipient(state, hosted.linkId) as Recipient));
    assert.deepEqual(hostedLinks(update(state, { type: "server-lost" }).state), [hosted.linkId]);
  }
});

test("server-lost drops noConnect and noRelay from a recipient it unbinds", () => {
  for (const turn of [true, false]) {
    const link = createLink(ORIGIN);
    const { state } = run(
      initialSenderState,
      { type: "add", link, name: "Anna", email: "anna@example.se" },
      joined(link.linkId, A, turn),
      { type: "dropped", linkId: link.linkId },
    );
    const before = findRecipient(state, link.linkId);
    assert.ok(before && ("noConnect" in before || "noRelay" in before));
    const after = findRecipient(update(state, { type: "server-lost" }).state, link.linkId);
    assert.equal(after?.unbound, true);
    assert.equal(after && "noConnect" in after, false);
    assert.equal(after && "noRelay" in after, false);
  }
});

test("server-lost unbinds every link the server emailed or may have emailed, and stops hosting it", () => {
  const mark = "MMMMMMMMMMMMMMMMMMMMMM";
  const [plain, sending, sent, limited, receiving] = Array.from({ length: 5 }, () =>
    createLink(ORIGIN),
  ) as [Link, Link, Link, Link, Link];
  const email = "anna@example.se";
  const { state } = run(
    initialSenderState,
    { type: "add", link: plain, name: "Plain" },
    { type: "add", link: sending, name: "Sending", email },
    { type: "add", link: sent, name: "Sent", email },
    { type: "add", link: limited, name: "Limited", email },
    { type: "add", link: receiving, name: "Receiving", email },
    { type: "email", linkId: sent.linkId, status: "sent", mark },
    { type: "email", linkId: limited.linkId, status: "limit" },
    { type: "email", linkId: receiving.linkId, status: "sent", mark },
    joined(receiving.linkId, A),
    { type: "channel-open", linkId: receiving.linkId },
    { type: "accepted", linkId: receiving.linkId },
  );
  const lost = update(state, { type: "server-lost" });
  assert.deepEqual(lost.effects, []);
  const unbound = lost.state.recipients.filter((r) => r.unbound).map((r) => r.linkId);
  assert.deepEqual(unbound, [sending.linkId, sent.linkId, receiving.linkId]);
  assert.deepEqual(hostedLinks(lost.state), [plain.linkId, limited.linkId]);
  assert.equal(statusOf(lost.state, receiving.linkId), "receiving");
  assert.equal(update(lost.state, { type: "server-lost" }).state, lost.state);

  const late = update(lost.state, { type: "email", linkId: sending.linkId, status: "sent", mark });
  assert.equal(late.state, lost.state);
  const removed = run(lost.state, { type: "remove", linkId: sent.linkId }).state;
  assert.deepEqual(hostedLinks(removed), [plain.linkId, limited.linkId]);
});

function withChecked(name = "Anna") {
  const link = createLink(ORIGIN);
  const { state } = run(initialSenderState, { type: "add", link, name, check: true });
  return { state, linkId: link.linkId, link };
}

test("an added recipient keeps its check choice", () => {
  const checked = withChecked();
  assert.equal(findRecipient(checked.state, checked.linkId)?.check, true);
  const plain = withRecipient();
  assert.equal(Object.hasOwn(findRecipient(plain.state, plain.linkId) ?? {}, "check"), false);
  const off = run(initialSenderState, {
    type: "add",
    link: createLink(ORIGIN),
    name: "A",
    check: false,
  });
  assert.equal(Object.hasOwn(off.state.recipients[0] ?? {}, "check"), false);
});

test("a checked recipient waits in checking until both confirmed", () => {
  const { state: s0, linkId } = withChecked();
  const open = run(s0, joined(linkId, A), { type: "channel-open", linkId });
  assert.equal(statusOf(open.state, linkId), "checking");
  assert.equal(update(open.state, joined(linkId, B)).effects[0]?.type, "refuse");
  const checked = update(open.state, { type: "checked", linkId });
  assert.equal(statusOf(checked.state, linkId), "offered");
  assert.deepEqual(checked.effects, []);

  const plain = withRecipient();
  const plainOpen = run(plain.state, joined(plain.linkId, A), {
    type: "channel-open",
    linkId: plain.linkId,
  });
  assert.equal(statusOf(plainOpen.state, plain.linkId), "offered");
  assert.equal(
    statusOf(
      update(plainOpen.state, { type: "checked", linkId: plain.linkId }).state,
      plain.linkId,
    ),
    "offered",
  );
});

test("it differs: back to waiting with the reason, the attempt refused and closed", () => {
  const { state: s0, linkId } = withChecked();
  const { state } = run(s0, joined(linkId, A), { type: "channel-open", linkId });
  const result = update(state, { type: "check-differs", linkId });
  const recipient = findRecipient(result.state, linkId);
  assert.equal(recipient?.status, "waiting");
  assert.equal(recipient?.error, CHECK_DIFFERS);
  assert.equal(recipient?.checkFailures, 1);
  assert.deepEqual(result.effects, [
    { type: "refuse", linkId, attempt: A, reason: "drop" },
    { type: "close", linkId },
  ]);
  const retry = update(result.state, joined(linkId, B));
  assert.equal(statusOf(retry.state, linkId), "connecting");
  assert.equal(findRecipient(retry.state, linkId)?.error, undefined);
  assert.equal(findRecipient(retry.state, linkId)?.checkFailures, 1);
});

test("failed checked attempts count, and the fifth locks the link", () => {
  const { state: s0, linkId } = withChecked();
  const open: SenderAction = { type: "channel-open", linkId };
  let state = run(
    s0,
    joined(linkId, `${A}1`),
    { type: "dropped", linkId },
    joined(linkId, `${A}2`),
    { type: "left", linkId },
    joined(linkId, `${A}3`),
    { type: "timeout", linkId },
    joined(linkId, `${A}4`),
    open,
    { type: "check-differs", linkId },
  ).state;
  assert.equal(statusOf(state, linkId), "waiting");
  assert.equal(findRecipient(state, linkId)?.checkFailures, 4);
  assert.deepEqual(hostedLinks(state), [linkId]);
  assert.equal(CHECK_ATTEMPTS, 5);

  state = run(state, joined(linkId, B), open).state;
  const fifth = update(state, { type: "check-differs", linkId });
  const locked = findRecipient(fifth.state, linkId);
  assert.equal(locked?.status, "failed");
  assert.equal(locked?.locked, true);
  assert.equal(locked?.error, CHECK_LIMIT);
  assert.equal(locked?.checkFailures, 5);
  assert.deepEqual(fifth.effects, [
    { type: "refuse", linkId, attempt: B, reason: "drop" },
    { type: "close", linkId },
  ]);
  assert.deepEqual(hostedLinks(fifth.state), []);

  const sixth = update(fifth.state, joined(linkId, A));
  assert.deepEqual(sixth.effects, [{ type: "refuse", linkId, attempt: A, reason: "used" }]);
  assert.equal(sixth.state, fifth.state);
});

test("every way a checked attempt ends unconfirmed counts", () => {
  const ends: Array<[string, (linkId: string) => SenderAction[]]> = [
    [
      "dropped while checking",
      (linkId) => [
        { type: "channel-open", linkId },
        { type: "dropped", linkId },
      ],
    ],
    ["a refused relay", (linkId) => [{ type: "path", linkId, attempt: A, path: "relay" }]],
    ["server-lost", () => [{ type: "server-lost" }]],
  ];
  for (const [label, actions] of ends) {
    const { state: s0, linkId } = withChecked();
    const { state } = run(s0, joined(linkId, A, false), ...actions(linkId));
    assert.equal(findRecipient(state, linkId)?.checkFailures, 1, label);
  }
});

test("a left, timeout or drop that locks the link refuses and closes it", () => {
  const { state: s0, linkId } = withChecked();
  let state = s0;
  for (let i = 0; i < CHECK_ATTEMPTS - 1; i++) {
    state = run(state, joined(linkId, `${A}${i}`), { type: "left", linkId }).state;
  }
  const result = update(run(state, joined(linkId, B)).state, { type: "left", linkId });
  assert.equal(findRecipient(result.state, linkId)?.locked, true);
  assert.deepEqual(result.effects, [
    { type: "refuse", linkId, attempt: B, reason: "drop" },
    { type: "close", linkId },
  ]);
});

test("a check recipient refused as too small after both confirmed doesn't count", () => {
  const { state: s0, linkId } = withChecked();
  const checked = run(
    s0,
    joined(linkId, A),
    { type: "channel-open", linkId },
    { type: "checked", linkId },
  ).state;
  const failed = update(checked, { type: "unsendable", linkId });
  const recipient = findRecipient(failed.state, linkId);
  assert.equal(recipient?.status, "failed");
  assert.equal(recipient?.error, TOO_SMALL_FOR_TEXT);
  assert.equal(recipient?.checkFailures, undefined);
  assert.deepEqual(failed.effects, [
    { type: "refuse", linkId, attempt: A, reason: "drop" },
    { type: "close", linkId },
  ]);
  assert.deepEqual(hostedLinks(failed.state), [linkId]);

  const retry = update(failed.state, joined(linkId, B));
  assert.equal(statusOf(retry.state, linkId), "connecting");
  assert.equal(findRecipient(retry.state, linkId)?.error, undefined);
  assert.deepEqual(retry.effects, [{ type: "start", linkId, attempt: B, iceServers: [] }]);
});

test("a check recipient is never refused as too small before both confirmed", () => {
  const { state: s0, linkId } = withChecked();
  const connecting = run(s0, joined(linkId, A)).state;
  const checking = update(connecting, { type: "channel-open", linkId }).state;
  for (const [label, state] of [
    ["connecting", connecting],
    ["checking", checking],
  ] as const) {
    const result = update(state, { type: "unsendable", linkId });
    assert.equal(result.state, state, label);
    assert.deepEqual(result.effects, [], label);
  }
});

test("a passed check does not count", () => {
  const { state: s0, linkId } = withChecked();
  const { state } = run(
    s0,
    joined(linkId, A),
    { type: "channel-open", linkId },
    { type: "checked", linkId },
    { type: "dropped", linkId },
  );
  assert.equal(statusOf(state, linkId), "waiting");
  assert.equal(findRecipient(state, linkId)?.checkFailures, undefined);
});

test("attempts without the check never count", () => {
  const { state: s0, linkId } = withRecipient();
  let state = s0;
  for (let i = 0; i < CHECK_ATTEMPTS + 1; i++) {
    state = run(state, joined(linkId, `${A}${i}`), { type: "dropped", linkId }).state;
  }
  assert.equal(statusOf(state, linkId), "waiting");
  assert.equal(findRecipient(state, linkId)?.checkFailures, undefined);
  assert.equal(update(state, { type: "check-differs", linkId }).state, state);
});

test("a check that takes too long ends the attempt and counts", () => {
  const { state: s0, linkId } = withChecked();
  const { state } = run(s0, joined(linkId, A), { type: "channel-open", linkId });
  const result = update(state, { type: "timeout", linkId });
  const recipient = findRecipient(result.state, linkId);
  assert.equal(recipient?.status, "waiting");
  assert.equal(recipient?.error, CHECK_EXPIRED);
  assert.equal(recipient?.checkFailures, 1);
  assert.deepEqual(result.effects, [
    { type: "refuse", linkId, attempt: A, reason: "drop" },
    { type: "close", linkId },
  ]);
  const offered = run(state, { type: "checked", linkId }).state;
  assert.equal(update(offered, { type: "timeout", linkId }).state, offered);
  assert.equal(CHECK_TIMEOUT_MS, 5 * 60_000);
});

test("outdated fails a connecting recipient with the page that must reload, closes without a refusal, and the next join retries", () => {
  for (const [older, error] of [
    ["sender", SENDER_OUTDATED],
    ["recipient", RECIPIENT_OUTDATED],
  ] as const) {
    const { state: s0, linkId } = withRecipient();
    const original = findRecipient(s0, linkId);
    const connecting = update(s0, joined(linkId, A, false)).state;
    const failed = update(connecting, { type: "outdated", linkId, older });
    assert.deepEqual(findRecipient(failed.state, linkId), {
      ...original,
      status: "failed",
      bytesSent: 0,
      ended: A,
      error,
    });
    assert.deepEqual(failed.effects, [{ type: "close", linkId }]);

    const offered = update(connecting, { type: "channel-open", linkId }).state;
    const late = update(offered, { type: "outdated", linkId, older });
    assert.equal(late.state, offered);
    assert.deepEqual(late.effects, []);

    const retry = update(failed.state, joined(linkId, B));
    assert.equal(statusOf(retry.state, linkId), "connecting");
    assert.equal(findRecipient(retry.state, linkId)?.error, undefined);
  }
});

test("an attempt that ends on another frame version doesn't count as a failed check", () => {
  const { state: s0, linkId } = withChecked();
  let state = s0;
  for (let i = 0; i < CHECK_ATTEMPTS + 1; i++) {
    state = run(state, joined(linkId, `${A}${i}`), {
      type: "outdated",
      linkId,
      older: "recipient",
    }).state;
  }
  const recipient = findRecipient(state, linkId);
  assert.equal(recipient?.checkFailures, undefined);
  assert.equal(recipient?.locked, undefined);
  assert.deepEqual(hostedLinks(state), [linkId]);
});
