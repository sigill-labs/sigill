// Per-recipient delivery state on the sender, as a pure reducer.
//
// The sender page owns one SenderState. User actions (add, remove) and
// network events (joined, channel-open, ...) go through `update`, which
// returns the next state and a list of effects for the caller to carry out
// (start a peer connection, refuse a joiner, close a connection).
//
// Transitions per recipient (anything not listed is ignored):
//
// | from                           | event          | to         | effect             |
// |--------------------------------|----------------|------------|--------------------|
// | waiting, declined, failed      | joined         | connecting | start              |
// | connecting ... receiving (2)   | joined (3)     | (same)     | restart            |
// | connecting ... receiving (2)   | joined         | (same)     | refuse busy        |
// | delivered, or locked           | joined         | (same)     | refuse used        |
// | (its attempt just ended) (4)   | joined         | (same)     | refuse drop        |
// | connecting                     | channel-open   | offered, or checking with check |  |
// | checking                       | checked        | offered    |                    |
// | checking                       | check-differs  | waiting    | refuse drop, close |
// | offered                        | accepted       | receiving  |                    |
// | offered                        | declined       | declined   | close              |
// | receiving                      | progress       | receiving  |                    |
// | receiving                      | receipt(true)  | delivered  | close              |
// | receiving                      | receipt(false) | failed     | close              |
// | connecting ... receiving (2)   | dropped        | waiting    | refuse drop, close |
// | connecting, checking           | timeout        | waiting    | refuse drop, close |
// | connecting (no check), offered (check) | unsendable | failed | refuse drop, close |
// | connecting                     | outdated       | failed     | close              |
// | connecting                     | left           | waiting    | close              |
// | connecting (5)                 | server-lost    | waiting    | close              |
// | connecting                     | resume-refused | waiting    | close              |
// | connecting ... receiving (2)   | path relay (1) | waiting    | refuse drop, close |
// | (its attempt matches)          | path           | (same)     |                    |
// | (not on the list)              | joined         | -          | refuse unknown     |
//
// (1) For the current attempt, when its `joined` said the sender refused the relay.
// (2) connecting, checking, offered or receiving: the active statuses.
// (3) With the attempt ID of the attempt in progress: the server's answer to that recipient joining again.
// (4) With the attempt ID of the recipient's last attempt that ended (`ended`).
// (5) Unless the page holds a resume token for its attempt (`armed`).
//
// Rules:
// - A link is used only once the recipient's RECEIPT matches (delivered).
//   Any later join on it is refused with "used" while the page still hosts it.
// - A join while a transfer is in progress (connecting, offered, receiving)
//   is refused with "busy". The server normally refuses a second joiner
//   itself; the sender is the authority either way.
// - A join while a transfer is in progress that carries that transfer's own
//   attempt ID is the same recipient asking again, because its open
//   connection dropped (decision 0031). It is refused nothing and changes
//   nothing but `turn`: the `restart` effect hands its ICE servers to the
//   attempt's peer, which restarts ICE once its channel has opened and ignores
//   them before. After delivery or a lock such a join is refused with "used".
//   After any other end it is refused with "drop" and changes nothing: the
//   join crossed the sender's refusal on the wire and reached a server that had
//   already unbound the attempt, so it paired as a first join, but the
//   recipient's peer for it is gone on this side and starting a new one would
//   only time out, and for a `check` recipient cost one of its CHECK_ATTEMPTS.
//   The reducer remembers only the last ended attempt (`ended`); a new attempt
//   always joins with a new random ID (see ReceivePage), so it starts as usual.
// - A join for a link ID not on the list is refused with "unknown".
// - `left` (the server says the recipient's signaling socket closed) ends an
//   attempt only while it is still connecting. Once the data channel is open
//   the socket no longer matters: the recipient closes it right after sending
//   RECEIPT or DECLINE, so `left` can arrive before that frame is decrypted,
//   and a recipient whose socket drops mid-transfer can still finish. From
//   then on only the peer closing (dropped), a receipt or a decline end it.
// - `dropped` means the sender's peer for the link failed or closed before
//   delivery; `timeout` means its data channel did not open within
//   SETUP_TIMEOUT_MS of the join. Either way the server may still have the
//   joiner bound to the link (a peer can fail while the joiner's socket stays
//   open, and someone who knows a link ID but not its secret can join and then
//   stay silent or send garbage). So the sender also refuses the joiner, which
//   makes the server unbind it and frees the link for the real recipient. The
//   reason is "drop", which tells the recipient the attempt failed and the
//   link still works (see ReceivePage). "busy" is only for a join while a
//   transfer is in progress; the server also sends it for a second joiner.
//   If the joiner already left, the server ignores the refusal. `left` needs
//   no refusal: the joiner is gone.
// - `server-lost` (our own signaling socket dropped) does the same for every
//   connecting recipient, since the server forgot their joins with the socket.
//   Unlike `left` it never sets `noRelay` or `noConnect`: the server dropped, not the relay.
// - A recipient whose current attempt the page holds a resume token for
//   (`armed` in `server-lost`, see armedLinks) is left as it is by
//   `server-lost`: the server holds that attempt, with its email binding, for
//   the page's next socket to take back (decision 0033). If the server refuses
//   that `resume`, or the socket closes before it answers, `resume-refused`
//   does to the recipient what `server-lost` would have done.
// - Every join carries the recipient's attempt ID, and every refusal names the
//   attempt it refuses. A join is refused with its own attempt; `dropped`,
//   `timeout` and `unsendable` refuse the attempt stored when the recipient
//   started connecting. The server ignores a refusal whose attempt is not the
//   bound joiner's, so a late drop of one attempt cannot turn away the next
//   joiner.
// - A drop before delivery returns the recipient to "waiting" with bytesSent
//   0. Only a drop while receiving also sets `error: INTERRUPTED`, which the
//   next join clears. The reducer keeps nothing else of it: the next join
//   starts a new transfer, which a recipient that kept part of the file continues from ACCEPT's
//   offset (see send-file.ts).
// - A decline marks the recipient "declined", so the sender sees the link was
//   opened and turned down. The link stays usable: the next join starts over,
//   exactly like a join from "waiting".
// - A mismatching RECEIPT marks the recipient "failed" with an error. The link
//   stays usable: the next join clears the error and starts over, exactly like
//   a join from "waiting".
// - `unsendable` means the connection can't carry a text in one chunk (see
//   textFitsOneChunk in text-secret.ts). Without the check it arrives when the
//   data channel just opened, so nothing was sent. With the check on it arrives
//   only after `checked`: INIT and CHECK went but no META, so a link's holder
//   can't tell a secret from a file before both confirmed, and it never counts
//   in `checkFailures`, like a file sender's own floor. The recipient is marked
//   "failed" with an error, the joiner is refused with "drop" and the
//   connection closed, and the next join starts over, as after a mismatching
//   RECEIPT.
// - `outdated` means the two pages run different frame versions, so the
//   sender's peer made no offer (see peer.ts). The recipient is marked "failed"
//   with SENDER_OUTDATED when this page is the older one, else
//   RECIPIENT_OUTDATED, and the connection closed. This reducer sends no
//   refusal: a recipient page with the check ends the attempt itself, and a
//   refusal could reach it before the sender's version marker that tells it
//   why. SendPage refuses the joiner with "drop" at the join deadline, which
//   ends a recipient page from before the check and which the server ignores
//   once the joiner has left. The next join starts over, as after a
//   mismatching RECEIPT.
// - Events that do not fit the current status (for example a late progress
//   after a drop) are ignored, as are events for link IDs not on the list.
// - `path` records how the current attempt's connection runs. It applies only
//   to the attempt it names, so a path read late for an earlier attempt is
//   ignored. Anything that resets the recipient clears it; delivery keeps it.
// - Each attempt keeps whether our relay was allowed when the server paired
//   it (`turn`): the `turn` its `joined` carried, and the sender's own
//   choice at that moment (`allowRelay`), so a server that ignores the
//   choice can't override it. Under `turn` false the start effect gets only
//   the `stun:` URLs, with no credential. A join that restarts the attempt
//   sets `turn` again the same way and filters its effect's servers by it, so
//   the refusal that counts is the one at the latest `joined`. An attempt that ends while
//   still connecting (dropped, timeout, left) under `turn` false returns to
//   "waiting" with `noRelay`, because a refused relay is the likely reason it
//   never connected. The next join clears it. Under `turn` true it returns
//   with `noConnect` instead, so the sender sees that someone tried and
//   couldn't connect; the next join clears that too.
// - A `relay` path for an active attempt under `turn` false ends that attempt
//   like a timeout and sets `noRelay`. This is a backstop for a recipient that
//   uses a relay on its own side: the sender's peer has no TURN server then,
//   and an honest server gives the recipient none either.
// - Removing a recipient is always allowed. If it was mid-transfer, the
//   result includes a close effect.
// - A recipient added with an email address starts at mail "sending"; `email`
//   then records what the server said. The latest status wins, because a
//   timed-out notice may still arrive and every new code says "verifying",
//   except that "verified" stays once reached and a late notice reply
//   ("sent", "failed", "limit") never replaces "verifying". Recipients without
//   an address ignore it. A reply with a mark means the server took the link and emailed
//   the marked copy, so the recipient's `url` becomes that copy. A refusal
//   without one (`limit`, or `failed` before anything went out) came after the
//   `email` message gave the server the link's secret, so the page passes a
//   `fresh` link and the recipient takes it in place of the old one, keeping
//   its name and mail status; `hostedLinks` then names the new link ID, not the
//   old. The page's own `failed` (its socket was closed, so nothing was sent)
//   carries no `fresh` link and keeps the plain link.
// - `server-lost` (and `resume-refused`) also unbinds every recipient whose link the server emailed
//   or may have emailed (a mark, "sending", or "verifying"/"verified" without
//   a mark, see `unmarked`): the server dropped its binding with the socket,
//   so `hostedLinks` leaves the link out from then on and nobody can host its
//   ID plain from this page. It also clears `noRelay` and `noConnect` there:
//   an unbound link can't be retried.
// - The server answers every `email` it refuses with `failed` or `limit`, naming
//   the link and with no mark, so a refusal never needs guessing which card it was for.
//
// - A recipient added with `check` shows the safety number once its channel
//   opens ("checking") and reaches "offered" only when both sides said the
//   numbers match (`checked`). `check-differs` returns it to "waiting" with
//   CHECK_DIFFERS, which the next join clears; the link still works, because a
//   misheard digit is the likely cause.
// - `timeout` also ends a "checking" attempt that both people have not
//   confirmed within CHECK_TIMEOUT_MS, as a failed check with CHECK_EXPIRED:
//   someone in the middle could otherwise hold one attempt open while it
//   makes the recipient connect again and again.
// - Every attempt of a `check` recipient that ends in connecting or checking
//   (dropped, timeout, left, server-lost, a refused relay, check-differs)
//   adds one to `checkFailures`, and nothing lowers it: someone
//   in the middle learns the sender's number from the offer, so it must not get
//   unlimited tries at a matching one. An attempt that ends with `outdated`
//   doesn't count, because it ends before the offer, and neither does one that
//   ends with `unsendable`, which comes only after both confirmed. At CHECK_ATTEMPTS the recipient is
//   "failed" with CHECK_LIMIT and `locked`, its attempt refused and closed,
//   every later join refused with "used", and `hostedLinks` leaves it out.
//
// Effects carry only link IDs, attempt IDs, refusal reasons and the ICE servers from the
// server's `joined`, which hold TURN credentials: pass them to the peer, never log or keep them. Recipient
// names never leave this module through an effect, so nothing built from
// effects can send a name to the network.

import {
  type EmailStatus,
  emailedFragment,
  type IceServer,
  MAX_LINKS,
  type RefuseReason,
} from "@fidant/protocol";
import type { Link } from "./link.ts";
import type { OpenPath } from "./peer.ts";

export type RecipientStatus =
  | "waiting"
  | "connecting"
  | "checking"
  | "offered"
  | "declined"
  | "receiving"
  | "delivered"
  | "failed";

export type Recipient = {
  readonly name: string;
  readonly linkId: string;
  readonly secret: string;
  readonly url: string;
  readonly status: RecipientStatus;
  readonly bytesSent: number;
  readonly error?: RecipientError;
  /** The attempt ID of the join that started the current connection. */
  readonly attempt?: string;
  /** The attempt ID of the last attempt that ended: a join carrying it is refused with "drop". */
  readonly ended?: string;
  /** How the current attempt's connection runs, once its data channel opened. */
  readonly path?: OpenPath;
  /** Whether our relay was allowed for the current attempt: the server's `turn` and the sender's own choice when it joined. */
  readonly turn?: boolean;
  /** The last attempt couldn't connect directly while the sender refused our relay. */
  readonly noRelay?: true;
  /** The last attempt ended before it connected, with our relay allowed. */
  readonly noConnect?: true;
  /** The address the server emails this link to, if the sender gave one. */
  readonly email?: string;
  /** Where that email stands: "sending" until the server answers. */
  readonly mail?: "sending" | EmailStatus;
  /** The server's value in the emailed link, once it took the link. Never logged. */
  readonly mark?: string;
  /** The server dropped this link's email binding, so the link is dead and no longer hosted. */
  readonly unbound?: true;
  /** Both people compare the safety number before anything about the file goes. */
  readonly check?: true;
  /** Checked attempts that ended before both sides confirmed. Never lowered. */
  readonly checkFailures?: number;
  /** The check failed CHECK_ATTEMPTS times: the link no longer works and is no longer hosted. */
  readonly locked?: true;
};

/** Recipients in the order they were added. Link IDs are unique. */
export type SenderState = { readonly recipients: readonly Recipient[] };

export type SenderAction =
  | { type: "add"; link: Link; name: string; email?: string; check?: boolean }
  | { type: "remove"; linkId: string }
  /** Empties the list, as `remove` on every recipient, so the sender can start on a new file or secret. */
  | { type: "reset" }
  | {
      type: "joined";
      linkId: string;
      attempt: string;
      iceServers: IceServer[];
      /** The server's `turn`. */
      turn: boolean;
      /** The sender's own relay checkbox when the join arrived. */
      allowRelay: boolean;
    }
  | { type: "channel-open"; linkId: string }
  | { type: "checked"; linkId: string }
  | { type: "check-differs"; linkId: string }
  | { type: "accepted"; linkId: string }
  | { type: "progress"; linkId: string; bytesSent: number }
  | { type: "receipt"; linkId: string; match: boolean }
  | { type: "dropped"; linkId: string }
  | { type: "timeout"; linkId: string }
  | { type: "left"; linkId: string }
  /** Our signaling socket closed. `armed` names the links whose attempt the next socket may take back. */
  | { type: "server-lost"; armed?: readonly string[] }
  /** The server refused to give a link's attempt back to our new socket, or never answered. */
  | { type: "resume-refused"; linkId: string }
  | { type: "declined"; linkId: string }
  | { type: "unsendable"; linkId: string }
  /** The two pages run different frame versions; `older` is the one that must reload. */
  | { type: "outdated"; linkId: string; older: "sender" | "recipient" }
  | { type: "path"; linkId: string; attempt: string; path: OpenPath }
  | {
      type: "email";
      linkId: string;
      status: EmailStatus;
      mark?: string | undefined;
      /** A new link to replace this one if the server refused its email: it saw the secret. */
      fresh?: Link | undefined;
    };

export type SenderEffect =
  | { type: "start"; linkId: string; attempt: string; iceServers: IceServer[] }
  /** The active recipient joined again: its peer restarts ICE with these servers. */
  | { type: "restart"; linkId: string; iceServers: IceServer[] }
  | { type: "refuse"; linkId: string; attempt: string; reason: RefuseReason }
  | { type: "close"; linkId: string };

export type SenderUpdate = { state: SenderState; effects: SenderEffect[] };

/** How long after a join the data channel may take to open before the attempt is dropped. */
export const SETUP_TIMEOUT_MS = 20_000;
/** How long both people have to compare the safety number before the attempt ends as a failed check. */
export const CHECK_TIMEOUT_MS = 5 * 60_000;
/** Checked attempts per link that may end without both sides confirming. */
export const CHECK_ATTEMPTS = 5;

export const CHECKSUM_MISMATCH = "The recipient's checksum did not match.";
export const TOO_SMALL_FOR_TEXT = "The connection can't carry a text in one chunk.";
export const CHECK_DIFFERS = "The safety numbers didn't match, so nothing was sent.";
export const CHECK_LIMIT = "The check failed too many times, so this link no longer works.";
export const CHECK_EXPIRED = "The safety number wasn't confirmed in time, so nothing was sent.";
export const SENDER_OUTDATED = "This page runs an older version than the recipient's.";
export const RECIPIENT_OUTDATED = "The recipient's page runs an older version than this one.";
export const INTERRUPTED = "The connection ended while the file was on its way.";
export type RecipientError =
  | typeof INTERRUPTED
  | typeof CHECKSUM_MISMATCH
  | typeof TOO_SMALL_FOR_TEXT
  | typeof CHECK_DIFFERS
  | typeof CHECK_LIMIT
  | typeof CHECK_EXPIRED
  | typeof SENDER_OUTDATED
  | typeof RECIPIENT_OUTDATED;

export const initialSenderState: SenderState = { recipients: [] };

const ACTIVE: ReadonlySet<RecipientStatus> = new Set([
  "connecting",
  "checking",
  "offered",
  "receiving",
]);

/** True while a peer connection for the recipient is being set up or used. */
export function isActive(recipient: Recipient): boolean {
  return ACTIVE.has(recipient.status);
}

/** True for a relay path on the recipient's active `attempt` that joined with the relay refused. */
export function refusesRelay(recipient: Recipient, attempt: string, path: OpenPath): boolean {
  return (
    path === "relay" &&
    recipient.attempt === attempt &&
    recipient.turn === false &&
    isActive(recipient)
  );
}

/** Finds a recipient by link ID. */
export function findRecipient(state: SenderState, linkId: string): Recipient | undefined {
  return state.recipients.find((r) => r.linkId === linkId);
}

const MAIL_PENDING: ReadonlySet<Recipient["mail"]> = new Set(["sending", "verifying", "verified"]);

/** True while the server may hold an email binding for the link but has not given the marked copy. */
export function unmarked(recipient: Recipient): boolean {
  return recipient.mark === undefined && MAIL_PENDING.has(recipient.mail);
}

/** True while the server holds, or may hold, an email binding for the recipient's link. */
export function emailBound(recipient: Recipient): boolean {
  return !recipient.unbound && (recipient.mark !== undefined || unmarked(recipient));
}

/**
 * The links whose current attempt a held resume token can take back: those of
 * `tokens` (link ID → the attempt its token is for) still hosted, whose
 * recipient's attempt is still that attempt (decision 0033).
 */
export function armedLinks(
  state: SenderState,
  tokens: ReadonlyMap<string, { readonly attempt: string }>,
): string[] {
  return state.recipients
    .filter(
      (r) =>
        !r.unbound &&
        !r.locked &&
        r.attempt !== undefined &&
        r.attempt === tokens.get(r.linkId)?.attempt,
    )
    .map((r) => r.linkId);
}

/**
 * Every link ID the sender should host: all recipients, including delivered
 * ones, so that the sender can answer a late join on them with "used", except
 * those whose email binding the server dropped or whose check locked them.
 */
export function hostedLinks(state: SenderState): string[] {
  return state.recipients.filter((r) => !r.unbound && !r.locked).map((r) => r.linkId);
}

export function update(state: SenderState, action: SenderAction): SenderUpdate {
  if (action.type === "add") {
    if (state.recipients.length >= MAX_LINKS || findRecipient(state, action.link.linkId)) {
      return { state, effects: [] };
    }
    const { linkId, secret, url } = action.link;
    const { email } = action;
    const recipient: Recipient = {
      name: action.name,
      linkId,
      secret,
      url,
      status: "waiting",
      bytesSent: 0,
      ...(email === undefined ? {} : { email, mail: "sending" as const }),
      ...(action.check ? { check: true as const } : {}),
    };
    return { state: { recipients: [...state.recipients, recipient] }, effects: [] };
  }
  if (action.type === "reset") {
    if (state.recipients.length === 0) {
      return { state, effects: [] };
    }
    const effects: SenderEffect[] = state.recipients
      .filter(isActive)
      .map((r) => ({ type: "close", linkId: r.linkId }));
    return { state: { recipients: [] }, effects };
  }
  if (action.type === "server-lost") {
    const effects: SenderEffect[] = [];
    let changed = false;
    const recipients = state.recipients.map((r) => {
      const next = action.armed?.includes(r.linkId) ? r : lose(r, effects);
      changed ||= next !== r;
      return next;
    });
    return { state: changed ? { recipients } : state, effects };
  }

  const { linkId } = action;
  const current = findRecipient(state, linkId);
  if (!current) {
    const effects: SenderEffect[] =
      action.type === "joined"
        ? [{ type: "refuse", linkId, attempt: action.attempt, reason: "unknown" }]
        : [];
    return { state, effects };
  }

  switch (action.type) {
    case "remove": {
      const recipients = state.recipients.filter((r) => r.linkId !== linkId);
      const effects: SenderEffect[] = isActive(current) ? [{ type: "close", linkId }] : [];
      return { state: { recipients }, effects };
    }
    case "joined": {
      const { attempt, iceServers } = action;
      const turn = action.turn && action.allowRelay;
      if (current.status === "delivered" || current.locked) {
        return { state, effects: [{ type: "refuse", linkId, attempt, reason: "used" }] };
      }
      if (attempt === current.ended) {
        return { state, effects: [{ type: "refuse", linkId, attempt, reason: "drop" }] };
      }
      if (isActive(current) && attempt !== current.attempt) {
        return { state, effects: [{ type: "refuse", linkId, attempt, reason: "busy" }] };
      }
      // Keep only the `stun:` URLs, without credentials, as the server does for a refused relay.
      const allowed = turn
        ? iceServers
        : iceServers.flatMap((server) => {
            const urls = server.urls.filter((url) => url.startsWith("stun:"));
            return urls.length > 0 ? [{ urls }] : [];
          });
      if (isActive(current)) {
        return {
          state: turn === current.turn ? state : replace(state, { ...current, turn }),
          effects: [{ type: "restart", linkId, iceServers: allowed }],
        };
      }
      return {
        state: replace(state, { ...reset(current, "connecting"), attempt, turn }),
        effects: [{ type: "start", linkId, attempt, iceServers: allowed }],
      };
    }
    case "channel-open":
      if (current.status !== "connecting") {
        return { state, effects: [] };
      }
      return {
        state: replace(state, { ...current, status: current.check ? "checking" : "offered" }),
        effects: [],
      };
    case "checked":
      if (current.status !== "checking") {
        return { state, effects: [] };
      }
      return { state: replace(state, { ...current, status: "offered" }), effects: [] };
    case "check-differs":
      if (current.status !== "checking") {
        return { state, effects: [] };
      }
      return end(
        state,
        current,
        failedCheck(current, { ...waiting(current, false), error: CHECK_DIFFERS }),
      );
    case "accepted":
      if (current.status !== "offered") {
        return { state, effects: [] };
      }
      return { state: replace(state, { ...current, status: "receiving" }), effects: [] };
    case "progress":
      if (current.status !== "receiving") {
        return { state, effects: [] };
      }
      return {
        state: replace(state, { ...current, bytesSent: Math.max(0, action.bytesSent) }),
        effects: [],
      };
    case "receipt": {
      if (current.status !== "receiving") {
        return { state, effects: [] };
      }
      const next: Recipient = action.match
        ? { ...current, status: "delivered" }
        : { ...reset(current, "failed"), error: CHECKSUM_MISMATCH };
      return { state: replace(state, next), effects: [{ type: "close", linkId }] };
    }
    case "dropped":
    case "timeout":
      if (action.type === "timeout" && current.status === "checking") {
        return end(
          state,
          current,
          failedCheck(current, { ...waiting(current, false), error: CHECK_EXPIRED }),
        );
      }
      if (action.type === "dropped" ? !isActive(current) : current.status !== "connecting") {
        return { state, effects: [] };
      }
      return end(state, current, {
        ...failedCheck(current, waiting(current, current.status === "connecting")),
        // Says why the card is back at waiting; the next join clears it.
        ...(current.status === "receiving" && { error: INTERRUPTED }),
      });
    case "left": {
      if (current.status !== "connecting") {
        return { state, effects: [] };
      }
      const next = failedCheck(current, waiting(current, true));
      if (next.locked) {
        return end(state, current, next);
      }
      return { state: replace(state, next), effects: [{ type: "close", linkId }] };
    }
    case "declined":
      if (current.status !== "offered") {
        return { state, effects: [] };
      }
      return {
        state: replace(state, reset(current, "declined")),
        effects: [{ type: "close", linkId }],
      };
    case "unsendable":
      if (current.status !== (current.check ? "offered" : "connecting")) {
        return { state, effects: [] };
      }
      return end(state, current, { ...reset(current, "failed"), error: TOO_SMALL_FOR_TEXT });
    case "outdated":
      if (current.status !== "connecting") {
        return { state, effects: [] };
      }
      return {
        state: replace(state, {
          ...reset(current, "failed"),
          error: action.older === "sender" ? SENDER_OUTDATED : RECIPIENT_OUTDATED,
        }),
        effects: [{ type: "close", linkId }],
      };
    case "resume-refused": {
      const effects: SenderEffect[] = [];
      const next = lose(current, effects);
      return { state: next === current ? state : replace(state, next), effects };
    }
    case "path":
      if (current.attempt !== action.attempt) {
        return { state, effects: [] };
      }
      if (refusesRelay(current, action.attempt, action.path)) {
        return end(state, current, failedCheck(current, waiting(current, true)));
      }
      return { state: replace(state, { ...current, path: action.path }), effects: [] };
    case "email": {
      if (current.mail === undefined || current.unbound) {
        return { state, effects: [] };
      }
      const keep =
        current.mail === "verified" ||
        (current.mail === "verifying" && action.status !== "verified");
      const mail = keep ? current.mail : action.status;
      const mark = current.mark ?? action.mark;
      if (
        action.fresh &&
        !keep &&
        mark === undefined &&
        (action.status === "limit" || action.status === "failed")
      ) {
        return swap(state, current, action.fresh, action.status);
      }
      if (mail === current.mail && mark === current.mark) {
        return { state, effects: [] };
      }
      const marked =
        mark === undefined
          ? {}
          : { mark, url: `${current.url.split("#")[0]}#${emailedFragment(mark, current.secret)}` };
      return { state: replace(state, { ...current, mail, ...marked }), effects: [] };
    }
  }
}

/**
 * Replaces a recipient whose email the server refused with `fresh`, keeping its name and mail
 * status. A joiner on the old link, which the server only allows before the `email` message, is
 * refused as unknown and its connection closed.
 */
function swap(
  state: SenderState,
  current: Recipient,
  fresh: Link,
  mail: EmailStatus,
): SenderUpdate {
  const { linkId, attempt } = current;
  const next: Recipient = {
    ...reset(current, "waiting"),
    linkId: fresh.linkId,
    secret: fresh.secret,
    url: fresh.url,
    mail,
  };
  const effects: SenderEffect[] = isActive(current)
    ? [
        ...(attempt === undefined
          ? []
          : [{ type: "refuse", linkId, attempt, reason: "unknown" } as const]),
        { type: "close", linkId },
      ]
    : [];
  return {
    state: { recipients: state.recipients.map((r) => (r === current ? next : r)) },
    effects,
  };
}

/**
 * What losing our signaling socket does to a recipient: the server dropped its email binding with
 * the socket, and forgot its join if it was still connecting. Pushes the close effect, if any.
 */
function lose(recipient: Recipient, effects: SenderEffect[]): Recipient {
  let next = recipient;
  if (emailBound(recipient)) {
    const { noRelay: _noRelay, noConnect: _noConnect, ...rest } = next;
    next = { ...rest, unbound: true };
  }
  if (recipient.status === "connecting") {
    effects.push({ type: "close", linkId: recipient.linkId });
    next = failedCheck(recipient, waiting(next, false));
  }
  return next;
}

/** Ends the current attempt as `next`: its joiner refused and its connection closed. */
function end(state: SenderState, current: Recipient, next: Recipient): SenderUpdate {
  const { linkId, attempt } = current;
  return {
    state: replace(state, next),
    effects: [
      // An active recipient always has the attempt its join stored.
      ...(attempt === undefined
        ? []
        : [{ type: "refuse", linkId, attempt, reason: "drop" } as const]),
      { type: "close", linkId },
    ],
  };
}

/**
 * `next` for an attempt that ended: if `current` was a check recipient still
 * connecting or checking, one more failed check, and locked at CHECK_ATTEMPTS.
 */
function failedCheck(current: Recipient, next: Recipient): Recipient {
  if (!current.check || (current.status !== "connecting" && current.status !== "checking")) {
    return next;
  }
  const checkFailures = (current.checkFailures ?? 0) + 1;
  if (checkFailures < CHECK_ATTEMPTS) {
    return { ...next, checkFailures };
  }
  return { ...reset(next, "failed"), checkFailures, error: CHECK_LIMIT, locked: true };
}

/** Back to waiting, with `noRelay` (relay refused) or `noConnect` if the attempt was `blocked`. */
function waiting(recipient: Recipient, blocked: boolean): Recipient {
  const next = reset(recipient, "waiting");
  if (!blocked) {
    return next;
  }
  return recipient.turn === false ? { ...next, noRelay: true } : { ...next, noConnect: true };
}

/**
 * The recipient with a new status, no progress, error, attempt, path, relay choice, noRelay or
 * noConnect. Its attempt, if any, becomes `ended`.
 */
function reset(recipient: Recipient, status: RecipientStatus): Recipient {
  const {
    error: _error,
    attempt,
    path: _path,
    turn: _turn,
    noRelay: _noRelay,
    noConnect: _noConnect,
    ...rest
  } = recipient;
  return { ...rest, ...(attempt === undefined ? {} : { ended: attempt }), status, bytesSent: 0 };
}

function replace(state: SenderState, recipient: Recipient): SenderState {
  return {
    recipients: state.recipients.map((r) => (r.linkId === recipient.linkId ? recipient : r)),
  };
}
