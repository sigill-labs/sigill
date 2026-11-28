// The recipient page: open a link, see what is offered, accept it, and save
// the file, or show the text, once its checksum is verified.
//
// One attempt (see lib/peer.ts and lib/receive-file.ts):
// - Connect to the signaling server and derive the link's signal key. Once
//   both are done, a plain link sends `join`. A link Fidant emailed carries
//   the server's mark (`#e.<mark>.<secret>`), and its page sends `gate` with
//   the mark first, on every attempt. Unless the server answers with the
//   masked address, the mark no longer matches a binding and the page joins
//   nothing (`unbound`). Otherwise it joins with this tab's token from
//   sessionStorage, or first asks the server to email a code and trades the
//   right code for a token. Before the channel opens, a `gate` answer to a
//   `join` is a refusal: the token is dropped and an emailed link asks `gate`
//   again; a plain link is email-bound and ends as `unbound`. Once it is open,
//   a `gate` can only answer a repeated `join` and is ignored (decision 0031).
// - The server answers `join` with `joined`, carrying this pairing's ICE
//   servers, before it tells the sender; the recipient peer is created
//   synchronously on it, so the sender's offer, which comes later on the same
//   socket, always finds a peer to answer it. Each attempt joins with a fresh
//   random attempt ID, so a sender's late refusal of an earlier attempt cannot
//   end this one.
// - `relay` goes to the peer. `refused` ends the attempt with the matching
//   message, except a `busy`, or any refusal after `host-gone`, once the
//   channel is open (decision 0031). `host-gone` ends it until the file starts
//   arriving. A transfer under way needs the server only to recover a dropped
//   route, not to go on (the sender may only have
//   lost its signaling connection), so then `host-gone` is only remembered: if
//   the sender's tab really closed, the peer drops too (at the latest when ICE
//   consent runs out) and the drop is reported as the sender's page closing.
// - If the connection drops after the data channel opened, the peer says so
//   (onStalled) and the page sends the same `join` again on the same socket,
//   with the same attempt ID and token (decision 0031). It doesn't once the
//   attempt has ended, the transfer has stopped, the signaling client is closed
//   or `host-gone` came: joining the sender's new socket would be a new
//   pairing. The `joined` that answers goes to the peer (rejoined), which
//   restarts ICE with the sender on the same connection; its ICE servers are
//   kept nowhere else. The path shown follows the peer (onPath). Once the
//   channel is open, the answers a repeated `join` can get instead never end
//   the transfer: `refused` with `busy` (the server's cap, or an older
//   sender's page), any `refused` after `host-gone`, a `gate`, and an older
//   server's `error`. The page shows nothing new; the progress stops until the
//   connection is back, or the peer gives up and the attempt ends as lost.
// - If the signaling socket drops before the data channel opens, a new
//   attempt starts (new socket, new attempt ID), unless this page already
//   answered the sender's offer: the answer gave anyone in the middle this
//   connection's safety number, so every new connection would be another guess, and only
//   the recipient's "Try again" makes one. A `token` counts only as the
//   answer to a code this page sent. A socket that never opened is
//   left to the signaling client's own retries. A server that started less
//   than STARTING_MS ago may not know the sender's link yet, because the
//   sender is still reconnecting, and refuses with `starting`: the page sends
//   the same `join` again on the same socket after STARTING_RETRY_MS, and each
//   `join` re-arms the connect timeout, so the server decides when waiting
//   ends (decision 0018). `refused: unknown` always ends the attempt.
// - Once the connection opened, the server sends `resume` with a token for
//   this side of the attempt (decision 0033), kept only in memory and replaced
//   by each new one. While the page holds a token it has not sent, a dropped
//   signaling socket does neither of the above: the client opens a new socket,
//   which sends `resume` with the token instead of `gate` or `join`, once per
//   token. The server's `resume` with a new token gives the attempt back; if
//   the peer stalled meanwhile, its repeated `join` waited and goes now, since
//   the sender's page restarts ICE only when asked. A `resume` without a token,
//   or a drop with no unsent token, goes on as before: once the channel is
//   open, the transfer needs the server only to recover a dropped route
//   (decision 0031), so the signaling client closes and the page can no longer
//   restart ICE after a dropped route; before it opens, as above.
//   Reaching the code step resets the rejoin count (a token holder's rejoins
//   do not), and the code field survives a rejoin. A `failed` or `expired`
//   code result asks the gate again, so a binding that is gone ends as "no
//   longer works".
// - A peer or an INIT that shows the two pages run different frame versions
//   ends the attempt with which page must reload, and no Try again.
// - If the data channel hasn't opened CONNECT_TIMEOUT_MS (30 s) after the
//   attempt starts, the attempt fails with "connect" (a peer exists) or
//   "server" (no `joined` yet), so "Connecting…" never stays up for good.
// - When the data channel opens with the safety number on, the page shows the
//   number before anything about the file, and receiveFile holds the offer
//   until the recipient said it matches and the sender's page said so too.
//   Either side saying it differs ends the attempt as "differed"; "Try again"
//   makes a new connection with a new number. The recipient saying it
//   differs discards any part a lost connection kept.
// - When the data channel opens, receiveFile runs the transfer. The offer
//   screen resolves its decision with a Sink (Download or Show) or undefined
//   (Decline). Show always collects a text in memory, never in a save dialog.
//
// When an attempt ends for any reason, its signaling socket is closed: the
// server keeps a guest bound to its link until then, and a later opener would
// get "in use" instead of the sender's answer. After DECLINE or RECEIPT the
// peer stays up for a moment so that frame reaches the sender, which closes
// the channel itself. "Try again" starts a fresh attempt with a new socket and
// a new peer, and hands it the part a lost connection kept (see
// lib/receive-file.ts). Only an attempt that ends on the failed view keeps it,
// and not one that ended as "differed" (keepsPart in lib/receive-problem.ts).
//
// The secret stays in this tab (it is never stripped from the address bar in
// this demo). The file name and size, or the text, are shown, never logged or
// sent anywhere.

import { type CodeResult, isLinkId } from "@fidant/protocol";
import { cn } from "cn";
import { type ComponentChildren, Fragment, type VNode } from "preact";
import { useEffect, useId, useMemo, useReducer, useRef, useState } from "preact/hooks";
import { Button, buttonVariants } from "#components/ui/button";
import { Card, CardContent } from "#components/ui/card";
import { Input } from "#components/ui/input";
import { Label } from "#components/ui/label";
import type { Messages } from "../i18n/en.ts";
import { useI18n } from "../i18n/I18n.tsx";
import { encodeBase64url } from "../lib/base64url.ts";
import type { TransferStatus } from "../lib/favicon.ts";
import {
  displayName,
  etaTracker,
  formatBytes,
  formatProgress,
  formatTimeLeft,
  toHex,
} from "../lib/format.ts";
import { deriveSignalKey } from "../lib/keys.ts";
import { LINK_ID_BYTES, parseRecipientLocation } from "../lib/link.ts";
import { askToNotify, notify, notifyPermission } from "../lib/notify.ts";
import { createRecipientPeer, type OpenPath, type Peer, type PeerOpenInfo } from "../lib/peer.ts";
import type { FileOffer, Resumable } from "../lib/receive-file.ts";
import { ReceiveError, receiveFile } from "../lib/receive-file.ts";
import {
  createRestartWatch,
  joinedAction,
  joinsAgain,
  onSocketClose,
  onSocketOpen,
  resumeAction,
  takesGate,
  takesRefusal,
} from "../lib/receive-guards.ts";
import { keepsPart, peerLostProblem, refusedProblem } from "../lib/receive-problem.ts";
import { connectSignaling, type SignalingClient } from "../lib/signaling-client.ts";
import {
  BLOB_WARN_BYTES,
  BlobSink,
  canPickSaveFile,
  createSink,
  isPickerCancel,
  type Sink,
} from "../lib/sink.ts";
import { decodeText, isTextOffer } from "../lib/text-secret.ts";
import {
  createTraceLog,
  fromMessage,
  type TraceLog as Log,
  recordAt,
  type TraceEvent,
} from "../lib/trace-log.ts";
import {
  CheckNumber,
  Direct,
  field,
  formRows,
  Icon,
  Page,
  PathLine,
  Problem,
  SwapLabel,
  TechDetails,
  TraceDrawer,
  useCopyNote,
} from "../ui.tsx";

const caption = "text-[0.9rem] text-muted-foreground";

/** The offered file, with whatever belongs to it right now: the buttons, the progress or the check. */
function FileBox({
  offer,
  aside,
  children,
}: {
  offer: Offer;
  /** Beside the file on wider screens, under it on phones. */
  aside?: ComponentChildren;
  children?: ComponentChildren;
}) {
  const { lang } = useI18n();
  return (
    <Card className="my-6">
      <CardContent className="flex flex-col gap-4">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {!offer.text && (
            <div class="flex min-w-0 items-center gap-3">
              <Icon name="file" class="size-8 text-muted-foreground" />
              <div class="min-w-0">
                <p class="m-0 font-semibold wrap-anywhere">{offer.name}</p>
                <p class="m-0 text-muted-foreground">{formatBytes(offer.size, lang)}</p>
              </div>
            </div>
          )}
          {aside}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** Which problem to show. Text comes from the dictionary at render time, so a language switch re-renders it. */
type ProblemKey = keyof Messages["receive"]["problems"];

type ProblemText = { title: string; body: string; detail?: string };

type Offer = FileOffer & { text: boolean };

export type View =
  | { s: "connecting" }
  | { s: "verify"; to: string; asked: boolean; sending: boolean; result: CodeResult | undefined }
  | { s: "check"; number: string | undefined; said?: boolean }
  | { s: "refused"; problem: ProblemKey; text?: boolean }
  | { s: "offer"; offer: Offer }
  | { s: "receiving"; offer: Offer; bytes: number; left?: number | undefined }
  | { s: "done"; offer: Offer; blob: Blob | undefined; sha256: string }
  | { s: "declined"; text: boolean }
  | { s: "failed"; problem: ProblemKey; text?: boolean };

type Attempt = {
  abort: AbortController;
  signaling: SignalingClient;
  peer?: Peer;
  /** Set once the data channel opened; signaling problems no longer matter then. */
  channelOpen: boolean;
  /** Set once a signal from the sender arrived, so the sender took this join. */
  heardSender: boolean;
  /** Set once the offer turned out to be a text, so later problems use text wording. */
  text: boolean;
  /** Set once the recipient accepted and the file started arriving. */
  receiving: boolean;
  /** Set once the channel opened with a part an earlier attempt kept, until a different offer discards it. */
  resuming?: boolean;
  /** The server said the sender is gone while the file was arriving. */
  hostGone: boolean;
  /** The sender refused our relay for this attempt, as the server's `joined` said. */
  relayRefused: boolean;
  /** Set once the attempt reached its final view. Later events are ignored. */
  ended: boolean;
  /** The final view, set when finish() ends the attempt. */
  ending?: View;
  /** Resolves the offer: a Sink to accept, undefined to decline. */
  decide?: ((sink: Sink | undefined) => void) | undefined;
  /** With the safety number on: resolves the recipient's own verdict. */
  confirm?: ((matches: boolean) => void) | undefined;
  /** The recipient said the numbers differ, so whatever ends the attempt now ends it as "differed". */
  saidDiffers?: boolean;
  /** Set when this page sends a code; only then may a `token` answer it. */
  codeSent?: boolean;
  timers: Array<ReturnType<typeof setTimeout>>;
};

/** How long to wait for `host-gone` after the peer drops, to tell "offline" from "failed". */
const HOST_GONE_GRACE_MS = 1000;
/** How long the peer stays up after DECLINE or RECEIPT for the sender to close it. */
const LINGER_MS = 5000;
/** How long to wait for the data channel before giving up on the sender. */
const CONNECT_TIMEOUT_MS = 30_000;
/** How many new attempts follow a socket that drops after opening before giving up. */
const MAX_REJOINS = 4;
/** How long to wait before asking again after the server refuses with `starting`. */
const STARTING_RETRY_MS = 1000;

/**
 * A state the dev panel (src/dev) puts the page in. While one is set the page connects to nothing,
 * and each new one replaces the page's state in place, so the change shows as it would live.
 */
export type ReceivePreview = {
  /** Left out, the page shows what a malformed link gets. */
  view?: View;
  emailed?: boolean;
  path?: OpenPath;
};

export function ReceivePage({
  onStatus,
  preview,
  shown,
}: {
  /** Told "active" while a file or text is offered or arriving, which leaving the tab would lose, and "done" once it has arrived. */
  onStatus(status: TransferStatus): void;
  preview?: ReceivePreview | undefined;
  /** False while another page is showing and this one is kept hidden. */
  shown: boolean;
}) {
  const { t, lang } = useI18n();
  const problemFor = (view: { problem: ProblemKey; text?: boolean }): ProblemText => {
    const problems: Record<ProblemKey, ProblemText> = view.text
      ? { ...t.receive.problems, ...t.secret.problems }
      : t.receive.problems;
    return problems[view.problem];
  };
  const link = useMemo(
    () =>
      preview
        ? preview.view && { linkId: "", secret: "", ...(preview.emailed && { mark: "" }) }
        : parseRecipientLocation(location),
    [preview],
  );
  const [view, setView] = useState<View>({ s: "connecting" });
  const status: TransferStatus =
    view.s === "offer" || view.s === "receiving" ? "active" : view.s === "done" ? "done" : "idle";
  useEffect(() => onStatus(status), [onStatus, status]);
  const downloading = view.s === "receiving" && !preview;
  useEffect(() => {
    if (!downloading) {
      return;
    }
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    addEventListener("beforeunload", ask);
    return () => removeEventListener("beforeunload", ask);
  }, [downloading]);
  const [picking, setPicking] = useState(false);
  // Only in page memory, and on the page rather than the attempt: Try again keeps it, with a marker line.
  const [traces, addTrace] = useReducer(recordAt, "recipient", createTraceLog);
  const trace = (event: TraceEvent) => addTrace({ event, at: Date.now() });
  const [canAskToNotify, setCanAskToNotify] = useState(false);
  const [notifyAnswer, setNotifyAnswer] = useState<"on" | "blocked" | undefined>(undefined);
  const notifyId = useId();
  // When the answer replaces the button, it takes the focus the button (or nothing) held.
  useEffect(() => {
    const active = document.activeElement;
    if (
      notifyAnswer &&
      (active === document.body || active === document.getElementById(`${notifyId}-me`))
    ) {
      document.getElementById(`${notifyId}-answer`)?.focus();
    }
  }, [notifyAnswer]);
  // Never during prerender.
  useEffect(() => setCanAskToNotify(notifyPermission() === "default"), []);
  const [path, setPath] = useState<OpenPath | undefined>(undefined);
  const attemptRef = useRef<Attempt | undefined>(undefined);
  const codeAsked = useRef<string | undefined>(undefined);
  const keptRef = useRef<Resumable | undefined>(undefined);
  const discardKept = () => {
    const kept = keptRef.current;
    keptRef.current = undefined;
    void kept?.sink.abort();
  };

  /** Closes everything an attempt holds. `linger` keeps the peer up for a moment. */
  const release = (attempt: Attempt, linger = false) => {
    attempt.ended = true;
    attempt.abort.abort(new Error("attempt ended"));
    attempt.signaling.close();
    const closePeer = () => {
      if (attempt.peer) {
        attempt.peer.close();
        trace({ t: "peer-closed", ...(link && { link: link.linkId }) });
      }
    };
    if (linger) {
      attempt.timers.push(setTimeout(closePeer, LINGER_MS));
    } else {
      for (const timer of attempt.timers) {
        clearTimeout(timer);
      }
      closePeer();
    }
  };

  const start = (rejoins = 0) => {
    if (!link || preview) {
      return;
    }
    const { linkId, secret, mark } = link;
    const previous = attemptRef.current;
    if (previous && !previous.ended) {
      release(previous);
    }

    // A fresh ID per attempt, so the sender's refusal can name the attempt it refuses.
    const attemptId = encodeBase64url(crypto.getRandomValues(new Uint8Array(LINK_ID_BYTES)));
    const signaling = connectSignaling({
      onMessage: (...args) => {
        const event = fromMessage(...args);
        if (event) {
          trace(event);
        }
      },
    });
    const attempt: Attempt = {
      abort: new AbortController(),
      signaling,
      channelOpen: false,
      heardSender: false,
      text: false,
      receiving: false,
      hostGone: false,
      relayRefused: false,
      ended: false,
      timers: [],
    };
    attemptRef.current = attempt;
    setPicking(false);
    setPath(undefined);
    setView({ s: "connecting" });

    const current = () => attemptRef.current === attempt && !attempt.ended;
    const lostMessage = () => peerLostProblem(attempt);
    const offlineMessage = () => (attempt.receiving ? "offlineReceiving" : "offline");
    const finish = (next: View, linger = false) => {
      if (!current()) {
        return;
      }
      release(attempt, linger);
      attempt.ending = next;
      if (!keepsPart(attempt)) {
        discardKept();
      }
      setView(
        attempt.text && (next.s === "refused" || next.s === "failed")
          ? { ...next, text: true }
          : next,
      );
    };
    // The peer dropped, or never connected (ICE failed). If the sender's tab
    // closed, `host-gone` arrives within moments of the drop, before or after
    // it; wait for it so the message says why.
    const lost = () => {
      if (!current()) {
        return;
      }
      if (attempt.saidDiffers) {
        finish({ s: "failed", problem: "differed" });
        return;
      }
      if (attempt.hostGone) {
        finish({ s: "refused", problem: offlineMessage() });
        return;
      }
      attempt.abort.abort(new Error("connection lost"));
      attempt.timers.push(
        setTimeout(() => finish({ s: "failed", problem: lostMessage() }), HOST_GONE_GRACE_MS),
      );
    };
    // A short transfer can end before the path resolves, so this checks the attempt, not current().
    const showPath = (resolved: OpenPath) => {
      if (attemptRef.current !== attempt) {
        return;
      }
      setPath(resolved);
      trace({ t: "path", path: resolved, link: linkId });
    };
    const outdated = (reason: "outdated" | "peer-outdated") =>
      finish({ s: "refused", problem: reason === "outdated" ? "outdated" : "senderOutdated" });
    // Without it, a sender whose signals never arrive leaves "Connecting…" up for good.
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    const armConnectTimeout = () => {
      clearTimeout(connectTimer);
      connectTimer = setTimeout(() => {
        if (!attempt.channelOpen) {
          finish({ s: "failed", problem: attempt.peer ? lostMessage() : "server" });
        }
      }, CONNECT_TIMEOUT_MS);
      attempt.timers.push(connectTimer);
    };
    armConnectTimeout();

    // Set before `join` is sent, so it is there when `joined` arrives.
    let signalKey: CryptoKey | undefined;
    let opened = false;
    let joinSent = false;
    /** The token the last `join` carried, so a `starting` refusal can send the same `join` again. */
    let joinToken: string | undefined;
    // Taking this attempt back on a new socket (decision 0033). The resume token lives only here,
    // in memory: never in storage, the address or a log. Sending it uses it up.
    let resumeToken: string | undefined;
    /** From a close with a token until the server answers the `resume`: no `join` goes out meanwhile. */
    let waiting = false;
    /** From each stall until the connection is connected again: a `join` sent then may have gone onto a dead socket. */
    const restart = createRestartWatch();
    const ask = () => {
      if (!opened || !signalKey || !current()) {
        return;
      }
      if (mark) {
        signaling.send({ t: "gate", link: linkId, mark });
      } else {
        join(undefined);
      }
    };
    const join = (token: string | undefined) => {
      joinSent = true;
      joinToken = token;
      armConnectTimeout();
      signaling.send(
        token === undefined
          ? { t: "join", link: linkId, attempt: attemptId }
          : { t: "join", link: linkId, attempt: attemptId, token },
      );
    };
    void deriveSignalKey(secret, linkId).then(
      (key) => {
        signalKey = key;
        ask();
      },
      () => finish({ s: "failed", problem: "server" }),
    );
    signaling.onOpen(() => {
      // Before the `resume` or `join` below, which the log reads against this socket.
      trace({ t: "socket-open" });
      if (!current()) {
        return;
      }
      opened = true;
      const action = onSocketOpen({
        channelOpen: attempt.channelOpen,
        hasToken: resumeToken !== undefined,
      });
      if (action === "resume" && resumeToken !== undefined) {
        signaling.send({ t: "resume", link: linkId, attempt: attemptId, token: resumeToken });
        resumeToken = undefined;
      } else if (action === "ask") {
        ask();
      }
    });
    /** Goes on without a socket that can take the attempt back, as before decision 0033. */
    const without = (hasToken: boolean) => {
      switch (
        onSocketClose({
          channelOpen: attempt.channelOpen,
          aborted: attempt.abort.signal.aborted,
          answered: attempt.peer?.answered ?? false,
          hasToken,
        })
      ) {
        case "resume":
          // The signaling client opens a new socket, and onOpen sends `resume` on it.
          waiting = true;
          break;
        case "close":
          // The transfer goes on without the server, which can no longer recover a dropped route.
          waiting = false;
          signaling.close();
          break;
        case "lost":
          // Before the channel opened, the answer gave anyone in the middle this connection's
          // safety number, so a new one would be another guess: only the recipient's Try again makes it.
          finish({ s: "failed", problem: lostMessage() });
          break;
        case "restart":
          if (rejoins < MAX_REJOINS) {
            start(rejoins + 1);
          } else {
            finish({ s: "failed", problem: "server" });
          }
          break;
      }
    };
    signaling.onClose(({ code, byClient }) => {
      trace({ t: "socket-closed", code });
      if (byClient || !current()) {
        return;
      }
      if (!opened) {
        // The client retries; CONNECT_TIMEOUT_MS bounds the wait.
        return;
      }
      without(resumeToken !== undefined);
    });
    signaling.subscribe((message) => {
      switch (message.t) {
        case "gate": {
          // Once the channel is open, a `gate` can only answer a repeated `join`, and the transfer goes on without it.
          if (
            !takesGate({
              current: current(),
              ourLink: message.link === linkId,
              channelOpen: attempt.channelOpen,
            })
          ) {
            break;
          }
          if (joinSent) {
            joinSent = false;
            storeToken(linkId, undefined);
            if (mark) {
              ask();
            } else {
              finish({ s: "refused", problem: "unbound" });
            }
            break;
          }
          // Someone else may host this link ID now, without the code that guards the emailed one.
          if (!message.to) {
            storeToken(linkId, undefined);
            finish({ s: "refused", problem: "unbound" });
            break;
          }
          const token = readToken(linkId);
          if (token) {
            join(token);
            break;
          }
          // Time on the code step must not use up the attempts a dropped connection gets.
          rejoins = 0;
          // The code step has no deadline; `join` arms it again.
          clearTimeout(connectTimer);
          const to = message.to;
          setView((v) =>
            v.s === "verify"
              ? v
              : {
                  s: "verify",
                  to,
                  asked: codeAsked.current === linkId,
                  sending: false,
                  result: undefined,
                },
          );
          break;
        }
        case "code":
          if (current() && message.link === linkId) {
            const { result } = message;
            setView((v) => (v.s === "verify" ? { ...v, sending: false, result } : v));
            // The binding may be gone: the gate answers with no address if so.
            if (!joinSent && (result === "failed" || result === "expired")) {
              ask();
            }
          }
          break;
        case "token":
          if (!current() || message.link !== linkId || joinSent || !attempt.codeSent) {
            break;
          }
          attempt.codeSent = false;
          storeToken(linkId, message.token);
          codeAsked.current = undefined;
          setView({ s: "connecting" });
          join(message.token);
          break;
        case "joined": {
          const action = joinedAction({
            current: current(),
            ours: message.link === linkId && message.attempt === attemptId,
            hasPeer: attempt.peer !== undefined,
          });
          if (action === "ignore" || !signalKey) {
            break;
          }
          if (action === "rejoin" && attempt.peer) {
            // The answer to a repeated `join`. The peer ignores one it never asked for.
            attempt.peer.rejoined(message.iceServers);
            break;
          }
          attempt.relayRefused = !message.turn;
          attempt.peer = createRecipientPeer({
            signaling,
            linkId,
            attempt: attemptId,
            signalKey,
            iceServers: message.iceServers,
            onOpen: (channel, info) => {
              void info.path.then(showPath);
              onOpen(channel, info);
            },
            onPath: showPath,
            onRelayAdded: () => trace({ t: "relay-added", link: linkId }),
            // The same `join` again, token included (decision 0031). After `host-gone` it would
            // be a new pairing with the sender's new socket, so then nothing is sent.
            onStalled: () => {
              if (
                joinsAgain({
                  current: current(),
                  hostGone: attempt.hostGone,
                  aborted: attempt.abort.signal.aborted,
                })
              ) {
                // No socket holds the attempt yet, so the `join` waits for the server's `resume`.
                if (restart.stalled(waiting)) {
                  join(joinToken);
                }
              }
            },
            onConnected: () => restart.connected(),
            onClose: (reason) => {
              trace({ t: "peer-closed", link: linkId });
              return reason === "unsupported"
                ? finish({ s: "failed", problem: "browser" })
                : reason === "outdated" || reason === "peer-outdated"
                  ? outdated(reason)
                  : lost();
            },
          });
          break;
        }
        case "resume": {
          // A token arrives when the connection opened and answers each `resume`; none refuses one.
          const action = resumeAction({
            current: current(),
            ours: message.link === linkId && message.attempt === attemptId,
            token: message.token !== undefined,
            waiting,
            restartPending: restart.pending,
          });
          if (action === "ignore") {
            break;
          }
          waiting = false;
          if (action === "refused") {
            without(false);
            break;
          }
          resumeToken = message.token;
          // The sender's page restarts ICE only when asked, so the `join` the stall wanted goes now.
          if (
            action === "keep-and-join" &&
            joinsAgain({
              current: current(),
              hostGone: attempt.hostGone,
              aborted: attempt.abort.signal.aborted,
            })
          ) {
            join(joinToken);
          }
          break;
        }
        case "relay":
          attempt.heardSender = true;
          void attempt.peer?.handleRelay(message.data);
          break;
        case "refused":
          // A refusal after the sender's first signal means the sender gave up
          // on this attempt (its peer failed or never connected), not that the
          // link is in use or used: the sender only signals a join it took.
          // Once the channel is open, `busy` answers a repeated `join` (the server's cap, or
          // an older sender's page), and so does any refusal after `host-gone`: the sender's
          // socket is gone, so it is the server's answer to a `join` that crossed it. The
          // transfer goes on without the server.
          if (!takesRefusal(attempt, message.reason)) {
            break;
          }
          if (attempt.saidDiffers) {
            finish({ s: "failed", problem: "differed" });
          } else if (attempt.heardSender) {
            finish({ s: "failed", problem: lostMessage() });
          } else if (message.reason === "starting") {
            // The server just started and the sender may not have hosted again yet.
            attempt.timers.push(
              setTimeout(() => {
                if (current() && joinSent) {
                  join(joinToken);
                }
              }, STARTING_RETRY_MS),
            );
          } else {
            finish(
              message.reason === "drop"
                ? { s: "failed", problem: lostMessage() }
                : refusedProblem(message.reason, keptRef.current !== undefined),
            );
          }
          break;
        case "host-gone":
          // A transfer under way can finish without the server; the peer
          // closing ends it if the sender really went away. Before that,
          // browsers can take many seconds to notice a closed tab over the
          // data channel, so trust the server.
          if (attempt.receiving && !attempt.abort.signal.aborted) {
            attempt.hostGone = true;
            break;
          }
          finish({ s: "refused", problem: offlineMessage() });
          break;
        case "error":
          if (!attempt.channelOpen) {
            finish({ s: "failed", problem: "server" });
          }
          break;
        default:
          break;
      }
    });

    const onOpen = (channel: RTCDataChannel, info: PeerOpenInfo) => {
      if (!current()) {
        return;
      }
      // receiveFile owns the kept part from here, so this attempt's own ending can't abort it while in use.
      const resumable = keptRef.current;
      keptRef.current = undefined;
      if (resumable) {
        attempt.resuming = true;
      }
      attempt.channelOpen = true;
      let offered: Offer | undefined;
      let timeLeft: ReturnType<typeof etaTracker> | undefined;
      const offerOf = (received: FileOffer): Offer => {
        offered = { ...received, from: displayName(received.from), text: isTextOffer(received) };
        attempt.text = offered.text;
        return offered;
      };
      const startReceiving = (offer: Offer, bytes: number) => {
        attempt.receiving = true;
        timeLeft = etaTracker(offer.size);
        setView({ s: "receiving", offer, bytes });
      };
      const confirm = info.check
        ? new Promise<boolean>((resolve) => {
            attempt.confirm = resolve;
          })
        : undefined;
      if (confirm) {
        setView({ s: "check", number: undefined });
        void info.checkNumber.then((number) => {
          if (current()) {
            setView((v) => (v.s === "check" ? { ...v, number } : v));
          }
        });
      }
      receiveFile({
        channel,
        maxMessageSize: info.maxMessageSize,
        secret,
        attempt: attemptId,
        signal: attempt.abort.signal,
        ...(confirm && { confirm }),
        ...(resumable && { resumable }),
        onOffer(received) {
          attempt.resuming = false;
          return new Promise((resolve) => {
            if (!current()) {
              return;
            }
            const offer = offerOf(received);
            attempt.decide = (sink) => {
              attempt.decide = undefined;
              if (sink) {
                startReceiving(offer, 0);
              }
              resolve(sink);
            };
            setView({ s: "offer", offer });
          });
        },
        onResume(received, bytes) {
          if (current()) {
            startReceiving(offerOf(received), bytes);
          }
        },
        onProgress(bytes) {
          if (!current()) {
            return;
          }
          const left = timeLeft?.(performance.now(), bytes);
          setView((v) => (v.s === "receiving" ? { ...v, bytes, left } : v));
        },
      }).then(
        (result) => {
          if (result.type === "check-differs") {
            finish({ s: "failed", problem: "differed" });
          } else if (result.type === "declined") {
            finish({ s: "declined", text: attempt.text }, true);
          } else if (result.type === "received" && offered) {
            const sha256 = toHex(result.sha256);
            finish({ s: "done", offer: offered, blob: result.blob, sha256 }, true);
          }
        },
        (error: unknown) => {
          const kept = error instanceof ReceiveError ? error.resumable : undefined;
          // Not current(): a refusal or the grace timer can end the attempt as failed before this lands.
          if (kept && attemptRef.current === attempt && keepsPart(attempt)) {
            keptRef.current = kept;
          } else {
            void kept?.sink.abort();
          }
          const reason = error instanceof ReceiveError ? error.reason : "connection";
          // RECEIPT went out for a mismatch: linger so it reaches the sender.
          if (reason === "checksum") {
            finish({ s: "failed", problem: "checksum" }, true);
          } else if (reason === "invalid") {
            finish({ s: "failed", problem: "invalid" });
          } else if (reason === "save") {
            finish({ s: "failed", problem: "save" });
          } else if (reason === "outdated" || reason === "peer-outdated") {
            outdated(reason);
          } else {
            lost();
          }
        },
      );
    };
  };

  // Runs on mount, and again when a dev preview starts or ends. The cleanup
  // closes the connection when a preview starts. Production never passes a
  // preview. "Try again" calls start() again.
  useEffect(() => {
    if (preview) {
      return;
    }
    if (link) {
      trace({ t: "address-bar" });
    }
    start();
    // Once the page is really going, close the peer so the sender hears it now, not when ICE
    // consent runs out about 15 s later. Unless the page may come back from the back-forward
    // cache, also close signaling with 1000, so the server frees the attempt at once instead of
    // holding it for a takeover (0033).
    const onPageHide = (event: PageTransitionEvent) => {
      if (attemptRef.current?.peer) {
        attemptRef.current.peer.close();
        trace({ t: "peer-closed", ...(link && { link: link.linkId }) });
      }
      if (!event.persisted) {
        attemptRef.current?.signaling.close();
      }
    };
    addEventListener("pagehide", onPageHide);
    return () => {
      removeEventListener("pagehide", onPageHide);
      const attempt = attemptRef.current;
      attemptRef.current = undefined;
      if (attempt) {
        for (const timer of attempt.timers) {
          clearTimeout(timer);
        }
        if (!attempt.ended) {
          release(attempt);
        } else {
          attempt.peer?.close();
        }
      }
      discardKept();
    };
  }, [preview === undefined]);

  useEffect(() => {
    if (!preview) {
      return;
    }
    setView(preview.view ?? { s: "connecting" });
    setPicking(false);
    setPath(preview.path);
  }, [preview]);

  // Each step replaces the button that had focus, so focus moves to the new step's heading.
  const firstView = useRef(true);
  useEffect(() => {
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    focusHeading();
  }, [view.s]);
  // Only fixed text: the system keeps a notification outside the page. notify() shows nothing
  // while the page has focus or without the recipient's permission.
  useEffect(() => {
    if (preview) {
      return;
    }
    const words = t.receive.notify;
    if (view.s === "done") {
      trace({ t: "received", secret: view.offer.text });
      notify((view.offer.text ? t.secret : t.receive).doneTitle, words.doneBody(view.offer.text));
    } else if (view.s === "offer") {
      notify(words.offerTitle, words.offerBody(view.offer.text));
    } else if (view.s === "failed" || view.s === "refused") {
      notify(words.stoppedTitle, words.stoppedBody);
    }
  }, [view.s]);
  // The safety number needs the recipient once it shows, before they said what the sender read.
  const checkReady = view.s === "check" && view.number !== undefined && view.said === undefined;
  useEffect(() => {
    if (checkReady && !preview) {
      notify(t.receive.notify.checkTitle, t.receive.notify.checkBody);
    }
  }, [checkReady]);
  // Try again and Show again: the user starts a new attempt, which the log marks.
  const startAgain = () => {
    trace({ t: "new-transfer" });
    start();
  };

  const onAccept = () => {
    const attempt = attemptRef.current;
    if (view.s !== "offer" || !attempt?.decide || picking) {
      return;
    }
    // First thing in the click handler: the save dialog needs the user gesture.
    const pending = createSink(view.offer.name);
    setPicking(true);
    pending.then(
      (sink) => {
        setPicking(false);
        if (
          attemptRef.current !== attempt ||
          attempt.ended ||
          attempt.abort.signal.aborted ||
          !attempt.decide
        ) {
          void sink.abort();
          return;
        }
        attempt.decide(sink);
      },
      (error: unknown) => {
        setPicking(false);
        // Cancelling the save dialog leaves the offer open.
        if (
          isPickerCancel(error) ||
          attemptRef.current !== attempt ||
          attempt.ended ||
          attempt.abort.signal.aborted
        ) {
          return;
        }
        release(attempt);
        setView({ s: "failed", problem: "create" });
      },
    );
  };

  const onDecline = () => attemptRef.current?.decide?.(undefined);

  const onCheck = (matches: boolean) => {
    const attempt = attemptRef.current;
    if (view.s !== "check" || !attempt?.confirm || attempt.ended) {
      return;
    }
    attempt.saidDiffers = !matches;
    if (!matches) {
      discardKept();
    }
    attempt.confirm(matches);
    attempt.confirm = undefined;
    setView({ ...view, said: matches });
    focusHeading();
  };

  const onShow = () => {
    const attempt = attemptRef.current;
    if (view.s !== "offer" || !attempt?.decide || attempt.ended || attempt.abort.signal.aborted) {
      return;
    }
    attempt.decide(new BlobSink());
  };

  const onSendCode = () => {
    const attempt = attemptRef.current;
    if (view.s !== "verify" || view.sending || !attempt || !link?.mark) {
      return;
    }
    codeAsked.current = link.linkId;
    setView({ ...view, asked: true, sending: true, result: undefined });
    attempt.signaling.send({ t: "send-code", link: link.linkId, mark: link.mark });
  };

  const onCode = (event: Event) => {
    event.preventDefault();
    const attempt = attemptRef.current;
    if (view.s !== "verify" || !attempt || !link?.mark) {
      return;
    }
    const input = (event.currentTarget as HTMLFormElement).elements.namedItem(
      "code",
    ) as HTMLInputElement;
    const code = input.value.replace(/\s/g, "");
    // The server drops the connection on a malformed code, so only six digits go out.
    if (!/^[0-9]{6}$/.test(code)) {
      setView({ ...view, result: "wrong" });
      input.focus();
      return;
    }
    setView({ ...view, result: undefined });
    attempt.codeSent = true;
    attempt.signaling.send({ t: "code", link: link.linkId, code, mark: link.mark });
  };

  if (!link) {
    return (
      <Page tall>
        <Problem {...t.receive.problems.badLink} />
      </Page>
    );
  }

  const emailed = link?.mark !== undefined;

  let body: VNode;
  switch (view.s) {
    case "connecting":
      body = <h1>{t.receive.connecting}</h1>;
      break;
    case "verify": {
      const { verify } = t.receive;
      const isError = !view.sending && view.result !== undefined && view.result !== "sent";
      body = (
        <>
          <h1>{verify.title}</h1>
          <p>{verify.body(view.to)}</p>
          <Button type="button" variant={view.asked ? "outline" : "default"} onClick={onSendCode}>
            {verify.send}
          </Button>
          {view.asked && (
            <form class={`mt-6 ${formRows}`} onSubmit={onCode} noValidate>
              <div class={field}>
                <Label htmlFor="code">{verify.codeLabel}</Label>
                <Input
                  id="code"
                  name="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  required
                  className="w-36"
                  aria-invalid={view.result === "wrong" ? "true" : "false"}
                  aria-describedby="code-note"
                />
              </div>
              <Button type="submit">{verify.submit}</Button>
            </form>
          )}
          <p
            id="code-note"
            class={isError ? "mt-3 text-destructive" : `mt-3 ${caption}`}
            aria-live="polite"
          >
            {view.sending ? verify.sending : view.result && verify.results[view.result]}
          </p>
        </>
      );
      break;
    }
    case "check": {
      const { check } = t.receive;
      body = (
        <>
          <h1>{check.heading}</h1>
          <CheckNumber number={view.number} />
          {view.number && view.said === undefined && (
            <>
              <p>{check.read}</p>
              <div class="flex flex-wrap gap-3">
                <Button type="button" onClick={() => onCheck(true)}>
                  {check.matches}
                </Button>
                <Button type="button" variant="outline" onClick={() => onCheck(false)}>
                  {check.differs}
                </Button>
              </div>
            </>
          )}
          <p class={caption} role="status">
            {view.said && check.waiting}
          </p>
          <p class={caption}>{check.why}</p>
          <p class={caption}>{check.expires}</p>
        </>
      );
      break;
    }
    case "refused":
      body = <Problem {...problemFor(view)} />;
      break;
    case "offer": {
      const { offer } = view;
      body = (
        <>
          <h1 class="mb-1">
            {offer.text ? t.secret.offerTitle(offer.from) : t.receive.offerTitle(offer.from)}
          </h1>
          {offer.from && <p class="mt-0 text-muted-foreground">{t.receive.unverified}</p>}
          <FileBox
            offer={offer}
            aside={
              <div class="flex flex-none flex-col gap-2 sm:flex-row sm:items-center">
                {offer.text ? (
                  <Button type="button" size="lg" className="w-full sm:w-auto" onClick={onShow}>
                    <Icon name="eye" class="size-4" /> {t.secret.show}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="lg"
                    className="w-full sm:w-auto"
                    onClick={onAccept}
                    disabled={picking}
                  >
                    <Icon name="download" class="size-4" /> {t.receive.download}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  className="w-full sm:w-auto"
                  onClick={onDecline}
                  disabled={picking}
                >
                  {t.receive.decline}
                </Button>
              </div>
            }
          >
            {!offer.text && offer.size > BLOB_WARN_BYTES && !canPickSaveFile() && (
              <p class="m-0 text-muted-foreground">{t.receive.memoryWarning}</p>
            )}
          </FileBox>
          <p class={`-mt-2 ${caption}`}>{t.receive.onceNotice}</p>
          <Direct from={offer.from || t.common.sender} to={t.common.you} state="ready" />
          <p class={caption}>{t.receive.offerCaption(offer.from)}</p>
          {path && <PathLine path={path} />}
          <OfferDetails offer={offer} emailed={emailed} />
        </>
      );
      break;
    }
    case "receiving": {
      const { offer, bytes, left } = view;
      body = (
        <>
          <h1>{offer.text ? t.secret.receivingTitle : t.receive.receivingTitle}</h1>
          {!offer.text && (
            <FileBox offer={offer}>
              <div class="flex flex-col gap-1.5">
                <progress
                  class="w-full accent-primary"
                  aria-label={t.receive.progressLabel}
                  max={Math.max(offer.size, 1)}
                  value={offer.size === 0 ? 0 : bytes}
                />
                <div class="flex flex-wrap justify-between gap-x-4 text-[0.85rem] text-muted-foreground tabular-nums">
                  <span>{formatProgress(bytes, offer.size, lang)}</span>
                  {left !== undefined && <span>{formatTimeLeft(left, lang)}</span>}
                </div>
              </div>
            </FileBox>
          )}
          <Direct from={t.common.sender} to={t.common.you} state="active" />
          <p class={caption}>{t.receive.receivingCaption}</p>
          {path && <PathLine path={path} />}
        </>
      );
      break;
    }
    case "done": {
      const { offer, blob, sha256 } = view;
      const textBlob = offer.text ? blob : undefined;
      body = (
        <>
          <div class="flex items-center gap-2.5 text-primary">
            <Icon name="check" class="size-8 stroke-[2.5]" />
            <h1 class="m-0">{textBlob ? t.secret.doneTitle : t.receive.doneTitle}</h1>
          </div>
          {textBlob ? (
            <>
              <ShownText
                blob={textBlob}
                // RECEIPT already went out, so the link is spent: no Try again.
                onUnreadable={() => setView({ s: "refused", problem: "save", text: true })}
              />
              <p class="text-muted-foreground">{t.secret.notSaved}</p>
            </>
          ) : (
            <FileBox
              offer={offer}
              aside={blob && <SaveLink blob={blob} name={offer.name} label={t.receive.saveFile} />}
            >
              <div class="border-t border-border pt-4">
                <p class="m-0 flex items-start gap-2 font-medium">
                  <Icon name="check" class="mt-0.5 size-5" />
                  {t.receive.verified}
                </p>
                <p class="mt-1 mb-0 pl-7 text-muted-foreground">
                  {blob ? t.receive.autoDownload : t.receive.savedWhereChosen}
                </p>
              </div>
            </FileBox>
          )}
          <Direct from={t.common.sender} to={t.common.you} state="done" />
          <p class={caption}>{t.receive.doneCaption}</p>
          {path && <PathLine path={path} />}
          <OfferDetails offer={offer} sha256={textBlob ? undefined : sha256} emailed={emailed} />
        </>
      );
      break;
    }
    case "declined":
      body = (
        <>
          <h1>{view.text ? t.secret.declinedTitle : t.receive.declinedTitle}</h1>
          <p>{t.receive.declinedBody}</p>
          <Button type="button" variant="outline" onClick={startAgain}>
            {view.text ? t.secret.showAgain : t.receive.showAgain}
          </Button>
        </>
      );
      break;
    case "failed": {
      const problem = problemFor(view);
      body = (
        <>
          <Problem {...problem} />
          {/* A retry in the same browser fails the same way, and on a link with the safety number on it would use up one of the sender's attempts. */}
          {view.problem !== "browser" && (
            <Button type="button" onClick={startAgain}>
              {t.receive.tryAgain}
            </Button>
          )}
          {problem.detail && <TechDetails rows={[[t.receive.whatHappened, problem.detail]]} />}
        </>
      );
      break;
    }
  }
  return (
    <Page tall>
      {/* A new key per step makes its heading a new node, so moving focus there is announced. */}
      <Fragment key={view.s}>{body}</Fragment>
      <ReceiveBar
        view={view}
        traces={traces}
        visible={shown}
        notifyId={notifyId}
        canAskToNotify={canAskToNotify}
        notifyAnswer={notifyAnswer}
        onNotify={async () => {
          const answer = await askToNotify();
          if (answer !== "default") {
            setCanAskToNotify(false);
            setNotifyAnswer(answer === "granted" ? "on" : "blocked");
          }
        }}
      />
    </Page>
  );
}

/**
 * The page's bottom bar, like the send page's: what is happening now, Notify me while the
 * recipient waits, and the Traces button. Green once the file or secret has arrived.
 */
function ReceiveBar({
  view,
  traces,
  visible,
  notifyId,
  canAskToNotify,
  notifyAnswer,
  onNotify,
}: {
  view: View;
  traces: Log;
  visible: boolean;
  notifyId: string;
  canAskToNotify: boolean;
  notifyAnswer: "on" | "blocked" | undefined;
  onNotify(): void;
}) {
  const { t } = useI18n();
  const { bar } = t.receive;
  const secret = "offer" in view ? view.offer.text : "text" in view ? view.text === true : false;
  const words = secret ? t.secret : t.receive;
  const done = view.s === "done";
  // While the recipient waits for the sender or for the file, Notify me is worth offering.
  const waiting =
    view.s === "connecting" || view.s === "receiving" || (view.s === "check" && view.said === true);
  const [main, sub] = ((): [string, string | undefined] => {
    switch (view.s) {
      case "connecting":
        return [bar.connecting, t.send.keepOpen];
      case "verify":
        return [bar.verify, t.send.keepOpen];
      case "check":
        return [view.said ? bar.checkWaiting : bar.check, t.send.keepOpen];
      case "offer":
        return [bar.offer, undefined];
      case "receiving":
        return [words.receivingTitle, t.send.keepOpen];
      case "done":
        return [words.doneTitle, bar.checked];
      case "declined":
        return [words.declinedTitle, undefined];
      case "refused":
      case "failed":
        return [bar.stopped, undefined];
    }
  })();
  const progress =
    view.s === "done"
      ? 1
      : view.s === "receiving"
        ? view.offer.size === 0
          ? 0
          : view.bytes / view.offer.size
        : 0;
  return (
    <div
      data-bottom-bar
      data-page-bar
      // White on emerald-700 is 5.5:1.
      class={`fixed inset-x-0 bottom-0 z-40 overflow-hidden bg-background/80 px-4 py-1.5 backdrop-blur-xl transition-colors duration-700 motion-reduce:transition-none ${done ? "text-white" : ""}`}
    >
      {/* The green that takes the bar once the file or secret has arrived, as on the send page. */}
      <div
        class={`absolute inset-x-0 top-0 h-[170%] bg-linear-to-b from-emerald-700 from-60% to-transparent transition-transform duration-700 ease-out motion-reduce:transition-none ${done ? "translate-y-0" : "-translate-y-full"}`}
        aria-hidden="true"
      />
      {/* The bar's top edge: a track that fills while the file arrives and stays full once done. */}
      <div class="absolute inset-x-0 top-0 h-1 bg-border" aria-hidden="true">
        {progress > 0 && (
          <div
            class={`h-full transition-[width,background-color] motion-reduce:transition-none ${done ? "bg-emerald-400" : "bg-emerald-600"}`}
            style={{ width: `${progress * 100}%` }}
          />
        )}
      </div>
      <div class="relative mx-auto flex min-h-[3.95rem] max-w-xl items-center gap-2 sm:gap-3">
        {/* The step's heading says the same, so this is no live region. */}
        <p class="m-0 flex min-w-0 flex-1 items-center gap-3 text-[0.9rem] leading-snug font-medium hyphens-auto wrap-anywhere">
          {done ? (
            <Icon name="check" class="size-4 flex-none" />
          ) : (
            <span class="flex size-4 flex-none items-center justify-center" aria-hidden="true">
              <span
                class={
                  waiting
                    ? "size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
                    : "size-2 rounded-full bg-muted-foreground"
                }
              />
            </span>
          )}
          <span>
            <span class="block">{main}</span>
            {sub && (
              <span class={`block font-normal ${done ? "" : "text-muted-foreground"}`}>{sub}</span>
            )}
          </span>
        </p>
        {/* Notify me and the browser's answer share one grid cell, the hidden one keeping its
            space, so the bar's text doesn't move as they swap. */}
        {(canAskToNotify || notifyAnswer) && (
          <div class="grid flex-none items-center justify-items-end">
            <Button
              id={`${notifyId}-me`}
              type="button"
              variant="outline"
              size="sm"
              // A bell alone on a phone, the bell and the words from sm up, as on the send page.
              className={`col-start-1 row-start-1 size-9 px-0 sm:h-7 sm:w-auto sm:px-2.5 ${waiting && canAskToNotify ? "" : "invisible"}`}
              title={t.send.notifyMe}
              onClick={onNotify}
            >
              <Icon name="bell" class="size-4" />
              <span class="sr-only sm:not-sr-only">{t.send.notifyMe}</span>
            </Button>
            {notifyAnswer && (
              // Takes the focus the button held, and tells the recipient what the browser answered.
              <p
                id={`${notifyId}-answer`}
                tabIndex={-1}
                role="status"
                class={`col-start-1 row-start-1 m-0 w-max max-w-28 text-right text-[0.8rem] leading-tight ${canAskToNotify || done ? "invisible" : ""} text-muted-foreground`}
              >
                {notifyAnswer === "on" ? t.send.notifyOn : t.send.notifyBlocked}
              </p>
            )}
          </div>
        )}
        {/* The file's name never shows in the traces; its size and type are on the page already. */}
        <TraceDrawer onGreen={done} visible={visible} traces={traces} facts={[]} />
      </div>
    </div>
  );
}

/** Moves focus to the step's heading so a screen reader announces it. */
function focusHeading(): void {
  const heading = document.querySelector<HTMLElement>("#receive h1");
  if (!heading) {
    return;
  }
  heading.tabIndex = -1;
  heading.focus();
}

/** This tab's token for an emailed link. Storage that is blocked acts as empty. */
function readToken(linkId: string): string | undefined {
  try {
    const token = sessionStorage.getItem(`token:${linkId}`);
    return isLinkId(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

function storeToken(linkId: string, token: string | undefined): void {
  try {
    if (token === undefined) {
      sessionStorage.removeItem(`token:${linkId}`);
    } else {
      sessionStorage.setItem(`token:${linkId}`, token);
    }
  } catch {
    // Not kept: this attempt still joins, and a reload asks for a new code.
  }
}

function OfferDetails({
  offer,
  sha256,
  emailed,
}: {
  offer: Offer;
  sha256?: string | undefined;
  emailed: boolean;
}) {
  const { t } = useI18n();
  const rows: Array<readonly [string, ComponentChildren]> = offer.text
    ? []
    : [
        [t.common.size, t.format.bytes(offer.size)],
        [t.common.type, offer.type || t.common.typeMissing],
      ];
  rows.push([
    t.receive.encryptionLabel,
    emailed ? t.receive.encryptionEmailed : t.receive.encryption,
  ]);
  if (sha256) {
    rows.push([t.receive.sha256Checked, <code key="sha256">{sha256}</code>]);
  }
  return <TechDetails rows={rows} />;
}

/** A received text, as plain text outside any form field so session restore has none of it to save, with a button that copies it. */
function ShownText({ blob, onUnreadable }: { blob: Blob; onUnreadable(): void }) {
  const { t } = useI18n();
  const [text, setText] = useState<string | undefined>(undefined);
  const { note, copy } = useCopyNote();

  useEffect(() => {
    void decodeText(blob).then(setText, onUnreadable);
  }, [blob]);

  return (
    <div class="my-4 flex flex-col gap-3">
      <section
        class="max-h-[66dvh] overflow-y-auto rounded-lg border border-input px-2.5 py-2 text-base transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
        aria-label={t.secret.textLabel}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the box scrolls, so keyboard users must reach it.
        tabIndex={0}
        translate={false}
        // Select-all would take the whole page, which is not a form field: keep it to the text.
        // The phone menu's Select All still takes the page: only user-select: all would stop
        // it, and that removes partial selection, while the Copy button already copies it all.
        onKeyDown={(e) => {
          // Shift or Alt with A is another shortcut, such as tab search; toLowerCase keeps Caps Lock working.
          const ctrlOrCmdOnly = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey;
          // A Cyrillic or Greek layout gives another key for the A key, which browsers still take
          // as select-all. A Latin letter there is its own shortcut, such as Ctrl+Q on AZERTY.
          const isA = e.key.toLowerCase() === "a" || (e.code === "KeyA" && !/^[a-z]$/i.test(e.key));
          if (ctrlOrCmdOnly && isA) {
            e.preventDefault();
            getSelection()?.selectAllChildren(e.currentTarget);
          }
        }}
      >
        <pre class="whitespace-pre-wrap wrap-anywhere">{text}</pre>
      </section>
      <div class="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => text !== undefined && copy(text)}
          disabled={text === undefined}
        >
          <SwapLabel
            idle={t.secret.copy}
            active={t.secret.copyNote.copied}
            on={note === "copied"}
          />
        </Button>
        <span
          class={`text-[0.85rem] text-muted-foreground ${note === "copied" ? "sr-only" : ""}`}
          role="status"
        >
          {note && t.secret.copyNote[note]}
        </span>
      </div>
    </div>
  );
}

/** Starts the download once by itself, and stays as a button in case the browser blocked that. */
function SaveLink({ blob, name, label }: { blob: Blob; name: string; label: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  const anchor = useRef<HTMLAnchorElement>(null);
  useEffect(() => anchor.current?.click(), [url]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    // cn drops the base `border-transparent`, which would otherwise hide the outline's border.
    <a ref={anchor} class={cn(buttonVariants({ variant: "outline" }))} href={url} download={name}>
      {label}
    </a>
  );
}
