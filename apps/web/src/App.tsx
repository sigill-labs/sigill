import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { buttonVariants } from "#components/ui/button";
import { HowPage, howStep } from "./how/HowPage.tsx";
import type { Messages } from "./i18n/en.ts";
import { useI18n } from "./i18n/I18n.tsx";
import { barePath, type Lang, localizedPath } from "./i18n/language.ts";
import { InfoPage } from "./info/InfoPage.tsx";
import { LandingPage } from "./landing/LandingPage.tsx";
import { faviconHref, overallStatus, type TransferStatus } from "./lib/favicon.ts";
import { PrivacyPage } from "./privacy/PrivacyPage.tsx";
import { ReceivePage, type ReceivePreview } from "./receive/ReceivePage.tsx";
import { SendPage, type SendPreview } from "./send/SendPage.tsx";
import { pageUrl } from "./site-files.ts";
import { applyTheme, type Theme } from "./theme.ts";
import {
  FILE_HREF,
  Footer,
  Header,
  Link,
  LiveDot,
  LocalhostBar,
  lede,
  Page,
  Problem,
  type Route,
  SECRET_HREF,
} from "./ui.tsx";

function InsecurePage() {
  const { t } = useI18n();
  return (
    <Page>
      <Problem title={t.insecure.title} body={t.insecure.body} />
    </Page>
  );
}

function NotFoundPage() {
  const { t } = useI18n();
  return (
    <Page>
      <h1>{t.notFound.title}</h1>
      <p class={lede}>{t.notFound.body}</p>
      <p>
        <Link href="/" class="font-medium underline underline-offset-4">
          {t.notFound.home}
        </Link>
      </p>
    </Page>
  );
}

const NAMED: ReadonlyArray<Route> = ["privacy", "how", "send", "about", "terms", "security"];

/** The route of a page's English path, as barePath returns it. */
function routeOf(path: string): Route {
  if (/^\/send\/secret\/?$/.test(path)) {
    return "secret";
  }
  if (/^\/send\/file\/?$/.test(path)) {
    return "send";
  }
  const named = NAMED.find((name) => new RegExp(`^/${name}/?$`).test(path));
  if (named) {
    return named;
  }
  if (howStep(path)) {
    return "how";
  }
  if (path.startsWith("/r/")) {
    return "receive";
  }
  return path === "/" ? "landing" : "notFound";
}

export function pageTitle(t: Messages, path: string): string {
  const step = howStep(path);
  return step ? `${t.how.sections[step.id].heading} – Fidant` : t.tabTitles[routeOf(path)];
}

export function pageDescription(t: Messages, path: string): string {
  const step = howStep(path);
  if (step) {
    return t.how.sections[step.id].body[0] ?? t.how.lede;
  }
  const route = routeOf(path);
  if (route === "receive") {
    return t.preview.receiveDescription;
  }
  return route === "notFound" ? t.notFound.body : t[route].lede;
}

type Place = { path: string; hash: string };

/**
 * Navigation never reloads the page (see `navigate`). The send, secret and receive
 * pages hold a transfer only in memory, so once opened they stay mounted, hidden
 * while another page shows.
 */
export function App({
  secure,
  theme: startTheme,
  prerender,
  preview,
}: {
  /** Web Crypto is available, so the send and receive pages can run. */
  secure: boolean;
  theme: Theme;
  /** Rendered at build time for this path: the send forms stay inert until the app takes over. */
  prerender?: string;
  /** The state each transfer page is put in. Only the dev panel (src/dev) passes it. */
  preview?: {
    send?: SendPreview;
    secret?: SendPreview;
    receive?: ReceivePreview;
    /** The page whose state was picked last. */
    page?: "send" | "secret" | "receive";
  };
}) {
  const { t, lang } = useI18n();
  // The path, not just the route, so moving between /how steps renders the new step. On /how pages
  // the fragment too, so a link to an entry on the same page scrolls to it; elsewhere the fragment
  // can be a decryption key, so it stays out.
  // A new object on every navigation, so following a link to the anchor already in the address
  // still scrolls to it.
  const where = (): Place => {
    let path = barePath(location.pathname);
    const mode = new URLSearchParams(location.search).get("mode");
    if (routeOf(path) === "send" && mode !== null) {
      // The send page's old addresses named the mode in the query.
      path = mode === "secret" ? SECRET_HREF : FILE_HREF;
      history.replaceState(history.state, "", localizedPath(path, lang) + location.hash);
    }
    return { path, hash: routeOf(path) === "how" ? location.hash : "" };
  };
  const [place, setPlace] = useState<Place>(() =>
    prerender === undefined ? where() : { path: prerender, hash: "" },
  );
  const [theme, setTheme] = useState(startTheme);
  const chooseTheme = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };
  const kept = useRef(new Set<Route>());
  const [sendStatus, setSendStatus] = useState<TransferStatus>("idle");
  const [secretStatus, setSecretStatus] = useState<TransferStatus>("idle");
  const [receiveStatus, setReceiveStatus] = useState<TransferStatus>("idle");
  const sendOpen = sendStatus === "active";
  const secretOpen = secretStatus === "active";
  const receiveOpen = receiveStatus === "active";
  // One send at a time: while a file or a secret is on its way, both modes' addresses lead to it.
  const lockedTo = sendOpen === secretOpen ? undefined : sendOpen ? "send" : "secret";
  const shown = routeOf(place.path);
  const path =
    lockedTo &&
    (shown === "send" || shown === "secret") &&
    shown !== lockedTo &&
    // The dev panel shows the page it picked, whatever the other one holds.
    shown !== preview?.page
      ? lockedTo === "send"
        ? FILE_HREF
        : SECRET_HREF
      : place.path;
  const route = routeOf(path);
  // Before paint, so the address never shows the mode that didn't open.
  useLayoutEffect(() => {
    if (path !== place.path) {
      history.replaceState(history.state, "", localizedPath(path, lang));
      setPlace(where());
    }
  }, [path, place]);
  // Without Web Crypto the send, secret and receive pages show only the secure-connection screen.
  const holdsTransfer = route === "send" || route === "secret" || route === "receive";
  const insecureShown = !secure && holdsTransfer;
  const icon = insecureShown
    ? "insecure"
    : overallStatus([sendStatus, secretStatus, receiveStatus]);
  useEffect(() => {
    document
      .querySelector('link[rel="icon"][type="image/svg+xml"]')
      ?.setAttribute("href", faviconHref(icon));
  }, [icon]);
  // Holds the key, so it stays out of the DOM: the link back shows only the path.
  const receiveUrl = useRef("");
  const away =
    sendOpen && route !== "send"
      ? "send"
      : secretOpen && route !== "secret"
        ? "secret"
        : receiveOpen && route !== "receive"
          ? "receive"
          : undefined;
  useEffect(() => {
    // Back or forward to an entry made before a language switch shows the page in the current language.
    const onPop = () => {
      const current = localizedPath(location.pathname, lang);
      if (current !== location.pathname) {
        history.replaceState(history.state, "", current + location.search + location.hash);
      }
      setPlace(where());
    };
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, [lang]);

  useEffect(() => {
    document.title = insecureShown ? t.tabTitles.insecure : pageTitle(t, path);
    const description = pageDescription(t, path);
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    if (route !== "receive" && route !== "notFound") {
      const set = (selector: string, to: Lang) =>
        document.querySelector(selector)?.setAttribute("href", pageUrl(path, to));
      set('link[rel="canonical"]', lang);
      set('link[rel="alternate"][hreflang="en"]', "en");
      set('link[rel="alternate"][hreflang="sv"]', "sv");
      set('link[rel="alternate"][hreflang="x-default"]', "en");
    }
  }, [path, route, t, lang, insecureShown]);

  // A page change hides the focused link, so focus moves to the new page's or section's heading.
  const firstRoute = useRef(true);
  useEffect(() => {
    // This effect reads the fragment only on /how; elsewhere it can be a decryption key.
    const named =
      routeOf(barePath(location.pathname)) === "how" && location.hash
        ? document.getElementById(location.hash.slice(1))
        : null;
    const target = named?.closest<HTMLElement>("main:not([hidden] *) section") ?? null;
    target?.scrollIntoView();
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    const heading =
      target?.querySelector<HTMLElement>("h2") ??
      document.querySelector<HTMLElement>("main:not([hidden] *) h1");
    if (!heading) {
      return;
    }
    heading.tabIndex = -1;
    heading.focus({ preventScroll: target !== null });
  }, [place]);

  if (holdsTransfer) {
    kept.current.add(route);
  }
  if (route === "receive" && !receiveUrl.current) {
    receiveUrl.current = location.pathname + location.hash;
  }
  return (
    <div class="flex min-h-dvh flex-col has-[[data-bottom-bar]:not([hidden]_*)]:pb-24 has-[[data-page-bar]:not([hidden]_*)]:has-[[data-pill]]:pb-40 has-[[data-page-bar]:not([hidden]_*)]:[&_[data-pill-wrap]]:bottom-20">
      <LocalhostBar />
      <Header current={route} open={{ send: sendOpen, secret: secretOpen }} />
      <div class="flex-1">
        {route === "landing" && <LandingPage />}
        {/* The privacy page uses no crypto, so it opens even without a secure connection. */}
        {route === "privacy" && <PrivacyPage />}
        {route === "how" && <HowPage path={path} />}
        {(route === "about" || route === "terms" || route === "security") && (
          <InfoPage page={route} />
        )}
        {route === "notFound" && <NotFoundPage />}
        {insecureShown && <InsecurePage />}
        {secure && kept.current.has("receive") && (
          <div id="receive" hidden={route !== "receive"}>
            <ReceivePage onStatus={setReceiveStatus} preview={preview?.receive} />
          </div>
        )}
        {secure && kept.current.has("send") && (
          <div hidden={route !== "send"} inert={prerender !== undefined}>
            <SendPage
              kind="file"
              onStatus={setSendStatus}
              preview={preview?.send}
              shown={route === "send"}
            />
          </div>
        )}
        {secure && kept.current.has("secret") && (
          <div hidden={route !== "secret"} inert={prerender !== undefined}>
            <SendPage
              kind="text"
              onStatus={setSecretStatus}
              preview={preview?.secret}
              shown={route === "secret"}
            />
          </div>
        )}
      </div>
      <Footer theme={theme} onTheme={chooseTheme} />
      <div
        role="status"
        data-pill-wrap
        class="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4"
      >
        {away && (
          <div
            data-bottom-bar
            data-pill
            class="pointer-events-auto flex items-center gap-3 rounded-full border border-border bg-popover/90 py-1.5 pr-1.5 pl-4 text-sm text-popover-foreground shadow-xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-4"
          >
            <LiveDot />
            <span>{t.openTransfer[away]}</span>
            <Link
              href={
                away === "receive"
                  ? (receiveUrl.current.split("#")[0] ?? "")
                  : away === "secret"
                    ? SECRET_HREF
                    : "/send"
              }
              to={away === "receive" ? receiveUrl.current : undefined}
              class={`${buttonVariants({ size: "sm" })} rounded-full`}
            >
              {t.openTransfer.back}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
