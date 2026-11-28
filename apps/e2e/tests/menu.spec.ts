import type { Page } from "@playwright/test";
import {
  canaryFile,
  choose,
  chooseFile,
  continueToLinks,
  expect,
  makeName,
  recipientRow,
  test,
} from "../src/fixtures.ts";
import { base32Token } from "../src/leaks/canary.ts";

const nav = (page: Page) => page.locator("header nav");

const footer = (page: Page) => page.locator("footer");

for (const path of ["/privacy", "/privacy/"]) {
  test(`${path} shows the Privacy page`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator("main h1")).toHaveText("Privacy");
    await expect(nav(page).getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
}

test("without a secure connection, transfer pages say so and Privacy still opens", async ({
  page,
}) => {
  // The stack always serves HTTPS, so pretend the context is insecure.
  await page.addInitScript(() =>
    Object.defineProperty(window, "isSecureContext", { value: false }),
  );
  const icon = page.locator('link[rel="icon"][type="image/svg+xml"]');
  await page.goto("/send");
  await expect(page.locator("main h1")).toHaveText("This page needs a secure connection");
  // The tab names the screen it shows (WCAG 2.4.2) and its icon is the red stop sign.
  await expect(page).toHaveTitle("Secure connection needed – Fidant");
  await expect(icon).toHaveAttribute("href", /%23dc2626/);
  for (const path of ["/send/secret", "/r/x#k"]) {
    await page.goto(path);
    await expect(page).toHaveTitle("Secure connection needed – Fidant");
  }
  await page.goto("/sv/skicka");
  await expect(page).toHaveTitle("Säker anslutning krävs – Fidant");
  await page.goto("/privacy");
  await expect(page.locator("main h1")).toHaveText("Privacy");
  await expect(page).toHaveTitle("Privacy – Fidant");
  await expect(icon).not.toHaveAttribute("href", /%23dc2626/);
});

test("leaving /send for Privacy and going back keeps the file and recipient", async ({
  page,
  leaks,
  canary,
}) => {
  const file = leaks.watch(canaryFile(canary.fork("file")));
  const name = makeName(leaks, canary, "Anna");
  await page.goto("/send");
  await chooseFile(page, {
    name: file.name,
    mimeType: file.mime,
    buffer: file.bytes,
  });
  await page.getByLabel("Who is it for?").fill(name);
  await page.getByRole("button", { name: "Add recipient", exact: true }).click();
  const link = await page.getByLabel(`Link for ${name}`, { exact: true }).textContent();
  leaks.watchKey("link secret", new URL(link ?? "").hash.slice(1));
  const pages = page.context().pages().length;

  // A reload would drop the transfer, so the in-app navigation must not reload.
  await page.evaluate(() => Object.assign(window, { notReloaded: true }));
  await nav(page).getByRole("link", { name: "Privacy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.locator("main:visible h1")).toHaveText("Privacy");
  expect(page.context().pages()).toHaveLength(pages);

  await page.goBack();
  await expect(page).toHaveURL(/\/send$/);
  expect(await page.evaluate(() => "notReloaded" in window)).toBe(true);
  await expect(page.getByText(file.name, { exact: true })).toBeVisible();
  await expect(recipientRow(page, name)).toBeVisible();
  await expect(page.getByLabel(`Link for ${name}`, { exact: true })).toHaveText(link ?? "");

  // One send at a time: the toggle is off, and the secret mode's link leads back to the file.
  await expect(
    page.getByRole("navigation", { name: "What to send" }).getByRole("button", { name: "Secret" }),
  ).toBeDisabled();
  await page.locator("footer").getByRole("link", { name: "Share a secret" }).click();
  await expect(page).toHaveURL(/\/send\/file$/);
  await expect(page.getByText(file.name, { exact: true })).toBeVisible();
  await expect(page.getByLabel("Your secret")).toBeHidden();
});

test("the footer links both ways to send, and a secret on its way keeps its page", async ({
  page,
  leaks,
  canary,
}) => {
  await page.goto("/");
  await expect(footer(page).getByRole("link", { name: "Send a file" })).toHaveAttribute(
    "href",
    "/send/file",
  );
  await expect(footer(page).getByRole("link", { name: "Share a secret" })).toHaveAttribute(
    "href",
    "/send/secret",
  );

  const name = makeName(leaks, canary, "Anna");
  const text = base32Token(canary.fork("text"), 40);
  leaks.watchContent("text", text);
  await page.goto("/send/secret");
  await page.getByLabel("Your secret").fill(text);
  await continueToLinks(page);
  await page.locator("#secret-recipient-name").fill(name);
  await page.getByRole("button", { name: "Add recipient", exact: true }).click();
  const link = await page.getByLabel(`Link for ${name}`, { exact: true }).textContent();
  leaks.watchKey("link secret", new URL(link ?? "").hash.slice(1));

  await expect(
    page.getByRole("navigation", { name: "What to send" }).getByRole("button", { name: "File" }),
  ).toBeDisabled();
  await footer(page).getByRole("link", { name: "Send a file" }).click();
  await expect(page).toHaveURL(/\/send\/secret$/);
  await expect(recipientRow(page, name)).toBeVisible();

  await page.goto("/sv");
  await expect(footer(page).getByRole("link", { name: "Skicka en fil" })).toHaveAttribute(
    "href",
    "/sv/skicka/fil",
  );
  await expect(footer(page).getByRole("link", { name: "Dela en hemlighet" })).toHaveAttribute(
    "href",
    "/sv/skicka/hemlighet",
  );
});

test("the menu's Send and the landing page's button open /send", async ({ page }) => {
  await page.goto("/privacy");
  await nav(page).getByRole("link", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/send$/);
  await expect(page.getByLabel("Choose a file")).toBeAttached();

  await page.goto("/");
  // Prerendered pages already carry their title, so only a page that didn't reload tests the update.
  await page.evaluate(() => Object.assign(window, { notReloaded: true }));
  await page.getByRole("main").getByRole("link", { name: "Send a file", exact: true }).click();
  await expect(page).toHaveURL(/\/send$/);
  await expect(page.getByLabel("Choose a file")).toBeAttached();
  // The tab title follows in-app navigation and a language switch.
  await expect(page).toHaveTitle("Send a file – Fidant");
  await choose(page, "Language", "Svenska");
  await expect(page).toHaveTitle("Skicka en fil – Fidant");
  expect(await page.evaluate(() => "notReloaded" in window)).toBe(true);
});

test("the language menu switches language and the choice survives a reload", async ({ page }) => {
  await page.goto("/privacy");
  await choose(page, "Language", "Svenska");
  await expect(page.locator("main h1")).toHaveText("Integritet");
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await expect(page).toHaveURL(/\/sv\/integritet$/);
  await page.reload();
  await expect(page.locator("main h1")).toHaveText("Integritet");

  await choose(page, "Språk", "English");
  await expect(page.locator("main h1")).toHaveText("Privacy");
  await expect(page).toHaveURL(/\/privacy$/);
  await page.reload();
  await expect(page.locator("main h1")).toHaveText("Privacy");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("the theme menu sets System, Light and Dark, and the choice survives a reload", async ({
  page,
}) => {
  const html = page.locator("html");
  await page.goto("/privacy");
  await expect(html).not.toHaveAttribute("data-theme");
  for (const [option, value] of [
    ["Light", "light"],
    ["Dark", "dark"],
    ["System", undefined],
  ] as const) {
    await choose(page, "Theme", option);
    for (const step of ["chosen", "reloaded"]) {
      if (value) {
        await expect(html).toHaveAttribute("data-theme", value);
      } else {
        await expect(html).not.toHaveAttribute("data-theme");
      }
      await footer(page).getByRole("button", { name: "Theme" }).click();
      await expect(page.getByRole("menuitemradio", { name: option })).toBeChecked();
      // Radix moves focus into the menu just after it opens; Escape before that does nothing.
      await expect(page.getByRole("menu")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toBeHidden();
      if (step === "chosen") {
        await page.reload();
      }
    }
  }
});

for (const [locale, lang, headings] of [
  ["en-GB", "en", { security: "Security", about: "About Fidant", terms: "Terms of use" }],
  ["sv-SE", "sv", { security: "Säkerhet", about: "Om Fidant", terms: "Användarvillkor" }],
] as const) {
  test.describe(`in ${locale}`, () => {
    test.use({ locale, viewport: { width: 360, height: 800 } });

    test("the info pages open in the browser's language and fit a phone screen", async ({
      page,
    }) => {
      for (const [path, heading] of Object.entries(headings)) {
        await page.goto(`/${path}`);
        await expect(page.locator("main h1")).toHaveText(heading);
        await expect(page.locator("html")).toHaveAttribute("lang", lang);
        const width = await page.evaluate(async () => {
          await document.fonts.ready;
          return document.documentElement.scrollWidth;
        });
        expect(width, path).toBeLessThanOrEqual(360);
      }
    });
  });
}

test("going back from /send with the traces drawer open leaves the next page usable", async ({
  page,
}) => {
  // A phone, where the button opens the traces as a modal drawer.
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/privacy");
  await nav(page).getByRole("link", { name: "Send" }).click();
  await page.getByRole("button", { name: "Traces" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // A modal dialog left open in the hidden page would make this page inert.
  await nav(page).getByRole("link", { name: "Send" }).click();
  await expect(page).toHaveURL(/\/send$/);
});

test("scrolling over the traces drawer leaves the page behind it where it was", async ({
  page,
}) => {
  // Wide enough for the side drawer, short enough that both the page and the drawer scroll.
  await page.setViewportSize({ width: 1000, height: 400 });
  await page.goto("/send");
  const button = page.getByRole("button", { name: "Traces" });
  // The button is on the bar fixed to the screen's bottom, so scroll the page itself.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(0);
  await button.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  // Up past the drawer's top, then over the dimmed page: without the lock, both scroll the page.
  await drawer.hover();
  await page.mouse.wheel(0, -2000);
  await page.mouse.move(100, 200);
  await page.mouse.wheel(0, -2000);
  // A wheel scroll lands a frame or so after the event: wait two before checking the page didn't move.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
  // A text selection that ends on the dimmed page keeps the drawer open; a click there closes it.
  const box = await drawer.getByRole("heading", { name: "Traces" }).boundingBox();
  if (!box) {
    throw new Error("the drawer's heading has no box");
  }
  await page.mouse.move(box.x + 5, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(100, 200);
  await page.mouse.up();
  await expect(drawer).toBeVisible();
  await page.mouse.click(100, 200);
  await expect(drawer).toBeHidden();
  await button.click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "Close" }).click();
  await expect(drawer).toBeHidden();
  // Closing gives the focus back to the button that opened the drawer.
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});
