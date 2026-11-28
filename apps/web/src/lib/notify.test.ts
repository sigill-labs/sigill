import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { askToNotify, notify, notifyPermission } from "./notify.ts";

type Shown = { title: string; body: string | undefined; icon: string | undefined };

/** Installs a fake `Notification` and `document`, and returns what was shown. */
function browser(permission: NotificationPermission, focused: boolean, broken = false): Shown[] {
  const shown: Shown[] = [];
  class Fake {
    static permission = permission;
    static requestPermission = async () => "granted" as const;
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      if (broken) {
        throw new TypeError("Illegal constructor");
      }
      shown.push({ title, body: options?.body, icon: options?.icon });
    }
    close() {}
  }
  Object.assign(globalThis, { Notification: Fake, document: { hasFocus: () => focused } });
  return shown;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "Notification");
  Reflect.deleteProperty(globalThis, "document");
});

test("notify shows the notification only when allowed and the page is out of focus", () => {
  const shown = browser("granted", false);
  notify("Delivered", "1 of 2");
  assert.deepEqual(shown, [{ title: "Delivered", body: "1 of 2", icon: "/apple-touch-icon.png" }]);

  const focused = browser("granted", true);
  notify("a", "b");
  assert.deepEqual(focused, []);

  const notAllowed = browser("default", false);
  notify("a", "b");
  assert.deepEqual(notAllowed, []);
});

test("notify does nothing without the API or when the constructor throws", () => {
  notify("a", "b");
  const shown = browser("granted", false, true);
  notify("a", "b");
  assert.deepEqual(shown, []);
});

test("notifyPermission says unsupported where a page can't notify", async () => {
  assert.equal(notifyPermission(), "unsupported");
  assert.equal(await askToNotify(), "unsupported");
  browser("default", false, true);
  assert.equal(notifyPermission(), "unsupported");
  browser("default", false);
  assert.equal(notifyPermission(), "default");
  assert.equal(await askToNotify(), "granted");
  browser("denied", false, true);
  assert.equal(notifyPermission(), "denied");
});
