import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { RETRY_MAX_MS } from "@fidant/protocol";
import { connectSignaling, retryDelay } from "./signaling-client.ts";

const STABLE = 10_000;
const LINK = "AAAAAAAAAAAAAAAAAAAAAA";

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static throws = 0;
  static firefoxBlock = false;
  readyState = 0;
  sent: string[] = [];
  constructor(_url: string) {
    super();
    if (FakeWebSocket.firefoxBlock) {
      FakeWebSocket.firefoxBlock = false;
      throw { name: "NS_ERROR_CONTENT_BLOCKED" };
    }
    if (FakeWebSocket.throws > 0) {
      FakeWebSocket.throws--;
      throw new DOMException("blocked", "SecurityError");
    }
    fake = this;
    created++;
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {}
}

let fake: FakeWebSocket;
let created = 0;
const original = globalThis.WebSocket;

beforeEach(() => {
  created = 0;
  FakeWebSocket.throws = 0;
  FakeWebSocket.firefoxBlock = false;
  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
});
afterEach(() => {
  globalThis.WebSocket = original;
});

function open() {
  fake.readyState = 1;
  fake.dispatchEvent(new Event("open"));
}

function drop(code = 1006) {
  fake.readyState = 3;
  fake.dispatchEvent(Object.assign(new Event("close"), { code }));
}

function receive(message: unknown) {
  fake.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(message) }));
}

test("tells onMessage each message sent and received, before subscribers, and no failed send or invalid frame", (t) => {
  t.mock.method(console, "warn", () => {});
  const seen: unknown[] = [];
  const client = connectSignaling({
    url: "wss://x/signal",
    onMessage: (...args) => seen.push(args),
  });
  client.subscribe((message) => seen.push(["subscriber", message.t]));
  client.send({ t: "host", links: [LINK], turn: true });
  fake.readyState = 1;
  client.send({ t: "join", link: LINK, attempt: LINK });
  receive({ t: "relay", link: LINK, data: "abc" });
  fake.dispatchEvent(Object.assign(new Event("message"), { data: "not json" }));
  assert.deepEqual(seen, [
    ["sent", { t: "join", link: LINK, attempt: LINK }],
    ["received", { t: "relay", link: LINK, data: "abc" }],
    ["subscriber", "relay"],
  ]);
});

test("retryDelay waits a random time up to 1 s × 2^failures, capped at 30 s", () => {
  assert.equal(
    retryDelay(0, () => 0),
    0,
  );
  assert.equal(
    retryDelay(0, () => 1),
    1000,
  );
  assert.equal(
    retryDelay(3, () => 0.5),
    4000,
  );
  assert.equal(
    retryDelay(5, () => 1),
    RETRY_MAX_MS,
  );
  assert.equal(
    retryDelay(50, () => 1),
    RETRY_MAX_MS,
  );
});

test("reconnects after a drop and keeps its listeners", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.method(Math, "random", () => 1);
  const client = connectSignaling({ url: "wss://x/signal" });
  const events: string[] = [];
  client.onOpen(() => events.push("open"));
  client.onClose(({ code, byClient }) => events.push(`close ${code} ${byClient}`));
  client.subscribe((message) => events.push(message.t));
  open();
  t.mock.timers.tick(STABLE);
  drop();
  t.mock.timers.tick(999);
  assert.equal(created, 1);
  t.mock.timers.tick(1);
  assert.equal(created, 2);
  open();
  receive({ t: "error", code: "already-hosted" });
  assert.deepEqual(events, ["open", "close 1006 false", "open", "error"]);
});

test("a failed connect doubles the next wait, and a stable open resets it", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.method(Math, "random", () => 1);
  connectSignaling({ url: "wss://x/signal" });
  drop();
  t.mock.timers.tick(1999);
  assert.equal(created, 1);
  t.mock.timers.tick(1);
  assert.equal(created, 2);
  drop();
  t.mock.timers.tick(3999);
  assert.equal(created, 2);
  t.mock.timers.tick(1);
  assert.equal(created, 3);
  open();
  t.mock.timers.tick(STABLE);
  drop();
  t.mock.timers.tick(1000);
  assert.equal(created, 4);
});

test("a close with 4012 or 1012 reconnects at once and resets the wait", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.method(Math, "random", () => 1);
  connectSignaling({ url: "wss://x/signal" });
  drop();
  t.mock.timers.tick(2000);
  assert.equal(created, 2);
  open();
  drop(4012);
  t.mock.timers.tick(0);
  assert.equal(created, 3);
  drop();
  t.mock.timers.tick(1999);
  assert.equal(created, 3);
  t.mock.timers.tick(1);
  assert.equal(created, 4);
  open();
  drop(1012);
  t.mock.timers.tick(0);
  assert.equal(created, 5);
});

test("a socket that opens and drops at once still backs off", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.method(Math, "random", () => 1);
  connectSignaling({ url: "wss://x/signal" });
  open();
  drop(1008);
  t.mock.timers.tick(1999);
  assert.equal(created, 1);
  t.mock.timers.tick(1);
  assert.equal(created, 2);
  open();
  drop(1008);
  t.mock.timers.tick(3999);
  assert.equal(created, 2);
  t.mock.timers.tick(1);
  assert.equal(created, 3);
});

test("a socket that stayed open for STABLE_MS retries within 1 s", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.method(Math, "random", () => 1);
  connectSignaling({ url: "wss://x/signal" });
  drop();
  t.mock.timers.tick(2000);
  open();
  t.mock.timers.tick(STABLE);
  drop();
  t.mock.timers.tick(1000);
  assert.equal(created, 3);
});

test("close() from an onClose listener stops the retry", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = connectSignaling({ url: "wss://x/signal" });
  client.onClose(() => client.close());
  open();
  drop();
  t.mock.timers.tick(RETRY_MAX_MS);
  assert.equal(created, 1);
});

test("close() during the wait stops reconnecting", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = connectSignaling({ url: "wss://x/signal" });
  const closes: boolean[] = [];
  client.onClose(({ byClient }) => closes.push(byClient));
  open();
  drop();
  client.close();
  t.mock.timers.tick(RETRY_MAX_MS);
  assert.equal(created, 1);
  assert.deepEqual(closes, [false]);
});

test("close() on an open socket reports byClient and does not reconnect", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const client = connectSignaling({ url: "wss://x/signal" });
  const closes: boolean[] = [];
  client.onClose(({ byClient }) => closes.push(byClient));
  open();
  client.close();
  drop(1000);
  t.mock.timers.tick(RETRY_MAX_MS);
  assert.equal(created, 1);
  assert.deepEqual(closes, [true]);
});

test("a socket the CSP blocks fails once the page has its listeners, then backs off", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.method(Math, "random", () => 1);
  FakeWebSocket.throws = 2;
  const client = connectSignaling({ url: "wss://x/signal" });
  const events: string[] = [];
  client.onOpen(() => events.push("open"));
  client.onClose(({ code, byClient }) => events.push(`close ${code} ${byClient}`));
  assert.equal(client.send({ t: "host", links: [LINK], turn: true }), false);
  assert.deepEqual(events, []);
  t.mock.timers.tick(0);
  assert.deepEqual(events, ["close 1006 false"]);
  t.mock.timers.tick(1999);
  assert.equal(FakeWebSocket.throws, 1);
  t.mock.timers.tick(1);
  assert.equal(FakeWebSocket.throws, 0);
  assert.deepEqual(events, ["close 1006 false", "close 1006 false"]);
  t.mock.timers.tick(3999);
  assert.equal(created, 0);
  t.mock.timers.tick(1);
  assert.equal(created, 1);
  open();
  assert.deepEqual(events, ["close 1006 false", "close 1006 false", "open"]);
});

test("a socket that reports error and never close fails once and retries once", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.method(Math, "random", () => 1);
  const client = connectSignaling({ url: "wss://x/signal" });
  const closes: string[] = [];
  client.onClose(({ code, byClient }) => closes.push(`${code} ${byClient}`));
  const first = fake;
  first.readyState = 3;
  first.dispatchEvent(new Event("error"));
  assert.deepEqual(closes, ["1006 false"]);
  t.mock.timers.tick(1999);
  assert.equal(created, 1);
  t.mock.timers.tick(1);
  assert.equal(created, 2);
  first.dispatchEvent(Object.assign(new Event("close"), { code: 1006 }));
  t.mock.timers.tick(RETRY_MAX_MS);
  assert.deepEqual(closes, ["1006 false"]);
  assert.equal(created, 2);
});

test("close() while a blocked socket's failure waits reports nothing and stops", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  FakeWebSocket.throws = 1;
  const client = connectSignaling({ url: "wss://x/signal" });
  const closes: boolean[] = [];
  client.onClose(({ byClient }) => closes.push(byClient));
  client.close();
  t.mock.timers.tick(RETRY_MAX_MS);
  assert.deepEqual(closes, []);
  assert.equal(created, 0);
});

test("Firefox's CSP block, a thrown non-Error, fails once and retries", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.method(Math, "random", () => 1);
  FakeWebSocket.firefoxBlock = true;
  const client = connectSignaling({ url: "wss://x/signal" });
  const events: string[] = [];
  client.onClose(({ code, byClient }) => events.push(`close ${code} ${byClient}`));
  t.mock.timers.tick(0);
  assert.deepEqual(events, ["close 1006 false"]);
  t.mock.timers.tick(2000);
  assert.equal(created, 1);
});
