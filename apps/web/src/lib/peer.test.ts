import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { checkNumber, commitFingerprint } from "./check.ts";
import { FRAME_VERSION } from "./frames.ts";
import { deriveSignalKey, openSignal, sealSignal } from "./keys.ts";
import { createLink } from "./link.ts";
import {
  assertFrameFits,
  connectionPath,
  createRecipientPeer,
  createSenderPeer,
  errorName,
  markedVersion,
  type PeerCloseReason,
  type PeerOpenInfo,
  type PeerOptions,
  parseSignalPayload,
  RECOVERY_TIMEOUT_MS,
  RELAY_FALLBACK_MS,
  UNMARKED_VERSION,
  versionMarker,
} from "./peer.ts";

const candidate = {
  candidate: "candidate:1 1 udp 2122260223 192.168.1.2 54400 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
  usernameFragment: "abcd",
};

const HASH = "eJYHYAxO7JqecPu7xarRNkTK0oca8dgQDy9zzSxGpf4";

test("parseSignalPayload accepts commits, offers, answers and candidates", () => {
  assert.deepEqual(parseSignalPayload({ kind: "commit", hash: HASH }), {
    kind: "commit",
    hash: HASH,
  });
  for (const check of [true, false]) {
    assert.deepEqual(parseSignalPayload({ kind: "offer", sdp: "v=0", check }), {
      kind: "offer",
      sdp: "v=0",
      check,
    });
  }
  assert.deepEqual(parseSignalPayload({ kind: "answer", sdp: "v=0" }), {
    kind: "answer",
    sdp: "v=0",
  });
  for (const kind of ["restart-offer", "restart-answer"]) {
    assert.deepEqual(parseSignalPayload({ kind, sdp: "v=0" }), { kind, sdp: "v=0" });
  }
  assert.deepEqual(parseSignalPayload({ kind: "ice", candidate }), { kind: "ice", candidate });
  assert.deepEqual(parseSignalPayload({ kind: "ice", candidate: null }), {
    kind: "ice",
    candidate: null,
  });
  const nulls = { candidate: "", sdpMid: null, sdpMLineIndex: null, usernameFragment: null };
  assert.deepEqual(parseSignalPayload({ kind: "ice", candidate: nulls }), {
    kind: "ice",
    candidate: nulls,
  });
});

test("parseSignalPayload rejects anything else", () => {
  for (const value of [
    null,
    "offer",
    [],
    {},
    { kind: "commit" },
    { kind: "commit", hash: "" },
    { kind: "commit", hash: HASH.slice(1) },
    { kind: "commit", hash: `${HASH}A` },
    { kind: "commit", hash: `${HASH.slice(1)}+` },
    { kind: "commit", hash: HASH, extra: 1 },
    { kind: "offer" },
    { kind: "offer", sdp: "v=0" },
    { kind: "offer", sdp: "", check: true },
    { kind: "offer", sdp: 1, check: true },
    { kind: "offer", sdp: "v=0", check: "true" },
    { kind: "offer", sdp: "v=0", check: true, name: "x" },
    { kind: "answer", sdp: "v=0", check: true },
    { kind: "restart-offer" },
    { kind: "restart-offer", sdp: "" },
    { kind: "restart-offer", sdp: "v=0", check: true },
    { kind: "restart-answer" },
    { kind: "restart-answer", sdp: "" },
    { kind: "restart-answer", sdp: 1 },
    { kind: "restart-answer", sdp: "v=0", check: true },
    { kind: "restart", sdp: "v=0" },
    { kind: "bye" },
    { kind: "ice" },
    { kind: "ice", candidate: "x" },
    { kind: "ice", candidate: { ...candidate, sdpMLineIndex: -1 } },
    { kind: "ice", candidate: { ...candidate, sdpMLineIndex: 0.5 } },
    { kind: "ice", candidate: { ...candidate, sdpMid: 0 } },
    { kind: "ice", candidate: { ...candidate, extra: 1 } },
    { kind: "ice", candidate: { candidate: candidate.candidate } },
  ]) {
    assert.equal(parseSignalPayload(value), undefined, JSON.stringify(value));
  }
});

test("the version marker is an ICE signal with a fragment no ICE agent makes", () => {
  const marker = versionMarker(FRAME_VERSION);
  assert.deepEqual(parseSignalPayload(marker), marker);
  assert.equal(markedVersion(marker), FRAME_VERSION);
  const fragment = marker.kind === "ice" ? marker.candidate?.usernameFragment : undefined;
  // RFC 8839: an ICE username fragment is ALPHA, DIGIT, "+" and "/" only.
  assert.doesNotMatch(fragment ?? "", /^[A-Za-z0-9+/]*$/);
});

test("markedVersion reads only the exact marker", () => {
  const marker = (fields: object) => ({
    kind: "ice" as const,
    candidate: {
      candidate: "",
      sdpMid: null,
      sdpMLineIndex: null,
      usernameFragment: "fidant-v3",
      ...fields,
    },
  });
  assert.equal(markedVersion(marker({ usernameFragment: "fidant-v1" })), 1);
  assert.equal(markedVersion(marker({ usernameFragment: "fidant-v999" })), 999);
  for (const fields of [
    { usernameFragment: "fidant-v0" },
    { usernameFragment: "fidant-v03" },
    { usernameFragment: "fidant-v1000" },
    { usernameFragment: "fidant-v3 " },
    { usernameFragment: " fidant-v3" },
    { usernameFragment: "fidant-v3\n" },
    { usernameFragment: "fidant-v" },
    { usernameFragment: "fidant-v-3" },
    { usernameFragment: "Fidant-v3" },
    { usernameFragment: null },
    { candidate: candidate.candidate },
    { candidate: " " },
    { sdpMid: "0" },
    { sdpMid: "" },
    { sdpMLineIndex: 0 },
  ]) {
    assert.equal(markedVersion(marker(fields)), undefined, JSON.stringify(fields));
  }
  assert.equal(markedVersion({ kind: "ice", candidate: null }), undefined);
  assert.equal(markedVersion({ kind: "commit", hash: HASH }), undefined);
});

test("assertFrameFits throws only for frames over the limit", () => {
  assertFrameFits(65536, 65536);
  assertFrameFits(Number.POSITIVE_INFINITY, 1 << 30);
  assert.throws(() => assertFrameFits(65536, 65537));
});

function statsWith(local: string, remote: string, selected = true): Map<string, object> {
  return new Map<string, object>([
    ["T1", { type: "transport", ...(selected ? { selectedCandidatePairId: "P1" } : {}) }],
    [
      "P0",
      {
        type: "candidate-pair",
        nominated: false,
        state: "failed",
        localCandidateId: "L0",
        remoteCandidateId: "R0",
      },
    ],
    [
      "P1",
      {
        type: "candidate-pair",
        nominated: true,
        state: "succeeded",
        localCandidateId: "L1",
        remoteCandidateId: "R1",
      },
    ],
    ["L0", { type: "local-candidate", candidateType: "relay" }],
    ["R0", { type: "remote-candidate", candidateType: "relay" }],
    ["L1", { type: "local-candidate", candidateType: local }],
    ["R1", { type: "remote-candidate", candidateType: remote }],
  ]);
}

test("connectionPath reads the selected candidate pair's types", () => {
  assert.equal(connectionPath(statsWith("host", "host")), "direct");
  assert.equal(connectionPath(statsWith("srflx", "host")), "stun");
  assert.equal(connectionPath(statsWith("host", "prflx")), "stun");
  assert.equal(connectionPath(statsWith("host", "relay")), "relay");
  assert.equal(connectionPath(statsWith("relay", "srflx")), "relay");
});

test("connectionPath falls back to the nominated succeeded pair", () => {
  assert.equal(connectionPath(statsWith("relay", "host", false)), "relay");
  assert.equal(connectionPath(statsWith("host", "host", false)), "direct");
});

test("connectionPath says direct when no pair is found", () => {
  assert.equal(connectionPath(new Map()), "direct");
});

test("errorName keeps only names that are plain identifiers", () => {
  assert.equal(errorName(new DOMException("a=ice-pwd:x", "OperationError")), "OperationError");
  assert.equal(errorName(new TypeError("x")), "TypeError");
  for (const name of ["", "a=ice-pwd:x", "Operation Error", "Error2", "x".repeat(41)]) {
    assert.equal(errorName(Object.assign(new Error("x"), { name })), undefined, name);
  }
  assert.equal(errorName("OperationError"), undefined);
  assert.equal(errorName({ name: "OperationError" }), undefined);
});

const SENDER_FP =
  "00:01:02:03:04:05:06:07:08:09:0A:0B:0C:0D:0E:0F:10:11:12:13:14:15:16:17:18:19:1A:1B:1C:1D:1E:1F";
const RECIPIENT_FP =
  "FF:FE:FD:FC:FB:FA:F9:F8:F7:F6:F5:F4:F3:F2:F1:F0:EF:EE:ED:EC:EB:EA:E9:E8:E7:E6:E5:E4:E3:E2:E1:E0";
const OTHER_FP = SENDER_FP.replace("00:", "AA:");

function resetFake(...fingerprints: string[]) {
  FakePeerConnection.fingerprints = fingerprints;
  FakePeerConnection.readBack = undefined;
  FakePeerConnection.localFingerprint = undefined;
  FakePeerConnection.throwOnConstruct = false;
  FakePeerConnection.stats = new Map();
  FakePeerConnection.statsGate = undefined;
}

function fakeSdp(...lines: string[]): string {
  return ["v=0", "s=-", "m=application 9 UDP/DTLS/SCTP webrtc-datachannel", ...lines, ""].join(
    "\r\n",
  );
}

type FakeCert = { getFingerprints(): { algorithm: string; value: string }[] };
type FakeConfiguration = { iceServers?: RTCIceServer[] | undefined };

// Just enough of RTCPeerConnection for startPeer's signaling; each certificate it
// makes carries the next fingerprint from `fingerprints`.
class FakePeerConnection {
  static fingerprints: string[] = [];
  static last: FakePeerConnection | undefined;
  static readBack: ((sdp: string) => string) | undefined;
  static localFingerprint: string | undefined;
  static throwOnConstruct = false;
  /** What getStats returns. */
  static stats = new Map<string, object>();
  /** When set, getStats waits for it. */
  static statsGate: Promise<void> | undefined;
  static async generateCertificate(): Promise<FakeCert> {
    const value = FakePeerConnection.fingerprints.shift() ?? SENDER_FP;
    return { getFingerprints: () => [{ algorithm: "sha-256", value: value.toLowerCase() }] };
  }
  readonly certificate: FakeCert;
  config: FakeConfiguration;
  /** The ICE servers of each setConfiguration call. */
  configured: unknown[] = [];
  refuseConfiguration = false;
  restarts = 0;
  added: unknown[] = [];
  iceConnectionState = "checking";
  localDescription: { sdp: string } | null = null;
  remoteDescription: { type: string; sdp: string } | null = null;
  connectionState = "new";
  signalingState = "stable";
  sctp = null;
  channel: { onopen: (() => void) | null } | undefined;
  onicecandidate = null;
  onconnectionstatechange = null;
  ondatachannel = null;
  constructor(config: FakeConfiguration & { certificates: FakeCert[] }) {
    if (FakePeerConnection.throwOnConstruct) {
      throw new TypeError("bad iceServers");
    }
    this.config = config;
    this.certificate = config.certificates[0] as FakeCert;
    FakePeerConnection.last = this;
  }
  createDataChannel(label: string) {
    this.channel = { onopen: null };
    return Object.assign(this.channel, { label, ordered: true, binaryType: "", close() {} });
  }
  getConfiguration() {
    return this.config;
  }
  setConfiguration(config: FakeConfiguration) {
    if (this.refuseConfiguration) {
      throw new DOMException("refused", "InvalidModificationError");
    }
    this.config = config;
    this.configured.push(config.iceServers);
  }
  restartIce() {
    this.restarts++;
  }
  async setLocalDescription() {
    // An answer if an offer waits for one, else an offer, as WebRTC 1.0 section 4.4.2 says.
    this.signalingState =
      this.signalingState === "have-remote-offer" ? "stable" : "have-local-offer";
    const [fp] = this.certificate.getFingerprints();
    this.localDescription = {
      sdp: fakeSdp(`a=fingerprint:sha-256 ${FakePeerConnection.localFingerprint ?? fp?.value}`),
    };
  }
  async setRemoteDescription(description: { type: string; sdp: string }) {
    this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    const read = FakePeerConnection.readBack;
    this.remoteDescription = read ? { ...description, sdp: read(description.sdp) } : description;
  }
  async addIceCandidate(candidate?: unknown) {
    this.added.push(candidate);
  }
  async getStats() {
    await FakePeerConnection.statsGate;
    return FakePeerConnection.stats;
  }
  close() {
    this.connectionState = "closed";
  }
}
(globalThis as { RTCPeerConnection?: unknown }).RTCPeerConnection = FakePeerConnection;

// Taken before any test mocks the timers, so waiting for signals still works.
const realSetTimeout = globalThis.setTimeout;

/** `wait` false returns before the peer's own first signals went out; `marked` relays this version's marker, as the other page sends it first. */
async function harness(
  side: "s" | "r",
  check?: boolean,
  iceServers: RTCIceServer[] = [],
  wait = true,
  marked = wait,
  callbacks: Pick<PeerOptions, "onStalled" | "onDisconnected" | "onPath" | "onRelayAdded"> = {},
) {
  const { linkId, secret } = createLink("https://localhost");
  const key = await deriveSignalKey(secret, linkId);
  const attempt = "A".repeat(22);
  const sent: unknown[] = [];
  const closes: Array<{ reason: PeerCloseReason; detail?: string | undefined }> = [];
  const opens: PeerOpenInfo[] = [];
  const options = {
    signaling: {
      send(message: { t: string; data?: string }) {
        if (message.t === "relay" && message.data) {
          sent.push(openSignal(key, linkId, attempt, side, message.data));
        }
        return true;
      },
    },
    linkId,
    attempt,
    signalKey: key,
    iceServers,
    ...(check === undefined ? {} : { check }),
    ...callbacks,
    onOpen: (_channel: RTCDataChannel, info: PeerOpenInfo) => opens.push(info),
    onClose: (reason: PeerCloseReason, detail?: string) => closes.push({ reason, detail }),
  };
  const peer = side === "s" ? createSenderPeer(options) : createRecipientPeer(options);
  const from = side === "s" ? "r" : "s";
  const relay = async (payload: unknown) =>
    peer.handleRelay(await sealSignal(key, linkId, attempt, from, payload));
  const settle = () => new Promise((resolve) => realSetTimeout(resolve, 10));
  const relayFrom = async (otherAttempt: string, payload: unknown) =>
    peer.handleRelay(await sealSignal(key, linkId, otherAttempt, from, payload));
  /** Every signal sent after the version marker so far, once at least `count` of them went out. */
  const signals = async (count = 0) => {
    for (let i = 0; i < 500 && sent.length < count + 1 && closes.length === 0; i++) {
      await settle();
    }
    await settle();
    const [marker, ...rest] = await Promise.all(sent);
    assert.deepEqual(marker, versionMarker(FRAME_VERSION), "the first signal is the marker");
    return rest;
  };
  if (wait) {
    // A peer that fails drops what it has not sealed yet, so wait for its own first signals.
    await signals(side === "r" ? 1 : 0);
  }
  if (marked) {
    await relay(versionMarker(FRAME_VERSION));
  }
  return { peer, relay, relayFrom, signals, closes, opens };
}

test("the sender offers only after the recipient's commitment, with its check setting", async () => {
  FakePeerConnection.fingerprints = [SENDER_FP];
  const h = await harness("s", true);
  assert.deepEqual(await h.signals(), []);
  await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  const [offer] = (await h.signals(1)) as Array<{ kind: string; sdp: string; check: boolean }>;
  assert.equal(offer?.kind, "offer");
  assert.equal(offer?.check, true);
  assert.match(offer?.sdp ?? "", new RegExp(SENDER_FP.toLowerCase()));
  assert.deepEqual(h.closes, []);
});

test("an answer that matches the commitment opens with both fingerprints' number", async () => {
  FakePeerConnection.fingerprints = [SENDER_FP];
  const h = await harness("s");
  await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await h.relay({ kind: "answer", sdp: fakeSdp(`a=fingerprint:sha-256 ${RECIPIENT_FP}`) });
  FakePeerConnection.last?.channel?.onopen?.();
  const [info] = h.opens;
  assert.equal(info?.check, false);
  assert.equal(await info?.checkNumber, await checkNumber(SENDER_FP, RECIPIENT_FP));
  assert.deepEqual(h.closes, []);
});

test("the sender refuses an answer that does not match the commitment", async () => {
  FakePeerConnection.fingerprints = [SENDER_FP];
  const h = await harness("s");
  await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await h.relay({ kind: "answer", sdp: fakeSdp(`a=fingerprint:sha-256 ${OTHER_FP}`) });
  assert.deepEqual(h.closes, [
    { reason: "bad-signal", detail: "answer does not match the commitment" },
  ]);
  assert.equal(FakePeerConnection.last?.remoteDescription, null);
});

test("the sender refuses an answer before any commitment", async () => {
  FakePeerConnection.fingerprints = [SENDER_FP];
  const h = await harness("s");
  await h.relay({ kind: "answer", sdp: fakeSdp(`a=fingerprint:sha-256 ${RECIPIENT_FP}`) });
  assert.equal(h.closes[0]?.reason, "bad-signal");
  assert.deepEqual(await h.signals(), []);
});

test("the sender refuses a second commitment", async () => {
  FakePeerConnection.fingerprints = [SENDER_FP];
  const h = await harness("s");
  const hash = await commitFingerprint(RECIPIENT_FP);
  await h.relay({ kind: "commit", hash });
  await h.relay({ kind: "commit", hash });
  assert.equal(h.closes[0]?.reason, "bad-signal");
});

test("the recipient sends its version marker, then commits to its certificate", async () => {
  FakePeerConnection.fingerprints = [RECIPIENT_FP];
  const h = await harness("r");
  assert.deepEqual(await h.signals(1), [
    { kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) },
  ]);
});

test("the recipient answers an offer, keeps its check flag and refuses a commitment", async () => {
  FakePeerConnection.fingerprints = [RECIPIENT_FP];
  const h = await harness("r");
  assert.equal(h.peer.answered, false);
  await h.relay({ kind: "offer", sdp: fakeSdp(`a=fingerprint:sha-256 ${SENDER_FP}`), check: true });
  assert.equal(h.peer.answered, true);
  const [, answer] = (await h.signals(2)) as Array<{ kind: string }>;
  assert.equal(answer?.kind, "answer");
  const pc = FakePeerConnection.last as unknown as {
    ondatachannel: (event: { channel: object }) => void;
  };
  const channel: { onopen: (() => void) | null } = { onopen: null };
  pc.ondatachannel({
    channel: Object.assign(channel, { label: "fidant", ordered: true, close() {} }),
  });
  channel.onopen?.();
  const [info] = h.opens;
  assert.equal(info?.check, true);
  assert.equal(await info?.checkNumber, await checkNumber(SENDER_FP, RECIPIENT_FP));

  await h.relay({ kind: "commit", hash: await commitFingerprint(SENDER_FP) });
  assert.equal(h.closes[0]?.reason, "bad-signal");
});

test("the recipient refuses an offer with a second fingerprint of another algorithm", async () => {
  FakePeerConnection.fingerprints = [RECIPIENT_FP];
  const h = await harness("r");
  await h.relay({
    kind: "offer",
    sdp: fakeSdp(`a=fingerprint:sha-256 ${SENDER_FP}`, `a=fingerprint:sha-1 ${OTHER_FP}`),
    check: false,
  });
  assert.equal(h.closes[0]?.reason, "bad-signal");
  assert.equal(FakePeerConnection.last?.remoteDescription, null);
});

test("the recipient sends no answer and no number when the browser read another fingerprint", async () => {
  for (const read of [
    (sdp: string) => sdp.replace(SENDER_FP, OTHER_FP),
    (sdp: string) => `${sdp}a=fingerprint:sha-256 ${OTHER_FP}\r\n`,
  ]) {
    resetFake(RECIPIENT_FP);
    FakePeerConnection.readBack = read;
    const h = await harness("r");
    // The commit goes out before the offer arrives; closing first would drop it.
    await h.signals(1);
    await h.relay({
      kind: "offer",
      sdp: fakeSdp(`a=fingerprint:sha-256 ${SENDER_FP}`),
      check: true,
    });
    assert.deepEqual(h.closes, [
      { reason: "bad-signal", detail: "the browser read another fingerprint" },
    ]);
    assert.equal(h.peer.answered, false);
    assert.deepEqual(await h.signals(1), [
      { kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) },
    ]);
  }
});

test("the sender opens no number when the browser read another fingerprint", async () => {
  for (const read of [
    (sdp: string) => sdp.replace(RECIPIENT_FP, OTHER_FP),
    (sdp: string) => `${sdp}a=fingerprint:sha-256 ${OTHER_FP}\r\n`,
  ]) {
    resetFake(SENDER_FP);
    FakePeerConnection.readBack = read;
    const h = await harness("s");
    await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
    FakePeerConnection.last?.channel?.onopen?.();
    const [info] = h.opens;
    assert.ok(info);
    await h.relay({ kind: "answer", sdp: fakeSdp(`a=fingerprint:sha-256 ${RECIPIENT_FP}`) });
    assert.deepEqual(h.closes, [
      { reason: "bad-signal", detail: "the browser read another fingerprint" },
    ]);
    const pending = new Promise((resolve) => realSetTimeout(resolve, 10, "pending"));
    assert.equal(await Promise.race([info.checkNumber, pending]), "pending");
  }
});

test("the recipient fails locally when its answer names another certificate", async () => {
  resetFake(RECIPIENT_FP);
  FakePeerConnection.localFingerprint = OTHER_FP;
  const h = await harness("r");
  await h.signals(1);
  await h.relay({ kind: "offer", sdp: fakeSdp(`a=fingerprint:sha-256 ${SENDER_FP}`), check: true });
  assert.equal(h.closes[0]?.reason, "setup-failed");
  assert.equal(h.peer.answered, false);
  assert.equal((await h.signals(1)).length, 1);
});

/** Waits until the peer closes. A peer whose setup fails may drop its version marker unsent, so `signals()` can't be used. */
async function failed(closes: unknown[]): Promise<void> {
  for (let i = 0; i < 500 && closes.length === 0; i++) {
    await new Promise((resolve) => realSetTimeout(resolve, 10));
  }
}

test("a recipient whose certificate has no sha-256 fingerprint closes as unsupported", async () => {
  resetFake("XX");
  const h = await harness("r", undefined, [], false);
  await failed(h.closes);
  assert.equal(h.closes[0]?.reason, "unsupported");
});

test("a connection that will not construct closes as setup-failed, not unsupported", async () => {
  resetFake(SENDER_FP);
  FakePeerConnection.throwOnConstruct = true;
  const h = await harness("s", undefined, [], false);
  await failed(h.closes);
  assert.equal(h.closes[0]?.reason, "setup-failed");
});

test("a browser without RTCPeerConnection closes as unsupported", async () => {
  const g = globalThis as { RTCPeerConnection?: unknown };
  g.RTCPeerConnection = undefined;
  try {
    resetFake(SENDER_FP);
    const h = await harness("s", undefined, [], false);
    await failed(h.closes);
    assert.equal(h.closes[0]?.reason, "unsupported");
  } finally {
    g.RTCPeerConnection = FakePeerConnection;
  }
});

test("after the answer the sender ignores signals sealed for another attempt or garbage", async () => {
  resetFake(SENDER_FP);
  const h = await harness("s");
  await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await h.relay({ kind: "answer", sdp: fakeSdp(`a=fingerprint:sha-256 ${RECIPIENT_FP}`) });
  await h.relayFrom("B".repeat(22), {
    kind: "commit",
    hash: await commitFingerprint(OTHER_FP),
  });
  await h.peer.handleRelay("not a sealed signal");
  assert.deepEqual(h.closes, []);
  FakePeerConnection.last?.channel?.onopen?.();
  assert.equal(h.opens.length, 1);
});

test("a channel that fires open twice opens the transfer once", async () => {
  resetFake(SENDER_FP);
  const h = await harness("s");
  await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await h.relay({ kind: "answer", sdp: fakeSdp(`a=fingerprint:sha-256 ${RECIPIENT_FP}`) });
  FakePeerConnection.last?.channel?.onopen?.();
  FakePeerConnection.last?.channel?.onopen?.();
  assert.equal(h.opens.length, 1);
  assert.deepEqual(h.closes, []);
});

test("before the answer the sender still closes on a signal that does not open", async () => {
  resetFake(SENDER_FP);
  const h = await harness("s");
  await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await h.relayFrom("B".repeat(22), { kind: "ice", candidate: null });
  assert.equal(h.closes[0]?.reason, "bad-signal");
});

test("the recipient closes on a signal that does not open, even after its answer", async () => {
  resetFake(RECIPIENT_FP);
  const h = await harness("r");
  await h.relay({ kind: "offer", sdp: fakeSdp(`a=fingerprint:sha-256 ${SENDER_FP}`), check: true });
  await h.peer.handleRelay("not a sealed signal");
  assert.equal(h.closes[0]?.reason, "bad-signal");
});

test("neither side describes itself before a getStats round trip", async () => {
  for (const side of ["s", "r"] as const) {
    resetFake(side === "s" ? SENDER_FP : RECIPIENT_FP);
    let open = () => {};
    FakePeerConnection.statsGate = new Promise((resolve) => {
      open = resolve;
    });
    // Relayed signals wait behind setup, so they are not awaited until the gate opens.
    const h = await harness(side, undefined, [], true, false);
    const relayed = Promise.all([
      h.relay(versionMarker(FRAME_VERSION)),
      side === "s"
        ? h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) })
        : h.relay({
            kind: "offer",
            sdp: fakeSdp(`a=fingerprint:sha-256 ${SENDER_FP}`),
            check: false,
          }),
    ]);
    // Long enough for the relayed signals to reach describe() without the barrier.
    await new Promise((resolve) => realSetTimeout(resolve, 50));
    const before = side === "s" ? [] : ["commit"];
    assert.deepEqual(await kinds(h, before.length), before);
    assert.equal(lastPc().localDescription, null);
    open();
    await relayed;
    const described = side === "s" ? "offer" : "answer";
    assert.deepEqual(await kinds(h, before.length + 1), [...before, described]);
    assert.deepEqual(h.closes, []);
  }
});

const stun = "stun:turn.example:3478";
const relayServers: RTCIceServer[] = [
  { urls: [stun, "turn:turn.example:3478?transport=udp"], username: "u", credential: "c" },
  { urls: "turns:turn.example:443?transport=tcp", username: "u", credential: "c" },
];
const stunServers: RTCIceServer[] = [{ urls: [stun] }];
const sdpWith = (fingerprint: string, ufrag: string) =>
  fakeSdp(`a=fingerprint:sha-256 ${fingerprint}`, `a=ice-ufrag:${ufrag}`);
const ice = (usernameFragment: string | null) => ({
  kind: "ice",
  candidate: { ...candidate, usernameFragment },
});

function lastPc(): FakePeerConnection {
  assert.ok(FakePeerConnection.last, "no connection yet");
  return FakePeerConnection.last;
}

/** The kinds of the signals sent, once there are `count`. */
async function kinds(h: { signals(count: number): Promise<unknown[]> }, count: number) {
  return ((await h.signals(count)) as Array<{ kind: string }>).map((s) => s.kind);
}

/** A sender that took the recipient's commitment and its answer, ICE username fragment "r1". */
async function answeredSender(servers = relayServers, onRelayAdded?: () => void) {
  resetFake(SENDER_FP);
  const h = await harness(
    "s",
    undefined,
    servers,
    true,
    true,
    onRelayAdded ? { onRelayAdded } : {},
  );
  await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await h.relay({ kind: "answer", sdp: sdpWith(RECIPIENT_FP, "r1") });
  return { ...h, pc: lastPc() };
}

/** A recipient that answered an offer with ICE username fragment "s1". */
async function answeredRecipient(servers = relayServers, onRelayAdded?: () => void) {
  resetFake(RECIPIENT_FP);
  const h = await harness(
    "r",
    undefined,
    servers,
    true,
    true,
    onRelayAdded ? { onRelayAdded } : {},
  );
  await h.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  return { ...h, pc: lastPc() };
}

/** An answered sender whose relay fallback fired. Needs mocked timers. */
async function restartedSender(t: TestContext) {
  const sender = await answeredSender();
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  assert.deepEqual(await kinds(sender, 2), ["offer", "restart-offer"]);
  return sender;
}

test("both sides start with the STUN URLs only", async () => {
  for (const side of ["s", "r"] as const) {
    resetFake();
    const h = await harness(side, undefined, relayServers);
    await h.relay(ice(null));
    assert.deepEqual(lastPc().config.iceServers, [{ urls: [stun] }], side);
  }
});

test("the sender adds the relay and restarts ICE once ICE has tried 3 s without it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await answeredSender();
  t.mock.timers.tick(RELAY_FALLBACK_MS - 1);
  await sender.relay(ice("r1"));
  assert.equal(sender.pc.restarts, 0);
  t.mock.timers.tick(1);
  assert.deepEqual(await kinds(sender, 2), ["offer", "restart-offer"]);
  assert.equal(sender.pc.restarts, 1);
  assert.deepEqual(sender.pc.configured, [relayServers]);
  await sender.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r2") });
  assert.equal(sender.pc.remoteDescription?.sdp, sdpWith(RECIPIENT_FP, "r2"));
  assert.deepEqual(sender.closes, []);
});

test("each side says when it added the relay, and only when the browser took it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let adds = 0;
  const added = () => adds++;
  const sender = await answeredSender(relayServers, added);
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  assert.deepEqual(await kinds(sender, 2), ["offer", "restart-offer"]);
  assert.equal(adds, 1);

  const refused = await answeredSender(relayServers, added);
  refused.pc.refuseConfiguration = true;
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  await refused.relay(ice("r1"));
  const noTurn = await answeredSender(stunServers, added);
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  await noTurn.relay(ice("r1"));
  assert.equal(adds, 1);

  const recipient = await answeredRecipient(relayServers, added);
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  assert.deepEqual(await kinds(recipient, 3), ["commit", "answer", "restart-answer"]);
  assert.equal(adds, 2);
  const stunOnly = await answeredRecipient(stunServers, added);
  await stunOnly.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  assert.deepEqual(await kinds(stunOnly, 3), ["commit", "answer", "restart-answer"]);
  assert.equal(adds, 2);
});

test("the sender never restarts without TURN, or once ICE connected", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const [servers, state] of [
    [stunServers, "checking"],
    [relayServers, "connected"],
    [relayServers, "completed"],
  ] as const) {
    const sender = await answeredSender(servers);
    sender.pc.iceConnectionState = state;
    t.mock.timers.tick(RELAY_FALLBACK_MS);
    await sender.relay(ice("r1"));
    assert.equal(sender.pc.restarts, 0, state);
    assert.deepEqual(sender.pc.configured, [], state);
    assert.deepEqual(sender.closes, [], state);
  }
});

test("a browser that refuses the new servers keeps the connection without the relay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await answeredSender();
  sender.pc.refuseConfiguration = true;
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  await sender.relay(ice("r1"));
  assert.equal(sender.pc.restarts, 0);
  assert.deepEqual(sender.closes, []);
  assert.deepEqual(await kinds(sender, 1), ["offer"]);
});

test("close() stops the relay fallback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await answeredSender();
  sender.peer.close();
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  assert.deepEqual(await kinds(sender, 1), ["offer"]);
  assert.equal(sender.pc.restarts, 0);
  assert.deepEqual(sender.pc.configured, []);

  const fired = await answeredSender();
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  fired.peer.close();
  assert.deepEqual(await kinds(fired, 1), ["offer"]);
  assert.equal(fired.pc.restarts, 0);
  assert.deepEqual(fired.pc.configured, []);
});

test("the sender does not restart once its channel is open", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await answeredSender();
  (sender.pc.channel as { readyState?: string }).readyState = "open";
  sender.pc.iceConnectionState = "disconnected";
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  await sender.relay(ice("r1"));
  assert.equal(sender.pc.restarts, 0);
  assert.deepEqual(sender.pc.configured, []);
  assert.deepEqual(sender.closes, []);
  assert.deepEqual(await kinds(sender, 1), ["offer"]);
});

test("the sent restart-offer names the first certificate and carries no check flag", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await restartedSender(t);
  const restart = (await sender.signals(2))[1] as { sdp: string; check?: unknown };
  assert.equal("check" in restart, false);
  assert.match(restart.sdp, new RegExp(SENDER_FP.toLowerCase()));
});

test("each side refuses the restart signal meant for the other", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await answeredSender();
  await sender.relay({ kind: "restart-offer", sdp: sdpWith(RECIPIENT_FP, "r2") });
  assert.deepEqual(sender.closes, [{ reason: "bad-signal", detail: "unexpected restart-offer" }]);

  const recipient = await answeredRecipient();
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  await recipient.relay({ kind: "restart-answer", sdp: sdpWith(SENDER_FP, "s3") });
  assert.deepEqual(recipient.closes, [
    { reason: "bad-signal", detail: "unexpected restart-answer" },
  ]);
});

/** Brings the path up as `how` and returns the function that takes it down again. */
function pathUp(pc: FakePeerConnection, how: "open" | "connected" | "completed") {
  if (how === "open") {
    if (!pc.channel) {
      // The recipient's channel arrives through ondatachannel.
      pc.channel = Object.assign({ onopen: null }, { label: "fidant", ordered: true, close() {} });
      (pc.ondatachannel as unknown as (e: { channel: object }) => void)({ channel: pc.channel });
    }
    const channel = Object.assign(pc.channel, { readyState: "open" });
    return () => Object.assign(channel, { readyState: "closed" });
  }
  pc.iceConnectionState = how;
  return () => {
    pc.iceConnectionState = "checking";
  };
}

test("the recipient ignores a restart-offer once its channel is open or ICE connected", async () => {
  for (const how of ["open", "connected", "completed"] as const) {
    const recipient = await answeredRecipient();
    const down = pathUp(recipient.pc, how);
    await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
    down();
    await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
    assert.deepEqual(recipient.closes, [], how);
    assert.deepEqual(recipient.pc.configured, [], how);
    assert.equal(recipient.pc.remoteDescription?.sdp, sdpWith(SENDER_FP, "s1"), how);
    assert.deepEqual(await kinds(recipient, 2), ["commit", "answer"], how);
  }
});

test("the sender ignores a restart-answer once its channel is open or ICE connected", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const how of ["open", "connected", "completed"] as const) {
    const sender = await restartedSender(t);
    const down = pathUp(sender.pc, how);
    await sender.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r2") });
    down();
    await sender.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r2") });
    assert.deepEqual(sender.closes, [], how);
    assert.equal(sender.pc.remoteDescription?.sdp, sdpWith(RECIPIENT_FP, "r1"), how);
  }
});

test("a sender takes one restart-answer, and only after its restart-offer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const early = await answeredSender();
  await early.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r2") });
  assert.deepEqual(early.closes, [{ reason: "bad-signal", detail: "unexpected restart-answer" }]);

  const twice = await restartedSender(t);
  await twice.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r2") });
  await twice.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r3") });
  assert.deepEqual(twice.closes, [{ reason: "bad-signal", detail: "unexpected restart-answer" }]);
});

test("a recipient takes one restart-offer, and only after its answer", async () => {
  resetFake(RECIPIENT_FP);
  const early = await harness("r", undefined, relayServers);
  await early.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s1") });
  assert.deepEqual(early.closes, [{ reason: "bad-signal", detail: "unexpected restart-offer" }]);

  const recipient = await answeredRecipient();
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  assert.deepEqual(await kinds(recipient, 3), ["commit", "answer", "restart-answer"]);
  assert.deepEqual(recipient.pc.configured, [relayServers]);
  assert.equal(recipient.pc.restarts, 0);
  assert.equal(recipient.pc.remoteDescription?.sdp, sdpWith(SENDER_FP, "s2"));
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s3") });
  assert.deepEqual(recipient.closes, [
    { reason: "bad-signal", detail: "unexpected restart-offer" },
  ]);

  const noTurn = await answeredRecipient(stunServers);
  await noTurn.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  assert.deepEqual(await kinds(noTurn, 3), ["commit", "answer", "restart-answer"]);
  assert.deepEqual(noTurn.pc.configured, []);
});

test("a replayed first offer or answer can't stand in for a restart one", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await restartedSender(t);
  await sender.relay({ kind: "answer", sdp: sdpWith(RECIPIENT_FP, "r2") });
  assert.deepEqual(sender.closes, [{ reason: "bad-signal", detail: "unexpected answer" }]);

  const recipient = await answeredRecipient();
  await recipient.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s2"), check: false });
  assert.deepEqual(recipient.closes, [{ reason: "bad-signal", detail: "unexpected offer" }]);
});

test("a restart must name the same two certificates as the safety number", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const recipient = await answeredRecipient();
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(OTHER_FP, "s2") });
  assert.deepEqual(recipient.closes, [
    { reason: "bad-signal", detail: "the restart names another certificate" },
  ]);
  assert.equal(recipient.pc.remoteDescription?.sdp, sdpWith(SENDER_FP, "s1"));
  assert.deepEqual(recipient.pc.configured, []);

  const sender = await restartedSender(t);
  await sender.relay({ kind: "restart-answer", sdp: sdpWith(OTHER_FP, "r2") });
  assert.deepEqual(sender.closes, [
    { reason: "bad-signal", detail: "the restart names another certificate" },
  ]);
  assert.equal(sender.pc.remoteDescription?.sdp, sdpWith(RECIPIENT_FP, "r1"));

  const own = await answeredSender();
  FakePeerConnection.localFingerprint = OTHER_FP;
  t.mock.timers.tick(RELAY_FALLBACK_MS);
  await own.relay(ice("r1"));
  assert.deepEqual(own.closes, [
    { reason: "setup-failed", detail: "the restart offer names another certificate" },
  ]);
  assert.deepEqual(await kinds(own, 1), ["offer"]);
  resetFake();
});

test("drops candidates for another ICE username fragment, queued ones too", async () => {
  resetFake(RECIPIENT_FP);
  const recipient = await harness("r", undefined, relayServers);
  await recipient.relay(ice("s0"));
  await recipient.relay(ice("s1"));
  await recipient.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  await recipient.relay(ice(null));
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  await recipient.relay(ice("s1"));
  await recipient.relay(ice("s2"));
  const added = lastPc().added as { usernameFragment: string | null }[];
  assert.deepEqual(
    added.map((c) => c.usernameFragment),
    ["s1", null, "s2"],
  );
  assert.deepEqual(recipient.closes, []);
});

const newer = versionMarker(FRAME_VERSION + 1);
const older = versionMarker(FRAME_VERSION - 1);
const recipientCommit = async () => ({
  kind: "commit",
  hash: await commitFingerprint(RECIPIENT_FP),
});

test("a marker for this version still connects", async () => {
  const marker = versionMarker(FRAME_VERSION);
  resetFake(SENDER_FP);
  const sender = await harness("s", undefined, [], true, false);
  await sender.relay(marker);
  await sender.relay(await recipientCommit());
  await sender.relay({ kind: "answer", sdp: sdpWith(RECIPIENT_FP, "r1") });
  assert.deepEqual(await kinds(sender, 1), ["offer"]);
  assert.deepEqual(sender.closes, []);
  assert.deepEqual(lastPc().added, []);

  resetFake(RECIPIENT_FP);
  const recipient = await harness("r", undefined, [], true, false);
  await recipient.relay(marker);
  await recipient.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  assert.deepEqual(await kinds(recipient, 2), ["commit", "answer"]);
  assert.deepEqual(recipient.closes, []);
  assert.deepEqual(lastPc().added, []);
});

test("a page without a marker counts as older, so neither side connects to it", async () => {
  assert.ok(UNMARKED_VERSION < FRAME_VERSION);
  resetFake(SENDER_FP);
  const sender = await harness("s", undefined, [], true, false);
  await sender.relay(await recipientCommit());
  assert.deepEqual(
    sender.closes.map((c) => c.reason),
    ["peer-outdated"],
  );
  assert.deepEqual(await sender.signals(), []);
  assert.equal(lastPc().localDescription, null);

  resetFake(RECIPIENT_FP);
  const recipient = await harness("r", undefined, [], true, false);
  await recipient.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  assert.deepEqual(
    recipient.closes.map((c) => c.reason),
    ["peer-outdated"],
  );
  assert.equal(recipient.peer.answered, false);
  assert.equal(lastPc().remoteDescription, null);
});

test("a second marker, or one after the commit or the offer, reaches no addIceCandidate and closes nothing", async () => {
  for (const late of [newer, older]) {
    for (const sequence of [
      [late, await recipientCommit(), late],
      [await recipientCommit(), late],
    ]) {
      resetFake(SENDER_FP);
      const sender = await harness("s");
      for (const payload of sequence) {
        await sender.relay(payload);
      }
      await sender.relay({ kind: "answer", sdp: sdpWith(RECIPIENT_FP, "r1") });
      await sender.relay(late);
      assert.deepEqual(sender.closes, []);
      assert.deepEqual(lastPc().added, []);
      assert.deepEqual(await kinds(sender, 1), ["offer"]);
    }

    for (const before of [[late], []]) {
      resetFake(RECIPIENT_FP);
      const recipient = await harness("r");
      for (const payload of before) {
        await recipient.relay(payload);
      }
      await recipient.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
      await recipient.relay(late);
      assert.deepEqual(recipient.closes, []);
      assert.deepEqual(lastPc().added, []);
      assert.deepEqual(await kinds(recipient, 2), ["commit", "answer"]);
    }
  }
});

/** Relays a mismatching marker while the peer's own first seals are held, then lets them finish. */
async function mismatched(t: TestContext, side: "s" | "r", marker: unknown) {
  const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
  const released = Promise.withResolvers<void>();
  let held = true;
  const sealing = t.mock.method(
    crypto.subtle,
    "encrypt",
    async (...args: Parameters<SubtleCrypto["encrypt"]>) => {
      if (held) {
        await released.promise;
      }
      return encrypt(...args);
    },
  );
  const h = await harness(side, undefined, [], false);
  held = false;
  const handled = h.relay(marker);
  await new Promise((resolve) => realSetTimeout(resolve, 100));
  released.resolve();
  await handled;
  sealing.mock.restore();
  return h;
}

test("a sender makes no offer for a recipient of another version, once its own marker went out", async (t) => {
  for (const [marker, reason] of [
    [newer, "outdated"],
    [older, "peer-outdated"],
  ] as const) {
    resetFake(SENDER_FP);
    const sender = await mismatched(t, "s", marker);
    await sender.relay(await recipientCommit());
    assert.deepEqual(
      sender.closes.map((c) => c.reason),
      [reason],
    );
    assert.deepEqual(await sender.signals(), []);
    assert.equal(lastPc().localDescription, null);
  }
});

test("a recipient makes no answer for a sender of another version, once its marker and commit went out", async (t) => {
  for (const [marker, reason] of [
    [newer, "outdated"],
    [older, "peer-outdated"],
  ] as const) {
    resetFake(RECIPIENT_FP);
    const recipient = await mismatched(t, "r", marker);
    assert.deepEqual(
      recipient.closes.map((c) => c.reason),
      [reason],
    );
    await recipient.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
    assert.equal(recipient.peer.answered, false);
    assert.equal(lastPc().remoteDescription, null);
    assert.deepEqual(await recipient.signals(1), [await recipientCommit()]);
  }
});

const freshServers: RTCIceServer[] = [
  { urls: [stun, "turn:turn.example:3478?transport=udp"], username: "u2", credential: "c2" },
];

/** Opens the data channel, as the browser does once the connection is up. */
function openChannel(pc: FakePeerConnection) {
  pathUp(pc, "open");
  pc.channel?.onopen?.();
}

function setState(pc: FakePeerConnection, state: string) {
  pc.connectionState = state;
  (pc.onconnectionstatechange as unknown as () => void)();
}

type Harness = Awaited<ReturnType<typeof harness>>;

/** Calls rejoined and waits until the peer has handled it, behind a candidate it drops. */
async function rejoin(h: Harness, servers: RTCIceServer[] = freshServers) {
  h.peer.rejoined(servers);
  await h.relay(ice("other"));
}

/** An open sender, or an open recipient that counts its onStalled calls and collects its onPath values. */
async function openPeer(side: "s" | "r", servers = relayServers) {
  resetFake(side === "s" ? SENDER_FP : RECIPIENT_FP);
  const seen = { stalled: 0, paths: [] as string[] };
  const h = await harness(side, undefined, servers, true, true, {
    ...(side === "r" ? { onStalled: () => seen.stalled++ } : {}),
    onPath: (path) => seen.paths.push(path),
  });
  if (side === "s") {
    await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
    await h.relay({ kind: "answer", sdp: sdpWith(RECIPIENT_FP, "r1") });
  } else {
    await h.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  }
  const pc = lastPc();
  setState(pc, "connected");
  openChannel(pc);
  return { ...h, pc, seen };
}

test("a rejoined sender restarts ICE with the new STUN URLs, each time it is asked", async (t) => {
  // A rejoined starts the deadline.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await openPeer("s");
  for (const round of [1, 2, 3]) {
    await rejoin(sender);
    assert.equal(sender.pc.restarts, round);
    assert.deepEqual(sender.pc.configured.at(-1), [{ urls: [stun] }]);
    const sent = (await sender.signals(1 + round)) as Array<{ kind: string; sdp: string }>;
    assert.equal(sent.at(-1)?.kind, "restart-offer");
    assert.match(sent.at(-1)?.sdp ?? "", new RegExp(SENDER_FP.toLowerCase()));
    const answer = sdpWith(RECIPIENT_FP, `r${round + 1}`);
    await sender.relay({ kind: "restart-answer", sdp: answer });
    assert.equal(sender.pc.remoteDescription?.sdp, answer);
    // A second answer to the same offer finds no offer waiting.
    await sender.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "replay") });
    assert.equal(sender.pc.remoteDescription?.sdp, answer);
  }
  assert.deepEqual(sender.closes, []);
});

test("rejoined does nothing before the channel opened", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await answeredSender(stunServers);
  await rejoin(sender);
  assert.equal(sender.pc.restarts, 0);
  assert.deepEqual(sender.pc.configured, []);
  assert.deepEqual(await kinds(sender, 1), ["offer"]);
  // No deadline runs, and the fallback's rules still hold.
  setState(sender.pc, "failed");
  assert.deepEqual(sender.closes, [{ reason: "connection-failed", detail: undefined }]);

  const early = await answeredSender(stunServers);
  await rejoin(early);
  await early.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r2") });
  assert.deepEqual(early.closes, [{ reason: "bad-signal", detail: "unexpected restart-answer" }]);
});

test("a recovery uses TURN only on a connection that had added the relay", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const answerFirst of [true, false]) {
    // The fallback's restart-offer is answered, or crosses the channel opening and is left unanswered.
    const sender = await restartedSender(t);
    if (answerFirst) {
      await sender.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r2") });
    }
    setState(sender.pc, "connected");
    openChannel(sender.pc);
    if (!answerFirst) {
      await sender.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "late") });
      assert.equal(sender.pc.signalingState, "have-local-offer");
    }
    await rejoin(sender);
    assert.deepEqual(sender.pc.configured, [relayServers, freshServers], String(answerFirst));
    assert.deepEqual(await kinds(sender, 3), ["offer", "restart-offer", "restart-offer"]);
    await sender.relay({ kind: "restart-answer", sdp: sdpWith(RECIPIENT_FP, "r3") });
    assert.equal(sender.pc.remoteDescription?.sdp, sdpWith(RECIPIENT_FP, "r3"));
    assert.deepEqual(sender.closes, [], String(answerFirst));
  }

  const recipient = await answeredRecipient();
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  openChannel(recipient.pc);
  setState(recipient.pc, "disconnected");
  await rejoin(recipient);
  // Without onStalled the recipient never asked, so its servers stay.
  assert.deepEqual(recipient.pc.configured, [relayServers]);
});

test("a rejoined sender whose browser refuses the new servers restarts with the old ones", async (t) => {
  // A rejoined starts the deadline.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await openPeer("s");
  sender.pc.refuseConfiguration = true;
  await rejoin(sender);
  assert.equal(sender.pc.restarts, 1);
  assert.deepEqual(await kinds(sender, 2), ["offer", "restart-offer"]);
  assert.deepEqual(sender.closes, []);
});

test("a rejoined sender refuses a restart-answer with another certificate", async (t) => {
  // A rejoined starts the deadline.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await openPeer("s");
  await rejoin(sender);
  await sender.relay({ kind: "restart-answer", sdp: sdpWith(OTHER_FP, "r2") });
  assert.deepEqual(sender.closes, [
    { reason: "bad-signal", detail: "the restart names another certificate" },
  ]);
  assert.equal(sender.pc.remoteDescription?.sdp, sdpWith(RECIPIENT_FP, "r1"));
});

test("the recipient asks on each drop after its channel opened, and the sender never", async () => {
  resetFake(RECIPIENT_FP);
  let stalled = 0;
  const before = await harness("r", undefined, [], true, true, { onStalled: () => stalled++ });
  await before.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  setState(lastPc(), "disconnected");
  assert.equal(stalled, 0);

  const recipient = await openPeer("r");
  setState(recipient.pc, "disconnected");
  assert.equal(recipient.seen.stalled, 1);
  setState(recipient.pc, "connected");
  setState(recipient.pc, "disconnected");
  assert.equal(recipient.seen.stalled, 2);
  assert.deepEqual(recipient.closes, []);

  resetFake(SENDER_FP);
  const sender = await harness("s", undefined, [], true, true, { onStalled: () => stalled++ });
  await sender.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await sender.relay({ kind: "answer", sdp: sdpWith(RECIPIENT_FP, "r1") });
  openChannel(lastPc());
  setState(lastPc(), "disconnected");
  assert.equal(stalled, 0);
});

test("the sender says when its open connection goes disconnected, and only then", async () => {
  resetFake(SENDER_FP);
  let disconnected = 0;
  const sender = await harness("s", undefined, [], true, true, {
    onDisconnected: () => disconnected++,
  });
  await sender.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await sender.relay({ kind: "answer", sdp: sdpWith(RECIPIENT_FP, "r1") });
  const pc = lastPc();
  setState(pc, "disconnected");
  assert.equal(disconnected, 0, "not before the channel opened");
  setState(pc, "connected");
  openChannel(pc);
  setState(pc, "disconnected");
  assert.equal(disconnected, 1);
  setState(pc, "connected");
  setState(pc, "disconnected");
  assert.equal(disconnected, 2);
  assert.deepEqual(sender.closes, []);

  resetFake(RECIPIENT_FP);
  const recipient = await harness("r", undefined, [], true, true, {
    onDisconnected: () => disconnected++,
  });
  await recipient.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  setState(lastPc(), "connected");
  openChannel(lastPc());
  setState(lastPc(), "disconnected");
  assert.equal(disconnected, 2, "never on the recipient");
});

test("a recipient that has asked answers every restart-offer, with the new STUN URLs only", async (t) => {
  // A rejoined starts the deadline.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const recipient = await openPeer("r");
  // Before it asks, a restart-offer and a rejoined change nothing.
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  await rejoin(recipient);
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  assert.equal(recipient.pc.remoteDescription?.sdp, sdpWith(SENDER_FP, "s1"));
  assert.deepEqual(recipient.pc.configured, []);
  assert.deepEqual(await kinds(recipient, 2), ["commit", "answer"]);

  setState(recipient.pc, "disconnected");
  await rejoin(recipient);
  assert.deepEqual(recipient.pc.configured, [[{ urls: [stun] }]]);
  for (const round of [1, 2, 3]) {
    // Its ICE state doesn't matter once it has asked.
    recipient.pc.iceConnectionState = round === 2 ? "connected" : "disconnected";
    const offer = sdpWith(SENDER_FP, `s${round + 1}`);
    await recipient.relay({ kind: "restart-offer", sdp: offer });
    assert.equal(recipient.pc.remoteDescription?.sdp, offer);
    const sent = await kinds(recipient, 2 + round);
    assert.equal(sent.length, 2 + round);
    assert.equal(sent.at(-1), "restart-answer");
  }
  assert.deepEqual(recipient.pc.configured, [[{ urls: [stun] }]]);
  assert.equal(recipient.pc.restarts, 0);
  assert.deepEqual(recipient.closes, []);

  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(OTHER_FP, "s9") });
  assert.deepEqual(recipient.closes, [
    { reason: "bad-signal", detail: "the restart names another certificate" },
  ]);
  assert.equal(recipient.pc.remoteDescription?.sdp, sdpWith(SENDER_FP, "s4"));
});

test("a recipient that took the fallback's restart-offer still answers a recovery's", async (t) => {
  // A rejoined starts the deadline.
  t.mock.timers.enable({ apis: ["setTimeout"] });
  resetFake(RECIPIENT_FP);
  let stalled = 0;
  const recipient = await harness("r", undefined, relayServers, true, true, {
    onStalled: () => stalled++,
  });
  await recipient.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  await recipient.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  const pc = lastPc();
  setState(pc, "connected");
  openChannel(pc);
  setState(pc, "failed");
  assert.equal(stalled, 0, "failed with no deadline closes without asking");
  assert.deepEqual(recipient.closes, [{ reason: "connection-failed", detail: undefined }]);

  resetFake(RECIPIENT_FP);
  const again = await harness("r", undefined, relayServers, true, true, {
    onStalled: () => stalled++,
  });
  await again.relay({ kind: "offer", sdp: sdpWith(SENDER_FP, "s1"), check: false });
  await again.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s2") });
  const next = lastPc();
  setState(next, "connected");
  openChannel(next);
  setState(next, "disconnected");
  assert.equal(stalled, 1);
  await rejoin(again);
  // This connection had added the relay, so it takes the new TURN servers.
  assert.deepEqual(next.configured, [relayServers, freshServers]);
  await again.relay({ kind: "restart-offer", sdp: sdpWith(SENDER_FP, "s3") });
  assert.equal(next.remoteDescription?.sdp, sdpWith(SENDER_FP, "s3"));
  assert.deepEqual(next.configured, [relayServers, freshServers]);
  assert.deepEqual(again.closes, []);
});

test("a second rejoined before the answer makes no second offer, and the answer is applied", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await openPeer("s");
  await rejoin(sender);
  await rejoin(sender);
  // One restart, one offer: a second would change the credentials the answer was made for.
  assert.equal(sender.pc.restarts, 1);
  assert.deepEqual(await kinds(sender, 2), ["offer", "restart-offer"]);
  const answer = sdpWith(RECIPIENT_FP, "r2");
  await sender.relay({ kind: "restart-answer", sdp: answer });
  assert.equal(sender.pc.signalingState, "stable");
  assert.equal(sender.pc.remoteDescription?.sdp, answer);
  // The next drop gets its own offer.
  setState(sender.pc, "connected");
  await rejoin(sender);
  assert.equal(sender.pc.restarts, 2);
  assert.deepEqual(sender.closes, []);
});

test("connected while the recovery's offer waits keeps it waiting, so a second drop makes no second offer", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await openPeer("s");
  setState(sender.pc, "disconnected");
  await rejoin(sender);
  assert.equal(sender.pc.signalingState, "have-local-offer");
  // The old route comes back before the answer, then drops again.
  setState(sender.pc, "connected");
  setState(sender.pc, "disconnected");
  await rejoin(sender);
  assert.equal(sender.pc.restarts, 1);
  assert.deepEqual(await kinds(sender, 2), ["offer", "restart-offer"]);
  const answer = sdpWith(RECIPIENT_FP, "r2");
  await sender.relay({ kind: "restart-answer", sdp: answer });
  assert.equal(sender.pc.remoteDescription?.sdp, answer);
  assert.equal(sender.pc.signalingState, "stable");
  assert.deepEqual(sender.closes, []);

  // The same while the browser is still making the offer, before it leaves "stable".
  const early = await openPeer("s");
  const make = early.pc.setLocalDescription.bind(early.pc);
  early.pc.setLocalDescription = async () => {
    setState(early.pc, "connected");
    await make();
  };
  setState(early.pc, "disconnected");
  await rejoin(early);
  setState(early.pc, "disconnected");
  await rejoin(early);
  assert.equal(early.pc.restarts, 1);
});

test("a deadline started while connected starts again in full when the connection drops", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const side of ["s", "r"] as const) {
    const h = await openPeer(side);
    // The recipient's drop healed before the joined came; the sender never noticed one.
    setState(h.pc, "disconnected");
    setState(h.pc, "connected");
    await rejoin(h);
    t.mock.timers.tick(RECOVERY_TIMEOUT_MS / 2);
    // A real drop, inside the first deadline.
    setState(h.pc, "disconnected");
    await rejoin(h);
    setState(h.pc, "failed");
    t.mock.timers.tick(RECOVERY_TIMEOUT_MS - 1);
    assert.deepEqual(h.closes, [], side);
    t.mock.timers.tick(1);
    assert.deepEqual(h.closes, [{ reason: "connection-failed", detail: undefined }], side);
  }
});

test("a path read that a newer one overtook reports nothing stale", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  resetFake(SENDER_FP);
  const paths: string[] = [];
  const h = await harness("s", undefined, relayServers, true, true, {
    onPath: (path) => paths.push(path),
  });
  await h.relay({ kind: "commit", hash: await commitFingerprint(RECIPIENT_FP) });
  await h.relay({ kind: "answer", sdp: sdpWith(RECIPIENT_FP, "r1") });
  const pc = lastPc();
  const settle = () => new Promise((resolve) => realSetTimeout(resolve, 10));
  // The open's read and a connected's read both see "stun" and wait to read again.
  FakePeerConnection.stats = statsWith("srflx", "host");
  setState(pc, "connected");
  openChannel(pc);
  setState(pc, "disconnected");
  setState(pc, "connected");
  await settle();
  // A newer connected reads "relay" at once.
  FakePeerConnection.stats = statsWith("relay", "host");
  setState(pc, "disconnected");
  setState(pc, "connected");
  await settle();
  assert.deepEqual(paths, ["relay"]);
  // The older reads now read "direct", too late.
  FakePeerConnection.stats = new Map();
  t.mock.timers.tick(1000);
  await settle();
  assert.deepEqual(paths, ["relay"]);
  assert.equal(await h.opens[0]?.path, "relay");
});

test("both sides close with connection-failed 30 s after a rejoined that never connects", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const side of ["s", "r"] as const) {
    const h = await openPeer(side);
    setState(h.pc, "disconnected");
    await rejoin(h);
    // The browser's own verdict doesn't end it while the deadline runs, and the recipient asks again.
    setState(h.pc, "failed");
    assert.equal(h.seen.stalled, side === "r" ? 2 : 0);
    t.mock.timers.tick(RECOVERY_TIMEOUT_MS / 2);
    // A second rejoined in the same drop doesn't move the deadline.
    await rejoin(h);
    t.mock.timers.tick(RECOVERY_TIMEOUT_MS / 2 - 1);
    assert.deepEqual(h.closes, [], side);
    t.mock.timers.tick(1);
    assert.deepEqual(h.closes, [{ reason: "connection-failed", detail: undefined }], side);
  }
});

test("failed with no rejoined closes at once", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const side of ["s", "r"] as const) {
    const h = await openPeer(side);
    setState(h.pc, "disconnected");
    assert.deepEqual(h.closes, [], side);
    setState(h.pc, "failed");
    assert.deepEqual(h.closes, [{ reason: "connection-failed", detail: undefined }], side);
    assert.equal(h.seen.stalled, side === "r" ? 1 : 0);
  }
});

test("connected ends the deadline, and the next drop gets its own", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const side of ["s", "r"] as const) {
    const h = await openPeer(side);
    setState(h.pc, "disconnected");
    await rejoin(h);
    t.mock.timers.tick(RECOVERY_TIMEOUT_MS - 1);
    setState(h.pc, "connected");
    await h.relay(ice("other"));
    assert.deepEqual(h.seen.paths, ["direct"], side);
    setState(h.pc, "disconnected");
    t.mock.timers.tick(RECOVERY_TIMEOUT_MS);
    assert.deepEqual(h.closes, [], side);

    await rejoin(h);
    t.mock.timers.tick(RECOVERY_TIMEOUT_MS - 1);
    assert.deepEqual(h.closes, [], side);
    t.mock.timers.tick(1);
    assert.deepEqual(h.closes, [{ reason: "connection-failed", detail: undefined }], side);
  }

  // With the deadline over, failed closes at once again.
  const sender = await openPeer("s");
  await rejoin(sender);
  setState(sender.pc, "connected");
  setState(sender.pc, "failed");
  assert.deepEqual(sender.closes, [{ reason: "connection-failed", detail: undefined }]);
});

test("a deadline that runs out on a connected connection closes nothing", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sender = await openPeer("s");
  await rejoin(sender);
  t.mock.timers.tick(RECOVERY_TIMEOUT_MS);
  assert.deepEqual(sender.closes, []);
  // It is over: failed closes at once.
  setState(sender.pc, "failed");
  assert.deepEqual(sender.closes, [{ reason: "connection-failed", detail: undefined }]);
});

test("no deadline outlives close() or a failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const end of ["close", "fail"] as const) {
    const sender = await openPeer("s");
    await rejoin(sender);
    if (end === "close") {
      sender.peer.close();
    } else {
      await sender.relay({ kind: "restart-offer", sdp: sdpWith(RECIPIENT_FP, "r2") });
      assert.equal(sender.closes[0]?.reason, "bad-signal");
    }
    // The deadline reads the state when it runs out; a cleared one never does.
    let reads = 0;
    Object.defineProperty(sender.pc, "connectionState", {
      get() {
        reads++;
        return "disconnected";
      },
    });
    t.mock.timers.tick(RECOVERY_TIMEOUT_MS);
    assert.equal(reads, 0, end);
    assert.equal(sender.closes.length, end === "close" ? 0 : 1);
  }
});
