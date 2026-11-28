import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { notifyIcon } from "./notify-icon.ts";

test("the notification icon is an inline copy of the public apple-touch-icon", () => {
  const file = readFileSync(new URL("../../public/apple-touch-icon.png", import.meta.url));
  assert.equal(notifyIcon, `data:image/png;base64,${file.toString("base64")}`);
});
