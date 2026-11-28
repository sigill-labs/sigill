// A typed wrapper over the /signal WebSocket.
//
// Outgoing messages are ClientMessages serialised as JSON. Incoming text
// frames are parsed with parseServerMessage; anything invalid (bad JSON,
// unknown shape, binary frames) is dropped and reported with a warning that
// never includes the frame's content.
//
// When the socket closes, or a connection attempt fails, onClose listeners
// learn why and the client opens a new socket after retryDelay, until close()
// is called. The wait grows with each socket that failed or closed within
// STABLE_MS of opening, and resets after one that stayed open longer. A close
// with SERVICE_RESTART (the server is stopping), or with 1012, which older
// servers send instead, resets it too and reconnects at once, since the
// restart is no fault of this client.
// Listeners stay registered across reconnects. onOpen fires on every open:
// the page re-sends host/join there, since it knows them and this wrapper
// does not.

import {
  type ClientMessage,
  parseServerMessage,
  RETRY_MAX_MS,
  SERVICE_RESTART,
  type ServerMessage,
} from "@fidant/protocol";
import { signalingUrl } from "./signaling-list.ts";
import type { SignalMessage } from "./trace-log.ts";

export type SignalingClose = {
  /** WebSocket close code (1006 when the connection dropped). */
  code: number;
  /** True if close() was called on this client. */
  byClient: boolean;
};

export type SignalingClient = {
  /** Sends a message. Returns false (and sends nothing) if the socket is not open. */
  send(message: ClientMessage): boolean;
  /** Calls the listener for every valid server message. Returns an unsubscribe function. */
  subscribe(listener: (message: ServerMessage) => void): () => void;
  /** Calls the listener every time a socket opens. Returns an unsubscribe function. */
  onOpen(listener: () => void): () => void;
  /** Calls the listener every time a socket closes, including a failed attempt. Returns an unsubscribe function. */
  onClose(listener: (info: SignalingClose) => void): () => void;
  /** Closes the socket and stops reconnecting. Safe to call more than once. */
  close(): void;
};

declare const __SIGNALING_URL__: string;

/** The signaling endpoint the build named, else the one on the server that served this page. */
export function defaultSignalingUrl(): string {
  return signalingUrl(__SIGNALING_URL__, location.host);
}

const RETRY_BASE_MS = 1000;
// A socket that stayed open this long was healthy; a faster close counts as a failure.
const STABLE_MS = 10_000;

/** A random wait up to min(30 s, 1 s × 2^failures), so clients don't reconnect in step. */
export function retryDelay(failures: number, random = Math.random): number {
  return random() * Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** failures);
}

export type SignalingOptions = {
  url?: string;
  /** Called with the data length of each relay message sent or received. */
  onRelay?: (bytes: number) => void;
  /**
   * Called with each message sent, and each valid message received before the subscribers see
   * it. For in-page observers such as the trace log only: the messages carry link IDs and tokens.
   */
  onMessage?: (...args: SignalMessage) => void;
};

export function connectSignaling({
  url = defaultSignalingUrl(),
  onRelay,
  onMessage,
}: SignalingOptions = {}): SignalingClient {
  const messageListeners = new Set<(message: ServerMessage) => void>();
  const openListeners = new Set<() => void>();
  const closeListeners = new Set<(info: SignalingClose) => void>();
  let closedByClient = false;
  let failures = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const clearListeners = () => {
    messageListeners.clear();
    openListeners.clear();
    closeListeners.clear();
  };

  const open = (): WebSocket | undefined => {
    let openedAt: number | undefined;
    let ended = false;
    const end = (code: number) => {
      if (ended) {
        return;
      }
      ended = true;
      socket = undefined;
      const info: SignalingClose = { code, byClient: closedByClient };
      for (const listener of [...closeListeners]) {
        listener(info);
      }
      if (closedByClient) {
        clearListeners();
        return;
      }
      const restart = code === SERVICE_RESTART || code === 1012;
      if (restart || (openedAt !== undefined && Date.now() - openedAt >= STABLE_MS)) {
        failures = 0;
      } else {
        failures++;
      }
      retry = setTimeout(
        () => {
          socket = open();
        },
        restart ? 0 : retryDelay(failures),
      );
    };

    let next: WebSocket;
    try {
      // Firefox and WebKit throw here when a CSP blocks the URL, before the page has its listeners.
      next = new WebSocket(url);
    } catch {
      retry = setTimeout(() => end(1006), 0);
      return undefined;
    }

    next.addEventListener("open", () => {
      openedAt = Date.now();
      for (const listener of [...openListeners]) {
        listener();
      }
    });

    next.addEventListener("message", (event: MessageEvent) => {
      const message = typeof event.data === "string" ? parseServerMessage(event.data) : undefined;
      if (!message) {
        console.warn("fidant: ignored an invalid signaling message");
        return;
      }
      if (message.t === "relay") {
        onRelay?.(message.data.length);
      }
      onMessage?.("received", message);
      for (const listener of [...messageListeners]) {
        listener(message);
      }
    });

    // Once per socket: Chromium reports a CSP block with error and no close.
    next.addEventListener("error", () => end(1006));
    next.addEventListener("close", (event: CloseEvent) => end(event.code));

    return next;
  };

  let socket: WebSocket | undefined = open();

  return {
    send(message) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
      }
      socket.send(JSON.stringify(message));
      if (message.t === "relay") {
        onRelay?.(message.data.length);
      }
      onMessage?.("sent", message);
      return true;
    },
    subscribe(listener) {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },
    onOpen(listener) {
      openListeners.add(listener);
      return () => {
        openListeners.delete(listener);
      };
    },
    onClose(listener) {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    close() {
      if (closedByClient) {
        return;
      }
      closedByClient = true;
      clearTimeout(retry);
      if (!socket || socket.readyState === WebSocket.CLOSED) {
        // No live socket, or one that already failed: a late error or close event reports nothing.
        clearListeners();
      } else {
        socket.close(1000);
      }
    },
  };
}
