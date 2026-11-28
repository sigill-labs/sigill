import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chooseFile, delivered, expect, fakeSavePicker, makeName, test } from "../src/fixtures.ts";
import { writeLargeCanary } from "../src/leaks/canary.ts";
import { sampleRss } from "../src/rss.ts";

test.skip(
  ({ browserName }) => process.env.FIDANT_E2E_LARGE !== "1" || browserName !== "chromium",
  "Sends gigabytes, so it runs only with FIDANT_E2E_LARGE=1, in Chromium",
);

const GB = 1e9;
const GiB = 1024 ** 3;
const MB = (bytes: number) => Math.round(bytes / 1e6);

for (const { gb, minutes } of [
  { gb: 1, minutes: 8 },
  { gb: 5, minutes: 24 },
]) {
  test(`sends a ${gb} GB file into the save dialog with bounded memory`, async ({
    actor,
    leaks,
    canary,
  }) => {
    test.setTimeout(minutes * 60_000);
    const dir = await mkdtemp(join(tmpdir(), "fidant-e2e-large-"));
    try {
      const file = leaks.watch(
        await writeLargeCanary(canary.fork("file"), dir, { min: gb * GB, max: gb * GB + 1e7 }),
      );
      const sha256 = file.sha256.toString("hex");

      const { page: sender } = await actor("sender");
      await sender.goto("/send");
      await chooseFile(sender, file.path);
      await sender.getByRole("button", { name: "Traces" }).click();
      await expect(sender.getByText(sha256)).toBeVisible({ timeout: gb * 2 * 60_000 });
      // The drawer covers the page until it is closed.
      await sender.getByRole("button", { name: "Close" }).click();
      const name = makeName(leaks, canary, "Anna");
      await sender.getByLabel("Who is it for?").fill(name);
      await sender.getByRole("button", { name: "Add recipient", exact: true }).click();
      const link =
        (await sender.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
      leaks.watchKey("link secret", new URL(link).hash.slice(1));

      const { context, page: recipient } = await actor("recipient");
      await context.addInitScript(fakeSavePicker);
      await recipient.goto(link);
      const download = recipient.getByRole("button", { name: "Download" });
      await expect(download).toBeVisible({ timeout: 30_000 });
      const rss = await sampleRss();
      const started = performance.now();
      try {
        await download.click();
        await expect(recipient.getByText("this is exactly the file that was sent")).toBeVisible({
          timeout: gb * 2 * 60_000,
        });
      } catch (error) {
        await rss.end().catch(() => {});
        throw error;
      }
      const memory = await rss.end();
      const seconds = (performance.now() - started) / 1000;
      console.log(
        `${gb} GB: ${(file.size / 1e6 / seconds).toFixed(1)} MB/s over ${seconds.toFixed(0)} s; ` +
          `browser RSS ${MB(memory.baselineBytes)} MB before Download, peak ${MB(memory.peakBytes)} MB ` +
          `(${memory.processes} processes, ${memory.samples} samples)`,
      );

      expect(await recipient.evaluate(() => (globalThis as { written?: number }).written)).toBe(
        file.size,
      );
      await recipient.getByText("Technical details").click();
      await expect(recipient.getByText(sha256)).toBeVisible();
      await expect(delivered(sender, name)).toBeAttached();
      expect(memory.baselineBytes).toBeGreaterThan(0);
      expect(memory.peakBytes - memory.baselineBytes).toBeLessThan(GiB);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
