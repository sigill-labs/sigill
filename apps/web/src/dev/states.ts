// The states the dev panel can put the transfer pages in. A state is only data:
// the real page draws it (see `preview` on SendPage and ReceivePage).
//
// Sender states are built by running actions through the real reducer
// (lib/sender-state.ts), so a state the reducer cannot reach cannot be shown.
// A name keeps its link from state to state, so its card changes in place.

import { CODE_RESULTS, MAX_LINKS } from "@fidant/protocol";
import { en } from "../i18n/en.ts";
import { createLink, type Link } from "../lib/link.ts";
import {
  initialSenderState,
  type SenderAction,
  type SenderState,
  update,
} from "../lib/sender-state.ts";
import { MAX_TEXT_LENGTH, textFile } from "../lib/text-secret.ts";
import type { ReceivePreview, View } from "../receive/ReceivePage.tsx";
import type { SendPreview } from "../send/SendPage.tsx";

export type DevState = { group: string; name: string } & (
  | { page: "send" | "secret"; preview(): SendPreview }
  | { page: "receive"; preview(): ReceivePreview }
);

const MB = 1_000_000;
const SIZE = 48 * MB;
const NUMBER = "4827 1503 9962";
const SHA256 = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const ATTEMPT = "preview";

/** A file that says it is `size` bytes without holding them. */
const FILE = new File([], "Annual report 2026.pdf", { type: "application/pdf" });
Object.defineProperty(FILE, "size", { value: SIZE });

type Step = (linkId: string) => SenderAction;
type Person = { name: string; email?: string; check?: boolean; steps?: Step[] };

const joined =
  (turn = true): Step =>
  (linkId) => ({
    type: "joined",
    linkId,
    attempt: ATTEMPT,
    iceServers: [],
    turn,
    allowRelay: turn,
  });
const on =
  (
    type:
      | "channel-open"
      | "checked"
      | "check-differs"
      | "accepted"
      | "dropped"
      | "timeout"
      | "declined"
      | "unsendable",
  ): Step =>
  (linkId) => ({ type, linkId });
const progress =
  (bytesSent: number): Step =>
  (linkId) => ({ type: "progress", linkId, bytesSent });
const receipt =
  (match: boolean): Step =>
  (linkId) => ({ type: "receipt", linkId, match });
const path =
  (way: "direct" | "relay"): Step =>
  (linkId) => ({ type: "path", linkId, attempt: ATTEMPT, path: way });
const outdated =
  (older: "sender" | "recipient"): Step =>
  (linkId) => ({ type: "outdated", linkId, older });
const mail =
  (status: "sent" | "failed" | "limit" | "verifying" | "verified", marked = true): Step =>
  (linkId) => ({
    type: "email",
    linkId,
    status,
    ...(marked ? { mark: "preview" } : { fresh: createLink(location.origin) }),
  });
const serverLost: Step = () => ({ type: "server-lost" });

const OPEN = [joined(), on("channel-open"), path("direct")];
const SENDING = [...OPEN, on("accepted"), progress(SIZE * 0.4)];
const DELIVERED = [...SENDING, receipt(true)];
const DIFFERS = [joined(), on("channel-open"), on("check-differs")];

const links = new Map<string, Link>();

function build(people: Person[]): SenderState {
  let state = initialSenderState;
  for (const { name, email, check, steps = [] } of people) {
    const link = links.get(name) ?? createLink(location.origin);
    links.set(name, link);
    state = update(state, {
      type: "add",
      link,
      name,
      ...(email && { email }),
      ...(check && { check }),
    }).state;
    for (const step of steps) {
      state = update(state, step(link.linkId)).state;
    }
  }
  return state;
}

/**
 * A send page with these people on the list, each with an open safety number if it is checking.
 * Only "Safety number" leaves its dialog open; elsewhere the check is put off, or the dialog
 * would cover the page on every reload.
 */
function sending(people: Person[], more: SendPreview = {}, later = true): SendPreview {
  const sender = build(people);
  const checks = Object.fromEntries(
    sender.recipients
      .filter((r) => r.status === "checking")
      .map((r, i) => [
        r.linkId,
        i === 1 ? { number: NUMBER, said: true } : { number: NUMBER, later },
      ]),
  );
  return { file: FILE, hash: { status: "ready", hex: SHA256 }, sender, checks, ...more };
}

const send = (name: string, preview: () => SendPreview): DevState => ({
  group: "Send a file",
  name,
  page: "send",
  preview,
});

const SECRET = "correct horse battery staple";
// A secret at the length limit, in lines like a pasted key, so the boxes reach their cap.
const LONG_SECRET = Array.from(
  { length: 200 },
  (_, i) => `${String(i + 1).padStart(3, "0")} ${"0Ol1Il".repeat(8)}`,
)
  .join("\n")
  .slice(0, MAX_TEXT_LENGTH);
const secret = (name: string, preview: () => SendPreview): DevState => ({
  group: "Send a secret",
  name,
  page: "secret",
  preview: () => ({ file: textFile(SECRET), text: SECRET, ...preview() }),
});

const receive = (group: string, name: string, preview: ReceivePreview): DevState => ({
  group,
  name,
  page: "receive",
  preview: () => preview,
});

const FILE_OFFER = {
  name: "Annual report 2026.pdf",
  size: SIZE,
  type: "application/pdf",
  from: "Anna Lind",
  text: false,
};
const TEXT_OFFER = { name: "", size: SECRET.length, type: "", from: "Anna Lind", text: true };
const verify = (more: Partial<Extract<View, { s: "verify" }>>): ReceivePreview => ({
  view: {
    s: "verify",
    to: "a***@example.se",
    asked: true,
    sending: false,
    result: undefined,
    ...more,
  },
  emailed: true,
});

type ProblemKey = keyof typeof en.receive.problems;
/** Problems that end the link for this page; the rest offer Try again. */
const REFUSED: ReadonlySet<ProblemKey> = new Set([
  "unknown",
  "unbound",
  "used",
  "busy",
  "offline",
  "offlineReceiving",
  "outdated",
  "senderOutdated",
]);
const PROBLEMS = (Object.keys(en.receive.problems) as ProblemKey[]).filter((k) => k !== "badLink");
const problem = (key: ProblemKey, text: boolean): ReceivePreview => ({
  view: { s: REFUSED.has(key) ? "refused" : "failed", problem: key, text },
});

export const STATES: readonly DevState[] = [
  send("Empty", () => ({})),
  send("File chosen, checksum pending", () => ({
    file: FILE,
    hash: { status: "preparing" },
  })),
  send("File chosen", () => ({ file: FILE, hash: { status: "ready", hex: SHA256 } })),
  send("File could not be read", () => ({ file: FILE, hash: { status: "failed" } })),
  send("File name not allowed", () => ({ fileError: "unsafe" })),
  send("File name too long", () => ({ fileError: "tooLong" })),
  send("Form errors", () => ({
    file: FILE,
    hash: { status: "ready", hex: SHA256 },
    mail: true,
    useEmail: true,
    nameError: "missing",
    fromError: "unsafe",
    emailError: true,
    continued: true,
  })),
  send("Name already on the list", () => sending([{ name: "Anna" }], { nameError: "taken" })),
  send("Email offered", () => ({
    file: FILE,
    hash: { status: "ready", hex: SHA256 },
    mail: true,
    continued: true,
  })),
  send("Email chosen", () => ({
    file: FILE,
    hash: { status: "ready", hex: SHA256 },
    mail: true,
    useEmail: true,
    continued: true,
  })),
  send("Waiting for the recipient", () => sending([{ name: "Anna" }])),
  send("Connecting", () => sending([{ name: "Anna", steps: [joined()] }])),
  send("Safety number", () =>
    sending(
      [
        { name: "Anna", check: true, steps: [joined(), on("channel-open")] },
        { name: "Björn (said it matches)", check: true, steps: [joined(), on("channel-open")] },
      ],
      {},
      false,
    ),
  ),
  send("Offered", () => sending([{ name: "Anna", steps: OPEN }])),
  send("Sending", () => sending([{ name: "Anna", steps: SENDING }], { from: "Anna Lind" })),
  send("Sending through the relay", () =>
    sending([
      {
        name: "Anna",
        steps: [joined(), on("channel-open"), path("relay"), on("accepted"), progress(SIZE * 0.4)],
      },
    ]),
  ),
  send("Delivered to one", () => sending([{ name: "Anna", steps: DELIVERED }], { from: "Peter" })),
  send("Delivered to all", () =>
    sending([
      { name: "Anna", steps: DELIVERED },
      { name: "Björn", steps: DELIVERED },
      { name: "Cecilia", steps: DELIVERED },
    ]),
  ),
  send("Every link status", () =>
    sending([
      { name: "Waiting" },
      { name: "Connecting", steps: [joined()] },
      { name: "Checking", check: true, steps: [joined(), on("channel-open")] },
      { name: "Offered", steps: OPEN },
      { name: "Receiving", steps: SENDING },
      { name: "Delivered", steps: DELIVERED },
      { name: "Declined", steps: [...OPEN, on("declined")] },
    ]),
  ),
  send("Every link problem", () =>
    sending([
      { name: "Checksum differed", steps: [...SENDING, receipt(false)] },
      { name: "Interrupted", steps: [...SENDING, on("dropped")] },
      { name: "Could not connect", steps: [joined(), on("timeout")] },
      { name: "Could not connect, relay off", steps: [joined(false), on("timeout")] },
      { name: "Numbers differed", check: true, steps: DIFFERS },
      {
        name: "Number not confirmed in time",
        check: true,
        steps: [joined(), on("channel-open"), on("timeout")],
      },
      {
        name: "Check failed too often",
        check: true,
        steps: [...DIFFERS, ...DIFFERS, ...DIFFERS, ...DIFFERS, ...DIFFERS],
      },
      { name: "This page is older", steps: [joined(), outdated("sender")] },
      { name: "Their page is older", steps: [joined(), outdated("recipient")] },
    ]),
  ),
  send("Every email status", () =>
    sending(
      [
        { name: "Sending", email: "anna@example.se" },
        { name: "Sent", email: "bjorn@example.se", steps: [mail("sent")] },
        {
          name: "Verifying",
          email: "cecilia@example.se",
          steps: [mail("sent"), mail("verifying")],
        },
        { name: "Verified", email: "david@example.se", steps: [mail("sent"), mail("verified")] },
        { name: "Failed", email: "erik@example.se", steps: [mail("failed", false)] },
        { name: "Limit", email: "frida@example.se", steps: [mail("limit", false)] },
      ],
      { mail: true, from: "Peter" },
    ),
  ),
  // `server-lost` unbinds every emailed link at once, so it gets a state of its own.
  send("Server unreachable, emailed link lost", () =>
    sending(
      [
        { name: "Anna" },
        { name: "Björn", email: "bjorn@example.se", steps: [mail("sent"), serverLost] },
      ],
      { mail: true, lostServer: true },
    ),
  ),
  send("Server unreachable", () => sending([{ name: "Anna" }], { lostServer: true })),
  send("List full", () =>
    sending(Array.from({ length: MAX_LINKS }, (_, i) => ({ name: `Person ${i + 1}` }))),
  ),

  { group: "Send a secret", name: "Empty", page: "secret", preview: () => ({}) },
  {
    group: "Send a secret",
    name: "Too long",
    page: "secret",
    preview: () => ({ text: "x".repeat(MAX_TEXT_LENGTH + 1) }),
  },
  secret("Typed", () => ({})),
  {
    group: "Send a secret",
    name: "Typed, long",
    page: "secret",
    preview: () => ({ file: textFile(LONG_SECRET), text: LONG_SECRET }),
  },
  secret("Waiting for the recipient", () => ({ sender: build([{ name: "Anna" }]) })),
  secret("Every link status", () => ({
    sender: build([
      { name: "Waiting" },
      { name: "Connecting", steps: [joined()] },
      { name: "Offered", steps: OPEN },
      { name: "Receiving", steps: [...OPEN, on("accepted")] },
      { name: "Delivered", steps: [...OPEN, on("accepted"), receipt(true)] },
      { name: "Declined", steps: [...OPEN, on("declined")] },
      { name: "Connection too small", steps: [joined(), on("unsendable")] },
    ]),
  })),
  secret("Delivered to all", () => ({
    sender: build([{ name: "Anna", steps: [...OPEN, on("accepted"), receipt(true)] }]),
  })),
  secret("Server unreachable", () => ({ sender: build([{ name: "Anna" }]), lostServer: true })),

  receive("Receive", "Link malformed", {}),
  receive("Receive", "Connecting", { view: { s: "connecting" } }),
  receive("Receive", "Email code: not asked yet", verify({ asked: false })),
  receive("Receive", "Email code: sending", verify({ sending: true })),
  ...CODE_RESULTS.map((result) => receive("Receive", `Email code: ${result}`, verify({ result }))),
  receive("Receive", "Safety number: loading", { view: { s: "check", number: undefined } }),
  receive("Receive", "Safety number", { view: { s: "check", number: NUMBER } }),
  receive("Receive", "Safety number: said it matches", {
    view: { s: "check", number: NUMBER, said: true },
  }),
  receive("Receive", "File offered", { view: { s: "offer", offer: FILE_OFFER }, path: "direct" }),
  receive("Receive", "File offered, sender unnamed", {
    view: { s: "offer", offer: { ...FILE_OFFER, from: "" } },
    path: "direct",
  }),
  receive("Receive", "File offered, by an emailed link", {
    view: { s: "offer", offer: FILE_OFFER },
    path: "direct",
    emailed: true,
  }),
  receive("Receive", "File offered, through the relay", {
    view: { s: "offer", offer: FILE_OFFER },
    path: "relay",
  }),
  receive("Receive", "Large file offered", {
    view: { s: "offer", offer: { ...FILE_OFFER, name: "Backup.zip", size: 8000 * MB } },
    path: "direct",
  }),
  receive("Receive", "Receiving a file", {
    view: { s: "receiving", offer: FILE_OFFER, bytes: SIZE * 0.4, left: 42 },
    path: "direct",
  }),
  receive("Receive", "File received", {
    view: { s: "done", offer: FILE_OFFER, blob: undefined, sha256: SHA256 },
    path: "direct",
  }),
  receive("Receive", "File declined", { view: { s: "declined", text: false } }),
  receive("Receive", "Secret offered", { view: { s: "offer", offer: TEXT_OFFER }, path: "direct" }),
  receive("Receive", "Receiving a secret", {
    view: { s: "receiving", offer: TEXT_OFFER, bytes: 0 },
    path: "direct",
  }),
  receive("Receive", "Secret shown", {
    view: { s: "done", offer: TEXT_OFFER, blob: new Blob([SECRET]), sha256: SHA256 },
    path: "direct",
  }),
  receive("Receive", "Long secret shown", {
    view: {
      s: "done",
      offer: { ...TEXT_OFFER, size: LONG_SECRET.length },
      blob: new Blob([LONG_SECRET]),
      sha256: SHA256,
    },
    path: "direct",
  }),
  receive("Receive", "Secret declined", { view: { s: "declined", text: true } }),

  ...PROBLEMS.map((key) => receive("Receive problems", key, problem(key, false))),
  ...PROBLEMS.filter((key) => key in en.secret.problems).map((key) =>
    receive("Receive problems, secret", key, problem(key, true)),
  ),
];
