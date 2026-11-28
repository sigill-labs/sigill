// A WebRTC connection between the sender and one recipient, signaled through
// the server with every SDP and ICE message sealed by the link's signal key.
//
// Message flow for one link:
//
//   recipient → server   join {link, attempt}
//   server → recipient   joined {link, attempt, iceServers, turn}   (recipient: createRecipientPeer)
//   recipient → sender   relay seal_r(versionMarker(FRAME_VERSION))   each side's first signal
//   recipient → sender   relay seal_r({kind:"commit", hash})   hash = commitFingerprint(its fingerprint)
//   server → sender      joined {link, attempt, iceServers, turn}   (sender: createSenderPeer)
//   sender → recipient   relay seal_s(versionMarker(FRAME_VERSION))
//   sender               waits for the commit, then makes the offer
//   sender → recipient   relay seal_s({kind:"offer", sdp, check})
//   recipient → sender   relay seal_r({kind:"answer", sdp})   its fingerprint must match the commit
//   both directions      relay seal({kind:"ice", candidate})   (trickle; null = end)
//   sender → recipient   relay seal_s({kind:"restart-offer", sdp})   (TURN fallback, at most once; see below)
//   recipient → sender   relay seal_r({kind:"restart-answer", sdp})   both keep the first fingerprints
//   sender ⇄ recipient   data channel "fidant" opens → onOpen(channel, info)
//
// Recovering a dropped route (decision 0031), only after the channel opened:
//
//   recipient            connectionState "disconnected", or "failed" while a
//                        deadline runs → onStalled()   ("failed" with none closes)
//   recipient → server   the same join again   (the page, from onStalled)
//   server → both        joined, with new ICE servers → the page calls rejoined(iceServers)
//   sender → recipient   relay seal_s({kind:"restart-offer", sdp})   after restartIce()
//   recipient → sender   relay seal_r({kind:"restart-answer", sdp})
//   both                 connected again → onPath(path)
//
// The sender's connection going "disconnected" after the channel opened only
// calls onDisconnected: its page re-sends `host`, so a dead signaling socket
// surfaces and can take its attempt back (decision 0033).
//
// Until then the restart signals follow the fallback's rules: each is taken at
// most once, and ignored once ICE is connected or the channel is open. From its
// first onStalled the recipient answers every restart-offer, and from its
// first rejoined the sender applies a restart-answer whenever an offer of its
// own waits for one. While a recovery's offer waits, the sender makes no second
// one; only its restart-answer ends that wait. Both still
// refuse another fingerprint. A recovery uses the TURN URLs of the new servers
// only if this connection had added the relay; otherwise only their STUN URLs.
// The first rejoined of a drop starts a deadline of RECOVERY_TIMEOUT_MS, which
// "connected" ends. A deadline started while the connection was still
// connected starts again in full when the connection next leaves "connected".
// While it runs, the browser's "failed" doesn't close the peer; when it runs
// out and the connection is not connected, the peer closes with
// "connection-failed". Without it, "failed" closes at once.
//
// The version marker is an `ice` signal whose empty candidate has the username
// fragment "fidant-v<FRAME_VERSION>". The sender reads the recipient's before the
// commit and the recipient the sender's before the offer; a page without a marker
// counts as UNMARKED_VERSION. On another version the page makes no offer or
// answer and closes with "outdated" (this page is older) or "peer-outdated".
// Pages from before the check drop the marker like a candidate for another ICE
// username fragment.
//
// Each side makes a fresh DTLS certificate for every connection. The recipient
// commits to its certificate's fingerprint before the sender's offer exists, so
// someone in the middle must fix both certificates before it can learn the
// safety number they give (check.ts). Before its first description the page
// waits for a getStats round trip, because Chromium was seen handing the
// certificate to the transport asynchronously. Every fingerprint line of an
// SDP, in any spelling, must be the exact `a=fingerprint:sha-256 <value>` form
// and all must name one certificate; after setRemoteDescription the page reads
// the fingerprint back from the browser's own copy and refuses any difference.
// `check` says whether the sender's page will ask for the safety number; the
// server can flip it only for an emailed link, and then the two pages disagree
// and nothing about the file is shown (see frames.ts).
//
// seal_s/seal_r are sealSignal with direction "s"/"r"; the receiving side opens
// with the other side's direction, so the server cannot reflect a message back,
// swap one link's signals into another, or replay one attempt's signals into
// another (the attempt ID is in the AAD too; see keys.ts). The server only sees link IDs and
// opaque blobs: no SDP, no candidates, no DTLS fingerprints.
//
// Outgoing signals are sealed and sent in order through one queue; incoming
// relay data is handled in order through another. ICE candidates that arrive
// before the remote description are held until it is set, and candidates for
// another ICE username fragment than the remote description's are dropped.
//
// No DOM or UI here, and nothing about files or names: the data channel
// carries only encrypted frames (frames.ts), and its label is fixed.

import type { ClientMessage, ConnectionPath } from "@fidant/protocol";
import { decodeBase64url } from "./base64url.ts";
import { certificateFingerprint, checkNumber, commitFingerprint, sdpFingerprint } from "./check.ts";
import { FRAME_VERSION } from "./frames.ts";
import { type Direction, openSignal, sealSignal } from "./keys.ts";

/** The data channel label. Fixed and neutral: never a file or recipient name. */
export const CHANNEL_LABEL = "fidant";

/**
 * SCTP max message size to assume if the browser does not report one. RFC 8841
 * says 64 KiB when the remote SDP has no max-message-size attribute.
 */
export const DEFAULT_MAX_MESSAGE_SIZE = 65536;

/** How long to wait before reading a "stun" path again (see readPath). */
const PATH_RECHECK_MS = 1000;

/** How long the sender lets ICE try without the relay, from applying the answer. */
export const RELAY_FALLBACK_MS = 3000;

/** How long a dropped connection gets to come back, from the first rejoined of the drop. */
export const RECOVERY_TIMEOUT_MS = 30_000;

export type PeerCloseReason =
  /** The data channel closed (the other side went away or closed it). */
  | "channel-closed"
  /** ICE or DTLS failed: the browsers could not reach each other. */
  | "connection-failed"
  /** The connection closed. */
  | "connection-closed"
  /** A relayed signal failed to open, had the wrong shape, or came out of order. */
  | "bad-signal"
  /** Could not seal or send our own offer or answer. */
  | "signal-failed"
  /** Setting up the connection threw (createOffer, setRemoteDescription, ...). */
  | "setup-failed"
  /** The other page runs a newer frame version, so this page must reload. */
  | "outdated"
  /** The other page runs an older frame version, so that page must reload. */
  | "peer-outdated"
  /** This browser can't build a connection: WebRTC is off or missing, or its certificate has no sha-256 fingerprint. */
  | "unsupported";

export type OpenPath = Exclude<ConnectionPath, "failed">;

export type PeerOpenInfo = {
  /** Largest message the channel accepts, in bytes. Check frames with assertFrameFits. */
  maxMessageSize: number;
  /**
   * How the browsers reached each other, from the selected candidate pair.
   * Resolves shortly after the channel opens; never rejects.
   */
  path: Promise<OpenPath>;
  /** Whether the safety number is on: the sender's own setting, or the recipient's from the offer. */
  check: boolean;
  /** The safety number from the two fingerprints, "ddd ddd". Show it; never send or log it. */
  checkNumber: Promise<string>;
};

export type PeerOptions = {
  /** Only `send` is used, so a fake works in place of a SignalingClient. */
  signaling: { send(message: ClientMessage): boolean };
  linkId: string;
  /** The recipient's attempt ID from its join; bound into every sealed signal. */
  attempt: string;
  /** From deriveSignalKey(secret, linkId). */
  signalKey: CryptoKey;
  /** From this pairing's `joined`, fresh for each peer: TURN credentials expire. */
  iceServers: RTCIceServer[];
  /** Sender only: whether this recipient's safety number is on. The recipient reads it from the offer. */
  check?: boolean;
  /** The channel is open, ordered, reliable, binaryType "arraybuffer". Called at most once. */
  onOpen(channel: RTCDataChannel, info: PeerOpenInfo): void;
  /**
   * The peer closed on its own. Called at most once, and never after close()
   * was called by the owner. `detail` can quote SDP, so never log it; `name`
   * is a caught error's name (see errorName), safe to log.
   */
  onClose(reason: PeerCloseReason, detail?: string, name?: string): void;
  /**
   * Recipient only: the connection went "disconnected", or "failed" while a
   * recovery deadline runs, after the channel opened, and the peer stays open.
   * A "failed" with no deadline closes the peer instead. Send the same `join`
   * again. Called once per such state change, never on a timer: each join is a
   * pairing on the server.
   */
  onStalled?(): void;
  /**
   * Sender only: the connection went "disconnected" after the channel opened.
   * Called once per such state change; the recipient's onStalled starts the recovery.
   */
  onDisconnected?(): void;
  /** The connection reports connected after the channel opened, which ends the page's wait for a restart. */
  onConnected?(): void;
  /** The connection is connected again after the channel opened: how it runs now. */
  onPath?(path: OpenPath): void;
  /**
   * This side added the relay's TURN servers to the connection: the sender's
   * fallback, or the recipient taking its restart-offer. Called once per add
   * that the browser accepted; a recovery never adds it.
   */
  onRelayAdded?(): void;
};

export type Peer = {
  /**
   * Handles the `data` of a relay message for this link. Never rejects: a bad
   * signal closes the peer with "bad-signal", except that a sender that has accepted
   * the answer ignores a signal that does not open or parse. Calls are processed in order.
   */
  handleRelay(data: string): Promise<void>;
  /** Recipient only: the answer went out, so this connection's safety number is fixed. */
  readonly answered: boolean;
  /**
   * A repeated `joined` for this attempt arrived, with its ICE servers. Does
   * nothing before the channel opened, or on a recipient that never called
   * onStalled. Otherwise it starts the recovery deadline unless one runs, and
   * the sender restarts ICE and sends a restart-offer.
   */
  rejoined(iceServers: RTCIceServer[]): void;
  /** Closes the channel and the connection. Safe to call more than once. */
  close(): void;
};

/** Wire form of an ICE candidate inside a sealed signal. */
export type SignalCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment: string | null;
};

/** The plaintext inside a sealed relay message. `candidate: null` ends trickle ICE. */
export type SignalPayload =
  | { kind: "commit"; hash: string }
  | { kind: "offer"; sdp: string; check: boolean }
  | { kind: "answer" | "restart-offer" | "restart-answer"; sdp: string }
  | { kind: "ice"; candidate: SignalCandidate | null };

type Fields = Record<string, unknown>;

function hasKeys(value: Fields, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseCandidate(value: unknown): SignalCandidate | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const fields = value as Fields;
  if (!hasKeys(fields, ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"])) {
    return undefined;
  }
  const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = fields;
  if (typeof candidate !== "string" || !isNullableString(sdpMid)) {
    return undefined;
  }
  if (!isNullableString(usernameFragment)) {
    return undefined;
  }
  if (
    sdpMLineIndex !== null &&
    !(typeof sdpMLineIndex === "number" && Number.isInteger(sdpMLineIndex) && sdpMLineIndex >= 0)
  ) {
    return undefined;
  }
  return { candidate, sdpMid, sdpMLineIndex, usernameFragment };
}

/** Checks an opened signal's shape. Returns undefined if it is not a SignalPayload. */
export function parseSignalPayload(value: unknown): SignalPayload | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const fields = value as Fields;
  switch (fields.kind) {
    case "commit":
      if (!hasKeys(fields, ["kind", "hash"]) || typeof fields.hash !== "string") {
        return undefined;
      }
      return decodeBase64url(fields.hash)?.length === 32
        ? { kind: "commit", hash: fields.hash }
        : undefined;
    case "offer":
      if (!hasKeys(fields, ["kind", "sdp", "check"]) || typeof fields.check !== "boolean") {
        return undefined;
      }
      if (typeof fields.sdp !== "string" || fields.sdp.length === 0) {
        return undefined;
      }
      return { kind: "offer", sdp: fields.sdp, check: fields.check };
    case "answer":
    case "restart-offer":
    case "restart-answer":
      if (!hasKeys(fields, ["kind", "sdp"]) || typeof fields.sdp !== "string") {
        return undefined;
      }
      if (fields.sdp.length === 0) {
        return undefined;
      }
      return { kind: fields.kind, sdp: fields.sdp };
    case "ice": {
      if (!hasKeys(fields, ["kind", "candidate"])) {
        return undefined;
      }
      if (fields.candidate === null) {
        return { kind: "ice", candidate: null };
      }
      const candidate = parseCandidate(fields.candidate);
      return candidate ? { kind: "ice", candidate } : undefined;
    }
    default:
      return undefined;
  }
}

/** The frame version assumed for a page that sends no version marker, as no page from before the check does. */
export const UNMARKED_VERSION = 3;

const MARKER = /^fidant-v([1-9][0-9]{0,2})$/;

/** Each side's first signal. Never change its form: pages from before the version check must keep dropping it. */
export function versionMarker(version: number): SignalPayload {
  return {
    kind: "ice",
    candidate: {
      candidate: "",
      sdpMid: null,
      sdpMLineIndex: null,
      usernameFragment: `fidant-v${version}`,
    },
  };
}

/** The version a signal names if it is exactly a version marker, else undefined. */
export function markedVersion(payload: SignalPayload): number | undefined {
  if (payload.kind !== "ice" || payload.candidate === null) {
    return undefined;
  }
  const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = payload.candidate;
  if (candidate !== "" || sdpMid !== null || sdpMLineIndex !== null || usernameFragment === null) {
    return undefined;
  }
  const digits = MARKER.exec(usernameFragment)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

/** Throws if a frame of `byteLength` bytes is larger than the channel accepts. */
export function assertFrameFits(maxMessageSize: number, byteLength: number): void {
  if (byteLength > maxMessageSize) {
    throw new Error(`frame of ${byteLength} bytes exceeds max message size ${maxMessageSize}`);
  }
}

/** The SCTP max message size for a connection, with a safe fallback. */
export function maxMessageSizeOf(pc: RTCPeerConnection): number {
  const size = pc.sctp?.maxMessageSize;
  // 0 or a missing value means the browser did not say; Infinity means no limit.
  return size !== undefined && size > 0 ? size : DEFAULT_MAX_MESSAGE_SIZE;
}

type StatsEntry = {
  type?: string;
  selectedCandidatePairId?: string;
  nominated?: boolean;
  state?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
};

/**
 * How a connection runs, from an RTCStatsReport (or any Map of stats): "relay"
 * if either side of the selected candidate pair is a TURN relay candidate,
 * "stun" if either is server- or peer-reflexive, else "direct". Reads only
 * candidate types, never addresses or ports.
 */
export function connectionPath(stats: ReadonlyMap<string, StatsEntry>): OpenPath {
  const entries = [...stats.values()];
  const pairId = entries.find(
    (s) => s.type === "transport" && s.selectedCandidatePairId,
  )?.selectedCandidatePairId;
  const pair =
    (pairId ? stats.get(pairId) : undefined) ??
    entries.find((s) => s.type === "candidate-pair" && s.nominated && s.state === "succeeded");
  // ponytail: no pair found (an old browser's stats) counts as direct; the
  // data channel is open, so ICE did connect, and direct is the common case.
  const types = [pair?.localCandidateId, pair?.remoteCandidateId].map((id) =>
    id ? stats.get(id)?.candidateType : undefined,
  );
  if (types.includes("relay")) {
    return "relay";
  }
  if (types.includes("srflx") || types.includes("prflx")) {
    return "stun";
  }
  return "direct";
}

/** A caught error's name, such as "OperationError", if it is a plain identifier. */
export function errorName(error: unknown): string | undefined {
  return error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : undefined;
}

class PeerError extends Error {
  readonly reason: PeerCloseReason;
  constructor(reason: PeerCloseReason, message: string) {
    super(message);
    this.reason = reason;
  }
}

function toCandidate(candidate: RTCIceCandidate): SignalCandidate {
  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    usernameFragment: candidate.usernameFragment ?? null,
  };
}

const urlsOf = (server: RTCIceServer) => [server.urls].flat();

function stunOf(servers: RTCIceServer[]): RTCIceServer[] {
  return servers
    .map((server) => ({ urls: urlsOf(server).filter((url) => url.startsWith("stun:")) }))
    .filter((server) => server.urls.length > 0);
}

function isConnected(state: RTCIceConnectionState): boolean {
  return state === "connected" || state === "completed";
}

function startPeer(options: PeerOptions, side: Direction): Peer {
  const { signaling, linkId, attempt, signalKey } = options;
  const other: Direction = side === "s" ? "r" : "s";
  const stunOnly = stunOf(options.iceServers);
  const hasTurn = options.iceServers.some((server) =>
    urlsOf(server).some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
  );

  let pc: RTCPeerConnection | undefined;
  let closed = false;
  let channel: RTCDataChannel | undefined;
  let opened = false;
  let gotOffer = false;
  let commit: string | undefined;
  /** The other page's frame version, from its version marker. */
  let theirVersion: number | undefined;
  let offerFingerprint: string | undefined;
  /** The other side's fingerprint in the safety number; a restart must carry the same one. */
  let theirFingerprint: string | undefined;
  let answered = false;
  // Relays run one at a time and an answer that isn't accepted closes the
  // peer, so this one flag both refuses a second answer and lets late relays
  // through (handleRelay).
  let answerAccepted = false;
  let ownFingerprint: string | undefined;
  let check = side === "s" && options.check === true;
  let resolveNumber: (value: string) => void = () => {};
  const number = new Promise<string>((resolve) => {
    resolveNumber = resolve;
  });
  /** Set when the sender starts its restart-offer, or the recipient takes one. */
  let restarted = false;
  let gotRestartAnswer = false;
  /** Set when a restart signal arrived with the path already up; later ones are ignored too. */
  let ignoredRestart = false;
  let relayTimer: ReturnType<typeof setTimeout> | undefined;
  /** Whether this connection got the TURN servers; a recovery uses TURN only then. */
  let relayAdded = false;
  /** Recipient: it called onStalled. Sender: it got a rejoined. The once-only restart rules end here. */
  let recovers = false;
  /**
   * Sender: a recovery's restart-offer waits for its answer, and only that answer ends the wait.
   * A later rejoined must not make a second offer: the answer would meet fresh credentials.
   * ponytail: a lost answer leaves this set, so later drops in the attempt end at the deadline;
   * tag offers and answers with a counter if that matters.
   */
  let recoveryOffered = false;
  /** Runs from the first rejoined of a drop until the connection is connected. */
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  /** The deadline started while the connection was connected: no drop needed it yet, so leaving "connected" starts it again. */
  let deadlineEarly = false;
  /** Counts path reads, so that one a newer read overtook reports nothing stale. */
  let pathReads = 0;
  let newestPath: Promise<OpenPath> | undefined;
  const pendingCandidates: Array<SignalCandidate | null> = [];
  let outgoing: Promise<void> = Promise.resolve();
  let incoming: Promise<void> = Promise.resolve();

  function teardown(): void {
    closed = true;
    clearTimeout(relayTimer);
    clearTimeout(recoveryTimer);
    if (channel) {
      channel.onopen = null;
      channel.onclose = null;
      channel.close();
    }
    if (pc) {
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.ondatachannel = null;
      pc.close();
    }
  }

  function connection(): RTCPeerConnection {
    if (!pc) {
      throw new PeerError("setup-failed", "no connection");
    }
    return pc;
  }

  function fail(reason: PeerCloseReason, detail?: string, name?: string): void {
    if (closed) {
      return;
    }
    teardown();
    if (detail === undefined) {
      options.onClose(reason);
    } else {
      options.onClose(reason, detail, name);
    }
  }

  function failWith(error: unknown, fallback: PeerCloseReason): void {
    if (error instanceof PeerError) {
      fail(error.reason, error.message);
    } else {
      fail(fallback, error instanceof Error ? error.message : String(error), errorName(error));
    }
  }

  /** Seals and sends a signal, in order. `required` signals close the peer if they fail. */
  function sendSignal(payload: SignalPayload, required: boolean): void {
    outgoing = outgoing.then(async () => {
      if (closed) {
        return;
      }
      try {
        const data = await sealSignal(signalKey, linkId, attempt, side, payload);
        if (closed) {
          return;
        }
        const sent = signaling.send({ t: "relay", link: linkId, data });
        if (!sent && required) {
          fail("signal-failed", "signaling is not connected");
        }
      } catch (error) {
        if (required) {
          failWith(error, "signal-failed");
        }
      }
    });
  }

  function attachChannel(next: RTCDataChannel): void {
    channel = next;
    next.binaryType = "arraybuffer";
    next.onopen = () => {
      // onOpen must not wait for the path: the other side may send at once,
      // and messages that arrive before onmessage is set are lost.
      // Chromium has been seen to fire open twice on one channel; a second reader fails the transfer.
      // Between the two, readyState reads "connecting", which channel-open.ts waits out.
      if (!closed && !opened) {
        opened = true;
        options.onOpen(next, {
          maxMessageSize: maxMessageSizeOf(connection()),
          path: readPath(),
          check,
          checkNumber: number,
        });
      }
    };
    next.onclose = () => fail("channel-closed");
  }

  /** The newest read wins: an older one that ends later resolves to the newest one's path. */
  function readPath(): Promise<OpenPath> {
    const read = ++pathReads;
    const path = readPathOnce().then((value) =>
      read === pathReads || !newestPath ? value : newestPath,
    );
    newestPath = path;
    return path;
  }

  async function readPathOnce(): Promise<OpenPath> {
    const read = () =>
      connection()
        .getStats()
        .then(connectionPath, () => "direct" as const);
    const first = await read();
    if (first !== "stun" || closed) {
      return first;
    }
    // A remote candidate shows as peer-reflexive while its trickled signal is
    // still being opened, even on one network. The browser corrects the type
    // once the candidate is added, so read again a moment later.
    await new Promise((resolve) => setTimeout(resolve, PATH_RECHECK_MS));
    return closed ? first : read();
  }

  async function addCandidate(candidate: SignalCandidate | null): Promise<void> {
    const ufrag = /^a=ice-ufrag:(\S+)/m.exec(connection().remoteDescription?.sdp ?? "")?.[1];
    // A candidate trickled before an ICE restart can arrive after it.
    if (
      candidate !== null &&
      candidate.usernameFragment !== null &&
      candidate.usernameFragment !== ufrag
    ) {
      return;
    }
    if (candidate === null || candidate.candidate === "") {
      // End of candidates. Older browsers reject this; it only speeds up
      // ICE completing, so a failure is harmless.
      try {
        await connection().addIceCandidate(candidate ?? undefined);
      } catch {}
      return;
    }
    await connection().addIceCandidate(candidate);
  }

  async function setRemote(type: "offer" | "answer", sdp: string, expected: string): Promise<void> {
    await connection().setRemoteDescription({ type, sdp });
    const sdpRead = connection().remoteDescription?.sdp;
    if ((sdpRead === undefined ? undefined : sdpFingerprint(sdpRead)) !== expected) {
      throw new PeerError("bad-signal", "the browser read another fingerprint");
    }
    const queued = pendingCandidates.splice(0);
    for (const candidate of queued) {
      await addCandidate(candidate);
    }
  }

  /** Sets and returns our own description, and its one fingerprint. */
  async function describe(kind: "offer" | "answer"): Promise<{ sdp: string; fingerprint: string }> {
    const pc = connection();
    await pc.setLocalDescription();
    const sdp = pc.localDescription?.sdp;
    const fingerprint = sdp ? sdpFingerprint(sdp) : undefined;
    if (!sdp || !fingerprint) {
      throw new PeerError("setup-failed", `no local ${kind} with one fingerprint`);
    }
    return { sdp, fingerprint };
  }

  function remoteFingerprint(sdp: string): string {
    const fingerprint = sdpFingerprint(sdp);
    if (!fingerprint) {
      throw new PeerError("bad-signal", "no single sha-256 fingerprint");
    }
    return fingerprint;
  }

  /** Once our own signals are out, throws if the other page runs another frame version. */
  async function checkVersion(): Promise<void> {
    const theirs = theirVersion ?? UNMARKED_VERSION;
    if (theirs === FRAME_VERSION) {
      return;
    }
    // Our marker must reach the other page first, so that it can say which page is older.
    await outgoing;
    throw new PeerError(
      theirs > FRAME_VERSION ? "outdated" : "peer-outdated",
      `the other page runs frame version ${theirs}`,
    );
  }

  async function handleSignal(payload: SignalPayload): Promise<void> {
    switch (payload.kind) {
      case "commit": {
        if (side !== "s" || commit !== undefined) {
          throw new PeerError("bad-signal", "unexpected commit");
        }
        await checkVersion();
        commit = payload.hash;
        const offer = await describe("offer");
        offerFingerprint = offer.fingerprint;
        sendSignal({ kind: "offer", sdp: offer.sdp, check }, true);
        return;
      }
      case "offer": {
        if (side !== "r" || gotOffer) {
          throw new PeerError("bad-signal", "unexpected offer");
        }
        await checkVersion();
        gotOffer = true;
        const theirs = remoteFingerprint(payload.sdp);
        check = payload.check;
        await setRemote("offer", payload.sdp, theirs);
        const answer = await describe("answer");
        if (answer.fingerprint !== ownFingerprint) {
          throw new PeerError("setup-failed", "the answer names another certificate");
        }
        sendSignal({ kind: "answer", sdp: answer.sdp }, true);
        answered = true;
        theirFingerprint = theirs;
        resolveNumber(await checkNumber(theirs, answer.fingerprint));
        return;
      }
      case "answer": {
        if (side !== "s" || answerAccepted || commit === undefined || !offerFingerprint) {
          throw new PeerError("bad-signal", "unexpected answer");
        }
        const theirs = remoteFingerprint(payload.sdp);
        if ((await commitFingerprint(theirs)) !== commit) {
          throw new PeerError("bad-signal", "answer does not match the commitment");
        }
        await setRemote("answer", payload.sdp, theirs);
        answerAccepted = true;
        theirFingerprint = theirs;
        if (hasTurn && !closed) {
          relayTimer = setTimeout(fallBackToRelay, RELAY_FALLBACK_MS);
        }
        resolveNumber(await checkNumber(offerFingerprint, theirs));
        return;
      }
      case "restart-offer": {
        if (side !== "r" || !answered || (restarted && !recovers)) {
          throw new PeerError("bad-signal", "unexpected restart-offer");
        }
        if (!recovers) {
          // An honest offer can cross the channel opening; an open path stays as it is.
          if (ignoredRestart) {
            return;
          }
          if (isConnected(connection().iceConnectionState) || channel?.readyState === "open") {
            ignoredRestart = true;
            return;
          }
        }
        restarted = true;
        const theirs = remoteFingerprint(payload.sdp);
        if (theirs !== theirFingerprint) {
          throw new PeerError("bad-signal", "the restart names another certificate");
        }
        // A recovery never adds the relay; rejoined set its servers.
        if (hasTurn && !recovers) {
          try {
            addRelay();
          } catch {
            // Without its own relay, the sender's relay candidates can still connect.
          }
        }
        await setRemote("offer", payload.sdp, theirs);
        const answer = await describe("answer");
        if (answer.fingerprint !== ownFingerprint) {
          throw new PeerError("setup-failed", "the answer names another certificate");
        }
        // An answer lost in a recovery is left to the deadline.
        sendSignal({ kind: "restart-answer", sdp: answer.sdp }, !recovers);
        return;
      }
      case "restart-answer": {
        if (side !== "s" || (!recovers && (!restarted || gotRestartAnswer))) {
          throw new PeerError("bad-signal", "unexpected restart-answer");
        }
        if (recovers) {
          recoveryOffered = false;
          if (connection().signalingState !== "have-local-offer") {
            return;
          }
        } else {
          if (ignoredRestart) {
            return;
          }
          if (isConnected(connection().iceConnectionState) || channel?.readyState === "open") {
            ignoredRestart = true;
            return;
          }
        }
        gotRestartAnswer = true;
        const theirs = remoteFingerprint(payload.sdp);
        if (theirs !== theirFingerprint) {
          throw new PeerError("bad-signal", "the restart names another certificate");
        }
        await setRemote("answer", payload.sdp, theirs);
        return;
      }
      case "ice": {
        const version = markedVersion(payload);
        // A marker counts only before the commit or offer; a later one is dropped by its fragment.
        if (
          version !== undefined &&
          theirVersion === undefined &&
          commit === undefined &&
          !gotOffer
        ) {
          theirVersion = version;
          await checkVersion();
          return;
        }
        if (connection().remoteDescription) {
          await addCandidate(payload.candidate);
        } else {
          pendingCandidates.push(payload.candidate);
        }
        return;
      }
    }
  }

  function addRelay(): void {
    const pc = connection();
    pc.setConfiguration({ ...pc.getConfiguration(), iceServers: options.iceServers });
    relayAdded = true;
    options.onRelayAdded?.();
  }

  /** Makes the offer that follows restartIce() and sends it as restart-offer. */
  async function sendRestartOffer(required: boolean): Promise<void> {
    const offer = await describe("offer");
    if (offer.fingerprint !== offerFingerprint) {
      throw new PeerError("setup-failed", "the restart offer names another certificate");
    }
    sendSignal({ kind: "restart-offer", sdp: offer.sdp }, required);
  }

  /** Adds TURN and restarts ICE, in order with the relayed signals, unless ICE connected or the channel opened. */
  function fallBackToRelay(): void {
    incoming = incoming
      .then(async () => {
        const pc = connection();
        const state = pc.iceConnectionState;
        if (closed || isConnected(state) || channel?.readyState === "open") {
          return;
        }
        try {
          addRelay();
          pc.restartIce();
        } catch {
          // An old browser: the connection keeps trying without the relay.
          return;
        }
        restarted = true;
        await sendRestartOffer(true);
      })
      .catch((error: unknown) => {
        failWith(error, "setup-failed");
      });
  }

  /**
   * In order with the relayed signals, like fallBackToRelay. The sender makes one offer per
   * recovery step: a rejoined while its offer waits for the answer only updates the servers.
   */
  function rejoined(iceServers: RTCIceServer[]): void {
    incoming = incoming
      .then(async () => {
        if (closed || !opened || (side === "r" && !recovers)) {
          return;
        }
        const pc = connection();
        recovers = true;
        if (recoveryTimer === undefined) {
          startDeadline(pc.connectionState === "connected");
        }
        try {
          pc.setConfiguration({
            ...pc.getConfiguration(),
            iceServers: relayAdded ? iceServers : stunOf(iceServers),
          });
        } catch {
          // The restart runs with the servers the connection has.
        }
        if (side === "r" || recoveryOffered) {
          // An offer already waits; a lost one or its answer is left to the deadline.
          return;
        }
        try {
          pc.restartIce();
        } catch {
          // An old browser: the deadline ends it unless the route comes back by itself.
          return;
        }
        // An offer lost here is left to the deadline.
        await sendRestartOffer(false);
        recoveryOffered = true;
      })
      .catch((error: unknown) => {
        failWith(error, "setup-failed");
      });
  }

  /** Starts a full recovery deadline, in place of any that runs. `early`: the connection is still connected. */
  function startDeadline(early: boolean): void {
    clearTimeout(recoveryTimer);
    deadlineEarly = early;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      deadlineEarly = false;
      if (connection().connectionState !== "connected") {
        fail("connection-failed");
      }
    }, RECOVERY_TIMEOUT_MS);
  }

  async function setup(): Promise<void> {
    if (typeof RTCPeerConnection === "undefined" || !RTCPeerConnection.generateCertificate) {
      throw new PeerError("unsupported", "no RTCPeerConnection");
    }
    const cert = await RTCPeerConnection.generateCertificate({
      name: "ECDSA",
      namedCurve: "P-256",
    } as EcKeyGenParams);
    if (closed) {
      return;
    }
    // STUN only, so a direct route wins whenever there is one; see fallBackToRelay.
    const next = new RTCPeerConnection({ iceServers: stunOnly, certificates: [cert] });
    pc = next;

    next.onicecandidate = (event) => {
      sendSignal(
        { kind: "ice", candidate: event.candidate ? toCandidate(event.candidate) : null },
        false,
      );
    };

    next.onconnectionstatechange = () => {
      const state = next.connectionState;
      if (state === "closed") {
        fail("connection-closed");
      } else if (state === "connected") {
        clearTimeout(recoveryTimer);
        recoveryTimer = undefined;
        deadlineEarly = false;
        if (opened) {
          options.onConnected?.();
        }
        if (opened && options.onPath) {
          // ponytail: a restart that never leaves "connected" reports no new path.
          const path = readPath();
          const read = pathReads;
          void path.then((value) => {
            if (!closed && read === pathReads) {
              options.onPath?.(value);
            }
          });
        }
      } else if (state === "disconnected" || state === "failed") {
        if (deadlineEarly) {
          startDeadline(false);
        }
        if (state === "failed" && recoveryTimer === undefined) {
          // No repeated joined in this drop: the other page is gone.
          fail("connection-failed");
        } else if (side === "r" && opened && options.onStalled) {
          recovers = true;
          options.onStalled();
        } else if (side === "s" && opened && state === "disconnected") {
          options.onDisconnected?.();
        }
      }
    };

    if (side === "s") {
      attachChannel(next.createDataChannel(CHANNEL_LABEL, { ordered: true }));
    } else {
      next.ondatachannel = (event) => {
        if (channel || event.channel.label !== CHANNEL_LABEL || !event.channel.ordered) {
          fail("bad-signal", "unexpected data channel");
          return;
        }
        attachChannel(event.channel);
      };
      try {
        ownFingerprint = certificateFingerprint(cert);
      } catch (error) {
        throw new PeerError(
          "unsupported",
          error instanceof Error ? error.message : "no fingerprint",
        );
      }
      sendSignal({ kind: "commit", hash: await commitFingerprint(ownFingerprint) }, true);
    }
    // Chromium was seen handing the certificate to the transport asynchronously:
    // an offer applied before that fails with "Fingerprint provided but no
    // identity available", and the connection can't recover. getStats queues
    // behind the hand-off (FID-194). A browser whose getStats rejects still sets
    // up, and a real identity failure still surfaces in describe().
    await next.getStats().catch(() => undefined);
  }

  sendSignal(versionMarker(FRAME_VERSION), true);
  // Relayed signals wait for the certificate and the connection.
  incoming = setup().catch((error: unknown) => {
    failWith(error, "setup-failed");
  });

  return {
    handleRelay(data) {
      incoming = incoming.then(async () => {
        if (closed) {
          return;
        }
        let payload: SignalPayload | undefined;
        try {
          payload = parseSignalPayload(await openSignal(signalKey, linkId, attempt, other, data));
        } catch {
          payload = undefined;
        }
        if (closed) {
          return;
        }
        if (!payload) {
          if (side === "s" && answerAccepted) {
            return;
          }
          fail("bad-signal", "signal did not open or had the wrong shape");
          return;
        }
        try {
          await handleSignal(payload);
        } catch (error) {
          failWith(error, "setup-failed");
        }
      });
      return incoming;
    },
    get answered() {
      return answered;
    },
    rejoined,
    close() {
      if (!closed) {
        teardown();
      }
    },
  };
}

/**
 * Starts the sender side for a recipient that joined `linkId`: creates the
 * data channel, and sends the offer once the recipient's commit arrives.
 */
export function createSenderPeer(options: PeerOptions): Peer {
  return startPeer(options, "s");
}

/**
 * Starts the recipient side after it joined `linkId`: commits to its
 * certificate, then waits for the sender's offer (passed in through
 * handleRelay) and answers it.
 */
export function createRecipientPeer(options: PeerOptions): Peer {
  return startPeer(options, "r");
}
