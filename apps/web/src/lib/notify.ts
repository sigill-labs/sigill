// Browser notifications that tell the sender a link has delivered, and the recipient that a
// file or secret needs them or has arrived.
//
// A notification leaves the page: the operating system shows it and can keep
// it in its notification list, and some systems mirror that list to other
// devices. So callers pass only fixed text and counts, never a file name, a
// sender's or recipient's name, a link or a key.

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
/** public/apple-touch-icon.png as a data: URL (notify.test.ts keeps the two the same). */
export const NOTIFICATION_ICON =
  "data:image/png;base64,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";

export function notify(title: string, body: string): void {
  const N = api();
  if (!N || N.permission !== "granted" || document.hasFocus()) {
    return;
  }
  try {
    // Our own logo. On macOS Chrome keeps its icon on the left and shows this one beside the
    // text; elsewhere it takes the browser icon's place. Inline, so a notification asks the
    // server for nothing at a transfer's status change.
    const notification = new N(title, { body, icon: NOTIFICATION_ICON });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // The delivery itself is on the page; a notification is only a nudge.
  }
}
