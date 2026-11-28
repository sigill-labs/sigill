// The sender page: choose a file (or, in secret mode, paste a text that goes as
// one), add named recipients, share each one's link, and send it to every
// recipient who opens their link.
//
// Wiring (see lib/peer.ts and lib/sender-state.ts):
// - On mount, connect to the signaling server and host every link ID on the
//   list, with whether recipients may use our TURN relay; re-host the full
//   list whenever the hosted links change (an add, a remove, a link the check locked, or a
//   link replaced after a refused email), every change of the relay checkbox and
//   every reconnect, and again REHOST_AFTER_MS after `already-hosted` while
//   the server still holds the old socket. When the socket drops, recipients
//   still connecting go back to waiting (reducer `server-lost`, which never
//   blames the relay); the page says the server is gone
//   only after LOST_AFTER_MS without it.
// - Server `joined` → reducer `joined`, whose `start` effect derives the
//   link's signal key and creates a sender peer with the ICE servers from
//   `joined`, without TURN entries when the relay checkbox or the server
//   refused it. `relay` goes to that peer. A `joined` with the attempt ID of
//   a transfer in progress is that recipient asking again after its
//   connection dropped (decision 0031): the reducer's `restart` effect hands
//   the new ICE servers, filtered the same way, to that peer's `rejoined`.
//   `left` → reducer `left`, which only matters before the channel opens, once
//   the signals relayed before it were handled.
// - When the data channel opens, sendFile runs the transfer and reports
//   accepted, progress, declined and receipt back to the reducer.
// - In secret mode, a connection whose max message size can't carry every text in
//   one chunk (textFitsOneChunk) gets no META: reducer `unsendable` fails the
//   recipient's card and refuses the joiner. Without the check that happens as
//   the channel opens, before INIT; with it, sendFile sends INIT and runs the
//   check first and ends with `too-small` once both confirmed, as a file would
//   get that far, so a link's holder can't tell a secret from a file before that.
// - A peer that closes on another frame version → `outdated`; onClose here, not the reducer,
//   refuses the joiner at the join deadline, so a joiner still bound then is unbound as a silent one is.
// - A peer that closes or fails before delivery → `dropped`; a data channel
//   that has not opened SETUP_TIMEOUT_MS after the join, or a safety number
//   not confirmed CHECK_TIMEOUT_MS after it opened → `timeout`. Both refuse
//   the joiner so the server unbinds it (see sender-state.ts).
// - Each connection reports its path to the server once: direct, stun or
//   relay when the channel opens, failed on an ICE failure or a timeout. A
//   relay path on an active attempt whose relay the sender refused
//   (refusesRelay) counts as failed too, and the reducer then ends the
//   attempt. An open channel's path also goes to the reducer, for the
//   recipient's card, and so does the path read again after a recovery
//   (onPath), which is not reported to the server a second time.
// - Effects run outside render: `close` tears the peer down, `refuse` tells
//   the server to refuse the joiner.
// - When the server's `hello` says it can send mail, the add form offers an
//   email address. Adding a recipient with one sends a single `email` message
//   after the `host` that includes its link; the server's `email` replies go
//   to the reducer. Its card offers no link until the server answers, then
//   the marked link the server emailed. If the server refused without a mark,
//   it still saw the secret, so the card gets a fresh plain link and the page
//   hosts that instead (reducer `email`); only the page's own `failed`, when
//   its socket was closed and nothing was sent, keeps the first link. A
//   reconnect never hosts an emailed link again (reducer `server-lost`),
//   except one whose attempt the new socket takes back (below).
// - Once a recipient's connection opened, the server sends `resume` with a
//   token for the sender's side of that attempt (decision 0033), kept only in
//   memory, per link and attempt, and replaced by each new one. A dropped
//   socket leaves a recipient whose attempt has a token as it is (reducer
//   `server-lost` with `armed`): the server holds the attempt and its email
//   binding. The new socket first sends `resume` for each such attempt, once
//   per token, and sends `host` only once the server answered them all, so a
//   link the server refused is never hosted on it. A `resume` with a token
//   keeps the attempt; one without, or a socket that closes before the
//   answer, makes the reducer do what `server-lost` would have done
//   (`resume-refused`).
// - A socket can die without closing, when the network under it changes. So
//   when an open connection goes "disconnected", the page sends the same
//   `host` again: on a dead socket the write draws a reset that closes it,
//   and the new socket takes the attempts back. On a live one the server
//   changes nothing and logs nothing.
//
// Names, the file or text and link secrets stay in this tab. The server only ever
// gets link IDs, attempt IDs, opaque sealed signals, refusal reasons,
// connection paths and the relay choice, except that an emailed link's one
// `email` message carries its address, its secret and the sender's typed
// name (decision 0012). Recipient names never leave this tab.

import {
  type ConnectionPath,
  type IceServer,
  isAddress,
  MAX_ADDRESS,
  MAX_LINKS,
} from "@fidant/protocol";
import { useEffect, useReducer, useRef, useState } from "preact/hooks";
import { Alert, AlertDescription } from "#components/ui/alert";
import { Button, buttonVariants } from "#components/ui/button";
import { Input } from "#components/ui/input";
import { Label } from "#components/ui/label";
import type { Messages } from "../i18n/en.ts";
import { useI18n } from "../i18n/I18n.tsx";
import type { TransferStatus } from "../lib/favicon.ts";
import { formatBytes, toHex } from "../lib/format.ts";
import { hasForbiddenCharacters, MAX_FROM_LENGTH, metaFits } from "../lib/frames.ts";
import { deriveSignalKey } from "../lib/keys.ts";
import { createLink } from "../lib/link.ts";
import { askToNotify, notify, notifyPermission } from "../lib/notify.ts";
import { createSenderPeer, type OpenPath, type Peer } from "../lib/peer.ts";
import { hashFile, sendFile } from "../lib/send-file.ts";
import {
  armedLinks,
  CHECK_TIMEOUT_MS,
  emailBound,
  findRecipient,
  hostedLinks,
  initialSenderState,
  isActive,
  refusesRelay,
  SETUP_TIMEOUT_MS,
  type SenderAction,
  type SenderEffect,
  type SenderState,
  update,
} from "../lib/sender-state.ts";
import { addRelay, NO_RELAYS } from "../lib/server-facts.ts";
import { connectSignaling, type SignalingClient } from "../lib/signaling-client.ts";
import { MAX_TEXT_BYTES, MAX_TEXT_LENGTH, textFile, textFitsOneChunk } from "../lib/text-secret.ts";
import {
  FILE_HREF,
  field,
  formRows,
  Icon,
  Link,
  lede,
  Page,
  SECRET_HREF,
  ServerDrawer,
} from "../ui.tsx";
import { type CheckView, RecipientList } from "./RecipientList.tsx";

type Hash =
  | { status: "none" }
  | { status: "preparing" }
  | { status: "ready"; hex: string }
  | { status: "failed" };

/** What the page's status region says, kept as data so its text follows a language switch. */
type Cue = { kind: "file"; name: string; size: number } | { kind: "links" } | null;

type Connection = {
  abort: AbortController;
  peer?: Peer;
  /** Relayed signals that arrived before the peer existed, such as the recipient's commit. */
  early: string[];
  /** The handling of the last relayed signal, which a `left` waits for. */
  relayed?: Promise<void>;
  /** With the safety number on: the sender's own verdict, from the card's buttons. */
  confirm?: (matches: boolean) => void;
  /** What the sender said about the safety number, once they said it. */
  said?: boolean;
  /** Fires `timeout` if the data channel has not opened in time, and later the 5-minute check deadline. */
  deadline?: ReturnType<typeof setTimeout>;
  /** Set once the connection's path went to the server. */
  pathSent?: boolean;
  /** Applies a `left` that waits for the last relayed signal to be handled. */
  pendingLeft?: () => void;
};

// Errors are kept as keys and turned into text in render, so they follow a language switch.
type ErrorOf<K extends "fromError" | "fileError" | "nameError"> = keyof Messages["send"][K] | "";

/** How long the server may stay unreachable before the page says so. */
const LOST_AFTER_MS = 10_000;
/** How long to wait before hosting again when the server still holds a link for our old socket. */
const REHOST_AFTER_MS = 5000;

const fieldError = "m-0 text-destructive";
const hint = "text-[0.9rem] text-muted-foreground";
const stepLabel = "m-0 mb-1 text-[0.85rem] font-medium text-muted-foreground";
const GLIDE_MS = 450;
/** On the last open step: tall enough to the page's end that a glide always brings its top to its scroll margin. Step 3 takes it over from step 2, so the page doesn't shrink and jump when the first link opens step 3. */
const lastStep = "min-h-[calc(100dvh-4rem)]";

/** Scrolls the window to `el` with an ease-in-out curve; stops if the user scrolls, jumps if they prefer less motion. */
function glideTo(el: HTMLElement) {
  const offset = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const goal = () => el.getBoundingClientRect().top + scrollY - offset;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    scrollTo({ top: goal(), behavior: "instant" });
    return;
  }
  const from = scrollY;
  const start = performance.now();
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const events = ["wheel", "touchstart", "keydown"] as const;
  for (const name of events) {
    addEventListener(name, stop, { once: true, passive: true });
  }
  const step = (now: number) => {
    const t = Math.min((now - start) / GLIDE_MS, 1);
    const eased = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
    if (!stopped) {
      scrollTo({ top: from + (goal() - from) * eased, behavior: "instant" });
    }
    if (t < 1 && !stopped) {
      requestAnimationFrame(step);
    } else {
      for (const name of events) {
        removeEventListener(name, stop);
      }
    }
  };
  requestAnimationFrame(step);
}

/**
 * A state the dev panel (src/dev) puts the page in. While one is set the page connects to nothing,
 * and each new one replaces the page's state in place, so the change shows as it would live.
 */
export type SendPreview = {
  file?: File | undefined;
  /** The text in the box. */
  text?: string;
  hash?: Hash;
  sender?: SenderState;
  checks?: Readonly<Record<string, CheckView>>;
  lostServer?: boolean;
  /** The server sends mail, so the form offers the email choice. */
  mail?: boolean;
  useEmail?: boolean;
  mailed?: boolean;
  viaRelay?: boolean;
  from?: string;
  fileError?: ErrorOf<"fileError">;
  nameError?: ErrorOf<"nameError">;
  fromError?: ErrorOf<"fromError">;
  emailError?: boolean;
  /** The sender clicked Continue, so step 2 shows. Defaults to whether the list has a link. */
  continued?: boolean;
};

export function SendPage({
  kind,
  onStatus,
  preview,
  shown = true,
}: {
  kind: "file" | "text";
  /** False while the page sits hidden: its safety-number dialog stays closed. */
  shown?: boolean;
  /** Told "active" while any recipient is unfinished, the same test that guards closing the tab, and "done" once all have the file or text. */
  onStatus(status: TransferStatus): void;
  preview?: SendPreview | undefined;
}) {
  const { t, lang } = useI18n();
  const text = kind === "text";
  // Both kinds can be mounted at once, so the text page prefixes its element IDs.
  const id = (name: string) => (text ? `secret-${name}` : name);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [hash, setHash] = useState<Hash>({ status: "none" });
  const [sender, setSender] = useState<SenderState>(initialSenderState);
  const [lostServer, setLostServer] = useState(false);
  const [relayed, countRelay] = useReducer(addRelay, NO_RELAYS);
  const [viaRelay, setViaRelay] = useState(false);
  const [nameError, setNameError] = useState<ErrorOf<"nameError">>("");
  const [mail, setMail] = useState(false);
  // Emailing a link is opt-in: until the sender ticks it, there is no email field.
  const [useEmail, setUseEmail] = useState(false);
  // Each open check's number, by link ID: on screen only, gone with its connection.
  const [checks, setChecks] = useState<Readonly<Record<string, CheckView>>>({});
  const [emailError, setEmailError] = useState(false);
  // ponytail: sticky for the page, since the server saw the key and keeps email counts for an hour
  const [mailed, setMailed] = useState(false);
  const [fileError, setFileError] = useState<ErrorOf<"fileError">>("");
  const [from, setFrom] = useState("");
  const [fromError, setFromError] = useState<ErrorOf<"fromError">>("");
  const [allowRelay, setAllowRelay] = useState(true);
  const [textLength, setTextLength] = useState(0);
  const [canAskToNotify, setCanAskToNotify] = useState(false);
  // Step 2 appears on Continue and stays: its links outlive any later change to step 1.
  const [continued, setContinued] = useState(false);
  // Screen readers hear it; focus moves on, so nothing else would say what happened.
  const [cue, setCue] = useState<Cue>(null);
  const [notifyAnswer, setNotifyAnswer] = useState<"on" | "blocked" | undefined>(undefined);
  // When the answer replaces the button, it takes the focus the button (or nothing) held.
  useEffect(() => {
    const active = document.activeElement;
    if (
      notifyAnswer &&
      (active === document.body || active === document.getElementById(id("notify-me")))
    ) {
      document.getElementById(id("notify-answer"))?.focus();
    }
  }, [notifyAnswer]);

  // Mutable state used from network callbacks, outside render.
  const senderRef = useRef<SenderState>(initialSenderState);
  // Set when the first recipient is added; the name field stays locked while anyone is on the list.
  const fromRef = useRef("");
  const allowRelayRef = useRef(true);
  const fileRef = useRef<{ file: File; sha256: Promise<Uint8Array> } | undefined>(undefined);
  const hashAbortRef = useRef<AbortController | undefined>(undefined);
  const signalingRef = useRef<SignalingClient | undefined>(undefined);
  const connectionsRef = useRef(new Map<string, Connection>());
  const dispatchRef = useRef<(action: SenderAction) => void>(() => {});
  const refusalsRef = useRef(new Set<ReturnType<typeof setTimeout>>());
  // Decision 0033: each link's unsent resume token and the attempt it is for, only in memory and
  // never logged; and the links whose `resume` went out on this socket and wait for an answer.
  const tokensRef = useRef(new Map<string, { attempt: string; token: string }>());
  const resumingRef = useRef(new Set<string>());

  const host = () => {
    // The last answer to a `resume` hosts, once the server said which links it gave back.
    if (resumingRef.current.size > 0) {
      return;
    }
    signalingRef.current?.send({
      t: "host",
      links: hostedLinks(senderRef.current),
      turn: allowRelayRef.current,
    });
  };

  const closeConnection = (linkId: string) => {
    const connection = connectionsRef.current.get(linkId);
    if (!connection) {
      return;
    }
    connectionsRef.current.delete(linkId);
    setChecks((all) => {
      if (!Object.hasOwn(all, linkId)) {
        return all;
      }
      const { [linkId]: _closed, ...rest } = all;
      return rest;
    });
    clearTimeout(connection.deadline);
    connection.abort.abort(new Error("connection closed"));
    connection.peer?.close();
  };

  const sendPath = (linkId: string, connection: Connection, path: ConnectionPath) => {
    if (!connection.pathSent) {
      connection.pathSent = true;
      signalingRef.current?.send({ t: "path", link: linkId, path });
    }
  };

  const startConnection = async (linkId: string, attempt: string, iceServers: IceServer[]) => {
    const recipient = findRecipient(senderRef.current, linkId);
    const signaling = signalingRef.current;
    if (!recipient || !signaling) {
      return;
    }
    closeConnection(linkId);
    tokensRef.current.delete(linkId);
    const joinedAt = performance.now();
    const connection: Connection = { abort: new AbortController(), early: [] };
    connectionsRef.current.set(linkId, connection);
    const dispatch = (action: SenderAction) => dispatchRef.current(action);
    // Someone who knows the link ID but not the secret can join and stay
    // silent; the reducer then refuses them so the link is free again.
    connection.deadline = setTimeout(() => {
      if (connectionsRef.current.get(linkId) === connection) {
        sendPath(linkId, connection, "failed");
        dispatch({ type: "timeout", linkId });
      }
    }, SETUP_TIMEOUT_MS);

    let signalKey: CryptoKey;
    try {
      signalKey = await deriveSignalKey(recipient.secret, linkId);
    } catch {
      console.warn("fidant: sender dropped a connection: signal-key");
      dispatch({ type: "dropped", linkId });
      return;
    }
    if (connection.abort.signal.aborted) {
      return;
    }

    // The path may come after a short transfer already closed the
    // connection; send it while the link is still hosted.
    const onPath = (path: OpenPath) => {
      const latest = findRecipient(senderRef.current, linkId);
      if (latest) {
        const refused = refusesRelay(latest, attempt, path);
        sendPath(linkId, connection, refused ? "failed" : path);
        dispatch({ type: "path", linkId, attempt, path });
        // ponytail: sticky for the page, since the relay's log lines stay after the transfer
        if (path === "relay" && !refused) {
          setViaRelay(true);
        }
      }
    };
    connection.peer = createSenderPeer({
      signaling,
      linkId,
      attempt,
      signalKey,
      iceServers,
      check: recipient.check === true,
      onPath,
      // The same `host` again surfaces a socket that died without closing (decision 0033).
      onDisconnected: () => {
        if (connectionsRef.current.get(linkId) === connection) {
          host();
        }
      },
      onOpen(channel, info) {
        clearTimeout(connection.deadline);
        void info.path.then(onPath);
        // Judged by the longest text, so a refusal says nothing about this text's length.
        // With the check on, sendFile refuses after both confirmed instead, so a
        // link's holder can't tell a secret from a file before that.
        if (text && !info.check && !textFitsOneChunk(info.maxMessageSize)) {
          dispatch({ type: "unsendable", linkId });
          return;
        }
        dispatch({ type: "channel-open", linkId });
        const chosen = fileRef.current;
        if (!chosen) {
          dispatch({ type: "dropped", linkId });
          return;
        }
        const confirm = info.check
          ? new Promise<boolean>((resolve) => {
              connection.confirm = resolve;
            })
          : undefined;
        if (confirm) {
          void info.checkNumber.then((number) => {
            if (connectionsRef.current.get(linkId) === connection) {
              setChecks((all) => ({ ...all, [linkId]: { number } }));
            }
          });
          connection.deadline = setTimeout(() => {
            if (connectionsRef.current.get(linkId) === connection) {
              dispatch({ type: "timeout", linkId });
            }
          }, CHECK_TIMEOUT_MS);
        }
        sendFile({
          channel,
          maxMessageSize: info.maxMessageSize,
          file: chosen.file,
          from: fromRef.current,
          secret: recipient.secret,
          attempt,
          sha256: chosen.sha256,
          signal: connection.abort.signal,
          ...(text && { minChunkBytes: MAX_TEXT_BYTES }),
          ...(confirm && {
            confirm,
            onChecked: () => {
              clearTimeout(connection.deadline);
              dispatch({ type: "checked", linkId });
            },
          }),
          onAccepted: () => dispatch({ type: "accepted", linkId }),
          onProgress: (bytesSent) => dispatch({ type: "progress", linkId, bytesSent }),
        }).then(
          (result) => {
            if (result.type === "check-differs") {
              dispatch({ type: "check-differs", linkId });
            } else if (result.type === "declined") {
              dispatch({ type: "declined", linkId });
            } else if (result.type === "receipt") {
              dispatch({ type: "receipt", linkId, match: result.match });
            } else if (result.type === "too-small") {
              dispatch({ type: "unsendable", linkId });
            }
          },
          () => {
            if (!connection.abort.signal.aborted) {
              dispatch({ type: "dropped", linkId });
            }
          },
        );
      },
      onClose(reason, _detail, name) {
        console.warn(`fidant: sender dropped a connection: ${reason}${name ? ` (${name})` : ""}`);
        if (reason === "connection-failed") {
          sendPath(linkId, connection, "failed");
        }
        if (reason === "outdated" || reason === "peer-outdated") {
          const older = reason === "outdated" ? "sender" : "recipient";
          dispatch({ type: "outdated", linkId, older });
          // Outlives closeConnection: a recipient page that saw the mismatch has left by then; any other joiner is unbound.
          const refusal = setTimeout(
            () => {
              refusalsRef.current.delete(refusal);
              if (hostedLinks(senderRef.current).includes(linkId)) {
                signalingRef.current?.send({ t: "refuse", link: linkId, attempt, reason: "drop" });
              }
            },
            Math.max(0, joinedAt + SETUP_TIMEOUT_MS - performance.now()),
          );
          refusalsRef.current.add(refusal);
          return;
        }
        // After "It differs" the recipient closes the channel as it should.
        dispatch({ type: connection.said === false ? "check-differs" : "dropped", linkId });
      },
    });
    for (const data of connection.early.splice(0)) {
      connection.relayed = connection.peer.handleRelay(data);
    }
  };

  const runEffect = (effect: SenderEffect) => {
    switch (effect.type) {
      case "start":
        void startConnection(effect.linkId, effect.attempt, effect.iceServers);
        break;
      case "restart":
        connectionsRef.current.get(effect.linkId)?.peer?.rejoined(effect.iceServers);
        break;
      case "close":
        closeConnection(effect.linkId);
        break;
      case "refuse":
        signalingRef.current?.send({
          t: "refuse",
          link: effect.linkId,
          attempt: effect.attempt,
          reason: effect.reason,
        });
        break;
    }
  };

  // Applies an action, then carries out its effects. Never called during render.
  dispatchRef.current = (action: SenderAction) => {
    const hosted = hostedLinks(senderRef.current).join();
    const next = update(senderRef.current, action);
    const changed = next.state !== senderRef.current;
    if (changed) {
      senderRef.current = next.state;
      setSender(next.state);
    }
    // Only fixed text and counts: the system keeps a notification outside the page.
    if (changed && action.type === "receipt" && action.match) {
      const { recipients } = next.state;
      const done = recipients.filter((r) => r.status === "delivered").length;
      const all = done === recipients.length;
      const words = text ? t.secret : t.send;
      notify(
        all ? t.send.doneTitle : t.send.delivered,
        all ? `${words.allDone}. ${t.send.closeTab}.` : words.summary(done, recipients.length),
      );
    }
    for (const effect of next.effects) {
      runEffect(effect);
    }
    // Adding, removing, a check locking a link or a refused email replacing a link
    // changes what to host.
    if (hostedLinks(next.state).join() !== hosted) {
      host();
    }
  };

  const onCheck = (linkId: string, matches: boolean) => {
    const connection = connectionsRef.current.get(linkId);
    if (connection) {
      connection.said = matches;
      connection.confirm?.(matches);
    }
    setChecks((all) => {
      const view = all[linkId];
      return view ? { ...all, [linkId]: { ...view, said: matches } } : all;
    });
  };

  const onLater = (linkId: string, later: boolean) =>
    setChecks((all) => {
      const view = all[linkId];
      return view ? { ...all, [linkId]: { ...view, later } } : all;
    });

  // Runs on mount, and again when a dev preview starts or ends. The cleanup
  // closes the connection when a preview starts. Production never passes a
  // preview. Everything it uses is read through refs.
  useEffect(() => {
    if (preview) {
      return;
    }
    const signaling = connectSignaling({ onRelay: countRelay });
    signalingRef.current = signaling;
    let disposed = false;
    const dispatch = (action: SenderAction) => dispatchRef.current(action);
    const clearRefusals = () => {
      for (const refusal of refusalsRef.current) {
        clearTimeout(refusal);
      }
      refusalsRef.current.clear();
    };

    let lost: ReturnType<typeof setTimeout> | undefined;
    let rehost: ReturnType<typeof setTimeout> | undefined;

    signaling.onOpen(() => {
      clearTimeout(lost);
      lost = undefined;
      setLostServer(false);
      // Take back each held attempt before `host`, which then names its link on this socket too.
      const tokens = tokensRef.current;
      const armed = armedLinks(senderRef.current, tokens);
      for (const [linkId, { attempt, token }] of [...tokens]) {
        tokens.delete(linkId);
        if (
          armed.includes(linkId) &&
          signaling.send({ t: "resume", link: linkId, attempt, token })
        ) {
          resumingRef.current.add(linkId);
        }
      }
      host();
    });
    signaling.onClose(({ byClient }) => {
      if (byClient || disposed) {
        return;
      }
      // A `resume` this socket never answered may have been refused: the token is spent either way.
      const unanswered = [...resumingRef.current];
      resumingRef.current.clear();
      for (const linkId of unanswered) {
        dispatch({ type: "resume-refused", linkId });
      }
      // The server forgot these joins with the socket, except the attempts it holds for a takeover;
      // the other recipients will join again.
      dispatch({ type: "server-lost", armed: armedLinks(senderRef.current, tokensRef.current) });
      // Short drops (a server restart) reconnect quietly.
      lost ??= setTimeout(() => setLostServer(true), LOST_AFTER_MS);
    });
    signaling.subscribe((message) => {
      switch (message.t) {
        case "joined":
          // Keeps socket order: a `left` still waiting on a signal is applied before this join.
          connectionsRef.current.get(message.link)?.pendingLeft?.();
          dispatch({
            type: "joined",
            linkId: message.link,
            attempt: message.attempt,
            iceServers: message.iceServers,
            turn: message.turn,
            allowRelay: allowRelayRef.current,
          });
          break;
        case "left": {
          const linkId = message.link;
          const connection = connectionsRef.current.get(linkId);
          if (!connection?.relayed) {
            dispatch({ type: "left", linkId });
            break;
          }
          // A signal relayed before `left` may close the peer with the reason the recipient left.
          const apply = () => {
            delete connection.pendingLeft;
            if (connectionsRef.current.get(linkId) === connection) {
              dispatch({ type: "left", linkId });
            }
          };
          connection.pendingLeft = apply;
          void connection.relayed.then(() => connection.pendingLeft === apply && apply());
          break;
        }
        case "resume": {
          const linkId = message.link;
          const answered = resumingRef.current.has(linkId);
          if (message.token !== undefined) {
            // A token for the attempt in progress: from its arming, or the answer to our `resume`.
            if (findRecipient(senderRef.current, linkId)?.attempt === message.attempt) {
              tokensRef.current.set(linkId, { attempt: message.attempt, token: message.token });
            }
          } else if (answered) {
            // The link still counts as waiting, so the reducer's change hosts nothing yet, and
            // the `host` below leaves out the link it unbound.
            dispatch({ type: "resume-refused", linkId });
          }
          if (answered) {
            resumingRef.current.delete(linkId);
            if (resumingRef.current.size === 0) {
              host();
            }
          }
          break;
        }
        case "hello":
          setMail(message.mail);
          break;
        case "email":
          dispatch({
            type: "email",
            linkId: message.link,
            status: message.status,
            mark: message.mark,
            // A refusal without a mark came after the server got the secret: never share that link.
            ...(message.mark === undefined &&
            (message.status === "limit" || message.status === "failed")
              ? { fresh: createLink(location.origin) }
              : {}),
          });
          break;
        case "relay": {
          const connection = connectionsRef.current.get(message.link);
          if (connection?.peer) {
            connection.relayed = connection.peer.handleRelay(message.data);
          } else {
            connection?.early.push(message.data);
          }
          break;
        }
        case "error":
          // After a reconnect the server may not have noticed the old socket close yet.
          if (message.code === "already-hosted") {
            clearTimeout(rehost);
            rehost = setTimeout(host, REHOST_AFTER_MS);
          }
          break;
        default:
          break;
      }
    });

    // Closing the tab ends every transfer, so ask first while any is unfinished.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (senderRef.current.recipients.some((r) => r.status !== "delivered")) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    // Once the page is really going, close the peers so recipients hear it now, not when ICE
    // consent runs out about 15 s later. Unless the page may come back from the back-forward
    // cache, also close signaling with 1000, so the server frees every attempt at once instead
    // of holding it for a takeover (0033).
    const onPageHide = (event: PageTransitionEvent) => {
      clearRefusals();
      for (const linkId of [...connectionsRef.current.keys()]) {
        closeConnection(linkId);
      }
      if (!event.persisted) {
        signaling.close();
      }
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      tokensRef.current.clear();
      resumingRef.current.clear();
      clearTimeout(lost);
      clearTimeout(rehost);
      clearRefusals();
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      hashAbortRef.current?.abort();
      for (const linkId of [...connectionsRef.current.keys()]) {
        closeConnection(linkId);
      }
      signaling.close();
    };
  }, [preview === undefined]);

  useEffect(() => {
    if (!preview) {
      return;
    }
    const state = preview.sender ?? initialSenderState;
    senderRef.current = state;
    setSender(state);
    setFile(preview.file);
    setHash(preview.hash ?? { status: "none" });
    setChecks(preview.checks ?? {});
    setLostServer(preview.lostServer ?? false);
    setViaRelay(preview.viaRelay ?? false);
    setMail(preview.mail ?? false);
    setUseEmail(preview.useEmail ?? false);
    setMailed(preview.mailed ?? false);
    setFrom(preview.from ?? "");
    setFileError(preview.fileError ?? "");
    setNameError(preview.nameError ?? "");
    setFromError(preview.fromError ?? "");
    setEmailError(preview.emailError ?? false);
    setTextLength(preview.text?.length ?? 0);
    setContinued(preview.continued ?? state.recipients.length > 0);
    // The box is not a controlled field, so its text is set here.
    const box = document.getElementById("secret-text");
    if (text && box instanceof HTMLTextAreaElement) {
      box.value = preview.text ?? "";
    }
  }, [preview]);

  const prepare = (chosen: File | undefined) => {
    hashAbortRef.current?.abort(new Error("a different file was chosen"));
    hashAbortRef.current = undefined;
    setFile(chosen);
    if (!chosen) {
      fileRef.current = undefined;
      setHash({ status: "none" });
      return;
    }
    const controller = new AbortController();
    hashAbortRef.current = controller;
    const sha256 = hashFile(chosen, controller.signal);
    // Hashed once; every recipient's transfer awaits the same promise.
    fileRef.current = { file: chosen, sha256 };
    setHash({ status: "preparing" });
    sha256.then(
      (digest) => {
        if (!controller.signal.aborted) {
          setHash({ status: "ready", hex: toHex(digest) });
        }
      },
      () => {
        if (!controller.signal.aborted) {
          setHash({ status: "failed" });
        }
      },
    );
  };

  const onFileChange = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const chosen = input.files?.[0];
    const unsafe =
      !!chosen && (hasForbiddenCharacters(chosen.name) || hasForbiddenCharacters(chosen.type));
    const fits = !chosen || (!unsafe && metaFits(chosen));
    setFileError(fits ? "" : unsafe ? "unsafe" : "tooLong");
    // Clear the input so it does not show a file that will not be sent.
    if (!fits) {
      input.value = "";
    }
    prepare(fits ? chosen : undefined);
    setCue(fits && chosen ? { kind: "file", name: chosen.name, size: chosen.size } : null);
    if (fits && chosen) {
      // The name is the next field of this step; Continue leads on to the links.
      requestAnimationFrame(() => document.getElementById(id("from"))?.focus());
    }
  };

  const onAdd = (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const input = form.elements.namedItem("name") as HTMLInputElement;
    const name = input.value.trim();
    if (!name) {
      setNameError("missing");
      input.focus();
      return;
    }
    if (sender.recipients.some((r) => r.name === name)) {
      setNameError("taken");
      input.focus();
      return;
    }
    setNameError("");
    const emailInput = form.elements.namedItem("email") as HTMLInputElement | null;
    const email = emailInput?.value.trim() ?? "";
    // The field exists only once the sender opted in to email, and then it needs a real address.
    if (emailInput && !isAddress(email)) {
      setEmailError(true);
      emailInput?.focus();
      return;
    }
    if (sender.recipients.length === 0) {
      const typed = from.trim();
      const problem = hasForbiddenCharacters(typed)
        ? "unsafe"
        : file && !metaFits(file, typed)
          ? "tooLong"
          : "";
      setFromError(problem);
      if (problem) {
        document.getElementById(id("from"))?.focus();
        return;
      }
      fromRef.current = typed;
    }
    const first = sender.recipients.length === 0;
    const link = createLink(location.origin);
    const submitter = (event as SubmitEvent).submitter;
    const check = submitter instanceof HTMLButtonElement ? submitter.value === "check" : !!email;
    dispatchRef.current({ type: "add", link, name, check, ...(email && { email }) });
    // After `add`, so the server already hosts the link this names.
    if (email && findRecipient(senderRef.current, link.linkId)) {
      const sent = signalingRef.current?.send({
        t: "email",
        link: link.linkId,
        to: email,
        secret: link.secret,
        from: fromRef.current,
        lang,
      });
      if (sent) {
        setMailed(true);
      } else {
        dispatchRef.current({ type: "email", linkId: link.linkId, status: "failed" });
      }
    }
    form.reset();
    input.focus();
    if (first) {
      // Step 3 appears below; the page stays where it is and focus stays for the next name.
      setCue({ kind: "links" });
    }
  };

  const onRemove = (linkId: string) => {
    const list = senderRef.current.recipients;
    const index = list.findIndex((r) => r.linkId === linkId);
    const neighbour = list[index + 1] ?? list[index - 1];
    dispatchRef.current({ type: "remove", linkId });
    // The removed card held focus; refocus after the re-render.
    requestAnimationFrame(() => {
      const button = neighbour
        ? document.querySelector<HTMLElement>(`[data-remove="${neighbour.linkId}"]`)
        : null;
      (button ?? document.getElementById(id("recipient-name")))?.focus();
    });
  };

  // Offered once every link has delivered, so nothing on its way is cut off. Like Remove on
  // every card: each link stops being hosted. The name stays, now unlocked.
  const onSendAnother = () => {
    dispatchRef.current({ type: "reset" });
    setChecks({});
    prepare(undefined);
    setFileError("");
    setNameError("");
    setContinued(false);
    setCue(null);
    const box = document.getElementById("secret-text");
    if (text && box instanceof HTMLTextAreaElement) {
      box.value = "";
      setTextLength(0);
    }
    // The frame comes after the render that brings back the picker and drops steps 2 and 3.
    requestAnimationFrame(() => {
      const top = document.getElementById(id("choose"));
      if (top) {
        glideTo(top);
      }
      document.getElementById(text ? "secret-text" : "file")?.focus({ preventScroll: true });
    });
  };

  const hasRecipients = sender.recipients.length > 0;
  // A label while the file can still be changed, plain text once the list locks it.
  const FileRow = hasRecipients ? "div" : "label";
  const fileStatus =
    !text && (hash.status === "preparing" || hash.status === "failed") ? hash.status : undefined;
  const tooLong = textLength > MAX_TEXT_LENGTH;
  const full = sender.recipients.length >= MAX_LINKS;
  // ponytail: counts by status, so it over-counts if a recipient's signaling drops mid-transfer; track joined/left if that matters
  const connected = sender.recipients.filter(isActive).length;
  const emailed = sender.recipients.filter(emailBound);
  const unfinished = sender.recipients.some((r) => r.status !== "delivered");
  const delivered = sender.recipients.filter((r) => r.status === "delivered").length;
  const allDone = hasRecipients && !unfinished;
  // Every link counts the same: a delivered one as 1, one on its way as the part that has gone.
  const progress =
    sender.recipients.reduce(
      (sum, r) =>
        sum +
        (r.status === "delivered"
          ? 1
          : r.status === "receiving" && file?.size
            ? r.bytesSent / file.size
            : 0),
      0,
    ) / Math.max(sender.recipients.length, 1);
  const status: TransferStatus = unfinished ? "active" : allDone ? "done" : "idle";
  useEffect(() => onStatus(status), [onStatus, status]);
  // Asked only once there is a link to wait for, and never during prerender.
  useEffect(() => {
    if (hasRecipients) {
      setCanAskToNotify(notifyPermission() === "default");
    }
  }, [hasRecipients]);
  const sendingText = t.send.sendingBar(delivered, sender.recipients.length);
  const doneText = (text ? t.secret : t.send).allDone;
  const barText = unfinished
    ? `${sendingText}. ${t.send.keepOpen}.`
    : `${doneText}. ${t.send.closeTab}.`;
  // Before the first link the bar names the open step, as its label and heading do.
  const stepText = continued
    ? `${t.send.step(2)}: ${t.send.peopleHeading}`
    : `${t.send.step(1)}: ${text ? t.menu.secret : t.send.title}`;
  // Step 2's explanation says what the hint would say before anything goes wrong, so the hint only reports problems.
  const recipientHint = !file
    ? text
      ? tooLong
        ? t.secret.tooLong
        : t.secret.first
      : t.send.fileFirst
    : full
      ? t.send.full(MAX_LINKS)
      : undefined;
  const goToRecipients = () => {
    setContinued(true);
    // The frame comes after the render that adds step 2.
    requestAnimationFrame(() => {
      const target = document.getElementById(id("recipients"));
      if (target) {
        glideTo(target);
      }
      document.getElementById(id("recipient-name"))?.focus({ preventScroll: true });
    });
  };

  return (
    <Page
      full
      banner={
        lostServer && (
          // A bar like the localhost bar, just below the header and held there while the page
          // scrolls. The header gives its height back to the page, so the top margin puts the bar
          // under it, and the bottom margin gives that back too: the page moves down by the bar's
          // height only, and nothing on it ends up under the bar.
          <p
            role="alert"
            data-banner="lost-server"
            class="sticky top-[calc(4rem+1px)] z-40 mt-[calc(4rem+1px)] -mb-[calc(4rem+1px)] bg-red-700 px-4 py-1.5 text-center text-sm text-white"
          >
            {text ? t.secret.lostServer : t.send.lostServer}
          </p>
        )
      }
    >
      <section id={id("choose")} aria-labelledby={id("send-title")}>
        {/* On a phone the title and the toggle don't fit side by side, so the toggle spans the page above
            the title. Only the look moves: the heading stays first for keyboards and screen readers. */}
        <div class="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p class={stepLabel}>{t.send.step(1)}</p>
            <h1 id={id("send-title")} class="mt-0">
              {text ? t.menu.secret : t.send.title}
            </h1>
          </div>
          <nav
            aria-label={t.send.mode.label}
            // ponytail: a native tooltip, which touch and keyboard never show; a visible note if that matters
            title={unfinished ? t.send.mode.locked : undefined}
            class={`flex gap-0.5 rounded-xl border border-border p-0.5 max-sm:order-first sm:flex-none ${unfinished ? "cursor-not-allowed" : ""}`}
          >
            {(["file", "secret"] as const).map((mode) => {
              const current = (mode === "secret") === text;
              const look = `${buttonVariants({
                variant: current ? "secondary" : "ghost",
                size: "sm",
              })} flex-1 sm:flex-none`;
              const label = (
                <>
                  <Icon name={mode === "secret" ? "key" : "file"} class="size-4" />
                  {t.send.mode[mode]}
                </>
              );
              // While this send is on its way both modes lead here (see App), so the toggle is off.
              return unfinished ? (
                <button
                  key={mode}
                  type="button"
                  disabled
                  aria-current={current ? "page" : undefined}
                  class={look}
                >
                  {label}
                </button>
              ) : (
                <Link
                  key={mode}
                  href={mode === "secret" ? SECRET_HREF : FILE_HREF}
                  aria-current={current ? "page" : undefined}
                  class={look}
                >
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>
        <p class={lede}>{text ? t.secret.lede : t.send.lede}</p>

        {text && (
          <div class={`my-8 ${field}`}>
            <Label htmlFor="secret-text">{t.secret.label}</Label>
            <textarea
              id="secret-text"
              class="field-sizing-content max-h-[66dvh] min-h-[calc(6lh+1rem+2px)] w-full min-w-0 resize-y rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-base transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-transparent dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
              rows={6}
              spellcheck={false}
              translate={false}
              autocomplete="off"
              writingsuggestions="false"
              // camelCase so Preact sets the attribute; the autocorrect property is a boolean in WebKit and Firefox.
              autoCorrect="off"
              autocapitalize="off"
              disabled={hasRecipients}
              onInput={(event) => {
                const value = event.currentTarget.value;
                setTextLength(value.length);
                prepare(textFile(value));
              }}
              aria-invalid={tooLong ? "true" : "false"}
              aria-describedby={tooLong ? "secret-text-error secret-text-hint" : "secret-text-hint"}
            />
            <p id="secret-text-hint" class={`m-0 ${hint}`}>
              {t.secret.hint(MAX_TEXT_LENGTH)}
            </p>
            {/* Always rendered so the status is announced; the count stays outside it so each key isn't read out. */}
            <p id="secret-text-error" class={tooLong ? fieldError : "-mt-2 mb-0"}>
              {tooLong && `${t.secret.count(textLength, MAX_TEXT_LENGTH)} `}
              <span role="status">{tooLong && t.secret.tooLong}</span>
            </p>
          </div>
        )}
        {!text && (file || !hasRecipients) && (
          // One box before and after the list locks the file, so nothing below it moves.
          <div
            class={`group relative my-8 rounded-2xl border-2 ${file ? "border-solid" : "border-dashed"} border-border bg-card ${hasRecipients ? "" : "transition-colors focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-primary hover:border-foreground/40 hover:bg-muted/40"}`}
          >
            {!hasRecipients && (
              <input
                id="file"
                type="file"
                class="absolute inset-0 size-full cursor-pointer opacity-0"
                onChange={onFileChange}
                aria-invalid={fileError ? "true" : "false"}
                aria-describedby={fileError ? "file-error" : undefined}
              />
            )}
            {file ? (
              <FileRow
                class="flex items-center gap-3 px-4 py-4"
                {...(!hasRecipients && { for: "file" })}
              >
                <Icon name="file" class="size-8 flex-none text-muted-foreground" />
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold wrap-anywhere">{file.name}</span>
                  <span class="block text-muted-foreground">{formatBytes(file.size, lang)}</span>
                </span>
                {!hasRecipients && (
                  <span class="font-medium underline underline-offset-4">{t.send.change}</span>
                )}
              </FileRow>
            ) : (
              <label
                for="file"
                class="flex flex-col items-center gap-3 px-4 py-14 text-center text-muted-foreground lg:py-20"
              >
                <span class="inline-flex size-14 items-center justify-center rounded-xl bg-muted text-foreground">
                  <Icon name="file" class="size-7" />
                </span>
                <span>
                  <strong class="text-foreground">{t.send.chooseFile}</strong> {t.send.orDrop}
                </span>
              </label>
            )}
          </div>
        )}
        {fileError && (
          <p id="file-error" class={fieldError}>
            {t.send.fileError[fileError]}
          </p>
        )}
        {/* The name locks with the file once a link exists, so it belongs to this step. */}
        <div class={`mt-6 ${field}`}>
          <Label htmlFor={id("from")}>
            {t.send.fromLabel}{" "}
            <span class="font-normal text-muted-foreground">{t.send.optional}</span>
          </Label>
          <Input
            id={id("from")}
            type="text"
            autoComplete="name"
            maxLength={MAX_FROM_LENGTH}
            value={from}
            onInput={(event) => {
              setFrom(event.currentTarget.value);
              setFromError("");
            }}
            disabled={hasRecipients}
            aria-invalid={fromError ? "true" : "false"}
            aria-describedby={
              fromError ? `${id("from-error")} ${id("from-hint")}` : id("from-hint")
            }
          />
          {fromError && (
            <p id={id("from-error")} class={fieldError}>
              {t.send.fromError[fromError]}
            </p>
          )}
          <p id={id("from-hint")} class={`m-0 ${hint}`}>
            {t.send.fromHint}
            {mail && ` ${t.send.fromHintEmail}`}
          </p>
        </div>
        <Button
          type="button"
          className="mt-4"
          disabled={!file || tooLong || hasRecipients}
          onClick={goToRecipients}
        >
          {t.send.continue}
        </Button>
        {(file || text) && (
          // One line that is always there: the file's status, then the lock's hint. Both share a
          // grid cell and the hidden one keeps its space, so neither moves the page (see SwapLabel).
          <p class={`mt-2 mb-0 grid ${hint}`}>
            <span
              class={`col-start-1 row-start-1 ${hasRecipients && !fileStatus ? "" : "invisible"}`}
            >
              {
                (text ? t.secret : t.send)[
                  sender.recipients.some((r) => r.status === "delivered")
                    ? "lockedDelivered"
                    : "locked"
                ]
              }
            </span>
            {fileStatus === "preparing" && (
              <span class="col-start-1 row-start-1" role="status">
                {t.send.preparing}
              </span>
            )}
            {fileStatus === "failed" && (
              <span class="col-start-1 row-start-1 text-destructive" role="alert">
                {t.send.readFailed}
              </span>
            )}
          </p>
        )}
      </section>

      {continued && (
        <section
          id={id("recipients")}
          class={`mt-10 scroll-mt-16 border-t border-border pt-8 ${hasRecipients ? "" : lastStep}`}
          aria-labelledby={id("recipients-heading")}
        >
          <p class={stepLabel}>{t.send.step(2)}</p>
          <h2 id={id("recipients-heading")} class="m-0 text-[1.75rem] font-bold">
            {t.send.peopleHeading}
          </h2>
          <p class={lede}>{t.send.peopleLede}</p>
          <form
            class={formRows}
            onSubmit={onAdd}
            // A held Enter that started on the last Remove button lands here and would submit an empty name.
            onKeyDown={(event) => {
              if (event.repeat && event.key === "Enter") {
                event.preventDefault();
              }
            }}
            noValidate
          >
            <div class={`basis-full ${field}`}>
              <Label htmlFor={id("recipient-name")}>{t.send.recipientLabel}</Label>
              <Input
                id={id("recipient-name")}
                name="name"
                type="text"
                placeholder={t.send.recipientPlaceholder}
                autoComplete="off"
                maxLength={100}
                disabled={!file || full}
                onInput={() => setNameError("")}
                aria-invalid={nameError ? "true" : "false"}
                aria-describedby={
                  [nameError && id("name-error"), recipientHint && id("recipient-hint")]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
              />
              {nameError && (
                <p id={id("name-error")} class={fieldError}>
                  {t.send.nameError[nameError]}
                </p>
              )}
            </div>
            {mail && (
              <div class={`basis-full ${field}`}>
                {/* Off by default: the safe way is to pass the link on yourself. */}
                <Label className="items-start leading-snug font-normal">
                  <input
                    type="checkbox"
                    class="mt-0.5 size-4 flex-none accent-primary"
                    checked={useEmail}
                    disabled={!file || full}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setUseEmail(checked);
                      setEmailError(false);
                    }}
                  />
                  {t.send.emailChoice}
                </Label>
                {useEmail && (
                  <>
                    <Alert role="note" id={id("email-notice")}>
                      <AlertDescription>
                        {text ? t.secret.emailNotice : t.send.emailNotice}{" "}
                        <Link href="/how/link" class="font-medium underline underline-offset-4">
                          {t.send.emailMore}
                        </Link>
                      </AlertDescription>
                    </Alert>
                    <Label htmlFor={id("recipient-email")}>{t.send.emailLabel}</Label>
                    <Input
                      id={id("recipient-email")}
                      name="email"
                      type="email"
                      required
                      autoComplete="off"
                      maxLength={MAX_ADDRESS}
                      disabled={!file || full}
                      onInput={() => setEmailError(false)}
                      aria-invalid={emailError ? "true" : "false"}
                      aria-describedby={
                        emailError
                          ? `${id("email-error")} ${id("email-notice")}`
                          : id("email-notice")
                      }
                    />
                    {emailError && (
                      <p id={id("email-error")} class={fieldError}>
                        {t.send.emailError}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
            <div class="flex basis-full flex-wrap gap-2">
              {mail && useEmail ? (
                <>
                  <Button
                    type="submit"
                    value="check"
                    disabled={!file || full}
                    aria-describedby={file && !full ? id("check-hint") : undefined}
                  >
                    {t.send.addEmailCheck}
                  </Button>
                  <Button type="submit" variant="outline" value="plain" disabled={!file || full}>
                    {t.send.addEmail}
                  </Button>
                </>
              ) : (
                <>
                  <Button type="submit" value="plain" disabled={!file || full}>
                    {t.send.add}
                  </Button>
                  <Button
                    type="submit"
                    variant="outline"
                    value="check"
                    disabled={!file || full}
                    aria-describedby={file && !full ? id("check-hint") : undefined}
                  >
                    {t.send.addCheck}
                  </Button>
                </>
              )}
            </div>
          </form>
          {file && !full && (
            <p id={id("check-hint")} class={`mb-0 ${hint}`}>
              {t.send.check.hint(text ? "secret" : "file")}
            </p>
          )}
          {recipientHint && (
            <p id={id("recipient-hint")} class={hint}>
              {recipientHint}
            </p>
          )}
          <details class="mt-6 text-[0.9rem]">
            <summary class="cursor-pointer text-muted-foreground">
              {t.send.connectionOptions}
            </summary>
            <div class="mt-4 flex items-start gap-2.5">
              <input
                type="checkbox"
                id={id("allow-relay")}
                class="mt-0.5 size-4 flex-none accent-primary"
                checked={allowRelay}
                aria-describedby={`${id("allow-relay")}-description`}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  allowRelayRef.current = checked;
                  setAllowRelay(checked);
                  host();
                }}
              />
              <div class="flex flex-col gap-1">
                <Label htmlFor={id("allow-relay")} className="leading-snug">
                  {t.send.allowRelay}
                </Label>
                <p id={`${id("allow-relay")}-description`} class={`m-0 leading-snug ${hint}`}>
                  {t.send.allowRelayHint(text ? "secret" : "file")}
                </p>
              </div>
            </div>
          </details>
        </section>
      )}

      {hasRecipients && (
        <section
          id={id("links")}
          class={`mt-12 scroll-mt-16 border-t border-border pt-8 ${lastStep}`}
          aria-labelledby={id("links-heading")}
        >
          <p class={stepLabel}>{t.send.step(3)}</p>
          <h2 id={id("links-heading")} class="m-0 text-[1.75rem] font-bold">
            {t.send.linksHeading}
          </h2>
          <RecipientList
            recipients={sender.recipients}
            fileSize={file?.size ?? 0}
            statusText={text ? { ...t.send.status, ...t.secret.status } : t.send.status}
            onRemove={onRemove}
            checks={checks}
            onCheck={onCheck}
            onLater={onLater}
            visible={shown}
          />
        </section>
      )}

      <p class="sr-only" role="status">
        {cue?.kind === "file" && t.send.fileChosen(cue.name, formatBytes(cue.size, lang))}
        {cue?.kind === "links" && hasRecipients && `${t.send.step(3)}: ${t.send.linksHeading}`}
      </p>
      <p class="sr-only" role="status">
        {hasRecipients && barText}
      </p>
      <div
        data-bottom-bar
        data-page-bar
        // White on emerald-700 is 5.5:1.
        class={`fixed inset-x-0 bottom-0 z-40 overflow-hidden bg-background/80 px-4 py-1.5 backdrop-blur-xl transition-colors duration-700 motion-reduce:transition-none ${allDone ? "text-white" : ""}`}
      >
        {/* The green that takes the bar once every link has delivered. It waits above the bar and
            slides down from the progress line, its soft lower edge first; 60 % of its height is
            solid, which covers the whole bar when it has landed. */}
        <div
          class={`absolute inset-x-0 top-0 h-[170%] bg-linear-to-b from-emerald-700 from-60% to-transparent transition-transform duration-700 ease-out motion-reduce:transition-none ${allDone ? "translate-y-0" : "-translate-y-full"}`}
          aria-hidden="true"
        />
        {/* The bar's top edge: a track that fills with what has gone through all links together.
            It is always there, and stays full in a lighter green once every link has delivered, so
            the bar never changes height. Its fill comes with the first link: the page is prerendered
            without links, and the CSP blocks the style attribute that sets the fill's width. */}
        <div class="absolute inset-x-0 top-0 h-1 bg-border" aria-hidden="true">
          {hasRecipients && (
            <div
              class={`h-full transition-[width,background-color] motion-reduce:transition-none ${allDone ? "bg-emerald-400" : "bg-emerald-600"}`}
              style={{ width: `${progress * 100}%` }}
            />
          )}
        </div>
        {/* As tall at every step: two lines of text with room around them, and three lines, which a
            phone beside Notify me needs, in the same height with less room. */}
        <div class="relative mx-auto flex min-h-[3.95rem] max-w-xl items-center gap-3">
          {/* All three texts share one grid cell, the hidden ones keeping their space, so the bar is
              as tall at a step as while sending and when done, whichever text wraps to more lines
              (see SwapLabel). */}
          <p class="m-0 grid flex-1 text-[0.9rem] leading-snug font-medium" aria-hidden="true">
            <span
              class={`col-start-1 row-start-1 flex items-center gap-3 ${hasRecipients ? "invisible" : ""}`}
            >
              <span class="flex size-4 flex-none items-center justify-center">
                <span class="size-2 rounded-full bg-muted-foreground" />
              </span>
              <span>{stepText}</span>
            </span>
            <span
              class={`col-start-1 row-start-1 flex items-center gap-3 ${unfinished ? "" : "invisible"}`}
            >
              {/* In a box as wide as the check that replaces it, so the text starts at the same place. */}
              <span class="flex size-4 flex-none items-center justify-center">
                <span class="size-2 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
              </span>
              <span>
                <span class="block">{sendingText}</span>
                <span class="block font-normal text-muted-foreground">{t.send.keepOpen}</span>
              </span>
            </span>
            <span
              class={`col-start-1 row-start-1 flex items-center gap-3 ${allDone ? "" : "invisible"}`}
            >
              <Icon name="check" class="size-4 flex-none" />
              <span>
                {/* Short, like "0 of 1 delivered" before it, so it fits beside Notify me on a phone;
                    the status line says it in full. */}
                <span class="block">{t.send.doneTitle}</span>
                <span class="block font-normal">{t.send.closeTab}</span>
              </span>
            </span>
          </p>
          {/* Once there is a link, Notify me while sending, the browser's answer and Send another
              file once done share one grid cell, the hidden ones keeping their space, so the bar's
              text wraps the same and the bar keeps its height as they swap (see SwapLabel). */}
          {(hasRecipients || canAskToNotify || notifyAnswer) && (
            <div class="grid flex-none items-center justify-items-end">
              <Button
                id={id("notify-me")}
                type="button"
                variant="outline"
                size="sm"
                className={`col-start-1 row-start-1 ${unfinished && canAskToNotify ? "" : "invisible"}`}
                onClick={async () => {
                  const answer = await askToNotify();
                  if (answer !== "default") {
                    setCanAskToNotify(false);
                    setNotifyAnswer(answer === "granted" ? "on" : "blocked");
                  }
                }}
              >
                {t.send.notifyMe}
              </Button>
              {notifyAnswer && (
                // Takes the focus the button held, and tells the sender what the browser answered.
                // Invisible while the button is offered again after an earlier answer.
                <p
                  id={id("notify-answer")}
                  tabIndex={-1}
                  role="status"
                  // As wide as the button, which keeps its place, so the answer wraps instead of
                  // taking width from the bar's text.
                  class={`col-start-1 row-start-1 m-0 w-0 min-w-full text-right text-[0.8rem] leading-tight ${canAskToNotify || allDone ? "invisible" : ""} text-muted-foreground`}
                >
                  {notifyAnswer === "on" ? t.send.notifyOn : t.send.notifyBlocked}
                </p>
              )}
              {hasRecipients && (
                // Only once every link has delivered, so it never cuts a transfer off.
                <Button
                  type="button"
                  size="sm"
                  className={`col-start-1 row-start-1 bg-white text-emerald-800 hover:bg-white/90 focus-visible:border-white focus-visible:ring-white/60 ${allDone ? "" : "invisible"}`}
                  onClick={onSendAnother}
                >
                  {(text ? t.secret : t.send).sendAnother}
                </Button>
              )}
            </div>
          )}
          {/* At the bar's end on every step; a closed dialog takes no space, an open one is in the top layer. */}
          <ServerDrawer
            onGreen={allDone}
            visible={shown}
            facts={
              file && !text
                ? [
                    [t.common.size, t.format.bytes(file.size)],
                    [t.common.type, file.type || t.common.typeMissing],
                    [
                      "SHA-256",
                      hash.status === "ready" ? <code>{hash.hex}</code> : t.send.hashPending,
                    ],
                  ]
                : []
            }
            sees={t.server.seesSender}
            holds={t.server.senderHolds({
              online: !lostServer,
              links: hostedLinks(sender).length,
              connected,
              relay: allowRelay,
              emailed: emailed.length,
              sending: emailed.filter((r) => r.mail === "sending").length,
              mailed,
              kind: text ? "secret" : "file",
            })}
            relayed={relayed}
            afterwards={t.server.senderAfterwards(!lostServer, mailed)}
            viaRelay={viaRelay}
            emailed={mailed}
            kind={text ? "secret" : "file"}
          />
        </div>
      </div>
    </Page>
  );
}
