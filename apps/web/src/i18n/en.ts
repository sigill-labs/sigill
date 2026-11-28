// English text. sv.ts must have the same keys; messages.test.ts checks it.
// Plain strings, or functions for text with numbers or names in it.

import type { LogFields } from "@fidant/protocol";
import type { Line } from "../how/traces.ts";
import type { Kind, Tie } from "../lib/server-facts.ts";

/** A place on the /how/traces explorer and the traces it keeps. */
export type Place = { name: string; kept: string; never: string; lines: readonly Line[] };

// Every field a server log line can carry (plus `event`, which names the log line), with what it is
// and why we keep it. Keyed by LogFields, so a new field fails the typecheck until it is described
// here and in sv.ts. Event names are typed by LogEvent in @fidant/protocol.
const logFields: Record<"event" | keyof LogFields, readonly [string, string]> = {
  event: [
    "what happened, like a link being opened or a connection being refused",
    "So we can see how the service behaves and find what went wrong.",
  ],
  link: [
    "the first 6 characters of a link ID",
    "So we can follow one link through the log when something goes wrong, without being able to find the link itself.",
  ],
  links: [
    "how many links a sender has",
    "To see how the service is used and to spot a sender with an unusual number of links.",
  ],
  bytes: ["message sizes", "To spot oversized or broken messages and to size the server."],
  reason: [
    "why a link or connection was refused",
    "To see why connections fail, so we can fix the cause.",
  ],
  code: [
    "what was wrong with a message the server rejected",
    "To find bugs in the browser app or the server.",
  ],
  path: [
    "whether each connection was direct, went through our relay or failed",
    "To know how often connections need our relay, which tells us how big it must be.",
  ],
  port: [
    "where on its machine the server can be reached (its port number)",
    "To confirm the server started where it should.",
  ],
};

export type Nouns = Record<
  Kind,
  {
    label: string;
    The: string;
    the: string;
    it: string;
    encrypted: string;
    data: string;
    key: string;
    unlocks: string;
    seen: string;
  }
>;

const items: Nouns = {
  file: {
    label: "File data",
    The: "The file",
    the: "the file",
    it: "it",
    encrypted: "encrypted",
    data: "file data",
    key: "the part of that link that unlocks the file",
    unlocks: "the part that unlocks the file",
    seen: "the encrypted file passing through, with its size rounded up so the exact size stays hidden",
  },
  secret: {
    label: "Secret",
    The: "The secret",
    the: "the secret",
    it: "it",
    encrypted: "encrypted",
    data: "secrets",
    key: "the part of that link that unlocks the secret",
    unlocks: "the part that unlocks the secret",
    seen: "the encrypted secret passing through, which shows nothing of its length",
  },
  unknown: {
    label: "Data",
    The: "What is shared",
    the: "what is shared",
    it: "it",
    encrypted: "encrypted",
    data: "what is shared",
    key: "the part of that link that unlocks what is shared",
    unlocks: "the part that unlocks what is shared",
    seen: "the encrypted data passing through, with its size rounded up so the exact size stays hidden",
  },
};

export const en = {
  product: "Fidant",
  // Browser tab titles, one per page (WCAG 2.4.2).
  tabTitles: {
    landing: "Fidant: private file transfer",
    send: "Send a file – Fidant",
    secret: "Share a secret – Fidant",
    receive: "Receive – Fidant",
    privacy: "Privacy – Fidant",
    how: "How it works – Fidant",
    about: "About – Fidant",
    terms: "Terms of use – Fidant",
    security: "Security – Fidant",
    notFound: "Page not found – Fidant",
    insecure: "Secure connection needed – Fidant",
  },
  notFound: {
    title: "Page not found",
    body: "There's no page at this address. It may have moved, or the link may be mistyped.",
    home: "Go to the front page",
  },
  noscript:
    "The encryption runs in your browser, so Fidant needs JavaScript. Turn it on to send or receive a file.",
  openTransfer: {
    send: "A file transfer is still open in this tab.",
    secret: "A secret is still being shared from this tab.",
    receive: "A transfer to you is still open in this tab.",
    back: "Go back to it",
  },
  menu: {
    language: "Language",
    theme: "Theme",
    themes: { system: "System", light: "Light", dark: "Dark" },
    label: "Main",
    send: "Send",
    secret: "Share a secret",
    how: "How it works",
    privacy: "Privacy",
  },
  landing: {
    title: "Send a file only the recipient can open.",
    lede: "Fidant encrypts the file in your browser before it goes to the person you choose. It is never stored, and only someone with the link can open it.",
    cta: "Send a file",
    how: "Read how it works",
    noAccount: "No account. Nothing stored.",
    linkHeading: "The whole trick is in the link",
    linkId: "Link ID. Our server sees this and uses it to connect the two browsers.",
    linkKey: "Key. Browsers never send what comes after # to any server.",
    stepsHeading: "What happens",
    steps: [
      ["Choose a file", "It stays on your computer. Nothing is uploaded."],
      ["Add who it's for", "Each person gets their own link, which works once."],
      [
        "Share the link",
        "When they open it, the file goes from your browser to theirs, encrypted the whole way.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    serverHeading: "What our server knows",
    neverHeading: "Our server never gets",
    seesHeading: "Our server sees",
    relayNote:
      "If the two browsers can't connect directly and our relay is available, the file passes through the relay instead, still encrypted. The relay then sees roughly how big the file is, and can't unlock it. Either way, each browser asks the relay for its public address, so the relay sees both IP addresses and can usually tell that they belong together.",
    caveat: "The catch: since nothing is stored, keep your tab open until the file has arrived.",
    tryHeading: "Try it on yourself",
    tryBody:
      "Send a file to yourself, open the link on your phone and watch it arrive. It takes about a minute.",
    tryCta: "Send a file to yourself",
    trySecret: "Or share a secret",
  },
  how: {
    title: "How it works",
    lede: "What happens to your file, step by step. In short: it is locked on your computer, and only someone with the link can unlock it.",
    sections: {
      stays: {
        heading: "Your file stays on your computer",
        body: [
          "You choose a file in your browser. It is not uploaded anywhere.",
          "Your browser locks it before it leaves your computer.",
        ],
      },
      link: {
        heading: "You get a link with the key inside",
        body: [
          "You get one link for each person. Each link works once. You send it yourself, for example by email or chat.",
          "The key that unlocks the file is the part after the # sign. Browsers never send that part to us, so we never see the key.",
          "Anyone with the link can open the file. Send each link only to the person it is for.",
        ],
      },
      open: {
        heading: "They open the link while your page is open",
        body: [
          "Nothing is stored, so your page must stay open until they have the file.",
          "Our server helps the two browsers find each other, like an operator connecting a phone call. It passes on a few small messages. Those that set up the connection are locked, so it can't read them.",
          "They see the file's name and size and choose whether to download it.",
        ],
      },
      direct: {
        heading: "The file goes straight to them, locked",
        body: [
          "When the networks allow it, the file goes straight from your computer to theirs. It stays locked the whole way.",
          "Their browser unlocks it and checks that it is exactly the file you sent.",
          "Like on a video call, each device can see the other's internet address.",
        ],
      },
      relay: {
        heading: "Sometimes it goes through our relay",
        body: [
          "Some networks can't connect directly to each other. This is common on mobile data and office networks.",
          "Then, if the relay is available, the file goes through our relay in Stockholm instead, still locked.",
          "The relay can't open the file and doesn't keep it.",
          "It sees the internet address of each device and roughly how big the file is.",
        ],
      },
      never: {
        heading: "What is left behind",
        body: [
          "We never see your file, its name or the key that unlocks it. Our relay never sees the key at all.",
          "What our server and relay do see, they keep in memory or in short logs, apart from monthly traffic totals. The two browsers keep a few traces too, and the recipient keeps the file.",
        ],
      },
      encryption: {
        heading: "It is locked twice",
        body: [
          "Your browser locks the file with a key that comes from the link. Without the link, nobody can unlock it.",
          "The connection between the two browsers is locked as well, so the file is locked twice on its way.",
        ],
      },
      transfer: {
        heading: "It goes in small numbered pieces",
        body: [
          "Your browser sends the file in pieces of the same size, each locked and numbered.",
          "No piece is sent until the recipient has said yes to the file.",
        ],
      },
      verification: {
        heading: "The recipient's browser checks it",
        body: [
          "When the last piece has arrived, the recipient's browser checks that the file is exactly the one you sent.",
          "If anything is missing or changed, the recipient's browser throws the file away. You see that it arrived only when the check has passed.",
        ],
      },
      masking: {
        heading: "Its size is blurred",
        body: [
          "Anyone watching the traffic can see roughly how much is sent, but not the exact size of your file.",
          "A shared secret always looks the same size, however long it is.",
        ],
      },
      protection: {
        heading: "What protects you, and what doesn't",
        body: [
          "Each risk, and what in Fidant stands against it.",
          "And the risks Fidant can't protect you from, such as someone else getting hold of the link.",
        ],
      },
      tech: {
        heading: "The words, explained",
        body: [
          "Fidant is built on WebRTC, the technology browsers use for video calls. This page explains it and the other technical words on these pages, such as STUN and TURN.",
        ],
      },
    },
    more: "Want the details? The privacy page says exactly what our server sees and what it logs.",
    moreLink: "Read the privacy page",
    readMore: "Read more",
    steps: "Steps",
    overview: "Overview",
    next: "Next",
    copyLink: "Copy link to this part",
    copied: "Link copied",
    copyFailed: "Couldn't copy the link. Copy it from the address bar instead.",
    /** Short names for the steps in the side menu. */
    nav: {
      stays: "File",
      encryption: "Encryption",
      link: "Link",
      open: "Connecting",
      direct: "Direct",
      relay: "Relay",
      transfer: "Transfer",
      verification: "Verification",
      masking: "Masking",
      never: "Traces",
      protection: "Protection",
      tech: "Words",
    },
  },
  insecure: {
    title: "This page needs a secure connection",
    body: "Files are encrypted in your browser, which only works over a secure connection. Open this page with an address that starts with https://.",
  },
  common: {
    techDetails: "Technical details",
    close: "Close",
    size: "Size",
    type: "Type",
    typeMissing: "Not given",
    you: "You",
    sender: "Sender",
    localhost:
      "This page is open on localhost, so the links won't work on other computers. Open the network address the server printed instead.",
  },
  connection: {
    why: "Why?",
    more: "More about how it works",
    direct: {
      label: "Direct connection",
      explain:
        "The file goes straight between the two devices. Each side can see the other's internet address, like on a video call.",
    },
    relay: {
      label: "Through our relay",
      explain:
        "The two networks couldn't connect directly, which is common on mobile data and office Wi-Fi. So the file goes through our relay in Stockholm. It stays locked the whole way: the relay can't open it and doesn't keep it. The relay sees both devices' internet addresses and roughly how big the file is.",
    },
  },
  format: {
    bytes: (n: number) => (n === 1 ? "1 byte" : `${n.toLocaleString("en-US")} bytes`),
    progress: (percent: string, done: string, total: string) => `${percent} · ${done} of ${total}`,
    timeLeft: (duration: string) => `About ${duration} left`,
  },
  send: {
    mode: {
      label: "What to send",
      file: "File",
      secret: "Secret",
      locked:
        "One send at a time. You can switch when every link here has delivered, or when you remove them.",
    },
    continue: "Continue",
    title: "Send a file",
    lede: "Choose a file, then add each person you want to send it to. Your file is sent from this browser to them. It's encrypted the whole way and never uploaded or stored.",
    step: (n: number) => `Step ${n} of 3`,
    peopleHeading: "Add recipients",
    peopleLede:
      "Add each person you want to send to. Each one gets their own link, which works once.",
    linksHeading: "Share the links",
    linksLede:
      "Send each person their own link, for example in a chat or an email. Keep this page open until everyone has received it.",
    change: "Change",
    connectionOptions: "Connection options",
    addEmail: "Add recipient and email link",
    addEmailCheck: "Add recipient and email link with safety number",
    // One entry per kind of link; a later kind (BankID) adds its own.
    linkKind: {
      label: "Verification",
      plain: "Link",
      check: "Safety number",
    },
    share: "Share",
    shareFor: (name: string) => `Share link for ${name}`,
    // No-break spaces keep the count on one line.
    sendingBar: (delivered: number, total: number) =>
      `${delivered}\u00a0of\u00a0${total}\u00a0delivered`,
    keepOpen: "Keep the tab open",
    // The bar shows these as two lines without full stops; a sentence built from them adds its own.
    allDone: "Every link has delivered the file",
    closeTab: "You can close this tab",
    notifyMe: "Notify me",
    notifyOn: "Notifications on",
    notifyBlocked: "Notifications blocked",
    summary: (done: number, total: number) => `${done} of ${total} links have delivered the file`,
    delivered: "Delivered",
    doneTitle: "All delivered",
    lostServer:
      "Lost the connection to the server. Trying to reconnect… Files already on their way can finish. Nobody new can connect until it's back, so keep this page open.",
    fromLabel: "Your name",
    optional: "(optional)",
    fromHint: "Shown to the people you send to.",
    fromHintEmail:
      "If we email a link, your name also goes in that email, marked as not verified. Our server puts it there and doesn't keep it.",
    allowRelay: "Use our relay if needed",
    allowRelayHint: (kind: Kind) =>
      `Some networks block direct connections. Then ${items[kind].the} goes through our relay in Stockholm, still encrypted. The relay sees both IP addresses${kind === "file" ? " and roughly the size" : ""}, but can't open ${items[kind].it}. If you untick this, our server stops giving out relay credentials for this send. The relay still sees each IP address, because each browser learns its public address from the relay.`,
    fromError: {
      unsafe:
        "Your name contains characters that can't be sent, or three or more spaces in a row. Remove them and try again.",
      tooLong:
        "Your name and the file name are too long together. Shorten your name or rename the file.",
    },
    chooseFile: "Choose a file",
    orDrop: "or drop it here",
    fileError: {
      unsafe:
        "This file name contains characters that can't be sent, or three or more spaces in a row. Rename the file and try again.",
      tooLong: "This file name is too long to send. Rename the file and try again.",
    },
    fileChosen: (name: string, size: string) => `File chosen: ${name}, ${size}`,
    preparing: "Getting the file ready…",
    readFailed: "Couldn't read the file. Choose it again.",
    hashPending: "Not ready yet",
    locked: "Remove everyone to change your name or file.",
    sendAnother: "Send another file",
    recipientLabel: "Who is it for?",
    recipientPlaceholder: "Their name",
    add: "Add recipient",
    addCheck: "Add recipient with safety number",
    nameError: {
      missing: "Enter a name.",
      taken: "That name is already on the list.",
    },
    emailChoice: "Email the link for me (less private)",
    emailMore: "What emailing a link means",
    emailLabel: "Their email address",
    emailError: "Enter a valid email address, like name@example.com.",
    emailNotice:
      "Our server will see this link's key once, to write the email. It doesn't store or log the key, but our mail service and anyone who reads the email on its way can see the key too. The link, key included, stays in the recipient's mailbox: anyone who can read that mailbox could receive the file. For this link, our server could also put itself between you and the recipient. To see if it does, add them with a safety number and compare it with the recipient. Sending the link yourself avoids all of this.",
    check: {
      hint: (kind: Kind) =>
        `With a safety number, you compare 6 digits with them by phone or in person before ${items[kind].the} is sent, so you know nobody is in between.`,
      ask: (name: string) => `Ask ${name} to read the number on their screen. Does it match?`,
      matches: "It matches",
      differs: "It differs",
      matchesFor: (name: string) => `It matches for ${name}`,
      differsFor: (name: string) => `It differs for ${name}`,
      titleFor: (name: string) => `Safety number for ${name}`,
      later: "Not now",
      compare: "Compare number",
      compareFor: (name: string) => `Compare number for ${name}`,
      waiting: "You said it matches. It goes once they confirm too.",
      differed:
        "The numbers didn't match, so nothing was sent. Someone may have been in between. The link still works if you want to try again.",
      expired:
        "The safety number wasn't confirmed within 5 minutes, so nothing was sent. The link still works if you want to try again.",
      limit: (times: number) =>
        `The check failed ${times} times, so this link no longer works. Someone may be trying to get between you. Add the recipient again for a new link.`,
    },
    fileFirst: "Choose a file first.",
    full: (max: number) => `You can send to up to ${max} people at a time.`,
    recipients: "Recipients",
    steps: {
      waiting: "Waiting",
      checking: "Checking",
      opened: "Opened",
      receiving: "Receiving",
      delivered: "Done",
    },
    status: {
      waiting: (name: string) => `Waiting for ${name}'s link to be opened`,
      connecting: (name: string) => `Connecting through ${name}'s link…`,
      checking: (name: string) => `${name}'s link has been opened. Compare the safety number.`,
      offered: (name: string) => `${name}'s link has been opened`,
      declined: (name: string) =>
        `${name}'s link was opened and the file was declined. The link still works.`,
      receiving: (name: string) => `Sending through ${name}'s link`,
      delivered: (name: string) => `Delivered through ${name}'s link`,
      interrupted: (name: string) =>
        `The transfer through ${name}'s link was interrupted. The link can be opened again to retry.`,
      failed: (name: string) =>
        `The file didn't arrive intact through ${name}'s link. The link can be opened again to retry.`,
      senderOutdated: (name: string) =>
        `${name}'s link was opened on a newer version of Fidant. To send through a new link, reload this page and add ${name} again. Reloading clears every link on this page.`,
      recipientOutdated: (name: string) =>
        `${name}'s link was opened on an older version of Fidant. Nothing is wrong with the file. Ask them to reload that page.`,
    },
    noConnect: (name: string) =>
      `${name}'s link was opened but couldn't connect to your computer. The link still works if they try again.`,
    noRelay: (name: string) =>
      `${name}'s link was opened but couldn't connect directly. Allowing our relay may let it connect when they try again.`,
    /** `to` is the masked address, like a***@example.se. */
    mail: {
      sending: (to: string) => `Sending email to ${to}…`,
      sent: (to: string) => `Email sent to ${to}`,
      failed: (to: string) =>
        `Email not sent to ${to}. To try again, remove this recipient and add them again, or add them without an email address and share the link yourself.`,
      limit: (to: string) =>
        `Email not sent to ${to}: too many emails right now. Copy the link below and share it yourself. It's a new link, because our server had seen the first link's secret.`,
      verifying: (to: string) => `Code sent to ${to}`,
      verified: (to: string) => `Verified with the code sent to ${to}`,
      lost: (to: string) =>
        `The link emailed to ${to} stopped working when the connection to our server dropped. To send it again, remove this recipient and add them again.`,
    },
    progressFor: (name: string) => `Progress for ${name}`,
    copy: "Copy link",
    copyFor: (name: string) => `Copy link for ${name}`,
    copyNote: {
      copied: "Copied",
      failed: "Couldn't copy. Select the link below and copy it yourself.",
    },
    remove: "Remove",
    removeFor: (name: string) => `Remove ${name}`,
    linkFor: (name: string) => `Link for ${name}`,
  },
  receive: {
    connecting: "Connecting to the sender…",
    /** The code step of a link that was emailed. `to` is the masked address, like a***@example.se. */
    verify: {
      title: "Confirm your email to open this link",
      body: (to: string) => `We'll email a code to ${to}.`,
      send: "Send me a code",
      sending: "Sending a code…",
      codeLabel: "Code from the email",
      submit: "Continue",
      results: {
        sent: "Code sent. Check your email.",
        wait: "No new code yet. Try again in a minute, or in an hour if this keeps happening.",
        limit: "Too many codes for this link. Ask the sender to send you the link again.",
        failed: "We couldn't send the code. Try again in a moment.",
        wrong: "That code is wrong. Try again.",
        expired: "The code has expired. Ask for a new one.",
        tries: "Too many wrong tries. Ask for a new code.",
      },
    },
    /** `from` is the sender's typed name, or "" when they gave none. */
    offerTitle: (from: string) =>
      from ? `${from} wants to send you a file` : "You've been sent a file",
    unverified: "Name typed by the sender, not verified.",
    memoryWarning:
      "This browser keeps the whole file in memory until you save it, which can slow down or crash the tab. Chrome or Edge on a computer saves straight to disk.",
    download: "Download",
    decline: "Decline",
    offerCaption: (from: string) =>
      `Sent from ${from ? `${from}'s` : "the sender's"} computer to yours. Encrypted, never stored on a server.`,
    receivingTitle: "Downloading…",
    progressLabel: "Download progress",
    receivingCaption: "Receiving from the sender. Keep this tab open until it's done.",
    doneTitle: "Download complete",
    verified: "We checked it: this is exactly the file that was sent.",
    autoDownload: "Your browser should be saving it now. Didn't see it?",
    onceNotice: "This link works once, and only while the sender's page is open.",
    savedWhereChosen: "It's saved where you chose.",
    saveFile: "Save file",
    doneCaption: "Sent from the sender's computer to yours. Encrypted the whole way.",
    declinedTitle: "You declined the file",
    declinedBody:
      "You can close this tab. If you change your mind, the link still works while the sender's page is open.",
    showAgain: "Show the file again",
    tryAgain: "Try again",
    check: {
      heading: "Safety number",
      read: "Read this number to the sender.",
      matches: "They said it matches",
      differs: "They said it differs",
      waiting: "Waiting for the sender to say it matches too.",
      why: "The number comes from this connection. If someone sat between you and the sender, your screens would show different numbers.",
      expires: "The safety number expires after 5 minutes.",
    },
    whatHappened: "What happened",
    encryptionLabel: "Encryption",
    encryption: "AES-256-GCM, end to end. The key is in your link and never leaves this browser.",
    encryptionEmailed: "AES-256-GCM. Fidant emailed this link, so our server had its key once.",
    sha256Checked: "SHA-256, checked",
    // Keyed by what went wrong; the page stores the key, so a language switch re-renders it.
    problems: {
      badLink: {
        title: "This link doesn't work",
        body: "Part of it may be missing. Check that you copied all of it, or ask the sender to send it again.",
      },
      unknown: {
        title: "This link isn't active",
        body: "The file comes straight from the sender's browser, so the link only works while they have the page open. Ask them for a new link.",
      },
      unbound: {
        title: "This link no longer works",
        body: "Ask the sender to send it again.",
      },
      used: {
        title: "This link has already been used",
        body: "Each link works once. If you still need the file, ask the sender for a new link.",
      },
      busy: {
        title: "This link is busy",
        body: "Each link can be open in one place at a time, and allows only a few connection attempts in a short time. Close any other tab with this link, wait half a minute and reload this page.",
      },
      offline: {
        title: "The sender's page is closed",
        body: "The file comes straight from their browser, so it has to stay open. Ask them for a new link.",
      },
      offlineReceiving: {
        title: "The sender's page is closed",
        body: "The file comes straight from their browser, so it has to stay open. The file may not have been saved. Ask them for a new link.",
      },
      lost: {
        title: "The connection to the sender was lost",
        body: "Nothing was saved.",
      },
      differed: {
        title: "The numbers didn't match",
        body: "So nothing was received. Someone may have been in between. Try again for a new number.",
      },
      lostReceiving: {
        title: "The connection to the sender was lost",
        body: "Try again. The download continues where it stopped if it can.",
      },
      senderBusy: {
        title: "This link is busy",
        body: "The sender's page may not have noticed that the connection dropped, or the link is open in another tab. Close any other tab with this link, wait a moment and try again. The download continues where it stopped if it can.",
      },
      checksum: {
        title: "The file didn't arrive intact",
        body: "It was changed or damaged on the way, so it was not saved. Try again, and tell the sender if it keeps happening.",
        detail: "The SHA-256 checksum of the received file did not match the sender's.",
      },
      invalid: {
        title: "Something went wrong with the transfer",
        body: "The sender's browser sent data we couldn't read, so nothing was saved.",
        detail: "A frame from the sender failed to decrypt or broke the transfer format.",
      },
      save: {
        title: "The file couldn't be saved",
        body: "Check that there's enough space on your disk.",
      },
      create: {
        title: "The file couldn't be created",
        body: "Try again, or choose another place to save it.",
      },
      connect: {
        title: "Couldn't connect to the sender's computer",
        body: "Your two computers couldn't reach each other.",
      },
      browser: {
        title: "This browser can't connect to the sender",
        body: "It may have WebRTC turned off, or be too old. Try another browser.",
      },
      noRelay: {
        title: "Couldn't connect directly to the sender",
        body: "The sender doesn't allow our relay, and your networks probably couldn't connect directly. Ask the sender to allow the relay, or try another network, for example your phone's mobile data.",
      },
      server: {
        title: "Couldn't reach the server",
        body: "The server connects you to the sender. Check your internet connection.",
      },
      outdated: {
        title: "This page is out of date",
        body: "Reload the page to receive the file.",
      },
      senderOutdated: {
        title: "The sender's page is out of date",
        body: "Nothing is wrong with the file. Ask the sender to reload their page and send you a new link.",
      },
    },
  },
  secret: {
    lede: "Paste a password, an API key or another short secret. It goes from this browser to the people you choose, encrypted the whole way, and is never uploaded or stored.",
    label: "Your secret",
    hint: (max: number) => `Up to ${max.toLocaleString("en-US")} characters.`,
    count: (length: number, max: number) =>
      `${length.toLocaleString("en-US")} of ${max.toLocaleString("en-US")} characters.`,
    tooLong: "Shorten the secret to share it.",
    lostServer:
      "Lost the connection to the server. Trying to reconnect… Secrets already on their way can finish. Nobody new can connect until it's back, so keep this page open.",
    // Only the problems after an offer whose file wording would be wrong; the rest come from receive.problems.
    problems: {
      offline: {
        title: "The sender's page is closed",
        body: "The secret comes straight from their browser, so it has to stay open. Ask them for a new link.",
      },
      offlineReceiving: {
        title: "The sender's page is closed",
        body: "The secret comes straight from their browser, so it has to stay open. The secret wasn't shown. Ask them for a new link.",
      },
      lost: {
        title: "The connection to the sender was lost",
        body: "The secret wasn't shown.",
      },
      lostReceiving: {
        title: "The connection to the sender was lost",
        body: "The secret wasn't shown. Try again to make sure you get it.",
      },
      checksum: {
        title: "The secret didn't arrive intact",
        body: "It was changed or damaged on the way, so it was not shown. Try again, and tell the sender if it keeps happening.",
        detail: "The SHA-256 checksum of the received secret did not match the sender's.",
      },
      invalid: {
        title: "Something went wrong with the transfer",
        body: "The sender's browser sent data we couldn't read, so nothing was shown.",
        detail: "A frame from the sender failed to decrypt or broke the transfer format.",
      },
      save: {
        title: "The secret couldn't be shown",
        body: "This browser couldn't read the secret it received. Ask the sender to send it again.",
      },
    },
    first: "Write or paste the secret first.",
    locked: "Remove everyone to change your name or secret.",
    sendAnother: "Send another secret",
    allDone: "Every link has delivered the secret",
    summary: (done: number, total: number) => `${done} of ${total} links have delivered the secret`,
    emailNotice:
      "Our server will see this link's key once, to write the email. It doesn't store or log the key, but our mail service and anyone who reads the email on its way can see the key too. The link, key included, stays in the recipient's mailbox: anyone who can read that mailbox could receive the secret. For this link, our server could also put itself between you and the recipient. To see if it does, add them with a safety number and compare it with the recipient. Sending the link yourself avoids all of this.",
    // Only the statuses whose file wording would be wrong; the rest come from send.status.
    status: {
      declined: (name: string) =>
        `${name}'s link was opened and the secret was declined. The link still works.`,
      failed: (name: string) =>
        `The secret didn't arrive intact through ${name}'s link. The link can be opened again to retry.`,
      recipientOutdated: (name: string) =>
        `${name}'s link was opened on an older version of Fidant. Nothing is wrong with the secret. Ask them to reload that page.`,
    },
    unsendable: (name: string) =>
      `The secret wasn't sent through ${name}'s link, because its length would have shown on this connection. The link still works.`,
    offerTitle: (from: string) =>
      from ? `${from} sent you a secret` : "You've been sent a secret",
    show: "Show",
    receivingTitle: "Opening the secret…",
    doneTitle: "Here's the secret",
    textLabel: "The secret",
    notSaved: "It isn't saved anywhere. Copy it before you close this tab.",
    copy: "Copy secret",
    copyNote: {
      copied: "Copied",
      failed: "Couldn't copy. Select the secret in the box above and copy it yourself.",
    },
    declinedTitle: "You declined the secret",
    showAgain: "Show the secret again",
  },
  server: {
    heading: "What our server has right now",
    seesLabel: "Sees",
    holdsLabel: "Holds",
    passedOnLabel: "Passed on",
    fileDataLabel: (kind: Kind) => items[kind].label,
    logsLabel: "Logs",
    afterwardsLabel: "Afterwards",
    seesSender:
      "Your IP address and the usual browser details any website gets, and the same for each recipient when they open their link.",
    seesRecipient: "Your IP address and the usual browser details any website gets.",
    senderHolds: ({
      online,
      links,
      connected,
      relay,
      emailed,
      sending,
      mailed,
      kind,
    }: {
      kind: Kind;
      online: boolean;
      links: number;
      connected: number;
      /** Whether the sender allows our TURN relay. */
      relay: boolean;
      /** Hosted links the server emails or may be emailing. */
      emailed: number;
      /** Of those, links whose email the server may still be sending. */
      sending: number;
      /** Whether this page ever asked the server to email a link. */
      mailed: boolean;
    }) => {
      if (!online) {
        return mailed
          ? "Only scrambled counts of the emails it sent for you, for up to an hour, once it notices the connection has closed. That takes up to a minute if the network dropped. If the network dropped during a transfer, it first keeps that transfer's place for up to 30 seconds, within that minute, so this page can take it back when it reconnects."
          : "Nothing once it notices the connection has closed. That takes up to a minute if the network dropped. If the network dropped during a transfer, it first keeps that transfer's place for up to 30 seconds, within that minute, so this page can take it back when it reconnects.";
      }
      const choice = relay
        ? "Your choice to allow our relay."
        : "Your choice not to allow our relay.";
      const counts = mailed
        ? " Scrambled counts of the emails it sent for you, for up to an hour."
        : "";
      if (links === 0) {
        return `No links yet. ${choice}${counts}`;
      }
      const ids = links === 1 ? "The ID of your link" : `The IDs of your ${links} links`;
      const email =
        emailed === 0
          ? ""
          : emailed === 1
            ? " For the link it emails: the recipient's email address and the codes sent there."
            : ` For the ${emailed} links it emails: the recipients' email addresses and the codes sent there.`;
      const key =
        sending === 0
          ? `${ids}, never ${items[kind].unlocks}.${email}`
          : `${ids}.${email} While it sends an email, also ${items[kind].key}, and your name.`;
      const held = `${key} ${choice}${counts}`;
      if (connected === 0) {
        return held;
      }
      const who = connected === 1 ? "1 recipient" : `${connected} recipients`;
      return `${held} ${who} connected right now.`;
    },
    /** `emailed`: the link is one the server emailed. */
    recipientHolds: (tie: Tie, emailed: boolean, kind: Kind) =>
      (emailed
        ? {
            paired: `The ID of your link, your email address, that this tab entered the right code, and that this page is connected to the sender. It had ${items[kind].unlocks} only while it emailed you the link.`,
            unpaired:
              "Your email address, which the sender gave for this link, the latest code it emailed you and whether this tab entered it. Only the sender's page can keep them there.",
            closed:
              "Nothing about this page once it notices the connection has closed, which takes up to a minute if the network dropped, apart from whether this tab entered the right code. If the network dropped during the transfer, it first keeps this page's place in it for up to 30 seconds, within that minute, so this page can take it back when it reconnects. Only the sender's page can keep that, your link's ID and your email address there.",
          }
        : {
            paired: `The ID of your link, never ${items[kind].unlocks}, and that this page is connected to the sender.`,
            unpaired:
              "Nothing that ties this page to your link. Only the sender's page can keep your link's ID there.",
            closed:
              "Nothing about this page once it notices the connection has closed, which takes up to a minute if the network dropped. If the network dropped during the transfer, it first keeps this page's place in it for up to 30 seconds, within that minute, so this page can take it back when it reconnects. Only the sender's page can keep your link's ID there.",
          })[tie],
    /** `size` is already formatted, like "9.2 KB". `emailed`: the server emailed a link on this page. */
    passedOn: (messages: number, size: string, emailed: boolean) =>
      messages === 0
        ? "Nothing yet."
        : `${messages} ${messages === 1 ? "setup message" : "setup messages"} (${size}), all encrypted so the server can't read them${emailed ? ", except for a link it emailed, whose key it had" : ""}.`,
    fileData: (kind: Kind) => `None. ${items[kind].The} goes directly between browsers.`,
    fileDataRelayed: (kind: Kind) =>
      `None. The browsers couldn't connect directly, so ${items[kind].the} passes ${items[kind].encrypted} through our relay instead.`,
    relaySeesLabel: "Our relay sees",
    relaySees: (kind: Kind) =>
      `Both browsers' IP addresses and ${items[kind].seen}. It can't unlock ${items[kind].the}.`,
    relayLogsLabel: "Our relay logs",
    relayLogs: (kind: Kind) =>
      `No log of the traffic by default. Only while we fix a fault or stop abuse: connection times, IP addresses and how much data passed through, for at most 7 days. Never names, keys or ${items[kind].data}. While it renews its certificate, it also logs the addresses that reach it on port 80, never browsers', for about five weeks.`,
    relayKeepsLabel: "Our relay keeps",
    relayKeeps: (kind: Kind) =>
      `Nothing of ${items[kind].the} once ${items[kind].it} has passed through. Log lines from fixing a fault or stopping abuse are deleted within 7 days.`,
    /** `mailed`: this page asked the server to email a link. */
    senderAfterwards: (online: boolean, mailed: boolean): string =>
      `${
        online
          ? "When you close this tab, the server forgets your links, within a minute at most. Its log lines stay."
          : "Your links are gone from the server within a minute of the connection closing. Its log lines stay."
      }${mailed ? " So do scrambled counts of the emails it sent for you, for up to an hour." : ""}`,
    /** `emailed`: the link is one the server emailed. */
    afterwardsRecipient: (emailed: boolean): string =>
      emailed
        ? "When this page disconnects, the server drops what it has about this page, within a minute at most, apart from what the code check needs: your email address and whether this tab entered the right code stay until the sender's page closes, and a scrambled count of the codes sent to your address and a scrambled count of the codes your IP address asked for, each for up to an hour. Its log lines stay."
        : "When this page disconnects, the server drops what it has about this page, within a minute at most. Its log lines stay.",
    logs: (kind: Kind) =>
      `What happened, like a link being opened, with ${new Intl.ListFormat("en", {
        type: "conjunction",
      }).format(
        Object.entries(logFields)
          .filter(([field]) => field !== "event")
          .map(([, [what]]) => what),
      )}. Never names, keys, ${items[kind].data} or IP addresses.`,
  },
  footer: {
    label: "Site",
    file: "Send a file",
    tagline: "Files encrypted in your browser. Only the link can unlock them.",
    about: "About",
    terms: "Terms",
    security: "Security",
    source: "Source code",
    license: "Open source, MIT license",
  },
  preview: {
    receiveTitle: "Sent to you with Fidant",
    receiveDescription:
      "Open the link to receive it. It's encrypted the whole way, and the link works only while the sender's page is open.",
  },
  about: {
    title: "About Fidant",
    lede: "Fidant is a way to send a file to someone without having to trust anyone in between, including us.",
    sections: [
      {
        heading: "Who runs it",
        body: [
          "Fidant is an open-source project with no company behind it yet. It is a proof of concept, not a commercial service.",
          "There are no ads, no accounts and no tracking.",
        ],
      },
      {
        heading: "Check it yourself",
        body: [
          "All the code that runs this site is public under the MIT license. Every claim on the privacy and security pages can be checked against it, and you can run your own copy.",
        ],
        link: ["The code on GitHub", "https://github.com/fidant-labs/fidant"],
      },
      {
        heading: "Contact",
        body: [
          "Questions, bugs and ideas go in the project's issue tracker. Issues are public, so never post files, links or personal details there. To report a security problem, follow the security page instead.",
        ],
        link: ["Open an issue", "https://github.com/fidant-labs/fidant/issues"],
      },
    ] as Sections,
  },
  terms: {
    title: "Terms of use",
    lede: "Short version: Fidant is free, comes as is, and you are responsible for what you send.",
    sections: [
      {
        heading: "As is",
        body: [
          "Fidant is a proof of concept offered free of charge, without any warranty. It can be unavailable, change or stop at any time. Don't rely on it as the only way to get an important file somewhere.",
        ],
      },
      {
        heading: "Your files are yours",
        body: [
          "Files go between browsers, encrypted the whole way. We never have the key, and we never keep it, so we can't recover, delete or check your files for you. Only send files you have the right to share, and only to people you mean to share them with.",
          "Don't use Fidant for anything illegal.",
        ],
      },
      {
        heading: "Links",
        body: [
          "Anyone who has a link can open the file it points to. Each link works once, and only while the sender's page is open.",
        ],
      },
      {
        heading: "Changes",
        body: ["These terms can change. Every change is visible in the project's public history."],
        link: ["History of this text", "https://github.com/fidant-labs/fidant/commits/main"],
      },
    ] as Sections,
  },
  security: {
    title: "Security",
    lede: "How your file is protected, what Fidant doesn't protect against, and how to tell us about a problem.",
    sections: [
      {
        heading: "How the file is protected",
        body: [
          "Your browser encrypts the file with AES-256-GCM before it leaves your computer. The key is in the part of the link after #, which browsers never send to a server.",
          "The file goes directly between the two browsers. If a network blocks that and our relay is available, it passes through the relay instead, still encrypted. Between the browsers, our server passes on a few small messages. Those that set up the connection are encrypted, so the server can't read them.",
          "The recipient's browser checks the file's SHA-256 checksum, so a file that was changed or damaged on the way is not saved.",
        ],
        link: ["How it works, step by step", "/how"],
      },
      {
        heading: "What it doesn't protect against",
        body: [
          "Anyone who gets hold of a link can open the file. Send each link only to the person it is for, over a channel you trust.",
          "The sender's name is typed by the sender and not verified.",
          "The two browsers see each other's IP address, the same as on a video call. Each browser asks our relay for its public address, so the relay sees both IP addresses and can usually tell that they belong together, even when the file goes directly. When the file goes through the relay, it also sees roughly how big the file is.",
          "Your browser runs the code our server sends it. A server that sent different code could read files, and could skip the safety number. The code is public, but browsers can't yet check that what they got matches it.",
          "A computer that is already compromised can read the file before it is encrypted or after it is unlocked.",
          "Fidant has not been independently audited yet.",
        ],
      },
      {
        heading: "Report a vulnerability",
        body: [
          "Please report security problems privately through GitHub, not in a public issue. We'll reply there.",
        ],
        link: [
          "Report privately on GitHub",
          "https://github.com/fidant-labs/fidant/security/advisories/new",
        ],
      },
    ] as Sections,
  },
  // A reader's version of docs/how-fidant-works.md, the source of truth. Change both together.
  technical: {
    sections: {
      parts: {
        heading: "The parts",
        body: [
          "Fidant has three parts. The web app runs in the sender's and the recipient's browsers and does all the encryption. Our server, in Stockholm, serves the web app and passes setup messages between the two browsers over a WebSocket. Our relay, on a machine of its own in Stockholm, tells browsers their public address (STUN). If the sender allows it and the relay is available, the relay also carries encrypted traffic (TURN). It does this when two browsers haven't reached each other directly 3 seconds after the recipient answers.",
          "There are no accounts, no file storage and no database of people or transfers. The server holds what it knows about pages and transfers only in memory. On disk the server keeps secrets of its own, among them the one the relay's secret comes from. The relay keeps its current and previous secret in a small database file.",
          "All of it is open source, so every statement on this page can be checked against the code.",
        ],
        link: ["The code on GitHub", "https://github.com/fidant-labs/fidant"],
      },
      link: {
        heading: "The link",
        body: [
          "For each recipient, the sender's browser creates a link of the form https://fidant.se/r/<link ID>#<secret>. The link ID is 16 random bytes and the secret 32 random bytes, both from the browser's cryptographic random number generator.",
          "The link ID only names the link: our server uses it to pair the sender with the recipient. The secret is in the fragment, the part after #, which browsers don't send to servers. The site also tells browsers not to send the page address on to other sites. The app never sends the secret anywhere. It only derives keys from the secret and keeps the receive page's first address, secret included, in memory. That lets the \"Go back to it\" bar return you to an unfinished transfer. The link in that bar carries only the path; following it puts the secret back in the address bar.",
          "Every recipient gets their own link ID and secret, so one recipient's link says nothing about another's.",
        ],
      },
      keys: {
        heading: "Keys",
        body: [
          "Two keys are derived from the secret with HKDF-SHA-256. Both are AES-256-GCM keys that the browser marks as non-extractable: the page can use them, but can't read them out.",
          "The signal key encrypts the setup messages. Its salt is the link ID.",
          "The file key encrypts every frame between the browsers except the first, INIT, which carries only the random transfer ID. The file key's salt is made of two random values: that transfer ID, which the sender picks for every attempt, and an attempt ID that the recipient's page picks for every new connection. So neither a retried transfer nor a replayed first frame ever reuses a key and nonce pair.",
        ],
      },
      signal: {
        heading: "Connecting the two browsers",
        body: [
          "The sender's page opens a WebSocket to our server and registers its link IDs. When the recipient opens their link, their page joins with the link ID and a random attempt ID, new for each page load and each retry. The server pairs at most one recipient page with a link at a time and tells both sides.",
          "The browsers then set up a WebRTC connection. The offer, the answer and the network candidates are encrypted with the signal key before they reach our server. Each message is bound to its link, attempt and direction, so the server can't read or change the messages. The server also can't send a message back to the side that sent it, move it to another link or replay it into another attempt. Replaying old messages can at most make one attempt fail, which dropping them would do anyway.",
          "This matters beyond privacy: the setup messages carry the fingerprints of WebRTC's own DTLS encryption. Because the server can't change them, it can't put itself between the two browsers. All of this rests on our server not having the key.",
          "That is what the safety number is for. Each browser makes a new certificate for every connection. The recipient's browser sends a commitment to its fingerprint, a hash, before the sender's browser makes its offer. Both browsers then compute six digits from the two fingerprints of their own connection. With someone in between there are two connections, so the two screens show different numbers. Because of the commitment, a party in the middle can only guess: one chance in a million per connection. The number is shown on screen only, never sent or stored.",
          "With a safety number, the recipient reads their number aloud and the sender compares it. Nothing about the file is sent until both have said it matches, and “It differs” on either side stops the attempt. Once the recipient's browser has answered an offer, it makes a new connection only when the recipient clicks Try again. Recovering a dropped route, described below, keeps the same connection and the same number. The sender's page stops offering a link after 5 attempts that ended before both confirmed, each limited to 5 minutes. An attempt the sender's page stopped because the two pages run different versions doesn't count: no safety number was shown. The check shows that nobody sat between the two browsers. It can't show that the page code itself is honest.",
          "If the connection to our server drops, both pages try to reconnect by themselves. The sender's page registers its links again. A recipient who was still connecting tries again a few times before giving up. For a minute after our server starts, it tells a recipient whose link it doesn't know yet to wait. So the recipient keeps trying while the sender's page registers the link again. A transfer that has already started doesn't need our server and carries on, as long as the route between the browsers holds.",
          "If the route between the two browsers drops while their connection is open, the pages try to get one back without starting over. The recipient's page sends its join to our server again, and the server gives both pages the connection details again. The sender's browser then looks for a route again on the same connection, with a new offer and answer, encrypted like the first and checked against the same two certificates. The keys and the safety number stay the same, and the transfer goes on where it stopped, with no click. This never adds the relay to a connection that didn't already use it. If no route comes back within 30 seconds, the attempt ends as a lost connection, and Try again continues a file's download. It needs both pages' connections to our server. A change of network can break a page's connection to our server too. Once the browsers' connection has opened, our server gives each page a random token, and a page whose connection to our server drops connects again and uses its token to take its place in the transfer back. Our server keeps that place for up to 30 seconds after a connection drops without closing, and a page that closes frees it at once. If the page doesn't come back in time, the transfer ends as a lost connection. The repeated join shows our server that this transfer's connection dropped, and when. A page that takes its place back shows it that its new IP address belongs to the same transfer. We have tested the recovery only in Chromium, with a route cut for about 6 to 8 seconds; Firefox and Safari are untested. We have tested taking a place back with a connection cut inside the browser, and in Chromium with a page whose public IP address changed behind a simulated home router in the middle of a transfer. A real change of network, such as from Wi-Fi to mobile data, is untested.",
          "The first setup message each browser sends says which version of the transfer format its page uses. If the versions differ, the browsers don't connect and nothing about the file is sent. Pages that have this check then say which of the two needs a reload. Every page of a release sends the same version, so the version reveals nothing about the transfer.",
        ],
      },
      layers: {
        heading: "Two layers of encryption",
        body: [
          "WebRTC encrypts the connection between the browsers with DTLS. Fidant doesn't rely on that alone: every frame after INIT is also encrypted with AES-256-GCM under the file key, which only the two browsers have.",
          "Each frame starts with a 10-byte header with its version, kind and sequence number. The header is authenticated with the frame, and the nonce is built from the direction and the sequence number, so the two directions never share a nonce. A browser accepts only the next sequence number, so a dropped, reordered, repeated or altered frame stops the transfer.",
        ],
      },
      frames: {
        heading: "The transfer, frame by frame",
        body: [
          "When the sender chooses the file, their browser computes its SHA-256 checksum.",
          "INIT: the sender sends the transfer ID. It is the only frame not encrypted. Changing it changes the file key, so the next frame fails to decrypt. Replaying it in a later attempt doesn't work either, because the recipient's new attempt ID changes the key.",
          "CHECK: with the safety number on, each side's answer, encrypted, once the person on that side has compared the numbers: matches or differs. META waits for both answers.",
          "META: the file name, size and type and the sender's typed name, encrypted. The recipient sees them and chooses.",
          "ACCEPT or DECLINE: the recipient's answer, encrypted. ACCEPT also says where to start: at the beginning, or after the part of the file a dropped connection left with the recipient. It proves that the recipient has the key. No file data is sent before it.",
          "CREDIT: how many chunks the sender may send, encrypted. The recipient grants 128 at a time and more as it writes them, so a slow recipient never has more than about 6 MiB waiting. A sender that gets further ahead than that is stopped.",
          "CHUNK: the file in frames of equal size, up to 48 KiB each, from where ACCEPT says.",
          "END: the whole file's exact size and the checksum computed when it was chosen.",
          "RECEIPT: the checksum the recipient computed from what arrived. The sender counts the file as delivered only when it matches. It isn't proof that the file arrived: END already carries the checksum, so a modified recipient's page, which has the key anyway, can skip every chunk and send the checksum back.",
        ],
      },
      check: {
        heading: "Checking the file",
        body: [
          "The recipient's browser hashes the file as it arrives, and checks the size, the number of chunks, the padding and the checksum against END. Only when everything matches is the file finished. A frame that fails to decrypt, a checksum that doesn't match or any other failed check throws away what was written.",
          "A lost connection that doesn't come back (see Connecting the two browsers) is different. If every frame so far checked out, the recipient's page keeps what arrived, in memory or in the file they chose to save to, and Try again continues from there. Try again makes a new connection with a new key. If the sender offers the same file again, with the same name, size, type, chunk size and sender's name, the page doesn't show the offer or a save dialog again. It tells the sender how much it already has, so only the rest is sent. With the safety number on, the number is still compared first. The checksum covers the whole file, so if the rest doesn't belong with what already arrived, the check fails. A different offer starts from the beginning, and so does a shared secret. Only that tab can continue it, and the page discards it if the transfer ends some other way. When the tab closes or reloads, what was in memory is gone. What the browser then does with an unfinished file from the save dialog hasn't been tested yet.",
          "Desktop Chromium browsers such as Chrome and Edge can write the file straight to a place on the disk the recipient chooses. Other browsers collect it in memory and start the download at the end, and for a file over 256 MiB the recipient is warned first. The download is always marked as plain binary data, whatever type the sender claims, so a file can't run as a web page on Fidant's site.",
          "Names are refused if they contain control characters, line separators, Unicode direction controls, blank filler characters or long runs of spaces. So a name ending in .exe can't be made to look like one ending in .pdf.",
        ],
      },
      padding: {
        heading: "Hiding the exact size",
        body: [
          "Anyone who can see the encrypted traffic, such as the networks on the way or our relay, sees how big the frames are. So the size is rounded up with the Padmé scheme, which adds at most 12 %, and then to whole chunks. Every chunk frame has the same size, and the padding is zeros that the recipient checks. A download that continues after a dropped connection sends only the rest, in frames of the same sizes, so someone who sees both attempts can add them up to at least the rounded size of one whole transfer, more by any chunks sent twice.",
          "The exact size travels only inside the encrypted META and END. META always has the same size, so the length of the file name doesn't show either.",
          "A shared secret is at most 32 KiB, and every shared secret is padded to exactly one chunk. The app enforces this: if a connection only allows messages too small for a 32 KiB chunk, the secret isn't sent over it, and the sender sees that it wasn't sent. Without a safety number nothing at all is sent over such a connection. With one, the two people compare the number first, as for a file, so whoever holds the link can't tell a secret from a file before both have confirmed. With every browser we tested in November 2026 (Chromium, Firefox and WebKit), the chunk is 48 KiB. So every shared secret looks the same on the wire, whatever its length, and the same as any file of up to 48 KiB sent in one attempt. A file whose download continues after a drop can need no chunk at all on the new attempt, which a shared secret never does, because it always starts over.",
        ],
      },
      travel: {
        heading: "How the file travels",
        body: [
          "Both browsers start with only our STUN service, so WebRTC tries the direct routes first, without the relay. The direct routes go over the local network, or through each side's public address, which the browser learns from our STUN service. The file then goes straight between the browsers. The sender's page shows which route each connection took.",
          "On both direct routes, each browser's request shows our STUN service its public IP address. The two browsers ask at about the same time, so our STUN service can usually tell which two addresses belong together. The browsers add the relay if you allow it, the relay is available and nothing has connected 3 seconds after the recipient answers. The relay can then learn that the two addresses belong together.",
          "On every route, each browser sees the other's IP address, like on a video call.",
        ],
      },
      relaying: {
        heading: "When the relay is used",
        body: [
          "When no direct route works, which is common on mobile data and office networks, the traffic goes through our TURN relay in Stockholm. The browsers add the relay only if the sender allows it, the relay is available and nothing has connected 3 seconds after the recipient answers. A page opened before we began adding the relay this way still reserves relay addresses from the start, until it is reloaded.",
          "To add the relay, the browsers start the connection setup again, with a new offer and answer, encrypted just like the first. A direct route can still win after that. So a connection that needs the relay starts about 3 seconds later. A direct route that is still connecting 3 seconds after the recipient answers, for example on a network that loses many packets, may end up on the relay.",
          "The relay forwards encrypted packets. It can't decrypt them and doesn't store them.",
          "To use the relay a browser needs credentials, which our server creates each time it pairs two pages, and again each time a recipient's page asks after a dropped route, and gives only to the two paired pages. A relay connection can start with them for 5 minutes, and can then run longer. Our server checks every minute that the relay can carry traffic, and offers it once a check passes. The server stops offering it after two failed checks in a row. The relay gets the secret behind the credentials from our server, sealed so that only the relay can open it.",
          "Browsers reach the relay over UDP, or over TLS on port 443 where a network allows only web traffic. The relay forwards only over UDP, and only from its own address. It refuses to forward to other machines on private or internal networks, with one accepted exception: the relay's own box (see decision 0007). It also limits how many relayed connections run at once.",
          "Once the estimated cost of our traffic for the month reaches our budget, the relay and our STUN service switch off. They stay off until the month ends, unless we switch them on again sooner, for example by raising the budget. Until then, a new transfer connects only where it can without them, for example on the same local network, and often fails elsewhere.",
        ],
      },
      norelay: {
        heading: "Refusing the relay",
        body: [
          "The sender can untick \"Use our relay if needed\". Our server then gives that send no relay credentials, only the STUN address, so an unmodified browser can't use the relay. The sender's browser also enforces the choice itself: it starts the connection without relay credentials, whatever our server sends. As a backstop, if the sender's browser still sees a relayed connection, it ends it. The backstop is best effort: a modified recipient can hide that its side goes through a relay.",
          "The limit: a modified recipient can still send its side through our relay with credentials from another pairing, or through any public relay. That recipient has the key anyway. The choice decides which infrastructure carries the encrypted traffic, not who can read the file.",
        ],
      },
      recipients: {
        heading: "Several recipients and one-time links",
        body: [
          "One send can go to up to 256 people. Each has their own link, key, connection and transfer.",
          "A link counts as used only once the recipient's RECEIPT matches. After that it is refused. A link that is already connected in one tab is refused in another, and so is a link that has had 10 connection attempts in the current 30-second window. A recipient's page that asks again after a dropped route counts as an attempt, but keeps its connection if it is refused.",
          "Until then the link can be opened again: after a decline, a dropped connection or a failed check. After a dropped connection, Try again in the same tab continues a file's download where it stopped if it can. Every new attempt has a new transfer ID and attempt ID, and so a new file key. A link with the safety number on stops working after 5 attempts that ended before both people confirmed the number. An attempt the sender's page stopped because the two pages run different versions doesn't count.",
          "Nothing is stored, so a link works only while the sender's page is open. When it closes, our server forgets its links within a minute.",
        ],
      },
      secret: {
        heading: "Sharing a secret",
        body: [
          "The Share a secret page sends a secret that the sender types or pastes. The shared secret is sent the same way as a file: the same keys, frames, checks and one-time links. Nothing is stored, so the sender's page must stay open until each recipient has the shared secret.",
          "The sender's browser turns the shared secret into a file that exists only in memory, with a fixed name and a type that marks it as a shared secret. Like any file's, the name and type travel only inside the encrypted META. A shared secret can have up to 10,000 characters, which is at most 30,000 bytes.",
          "The text box tells the browser to turn off spell checking, autocorrect, automatic capitals, autocomplete, writing suggestions and translation for it.",
          "The recipient's browser treats an offer as a shared secret only if it has exactly that type and is at most 32 KiB. Anything else is offered as a file. For a shared secret, the recipient sees the sender's typed name but not the size, and chooses Show or Decline. After Decline the link still works.",
          "Show keeps the shared secret in the browser's memory, never in a save dialog or a download. Only once the checks against END pass is it decoded and shown, as plain text with translation off. The page inserts it as text and never reads it as HTML. It isn't in a form field, whose contents a browser can save with the session. The Copy secret button puts it on the clipboard.",
          "Our server and relay handle a shared secret like any file. When the Share a secret page is loaded from our server, by typing its address, reloading or following a link, our server can see that someone opened it. The page then opens a signaling connection like every sender page, and moving to it inside the app opens one too. The server never gets the shared secret or its length, and a connection doesn't say which page opened it. But after a full load, the server can tie the connection that follows from the same address to the visit. It can then infer that this visitor shares a secret, and with how many links. A full load of any other page can give away that the visitor shares a secret too. Each sender page connects when it is first shown and stays connected while the tab is open. So when two sender connections are open at once from the same address, with no page load between them, the visitor most likely opened both the Send a file page and the Share a secret page in one tab. After a full load of the Send a file page, the second connection comes from the Share a secret page. Page visits aren't logged.",
        ],
      },
      site: {
        heading: "The site itself",
        body: [
          "The site is served only over HTTPS, and browsers are told never to use plain HTTP for it. Sending and receiving refuse to run without a secure connection.",
          "A Content Security Policy lets the pages load code, styles, fonts and connections only from our own site, and stops other sites from showing them in a frame. There are no cookies, no third-party scripts and no trackers.",
          "The setup WebSocket refuses connections opened from other sites. Limits protect the server from overload: connections in total and per address, messages per connection, pairings per link, links per sender and the size of each setup message.",
        ],
      },
      limits: {
        heading: "What it doesn't protect against",
        body: [
          "The link is the key. Anyone who gets a link can open the file or shared secret behind it until the link has been used. Send each link only to the person it is for, over a channel you trust.",
          "Your browser runs the code our server sends it. A server that sent different code could read files, and could skip the safety number. The code is public, but browsers can't yet check that what they got matches it.",
          "The sender's name is typed by the sender and not verified.",
          "The other browser sees your IP address. Each browser asks our relay for its public address, so the relay sees both IP addresses and can usually tell that they belong together. The networks on the way, and our relay when the file goes through it, also see when the transfer happens and roughly how big the file is. Our server sees both IP addresses, which recipient connects to which sender and when, and how many recipients a sender has. If a transfer's connection drops and the recipient's page asks our server again, it sees that too, and when. If a page's connection to our server drops and the page takes its place back, it sees that the new IP address belongs to the same transfer. So it learns who sends to whom, though not what.",
          "Malware on either computer can read the file before it is encrypted or after it is decrypted.",
          "When the recipient copies a shared secret, it goes to the device's clipboard, where clipboard history, clipboard sync to other devices and other apps can read it. Once a shared secret has been shown, Fidant can't reach it: it can't take it back or delete it.",
          "Fidant has not been independently audited yet.",
        ],
      },
      planned: {
        heading: "Planned: verified transfers",
        body: [
          "Not built yet. The plan: the recipient signs a receipt with BankID before they can open the file, and the receipt names the file. The key is split, and our server releases its half only after the receipt is signed. Events go into an audit log that makes tampering visible, anchored with trusted timestamps.",
          "When it ships, this page will describe it as a new mode.",
        ],
        link: [
          "The design records on GitHub",
          "https://github.com/fidant-labs/fidant/tree/main/docs/decisions",
        ],
      },
    } satisfies Record<string, Section>,
    modes: {
      send: {
        heading: "What is sent",
        items: {
          file: {
            heading: "A file",
            body: "Any file. Its name, size and type travel encrypted, and the recipient sees them and chooses to download it or decline.",
          },
          secret: {
            heading: "A shared secret",
            body: "Up to 10,000 characters the sender types or pastes, such as a password. It travels like a file, padded to a fixed size, and the recipient's page shows it as text and never downloads it.",
          },
        },
      },
      link: {
        heading: "How the link reaches the recipient",
        items: {
          link: {
            heading: "The sender passes it on",
            body: "The sender copies each link and sends it themselves, for example by chat or email. The key in the link never reaches our server.",
          },
        },
      },
      route: {
        heading: "The route the traffic takes",
        items: {
          local: {
            heading: "Direct, on the same network",
            body: "When both browsers are on the same local network, they connect over their local addresses. The file goes straight between them, and our server and relay see none of it. Each browser still asks our STUN service for its public address. A test in our suite puts both browsers on one simulated network and checks that they connect over their local addresses and that nothing leaves that network but the browsers' connections to our server and their STUN requests.",
          },
          stun: {
            heading: "Direct, through public addresses",
            body: "Each browser asks our STUN service for its public address. The file then goes straight between the browsers over the internet.",
          },
          relay: {
            heading: "Through our relay",
            body: "When nothing has connected 3 seconds after the recipient answers and the relay is available, the browsers add our TURN relay in Stockholm. Unless a direct route still wins, the encrypted traffic then goes through the relay, over UDP or over TLS on port 443. The relay forwards packets it can't decrypt and doesn't store them.",
          },
          norelay: {
            heading: "Relay refused",
            body: "The sender can refuse our relay for a send. Our server then gives no relay credentials, and a connection with no direct route fails.",
          },
        },
      },
    },
    glossary: {
      webrtc: [
        "WebRTC",
        "The technology built into every modern browser for connecting two browsers directly, best known from video calls. Fidant uses it to carry the file between the browsers. The words below are its parts, and the ones Fidant adds.",
      ],
      signaling: [
        "Signaling",
        "Passing the setup messages between two browsers before they can reach each other. WebRTC leaves this to the app. Fidant passes them through our server, encrypted so the server can't read or change them.",
      ],
      websocket: [
        "WebSocket",
        "A lasting two-way connection between a page and a server. Fidant's pages keep one open to our server to pass the setup messages.",
      ],
      sdp: [
        "Offer and answer",
        "The setup messages that describe each side of a WebRTC connection, including the fingerprint of its DTLS certificate. The sender's browser makes the offer and the recipient's browser the answer.",
      ],
      ice: [
        "Candidates",
        "The addresses at which a browser might be reached: on the local network, its public address, or an address on a relay. The two browsers swap candidates and try pairs of them until one works. WebRTC calls this process ICE.",
      ],
      stun: [
        "STUN",
        "A service that tells a browser its public address: the address the internet sees when the browser is behind a router. Our STUN service runs on the same machine as our relay.",
      ],
      turn: [
        "TURN",
        "A relay that forwards the traffic between two browsers that can't reach each other directly. Our relay is a TURN server. It forwards encrypted packets that it can't read.",
      ],
      dtls: [
        "DTLS",
        "The encryption WebRTC always puts on the connection between two browsers, much like the TLS that HTTPS uses. Each browser checks the other's certificate against the fingerprint in the offer or answer.",
      ],
      channel: [
        "Data channel",
        "A WebRTC connection that carries data instead of sound and video. Fidant sends its frames over one.",
      ],
      aes: [
        "AES-256-GCM",
        "The encryption Fidant adds on top of DTLS, with a 256-bit key. It also detects any change to what it encrypted.",
      ],
      hkdf: [
        "HKDF-SHA-256",
        "A standard way to derive several keys from one secret. Fidant derives the signal key and the file key from the secret in the link.",
      ],
      sha: [
        "SHA-256",
        "A checksum: any change to a file, however small, gives a completely different value. The recipient's browser compares the file's checksum with the sender's.",
      ],
      nonce: [
        "Nonce",
        "A number that must never be used twice with the same key. Fidant builds it from the direction and the frame's sequence number.",
      ],
      fragment: [
        "Fragment",
        "The part of an address after the # sign. Browsers don't send it to servers, so that is where the link keeps its secret.",
      ],
      padme: [
        "Padmé",
        "A way to round a size up so that it shows only roughly. It adds at most 12 %.",
      ],
      hmac: [
        "HMAC",
        "A checksum made with a key. Only someone who has the key can make or check it.",
      ],
    },
    linkRisks: {
      heading: "Who can see the key",
      body: ["Who else can see the key depends on the channel the link travels over."],
      columns: ["How the link travels", "Who else can see the key", "What limits the risk"],
      rows: [
        [
          "The sender passes it on",
          "Anyone who can read the channel the sender uses, such as the chat or email service.",
          "The link works only until its file is delivered, and only while the sender's page is open. Send each link only to the person it is for, over a channel you trust.",
        ],
      ],
    },
    protect: {
      heading: "How Fidant protects you",
      body: ["The earlier steps explain each part."],
      columns: ["The risk", "What Fidant does"],
      rows: [
        [
          "Our server or our host reads the file",
          "The file is encrypted in your browser with a key from the part of the link after #, which browsers never send to a server. Only someone with the link can decrypt it. All of this rests on the code we serve being the published code (see What it doesn't protect against).",
        ],
        [
          "Our server puts itself between the two browsers",
          "The setup messages are encrypted and bound to their link, attempt and direction. They carry the fingerprints of the WebRTC encryption, which the server therefore can't swap for its own.",
        ],
        [
          "The networks on the way or our relay read the traffic",
          "Two layers of encryption: WebRTC's DTLS, and AES-256-GCM under a file key only the two browsers have, new for every attempt.",
        ],
        [
          "The traffic gives away the file name, the exact size or a secret's length",
          "Name, type and size travel only encrypted, in a frame of fixed size. A file is padded so its size shows only roughly, and every shared secret is padded to the same single chunk.",
        ],
        [
          "A piece of the file is changed, dropped, repeated or reordered",
          "Every frame is authenticated and numbered, and the recipient checks the size and the SHA-256 checksum. A frame or a checksum that doesn't check out stops the transfer and throws away what was written.",
        ],
        [
          "A link is opened twice, or by someone else after delivery",
          "A link is refused once its file is delivered, and in a second tab while one is connected to it.",
        ],
        [
          "A file disguised by its name, or one that runs as a page",
          "Names that hide their real ending with text direction characters are refused, and downloads are always plain binary data.",
        ],
        [
          "A shared secret lingers in the browser",
          "On the recipient's side it is never downloaded or put in a form field, and translation is off. The sender's text box tells the browser to keep spelling, autocomplete, writing suggestions and translation off it. The shared secret can still linger in two ways: a browser can save the sender's text box with its session, and a copied secret stays on the clipboard (see What it doesn't protect against).",
        ],
        [
          "Data left behind on our machines",
          "No accounts, file storage or database of people or transfers. The server holds what it knows about pages only in memory, and forgets a page within a minute after the page disconnects. The server's logs have fixed fields and never hold names, keys, file data or IP addresses. They are deleted after 30 days. The relay keeps no log of the traffic by default. While the relay renews its certificate, it logs the addresses that reach it on port 80, never browsers', and keeps them for about five weeks.",
        ],
        [
          "Tracking, or code from other sites",
          "HTTPS only, no cookies, no third-party scripts or trackers, and a Content Security Policy that allows code only from our own site.",
        ],
        [
          "You don't want your traffic through our relay",
          "Untick the relay for that send. Our server then gives no relay credentials, and the sender's browser ends a relayed connection it sees.",
        ],
      ],
    },
    explorer: {
      heading: "See what your transfer leaves behind",
      body: [
        "Pick how you send to see every place that keeps a trace of it: what it keeps, and for how long. Places your path doesn't use say so.",
      ],
      questions: {
        what: { legend: "What do you send?", options: { file: "A file", secret: "A secret" } },
        link: {
          legend: "How does the link reach the recipient?",
          options: { self: "I pass it on myself" },
        },
        route: {
          legend: "Which way does the encrypted traffic go?",
          options: {
            direct: "Directly, with our relay allowed",
            relay: "Through our relay",
            norelay: "Directly, with our relay refused",
          },
        },
      },
      kept: "Kept",
      never: "Never",
      notUsed: "Not part of this path.",
      link: ["Every log field, on the privacy page", "/privacy"] as readonly [string, string],
      places: {
        sender: {
          name: "Your browser",
          kept: "Mostly until you close the tab",
          never: "Fidant saves no file, secret, link or key on your device.",
          lines: [
            [
              "",
              "The links, their keys and the transfers, only in this tab's memory, until you close it.",
            ],
            [
              "",
              "A link you copy, on your clipboard until you copy something else. Clipboard history, clipboard sync and other apps can keep it longer.",
            ],
            [
              "file",
              "Your file stays where it is. The page reads it to encrypt it and copies it nowhere.",
            ],
            [
              "secret",
              "The secret, in its text box until you close the tab. The browser can also save it with the session, to restore it after a crash or a reopened tab.",
            ],
            [
              "",
              "The tab's icon as it last was, a green dot while a transfer was open, a check once it was done or a red stop sign where the page needed a secure connection, in the browser's store of page icons, beside the history entry of each page this tab showed, until you clear history.",
            ],
            [
              "",
              "Your theme and language choice, in the browser's local storage, until you clear it.",
            ],
            [
              "",
              "If you allow notifications: a notification for each delivery, shown and kept by your device's notification list. It says only whether a file or a secret was sent and how many links have delivered, never a file name, a person's name, a link or a key.",
            ],
            [
              "direct,relay",
              "While our relay is available: credentials for it, made for this pair of browsers, in memory while the page is open. A relay connection can start with them for 5 minutes.",
            ],
            [
              "",
              "Once a recipient's connection opens: a random token from our server for that link, in this tab's memory only, so the page can take its place back if its connection to our server drops. A new one replaces it each time the page takes its place back. It stays until the page's next connection to our server uses it, the link connects again or you close the tab.",
            ],
          ],
        },
        channel: {
          name: "Where you paste the link",
          kept: "As long as that service keeps messages",
          never: "Fidant never sees this message.",
          lines: [
            [
              "self",
              "The full link, key included, in the chat, mail or messaging service you send it with. The service's link preview may open the address, but never gets the key, which is after the #.",
            ],
          ],
        },
        server: {
          name: "Our server, in memory",
          kept: "While the pages are open, and up to a minute after",
          never: "Your file, its name, size or type, or the secret or its length.",
          lines: [
            ["", "Both IP addresses, the link ID and which page is paired with which link."],
            ["", "Encrypted setup messages pass through it and aren't kept. It can't read them."],
            [
              "direct,relay",
              "While our relay is available, it makes relay credentials for this pair of browsers, with which a relay connection can start for 5 minutes, and sends them to both pages without keeping them. It makes new ones each time the recipient's page asks again after a dropped route.",
            ],
            [
              "",
              "Once the browsers' connection opens: a random token for each page, so a page whose connection to our server drops can take its place in the transfer back. If a page's connection drops without closing, its place, for up to 30 seconds. The tokens are never logged.",
            ],
          ],
        },
        proxy: {
          name: "Our front proxy",
          kept: "While any connection from it is open, and up to 2 minutes after the last one closes",
          never:
            "Anything it carries: it passes the traffic on without decrypting it. It logs nothing.",
          lines: [
            [
              "",
              "Each source IP address (for IPv6, its /64 block) and how many connections it has, in memory.",
            ],
          ],
        },
        caddy: {
          name: "Our web server (Caddy)",
          kept: "No access log. Its own log: 30 days",
          never: "The part of the link after #, which browsers never send.",
          lines: [
            [
              "",
              "It decrypts HTTPS, so it sees, in memory only, each request's path (such as /r/ with the link ID), each browser's IP address and every message the pages send our server. Setup messages stay encrypted.",
            ],
            [
              "",
              "Its own log, about starting up, goes to the system journal. It keeps no access log, and its error and TLS logs are off.",
            ],
          ],
        },
        log: {
          name: "Our server log",
          kept: "30 days",
          never: "Names, keys, IP addresses or file data.",
          lines: [
            [
              "",
              "Short lines with a fixed list of fields: that a sender registered and how many links, that a recipient joined or was refused and why, the size of each setup message, and the route taken. A link shows only by its first 6 characters.",
            ],
            ["", "That a recipient left, and that your page closed, with how many links it had."],
            [
              "direct,relay",
              "If our relay is available and the browsers still haven't connected 3 seconds after the recipient answers, they add the relay. That adds lines for about a dozen more setup messages, which hint that you allowed the relay.",
            ],
            ["norelay", "If your page sees a relayed connection anyway: that it ended it."],
            [
              "",
              "If the route between the browsers drops during the transfer and the recipient's page asks our server again: one more line that a recipient joined, or that it was refused as busy if the link had 10 connection attempts in that half minute, or, if the sender had just given up, one that it joined and one that the sender refused it, and lines for the new setup messages. Together they show that this link's connection dropped, and when. They don't show why, on whose side or whether it came back.",
            ],
            [
              "",
              "If a page's connection to our server drops during the transfer and the page connects again: a line that it took its place back, or that it was refused. It shows that a page's connection dropped, and when, not whose.",
            ],
          ],
        },
        relay: {
          name: "Our relay",
          kept: "Nothing once the traffic has passed. A temporary log, only if we turn one on: at most 7 days",
          never: "The key, the file or the secret. It can't decrypt what it carries.",
          lines: [
            [
              "",
              "Each browser's public IP address, when the browser asks for it. The two browsers ask at about the same time, so the relay can usually tell which two addresses belong together.",
            ],
            [
              "direct",
              "If our relay is available and the browsers still haven't connected 3 seconds after the recipient answers: both IP addresses together, even if a direct route wins after all. Both browsers then reserve a relay address. Only yours does if the recipient's browser had already connected when your page's request to add the relay reached it. Either way the relay can learn both IP addresses.",
            ],
            [
              "relay",
              "Both IP addresses, and the encrypted traffic, which it forwards and doesn't store.",
            ],
            [
              "",
              "If the route between the browsers drops and they look for a new one, each can ask for its public IP address again.",
            ],
            [
              "direct,relay",
              "If the route drops after the browsers added the relay, and our relay is still available, they get new credentials and may reserve relay addresses again. Browsers that never added the relay don't add it then either.",
            ],
            ["relay file", "The file's size, only roughly."],
            ["relay secret", "Not the secret's length: every secret is the same size on the wire."],
            [
              "",
              "No log of the traffic. We turn one on only to fix a fault or stop abuse, for at most 7 days, with connection times, IP addresses and data volumes.",
            ],
            [
              "",
              "While it renews its certificate, a few seconds every two months or so, it logs the addresses that reach it on port 80. They come from Let's Encrypt's checks and internet scanners, never from browsers, and are deleted within about five weeks.",
            ],
            ["", "Its own current and previous secret, which hold no trace of your transfer."],
          ],
        },
        relayCap: {
          name: "Our monthly traffic count",
          kept: "Up to 15 months; at our host, 455 days",
          never:
            "Which transfer the traffic belongs to, IP addresses, the key, the file or the secret.",
          lines: [
            [
              "",
              "The pages your browser loads, the messages it exchanges with our server and its requests to our relay. They are counted together with all other traffic through them, so that we can switch the relay off when the estimated cost reaches our budget.",
            ],
            [
              "relay",
              "Your transfer's encrypted size, rounded up, is counted in the traffic of the relay that carried it. We save the month's totals for our server and our relay every 5 minutes, so on a quiet relay, the step between two saved values can match your transfer's size and time.",
            ],
            [
              "",
              "The month's totals until the next month starts, and their last 100 versions, which cover about 8 hours.",
            ],
            [
              "",
              "The month's total as it stood every 5 minutes, for 63 days, and every hour, for 15 months. The count's own log keeps it for 30 days.",
            ],
            [
              "",
              "Our host, Amazon Lightsail, keeps how much traffic our server and our relay carry, for 455 days.",
            ],
          ],
        },
        recipient: {
          name: "The recipient's browser",
          kept: "Mostly until the tab closes",
          never:
            "Fidant saves no key on their device, apart from what the browser keeps with its history: the link, and the tab's icon stored against it.",
          lines: [
            [
              "",
              "The link, key included, in the browser's history like any address. Your page refuses the link once the delivery is done, and the link works only while your page is open.",
            ],
            [
              "file",
              "The file, where they save it: desktop Chromium browsers such as Chrome and Edge write it where the recipient chooses, other browsers to their downloads.",
            ],
            [
              "file",
              "If the connection drops while the file arrives: the part that arrived, in the page's memory or in the file they chose to save to, so that Try again can continue it. The page discards it if the transfer ends some other way. When the tab closes or reloads, what was in memory is gone; what the browser does with an unfinished file from the save dialog hasn't been tested yet.",
            ],
            [
              "secret",
              "The secret, only in the page's memory until they copy it. Then it's also on their clipboard, where clipboard history, clipboard sync and other apps can read it.",
            ],
            [
              "direct,relay",
              "While our relay is available: credentials for it, made for this pair of browsers, in memory while the page is open. A relay connection can start with them for 5 minutes.",
            ],
            [
              "",
              "Once the connection opens: a random token from our server, in the page's memory only, so the page can take its place back if its connection to our server drops. A new one replaces it each time the page takes its place back; it is gone when the transfer ends or the tab closes.",
            ],
            [
              "",
              "The tab's icon as it last was, a green dot while the transfer was open, a check once it arrived or a red stop sign where the page needed a secure connection, in the browser's store of page icons, beside the history entry of each page that tab showed, the link included, until history is cleared.",
            ],
            ["", "Their theme and language choice, in the browser's local storage, until cleared."],
          ],
        },
        networks: {
          name: "The networks on the way",
          kept: "Not known",
          never: "Anything readable: all traffic is encrypted.",
          lines: [
            ["", "Both IP addresses and the timing."],
            ["file", "The file's size, only roughly."],
            ["secret", "Not the secret's length: every secret is the same size on the wire."],
          ],
        },
      } satisfies Record<string, Place>,
    },
    data: {
      heading: "Step by step",
      body: [
        "The same facts in the order a transfer happens: what our server sees, keeps and logs at each step, and what our relay sees. A shared secret goes through the same steps as a file.",
      ],
      columns: ["Step", "Our server sees", "Our server keeps", "Our server logs", "Our relay"],
      rows: [
        [
          "You open the site",
          "Your IP address and browser details, like any website.",
          "Nothing. A send page also opens a connection to our server, which the server holds in memory while the page is open.",
          "Nothing.",
          "Nothing.",
        ],
        [
          "You choose the file or type the secret, and add recipients",
          "Nothing. Your browser reads the file, computes its checksum and makes the links on its own.",
          "Nothing.",
          "Nothing.",
          "Nothing.",
        ],
        [
          "Your page registers its links",
          "The link IDs, your relay choice and your IP address.",
          "The link IDs and your relay choice, in memory, while your page is open.",
          "That a sender registered, and how many links.",
          "Nothing.",
        ],
        [
          "A recipient opens their link",
          "The link ID, a random attempt ID, and the recipient's IP address and browser details. If your page turns the recipient away, why: the link was already used, another page is connected to it, your page doesn't have that link, or your page ended the attempt.",
          "Which recipient page is paired with which link, in memory.",
          "That a recipient joined or was refused and why, with the first 6 characters of the link ID.",
          "Nothing yet. If you allow the relay and it is available, our server gives the two pages credentials for it, with which a relay connection can start for 5 minutes.",
        ],
        [
          "The browsers set up the connection",
          "Encrypted setup messages and their sizes. It can't read them.",
          "Nothing. It passes them on.",
          "Each message's size, with the first 6 characters of the link ID.",
          "Each browser's IP address, when it asks for its public address (STUN). If you allow the relay and it is available, and the browsers still haven't connected 3 seconds after the recipient answers, they add the relay. Both then reserve a relay address. Only yours does if the recipient's browser had already connected when your page's request to add the relay reached it. Either way the relay can learn both IP addresses, even if a direct route wins after all.",
        ],
        [
          "The file or secret travels",
          "Nothing of it. Your page reports the route once, as it first opened: direct, STUN, relay or failed. If the route drops and the recipient's page asks again, that it asked, which shows that the connection dropped. If a page's connection to our server drops and the page takes its place back, that it came back, and from which IP address.",
          "A random token for each page, so a page whose connection to our server drops can take its place back. If a page's connection drops without closing, its place, for up to 30 seconds.",
          "The route. If the recipient's page asked again after a dropped route: that a recipient joined or was refused as busy, or, if the sender had just given up, joined and was then refused by the sender, and the size of each new setup message. If a page tried to take its place back: that it did, or was refused.",
          "On the relay route, the encrypted packets, which it forwards and doesn't store. Both IP addresses whenever the browsers have added the relay. If the route drops, each browser can ask for its public address again, and browsers that had added the relay may reserve relay addresses again.",
        ],
        [
          "The recipient confirms delivery",
          "Nothing. The receipt goes between the browsers. If the link is opened again, your page refuses it as used.",
          "Nothing.",
          'A later refusal, with the reason "used".',
          "Nothing.",
        ],
        [
          "A page closes",
          "That the page disconnected.",
          "Nothing about that page, within a minute.",
          "That a sender left and how many links it had, or that a recipient left, with the first 6 characters of the link ID.",
          "Nothing.",
        ],
        [
          "Afterwards",
          "Nothing.",
          "Nothing.",
          "Log lines are deleted after 30 days.",
          "No log of the traffic. We turn one on only to fix a fault or stop abuse, for at most 7 days, with connection times, IP addresses and data volumes. While it renews its certificate, it also logs the addresses that reach it on port 80, never browsers', for about five weeks.",
        ],
      ],
    },
  },
  privacy: {
    title: "Privacy",
    lede: "We never get your file or shared secret, or its name. We never get the key that unlocks it either. Below is what we see and keep, and for how long.",
    neverHeading: "What we never get",
    never: [
      ["Your file", "Not the contents, not the file name, not its size or type."],
      [
        "Your secret",
        "Not a secret you share from the Share a secret page, and not its length: every shared secret is padded to the same size before it leaves your browser.",
      ],
      [
        "The key",
        "The part of the link that unlocks the file or the shared secret never reaches us.",
      ],
      ["Recipients' names", "Not the names you give the people you send to."],
    ] as ReadonlyArray<readonly [string, string]>,
    seesHeading: "What our server sees",
    sees: [
      [
        "Your IP address and browser details",
        "Like any website you visit, we see them, along with which page you open. That page's address names the language you chose. We use them to show you this page, connect you and limit abuse. Our server never writes them to its logs. Our relay doesn't log them either, except while we fix a fault or stop abuse (see below).",
      ],
      [
        "A link ID",
        "Each link has a random ID, like a ticket number, so the right two browsers can find each other. It can't unlock anything. We forget it within a minute after the sender's page closes, apart from its first few characters in our log lines.",
      ],
      [
        "Setup messages",
        "A few small, locked messages that help the two browsers connect. We pass them on and don't keep them. We can't read them.",
      ],
      [
        "The sender's relay choice",
        "Whether the sender allows our relay, so we only give recipients access to it when the sender does. We forget it within a minute after the sender's page closes, and never write it to our logs.",
      ],
      [
        "How each connection went",
        "The sender's page tells us whether each connection was direct, went through our relay or failed. We write it to our logs, to know how often connections need our relay.",
      ],
      [
        "Why a recipient was turned away",
        "When the sender's page turns a recipient away, it tells us why: the link was already used, another page is connected to it, the sender's page doesn't have that link, or the sender's page ended the attempt. So we can tell that a link was delivered if it is opened again. We write the reason to our logs.",
      ],
      [
        "When each page connects and leaves",
        "We see when each page connects to our server and when it leaves, so we can tell when someone opens a link. Our log lines note when a sender's page registers or changes its links and when it closes, and when a recipient joins or leaves.",
      ],
      [
        "When a transfer's connection drops",
        "If the connection between the two browsers drops during a transfer, the recipient's page asks our server to help them find a route again. So we see that this transfer's connection dropped, and when. Our log notes it as one more line that a recipient joined or was refused, and the sizes of the new setup messages. We don't see why it dropped or how far the transfer had got. If a page's connection to our server drops too, as when a laptop changes network, the page connects again and takes its place in the transfer back. Then we also see that its new IP address belongs to the same transfer. Our log notes that a page took its place back, or was refused.",
      ],
    ] as ReadonlyArray<readonly [string, string]>,
    keepHeading: "What we keep",
    keep: "We have no accounts, no database of people or transfers, no cookies and no tracking. Once the sender's page is closed, nothing about you is kept, within 2 minutes at most, apart from the log lines below, a relay log while we fix a fault or stop abuse, and our monthly traffic totals. The totals count all traffic in and out of our server and relay, and we keep them for up to 15 months. They name no transfer. But we save a new total every 5 minutes, so on a quiet relay the difference between two totals can show roughly how big one transfer was and when it happened.",
    logFields,
    logRetention: "Log lines are deleted after 30 days.",
    relayLog:
      "Our relay, which can carry the locked file when two browsers can't connect directly, keeps no log of the traffic. We turn one on only to fix a fault or stop abuse. The log then records, for each relayed connection, both IP addresses and ports, when the connection started and ended, and how much data passed through. Never names, keys or file data. We turn it off and delete it within 7 days. Separately, while the relay renews its certificate, a few seconds every two months or so, it logs the addresses that reach it on port 80. Those are Let's Encrypt's checks and internet scanners, never browsers, and they are deleted within about five weeks.",
    limitsHeading: "What we can't protect you from",
    limits: [
      "Anyone who has the link can open the file. Send each link only to the person it is for.",
      "Your browser runs the code our server sends it. A server that sent different code could read files, and could skip the safety number. The code is public, but browsers can't yet check that what they got matches it.",
      "The other browser sees your IP address, as on a video call. Our server sees both IP addresses, which recipient connects to which sender and when, and how many recipients a sender has. So it learns who sends to whom, though not what.",
      "Each browser asks our relay for its public address, so the relay sees each IP address and can usually tell which two belong together. The networks on the way, and our relay when the file goes through it, see both IP addresses, when the transfer happens and roughly how big the file is.",
    ],
    limitsLink: ["Every risk, and what Fidant does about it", "/how/protection"] as readonly [
      string,
      string,
    ],
    checkHeading: "Check it yourself",
    check:
      "This page is the short version. How it works explains every step, and every claim here can be checked against the public code.",
    checkLinks: [
      ["How it works, step by step", "/how"],
      ["What is seen and kept at each step", "/how/traces"],
      ["The code on GitHub", "https://github.com/fidant-labs/fidant"],
    ] as ReadonlyArray<readonly [string, string]>,
    contactHeading: "Contact",
    contact:
      "Fidant is an open-source project, and no company or person is responsible for it yet. Questions about privacy and your data go to",
  },
};

export type Messages = typeof en;
/** A text page: each section a heading, paragraphs and an optional [text, href] link. */
export type Section = {
  heading: string;
  body: readonly string[];
  link?: readonly [string, string];
};
export type Sections = ReadonlyArray<Section>;
