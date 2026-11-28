import { barText, choose, continueToLinks, expect, makeName, test } from "../src/fixtures.ts";

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("/sv/sakerhet is the Swedish security page with its own head", async ({ page }) => {
    await page.goto("/sv/sakerhet");
    await expect(page.locator("main h1")).toHaveText("Säkerhet");
    await expect(page).toHaveTitle("Säkerhet – Fidant");
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      "https://fidant.se/sv/sakerhet",
    );
    for (const [lang, href] of [
      ["en", "https://fidant.se/security"],
      ["sv", "https://fidant.se/sv/sakerhet"],
      ["x-default", "https://fidant.se/security"],
    ] as const) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${lang}"]`)).toHaveAttribute(
        "href",
        href,
      );
    }
  });

  test("an English page links to the other English pages", async ({ page }) => {
    await page.goto("/how");
    await expect(page.locator("main h1")).toHaveText("How it works");
    await page
      .locator("main")
      .getByRole("link", { name: /Read more/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/how\/file$/);
    await expect(page.locator("main h1")).not.toBeEmpty();
  });
});

test("every page in the sitemap answers with its own canonical", async ({ request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1] ?? "");
  expect(urls).toHaveLength(40);
  for (const url of urls) {
    const res = await request.get(url.replace("https://fidant.se", ""), { maxRedirects: 0 });
    expect(res.status(), url).toBe(200);
    expect(await res.text(), url).toContain(`<link rel="canonical" href="${url}" />`);
  }
  const llms = await (await request.get("/llms.txt")).text();
  for (const url of urls) {
    expect(llms, url).toContain(`](${url}): `);
  }
});

test("unknown paths are 404 and receive links are noindex", async ({ request }) => {
  for (const path of ["/no-such-page", "/sv/security", "/sv/how/link"]) {
    expect((await request.head(path)).status(), path).toBe(404);
  }
  const receive = await request.head("/r/AAAAAAAAAAAAAAAAAAAAAA");
  expect(receive.status()).toBe(200);
  expect(receive.headers()["x-robots-tag"]).toBe("noindex");
  expect((await request.head("/about")).headers()["x-robots-tag"]).toBeUndefined();
});

test("the not-found page says so and links home", async ({ page }) => {
  await page.goto("/no-such-page");
  await expect(page.locator("main h1")).toHaveText("Page not found");
  await expect(page).toHaveTitle("Page not found – Fidant");
  // The localhost bar's text is shared, not the send page's, so every page can show it.
  await expect(
    page.getByRole("note").filter({ hasText: "This page is open on localhost" }),
  ).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: "Go to the front page" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the send page's toggle switches between a file and a secret, and the address names the mode", async ({
  actor,
}) => {
  const { page } = await actor("sender");
  // Taller than step 1, so the footer would show on the first screen without the page's height.
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.goto("/send/secret");
  await expect(page.getByLabel("Your secret")).toBeVisible();
  await expect(page.locator("footer")).not.toBeInViewport();
  // The bottom bar shows from the first step, before there is a link.
  await expect(barText(page, "Step 1 of 3: Share a secret")).toBeInViewport();
  // The traces open from an icon button at the bar's end, inside it at a phone's width too.
  const bar = page.locator("[data-page-bar]").filter({ visible: true });
  const details = bar.getByRole("button", { name: "Traces" });
  await expect(details).toBeVisible();
  await expect(details).toHaveAttribute("title", "Traces");
  // The bar is one height at every width, so the button never makes it taller.
  let barHeight: number | undefined;
  const insideBar = async () => {
    const [outer, inner] = await Promise.all([bar.boundingBox(), details.boundingBox()]);
    expect(outer && inner).toBeTruthy();
    if (outer && inner) {
      expect(inner.width).toBeGreaterThanOrEqual(40);
      expect(inner.x).toBeGreaterThanOrEqual(outer.x);
      expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
      expect(inner.y).toBeGreaterThanOrEqual(outer.y);
      expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
      barHeight ??= outer.height;
      expect(outer.height).toBe(barHeight);
    }
  };
  await insideBar();
  // Focus scrolls a control to above the bar, not under it.
  const scrollPadding = () =>
    page.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom);
  expect(await scrollPadding()).toBe("96px");
  // The space above and below the box that holds the secret or the file, up to the name field.
  const gaps = () =>
    page
      .getByLabel("Your name")
      .filter({ visible: true })
      .evaluate((input) => {
        const field = input.parentElement;
        const box = field?.previousElementSibling;
        const above = box?.previousElementSibling;
        if (!field || !box || !above) {
          return [];
        }
        return [
          box.getBoundingClientRect().top - above.getBoundingClientRect().bottom,
          field.getBoundingClientRect().top - box.getBoundingClientRect().bottom,
        ];
      });
  const secretGaps = await gaps();
  const toggle = page.getByRole("navigation", { name: "What to send" }).filter({ visible: true });
  await toggle.getByRole("link", { name: "File" }).click();
  await expect(page).toHaveURL(/\/send\/file$/);
  await expect(page.getByLabel("Your secret")).toBeHidden();
  // Both boxes sit the same way, so the toggle moves nothing around them.
  expect(await gaps()).toEqual(secretGaps);
  await expect(page).toHaveTitle("Send a file – Fidant");
  await expect(barText(page, "Step 1 of 3: Send a file")).toBeInViewport();
  await page.setViewportSize({ width: 360, height: 1600 });
  await insideBar();
  expect(await scrollPadding()).toBe("96px");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  await page.setViewportSize({ width: 1280, height: 1600 });
  await toggle.getByRole("link", { name: "Secret" }).click();
  await expect(page).toHaveURL(/\/send\/secret$/);
  await expect(page.getByLabel("Your secret")).toBeVisible();
  await page.goto("/send");
  await expect(page).toHaveURL(/\/send$/);
  await expect(page.getByLabel("Your secret")).toBeHidden();
  // The old addresses still open their mode, under its new address.
  for (const [old, now] of [
    ["/secret", /\/send\/secret$/],
    ["/sv/hemlighet", /\/sv\/skicka\/hemlighet$/],
    ["/send?mode=secret", /\/send\/secret$/],
    ["/send?mode=file", /\/send\/file$/],
    ["/sv/skicka?mode=secret", /\/sv\/skicka\/hemlighet$/],
  ] as const) {
    await page.goto(old);
    await expect(page, old).toHaveURL(now);
  }
  await expect(page.getByLabel("Din hemlighet")).toBeVisible();
});

test("each send mode is its own page, and /send names file mode as its canonical", async ({
  request,
}) => {
  for (const [path, title, canonical] of [
    ["/send", "Send a file – Fidant", "https://fidant.se/send/file"],
    ["/send/file", "Send a file – Fidant", "https://fidant.se/send/file"],
    ["/send/secret", "Share a secret – Fidant", "https://fidant.se/send/secret"],
    ["/sv/skicka", "Skicka en fil – Fidant", "https://fidant.se/sv/skicka/fil"],
    ["/sv/skicka/hemlighet", "Dela en hemlighet – Fidant", "https://fidant.se/sv/skicka/hemlighet"],
  ] as const) {
    const html = await (await request.get(path, { maxRedirects: 0 })).text();
    expect(html, path).toContain(`<title>${title}</title>`);
    expect(html, path).toContain(`<link rel="canonical" href="${canonical}" />`);
  }
  for (const [old, now] of [
    ["/secret", "/send/secret"],
    ["/sv/hemlighet", "/sv/skicka/hemlighet"],
  ] as const) {
    const res = await request.get(old, { maxRedirects: 0 });
    expect(res.status(), old).toBe(301);
    expect(res.headers().location, old).toBe(now);
  }
});

test.describe("in a Swedish browser", () => {
  test.use({ locale: "sv-SE" });

  test("/ opens /sv before any English shows", async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const seen = JSON.parse(sessionStorage.getItem("seen") ?? "[]");
        seen.push([location.pathname, document.documentElement.hidden]);
        sessionStorage.setItem("seen", JSON.stringify(seen));
      });
    });
    await page.goto("/");
    await expect(page).toHaveURL(/\/sv$/);
    await expect(page.locator("main h1")).toHaveText(
      "Skicka en fil som bara mottagaren kan öppna.",
    );
    const seen: [string, boolean][] = JSON.parse(
      (await page.evaluate(() => sessionStorage.getItem("seen"))) ?? "[]",
    );
    // The English page may never finish parsing; if it did, it was hidden.
    expect(seen.filter(([path, hidden]) => path === "/" && !hidden)).toEqual([]);
  });

  test("a stored choice of English keeps the English page", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("lang", "en"));
    await page.goto("/about");
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.locator("main h1")).toHaveText("About Fidant");
  });
});

test("switching language while sharing keeps the share, and the recipient still gets it", async ({
  actor,
  leaks,
  canary,
}) => {
  const name = makeName(leaks, canary, "Anna");
  const text = `language-switch-${makeName(leaks, canary, "text")}`;
  leaks.watchContent("text", text);
  const { page: sender } = await actor("sender");
  await sender.goto("/send/secret");
  await sender.getByLabel("Your secret").fill(text);
  await continueToLinks(sender);
  await sender.locator("#secret-recipient-name").fill(name);
  await sender.getByRole("button", { name: "Add recipient", exact: true }).click();
  const link = (await sender.getByLabel(`Link for ${name}`, { exact: true }).textContent()) ?? "";
  leaks.watchKey("link secret", new URL(link).hash.slice(1));

  await sender.evaluate(() => Object.assign(window, { notReloaded: true }));
  await choose(sender, "Language", "Svenska");
  await expect(sender).toHaveURL(/\/sv\/skicka\/hemlighet$/);
  await expect(sender.locator("html")).toHaveAttribute("lang", "sv");
  expect(await sender.evaluate(() => "notReloaded" in window)).toBe(true);
  await expect(sender.getByLabel(`Länk till ${name}`, { exact: true })).toHaveText(link);

  const { page: recipient } = await actor("recipient");
  await recipient.goto(link);
  await recipient.getByRole("button", { name: "Show", exact: true }).click();
  await expect(recipient.getByRole("region", { name: "The secret", exact: true })).toHaveText(text);
});

test("back after a language switch shows the earlier page in the new language", async ({
  page,
}) => {
  await page.goto("/privacy");
  await page.locator("header nav").getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/how$/);
  await choose(page, "Language", "Svenska");
  await expect(page).toHaveURL(/\/sv\/sa-fungerar-det$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/sv\/integritet$/);
  await expect(page.locator("main h1")).toHaveText("Integritet");
  await page.locator("header nav").getByRole("link", { name: "Skicka", exact: true }).click();
  await expect(page).toHaveURL(/\/sv\/skicka$/);
});

test("every internal link on a Swedish page leads to a Swedish page", async ({ page, request }) => {
  const sitemap = await (await request.get("/sitemap.xml")).text();
  const swedish = [...sitemap.matchAll(/<loc>https:\/\/fidant\.se(\/sv[^<]*)<\/loc>/g)].map(
    (m) => m[1] ?? "",
  );
  expect(swedish).toHaveLength(20);
  // The menu's /sv/skicka is left out of the sitemap, which lists its canonical /sv/skicka/fil.
  const linkable = [...swedish, "/sv/skicka"];
  for (const path of swedish) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "sv");
    await expect(page.locator("main h1")).not.toBeEmpty();
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs.length, path).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(linkable, `${path} links to ${href}`).toContain(href.split(/[?#]/)[0]);
    }
  }
});

test("switching language on a step page opens its twin and keeps the anchor", async ({ page }) => {
  await page.goto("/sv/sa-fungerar-det/kryptering#keys");
  await expect(page.locator("main h1")).not.toBeEmpty();
  await choose(page, "Språk", "English");
  await expect(page).toHaveURL(/\/how\/encryption#keys$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await choose(page, "Language", "Svenska");
  await expect(page).toHaveURL(/\/sv\/sa-fungerar-det\/kryptering#keys$/);
});
