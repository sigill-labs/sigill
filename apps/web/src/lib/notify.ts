// Browser notifications that tell the sender a link has delivered, and the recipient that a
// file or secret needs them or has arrived.
//
// A notification leaves the page: the operating system shows it and can keep
// it in its notification list, and some systems mirror that list to other
// devices. So callers pass only fixed text and counts, never a file name, a
// sender's or recipient's name, a link or a key.

import { notifyIcon } from "./notify-icon.ts";

const api = () => (typeof Notification === "undefined" ? undefined : Notification);

/** Where the page stands with notifications; "default" means asking is worth it. */
export function notifyPermission(): NotificationPermission | "unsupported" {
  const N = api();
  if (!N) {
    return "unsupported";
  }
  if (N.permission === "default") {
    // Chrome on Android has `Notification` but its constructor throws, because a page there
    // needs a service worker to notify. Without permission this shows nothing anywhere.
    try {
      new N("").close();
    } catch {
      return "unsupported";
    }
  }
  return N.permission;
}

/** Asks the browser for permission. Call it from a click. */
export async function askToNotify(): Promise<NotificationPermission | "unsupported"> {
  const N = api();
  if (!N) {
    return "unsupported";
  }
  try {
    return await N.requestPermission();
  } catch {
    return N.permission;
  }
}

/**
 * Shows a notification if the user allowed it and isn't looking at the page.
 * Clicking it brings the page back.
 */
export function notify(title: string, body: string): void {
  const N = api();
  if (!N || N.permission !== "granted" || document.hasFocus()) {
    return;
  }
  try {
    // Inline, so a delivery asks the server for nothing. On macOS Chrome keeps its own icon
    // on the left and shows this one beside the text; elsewhere it takes the browser's place.
    const notification = new N(title, { body, icon: notifyIcon });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // The delivery itself is on the page; a notification is only a nudge.
  }
}
