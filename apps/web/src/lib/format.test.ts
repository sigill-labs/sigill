import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayName,
  etaTracker,
  formatBytes,
  formatClock,
  formatProgress,
  formatSpan,
  formatTimeLeft,
  toHex,
} from "./format.ts";

test("displayName drops names with nothing visible to show", () => {
  assert.equal(displayName("  Åsa Öberg "), "Åsa Öberg");
  assert.equal(displayName("李"), "李");
  assert.equal(displayName(""), "");
  assert.equal(displayName("   "), "");
  assert.equal(displayName(String.fromCodePoint(0x200b, 0x3164, 0xfeff)), "");
  assert.equal(displayName("!!!"), "");
});

test("toHex pads every byte", () => {
  assert.equal(toHex(new Uint8Array([0, 15, 16, 255])), "000f10ff");
  assert.equal(toHex(new Uint8Array()), "");
});

test("formatBytes uses decimal units", () => {
  assert.equal(formatBytes(0, "en"), "0 bytes");
  assert.equal(formatBytes(1, "en"), "1 byte");
  assert.equal(formatBytes(999, "en"), "999 bytes");
  assert.equal(formatBytes(1000, "en"), "1.0 KB");
  assert.equal(formatBytes(8 * 1024 * 1024, "en"), "8.4 MB");
  assert.equal(formatBytes(999_999, "en"), "1.0 MB");
  assert.equal(formatBytes(123_456_789, "en"), "123 MB");
  assert.equal(formatBytes(1_000_000_000, "en"), "1.0 GB");
});

test("formatProgress rounds down and treats an empty file as done", () => {
  assert.equal(formatProgress(1_100_000, 2_400_000, "en"), "45% · 1.1 MB of 2.4 MB");
  assert.equal(formatProgress(2_399_999, 2_400_000, "en"), "99% · 2.4 MB of 2.4 MB");
  assert.equal(formatProgress(0, 0, "en"), "100% · 0 bytes of 0 bytes");
});

test("formatBytes and formatProgress in Swedish", () => {
  assert.equal(formatBytes(1, "sv"), "1 byte");
  assert.equal(formatBytes(512, "sv"), "512 byte");
  assert.equal(formatBytes(8 * 1024 * 1024, "sv"), "8,4 MB");
  assert.equal(formatBytes(123_456_789, "sv"), "123 MB");
  // Intl puts a no-break space before the Swedish percent sign.
  assert.equal(formatProgress(1_100_000, 2_400_000, "sv"), "45\u00a0% · 1,1 MB av 2,4 MB");
});

test("etaTracker waits for the warm-up, then uses the rate over its window", () => {
  const left = etaTracker(10_000_000, 3000, 4000);
  assert.equal(left(0, 0), undefined);
  assert.equal(left(2000, 1_000_000), undefined);
  assert.equal(left(4000, 4_000_000), 6);
  // After a stall the window has forgotten the fast part, so the estimate grows.
  assert.ok((left(8000, 4_100_000) ?? 0) > 60);
});

test("formatTimeLeft rounds to steps that don't flicker", () => {
  assert.equal(formatTimeLeft(2, "en"), "About 5 seconds left");
  assert.equal(formatTimeLeft(41, "en"), "About 40 seconds left");
  assert.equal(formatTimeLeft(56, "en"), "About 1 minute left");
  assert.equal(formatTimeLeft(150, "sv"), "Ungefär 3 minuter kvar");
  assert.equal(formatTimeLeft(7200, "sv"), "Ungefär 2 timmar kvar");
});

test("formatClock writes local 24-hour time with seconds", () => {
  assert.equal(formatClock(new Date(2026, 10, 28, 9, 5, 7).getTime()), "09:05:07");
  assert.equal(formatClock(new Date(2026, 10, 28, 23, 59, 59, 999).getTime()), "23:59:59");
  assert.equal(formatClock(new Date(2026, 10, 28, 0, 0, 0).getTime()), "00:00:00");
});

test("formatSpan gives whole seconds, then minutes, then hours and minutes", () => {
  assert.equal(formatSpan(0), "under 1 s");
  assert.equal(formatSpan(999), "under 1 s");
  assert.equal(formatSpan(1000), "1 s");
  assert.equal(formatSpan(59_999), "59 s");
  assert.equal(formatSpan(60_000), "1 min");
  assert.equal(formatSpan(4 * 60_000 + 59_000), "4 min");
  assert.equal(formatSpan(60 * 60_000), "1 h");
  assert.equal(formatSpan(65 * 60_000 + 30_000), "1 h 5 min");
  assert.equal(formatSpan(26 * 60 * 60_000), "26 h");
});
