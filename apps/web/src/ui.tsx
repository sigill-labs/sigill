// Pieces shared by the pages.

import { cn } from "cn";
import type { AnchorHTMLAttributes, ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { DropdownMenu } from "radix-ui";
import { Alert, AlertDescription, AlertTitle } from "#components/ui/alert";
import { buttonVariants } from "#components/ui/button";
import { useI18n } from "./i18n/I18n.tsx";
import { LANGUAGE_NAMES, type Lang, localizedPath } from "./i18n/language.ts";
import { describeTrace, formatBytes } from "./lib/format.ts";
import type { OpenPath } from "./lib/peer.ts";
import type { Kind, Relayed } from "./lib/server-facts.ts";
import type { TraceLog as Log } from "./lib/trace-log.ts";
import type { Theme } from "./theme.ts";

export const ICONS = {
  phone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </>
  ),
  computer: (
    <>
      <rect x="4" y="4.5" width="16" height="11" rx="1.5" />
      <path d="M2 19.5h20" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  download: <path d="M12 4v11m-5-5 5 5 5-5M5 20h14" />,
  send: <path d="M21 3 10 14M21 3l-6.5 18-4.5-7-7-4.5z" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  languages: <path d="m5 8 6 6m-7 0 6-6 2-3M2 5h12M7 2h1m14 20-5-10-5 10m2-4h6" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V13m0 3.5v.01" />
    </>
  ),
  declined: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  server: (
    <>
      <rect x="3" y="3.5" width="18" height="7" rx="1.5" />
      <rect x="3" y="13.5" width="18" height="7" rx="1.5" />
      <path d="M7 7h.01M7 17h.01" />
    </>
  ),
  cloud: <path d="M7 18h10.5a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 7.2 10.6 3.75 3.75 0 0 0 7 18z" />,
  key: (
    <>
      <circle cx="6.5" cy="12" r="4" />
      <path d="M10.5 12H21v3.5M17.5 12v2.5" />
    </>
  ),
  tag: (
    <>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H15l6 6-6 6H4.5A1.5 1.5 0 0 1 3 16.5z" />
      <path d="M16 12h.01" />
    </>
  ),
  link: (
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  footprints: (
    <>
      <path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z" />
      <path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z" />
      <path d="M16 17h4M4 13h4" />
    </>
  ),
};

type IconName = keyof typeof ICONS;

/** A green dot with a ring that keeps expanding, for a transfer still open. Decorative. */
export function LiveDot() {
  return (
    <span class="relative flex size-2.5 flex-none" aria-hidden="true">
      <span class="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75 motion-reduce:hidden" />
      <span class="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
    </span>
  );
}

/** Decorative: the text next to an icon always carries its meaning. */
export function Icon({ name, class: cls }: { name: IconName; class?: string }) {
  return (
    <svg
      class={`flex-none ${cls ?? "size-[1.25em]"}`}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

export const lede = "mt-2 mb-6 text-[1.05rem] text-muted-foreground";

export const field = "flex flex-col gap-2";

export const formRows = "flex flex-wrap items-end gap-x-2 gap-y-4";

export const display = "font-display font-normal tracking-tight";

export type Route =
  | "landing"
  | "send"
  | "secret"
  | "privacy"
  | "how"
  | "receive"
  | "about"
  | "terms"
  | "security"
  | "notFound";

/** The send page in each mode. `/send` alone opens file mode too. */
export const FILE_HREF = "/send/file";
export const SECRET_HREF = "/send/secret";

/** Changes the page without reloading it, so a transfer held in memory survives. */
export function navigate(href: string) {
  history.pushState(null, "", href);
  dispatchEvent(new PopStateEvent("popstate"));
  scrollTo(0, 0);
}

/** A link that navigates inside the app; modified clicks (new tab, new window) keep the browser default. */
export function Link({
  href,
  to,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  /** Where a plain click goes, when that must differ from what the page shows in `href`. */
  to?: string | undefined;
}) {
  const { lang } = useI18n();
  const local = (path: string) => (path.startsWith("/") ? localizedPath(path, lang) : path);
  return (
    <a
      {...props}
      href={local(href)}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        navigate(local(to ?? href));
      }}
    />
  );
}

const MENU: ReadonlyArray<readonly ["send" | "how" | "privacy", string]> = [
  ["send", "/send"],
  ["how", "/how"],
  ["privacy", "/privacy"],
];

const LANGS: readonly Lang[] = ["sv", "en"];
const THEME_ICONS: Record<Theme, IconName> = { system: "computer", light: "sun", dark: "moon" };

/** A button showing the current choice that opens a menu of all of them, the current one checked. */
function Choice<T extends string>({
  label,
  icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: IconName;
  value: T;
  /** Value, text, and the text's language when it differs from the page's. */
  options: ReadonlyArray<readonly [T, string, string?]>;
  onChange(value: T): void;
}) {
  return (
    // Not modal: the modal version injects a <style> element, which the CSP blocks.
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger class={`${buttonVariants({ variant: "ghost" })} text-muted-foreground`}>
        <Icon name={icon} class="size-4" />
        <span class="sr-only">{label}: </span>
        {options.find(([option]) => option === value)?.[1]}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="end"
          sideOffset={8}
          class="z-[60] min-w-40 rounded-xl border border-border bg-popover/90 p-1 text-popover-foreground shadow-xl backdrop-blur-xl animate-in fade-in zoom-in-95"
        >
          <DropdownMenu.Label class="px-2 py-1.5 text-xs text-muted-foreground">
            {label}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
            {options.map(([option, text, lang]) => (
              <DropdownMenu.RadioItem
                key={option}
                value={option}
                lang={lang}
                class="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              >
                <span class="flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Icon name="check" class="size-4" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {text}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * On localhost, a yellow bar at the top of the page saying the links won't work on other computers.
 * It scrolls away with the page, so the header keeps its height and anchors still land below it.
 */
export function LocalhostBar() {
  const { t } = useI18n();
  if (typeof location === "undefined" || !LOCAL_HOSTS.has(location.hostname)) {
    return null;
  }
  return (
    <p
      role="note"
      data-banner="localhost"
      class="m-0 bg-yellow-300 px-4 py-1.5 text-center text-sm text-black"
    >
      {t.common.localhost}
    </p>
  );
}

export function Header({
  current,
  open,
}: {
  current: Route;
  /** Pages that still hold an unfinished transfer. */
  open: { send: boolean; secret: boolean };
}) {
  const { t } = useI18n();
  return (
    // Sticky with its height taken back, so it lies over the page like a fixed header but starts
    // below the localhost bar.
    <header class="sticky top-0 z-50 -mb-[calc(4rem+1px)] border-b border-border/60 bg-background/70 backdrop-blur-xl backdrop-saturate-150">
      <div class="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-3 sm:gap-4 sm:px-4">
        <Link
          href="/"
          aria-current={current === "landing" ? "page" : undefined}
          class="flex items-center gap-2 rounded-md text-[1.05rem] font-bold tracking-tight no-underline"
        >
          {/* The mark: a shepherd's crook, upright and bent over what it looks after. Same drawing as public/favicon.svg, and like it flips with the theme (docs/decisions/0035-logo-flips-with-the-theme.md). */}
          <svg
            class="size-8 flex-none rounded-md bg-foreground text-background"
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M11.25 24.25V12.75a5 5 0 0 1 10 0v.5" />
            <circle cx="21.25" cy="19.75" r="2.5" fill="currentColor" stroke="none" />
          </svg>
          <span class="max-sm:sr-only">{t.product}</span>
        </Link>
        <nav aria-label={t.menu.label}>
          <ul class="flex items-center gap-0.5 sm:gap-1">
            {MENU.map(([section, href]) => {
              // Send covers both modes of the send page.
              const here = section === current || (section === "send" && current === "secret");
              return (
                <li key={section}>
                  <Link
                    // With only a secret open, Send leads back to it.
                    href={section === "send" && open.secret && !open.send ? SECRET_HREF : href}
                    aria-current={here ? "page" : undefined}
                    class={`${buttonVariants({ variant: here ? "secondary" : "ghost" })} max-sm:px-1 max-sm:text-[0.8125rem]`}
                  >
                    {t.menu[section]}
                    {section === "send" && (open.send || open.secret) && <LiveDot />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}

const FOOTER_LINKS: ReadonlyArray<
  readonly ["file" | "how" | "secret" | "privacy" | "about" | "terms" | "security", string]
> = [
  ["file", FILE_HREF],
  ["secret", SECRET_HREF],
  ["how", "/how"],
  ["about", "/about"],
  ["privacy", "/privacy"],
  ["terms", "/terms"],
  ["security", "/security"],
];

export function Footer({ theme, onTheme }: { theme: Theme; onTheme(next: Theme): void }) {
  const { lang, t, setLang } = useI18n();
  const link =
    "rounded-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
  return (
    <footer class="border-t border-border text-[0.9rem]">
      <div class="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:justify-between">
        <div class="max-w-xs">
          <p class="m-0 font-bold">{t.product}</p>
          <p class="mb-0 text-muted-foreground">{t.footer.tagline}</p>
        </div>
        <nav aria-label={t.footer.label}>
          <ul class="m-0 grid list-none grid-cols-2 gap-x-10 gap-y-2 p-0">
            {FOOTER_LINKS.map(([page, href]) => (
              <li key={page}>
                <Link href={href} class={link}>
                  {page === "how" || page === "secret" || page === "privacy"
                    ? t.menu[page]
                    : t.footer[page]}
                </Link>
              </li>
            ))}
            <li>
              <a href="https://github.com/fidant-labs/fidant" class={link}>
                {t.footer.source}
              </a>
            </li>
          </ul>
        </nav>
      </div>
      <div class="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pb-8">
        <p class="m-0 text-[0.85rem] text-muted-foreground">{t.footer.license}</p>
        <div class="flex flex-none items-center gap-1">
          <Choice
            label={t.menu.language}
            icon="languages"
            value={lang}
            options={LANGS.map((code) => [code, LANGUAGE_NAMES[code], code] as const)}
            onChange={setLang}
          />
          <Choice
            label={t.menu.theme}
            icon={THEME_ICONS[theme]}
            value={theme}
            options={(["system", "light", "dark"] as const).map(
              (v) => [v, t.menu.themes[v]] as const,
            )}
            onChange={onTheme}
          />
        </div>
      </div>
    </footer>
  );
}

/** Page content. The sticky header lies over its top padding, so the content starts under the header. */
export function Page({
  children,
  tall,
  full,
  banner,
}: {
  children: ComponentChildren;
  /** At least a screen high, so only the top of the footer shows. */
  tall?: boolean;
  /** At least a full screen high, so the footer starts below the first screen. */
  full?: boolean;
  /** A full-width bar just below the header, outside the page's column. */
  banner?: ComponentChildren;
}) {
  return (
    <>
      {banner}
      <main
        class={`mx-auto px-4 pt-24 pb-16 max-w-xl ${full ? "min-h-dvh" : tall ? "min-h-[calc(100dvh-4.5rem)]" : ""}`}
      >
        {children}
      </main>
    </>
  );
}

type DirectState = "ready" | "active" | "done";

const DIRECT_LINE: Record<DirectState, string> = {
  ready:
    "bg-[image:repeating-linear-gradient(90deg,var(--color-border)_0_6px,transparent_6px_12px)]",
  active:
    "bg-[image:repeating-linear-gradient(90deg,var(--color-primary)_0_6px,transparent_6px_12px)] bg-[length:12px_2px] animate-flow motion-reduce:animate-none",
  done: "bg-primary",
};

/** Hidden from screen readers, so always pair it with a sentence that says the same. */
export function Direct({
  from,
  to,
  state,
  class: cls = "mt-6",
}: {
  from: string;
  to: string;
  state: DirectState;
  /** Top margin; the default suits a page, a card passes a smaller one. */
  class?: string;
}) {
  const done = state === "done";
  return (
    <div class={`mb-1 flex items-center gap-3 ${cls}`} aria-hidden="true">
      <span class="flex max-w-28 flex-col items-center text-muted-foreground">
        <Icon name="computer" class="size-9 text-foreground" />
        <span class="max-w-full truncate text-[0.85rem]">{from}</span>
      </span>
      <span class={`mb-5 flex h-0.5 flex-1 items-center justify-center ${DIRECT_LINE[state]}`}>
        <span
          class={`inline-flex rounded-[50%] border bg-background p-1.5 ${done ? "border-primary" : "border-border"} text-primary`}
        >
          <Icon name={done ? "check" : "lock"} />
        </span>
      </span>
      <span class="flex max-w-28 flex-col items-center text-muted-foreground">
        <Icon name="computer" class="size-9 text-foreground" />
        <span class="max-w-full truncate text-[0.85rem]">{to}</span>
      </span>
    </div>
  );
}

function Facts({
  rows,
  inline,
}: {
  rows: ReadonlyArray<readonly [string, ComponentChildren]>;
  /** Short values share a line; a value too wide for what is left starts a new one. */
  inline?: boolean;
}) {
  return (
    <dl class={inline ? "mt-3 flex flex-wrap gap-x-10 gap-y-2" : "mt-3 grid gap-2"}>
      {rows.map(([term, value]) => (
        <div key={term} class={inline ? "max-w-full min-w-0" : undefined}>
          <dt class="text-muted-foreground">{term}</dt>
          <dd class="m-0 wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function TechDetails({
  rows,
}: {
  rows: ReadonlyArray<readonly [string, ComponentChildren]>;
}) {
  const { t } = useI18n();
  return (
    <details class="mt-8 text-[0.9rem] [&_code]:text-[0.85rem]">
      <summary class="cursor-pointer text-muted-foreground">{t.common.techDetails}</summary>
      <Facts rows={rows} inline />
    </details>
  );
}

/** How a connection runs, on the send card: one line with a link to /how and nothing to open. */
export function PathNote({ path }: { path: OpenPath }) {
  const { t } = useI18n();
  const kind = path === "relay" ? "relay" : "direct";
  return (
    <p class="mt-2 mb-0 text-[0.9rem]">
      <span class="font-medium">{t.connection[kind].label}</span>{" "}
      <Link
        href={`/how#${kind}`}
        class="rounded-sm text-muted-foreground underline underline-offset-4"
      >
        {t.connection.more}
      </Link>
    </p>
  );
}

/**
 * How a connection runs, with a "Why?" that explains it. The summary holds the label too, so it
 * makes sense on its own.
 */
export function PathLine({ path }: { path: OpenPath }) {
  const { t } = useI18n();
  const kind = path === "relay" ? "relay" : "direct";
  const { label, explain } = t.connection[kind];
  return (
    <details class="mt-2 text-[0.9rem]">
      <summary class="cursor-pointer">
        <span class="font-medium">{label}</span>{" "}
        <span class="text-muted-foreground underline underline-offset-4">{t.connection.why}</span>
      </summary>
      <p class="mt-1 mb-0 text-muted-foreground">
        {explain}{" "}
        <Link href={`/how#${kind}`} class="rounded-sm font-medium underline underline-offset-4">
          {t.connection.more}
        </Link>
      </p>
    </details>
  );
}

type ServerPanelProps = {
  kind: Kind;
  sees: string;
  holds: string;
  relayed: Relayed;
  afterwards: string;
  /** A connection on this page went through our TURN relay. */
  viaRelay: boolean;
  /** The server got the key of a link on this page, to email it. */
  emailed: boolean;
};

/** What our server and relay see, hold and keep, as rows for `Facts`. */
function serverRows(
  t: ReturnType<typeof useI18n>["t"],
  lang: Lang,
  { sees, holds, relayed, afterwards, viaRelay, emailed, kind }: ServerPanelProps,
): ReadonlyArray<readonly [string, string]> {
  return [
    [t.server.seesLabel, sees],
    [t.server.holdsLabel, holds],
    [
      t.server.passedOnLabel,
      t.server.passedOn(relayed.messages, formatBytes(relayed.bytes, lang), emailed),
    ],
    [
      t.server.fileDataLabel(kind),
      viaRelay ? t.server.fileDataRelayed(kind) : t.server.fileData(kind),
    ],
    [t.server.logsLabel, t.server.logs(kind)],
    [t.server.afterwardsLabel, afterwards],
    ...(viaRelay
      ? ([
          [t.server.relaySeesLabel, t.server.relaySees(kind)],
          [t.server.relayLogsLabel, t.server.relayLogs(kind)],
          [t.server.relayKeepsLabel, t.server.relayKeeps(kind)],
        ] as const)
      : []),
  ];
}

/**
 * This page's traces, oldest first, each with when this page saw it, who holds it, what and until
 * when. No live region: a line per signaling message would flood a screen reader.
 */
export function TraceLog({ log }: { log: Log }) {
  const { t, lang } = useI18n();
  const headingId = useId();
  return (
    <section class="mt-6" aria-labelledby={headingId}>
      <h3 id={headingId} class="m-0 text-[length:inherit] font-semibold">
        {t.traces.heading}
      </h3>
      <p class="mt-1 mb-0 text-muted-foreground">{t.traces.note}</p>
      {log.entries.length === 0 ? (
        <p class="mt-3 mb-0">{t.traces.empty}</p>
      ) : (
        <ol class="mt-3 mb-0 grid list-none gap-2 p-0">
          {log.entries.map((entry, index) => {
            const line = describeTrace(entry, log.role, lang);
            return (
              // Keyed by index: lines only change or drop off the front, and hold no state of their own.
              <li key={index} class="wrap-anywhere">
                <time
                  datetime={new Date(entry.at).toISOString()}
                  class="text-muted-foreground tabular-nums"
                >
                  {line.time}
                </time>{" "}
                <span class="font-medium">{line.part}:</span> {line.what}{" "}
                <span class="text-muted-foreground">({line.until})</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/** The receive page's server facts: a section with a disclosure. */
export function ServerPanel(props: ServerPanelProps) {
  const { t, lang } = useI18n();
  const headingId = useId();
  return (
    <section class="mt-10 text-[0.9rem]" aria-labelledby={headingId}>
      <details>
        <summary id={headingId} class="cursor-pointer font-medium text-muted-foreground">
          {t.server.heading}
        </summary>
        <Facts rows={serverRows(t, lang, props)} />
      </details>
    </section>
  );
}

/** The send page's "Technical details": an icon button, for the bottom bar, that opens the file facts and the server facts in a drawer. */
export function ServerDrawer({
  facts,
  visible,
  onGreen,
  traces,
  ...panel
}: ServerPanelProps & {
  /** This page's trace log, shown under the server facts. */
  traces: Log;
  /** The file's facts, shown above the server's; empty for a secret. */
  facts: ReadonlyArray<readonly [string, ComponentChildren]>;
  /** False while the page is hidden. A hidden page closes the drawer, so a modal dialog never stays open in it. */
  visible: boolean;
  /** True while the bar behind the button is green, with white text. */
  onGreen: boolean;
}) {
  const { t, lang } = useI18n();
  const headingId = useId();
  const titleId = useId();
  const drawer = useRef<HTMLDialogElement>(null);
  // Whether the last press began on the dimmed page, so a text selection dragged out of the drawer doesn't close it.
  const pressedOutside = useRef(false);
  useEffect(() => {
    if (!visible) {
      drawer.current?.close();
    }
  }, [visible]);
  return (
    <>
      {/* 40 × 40, no taller than the bar's two lines of text. showModal from the button returns
          focus to it when the drawer closes. */}
      <button
        type="button"
        aria-label={t.common.techDetails}
        title={t.common.techDetails}
        class={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "size-10 cursor-pointer",
          onGreen
            ? "text-white hover:bg-white/15 hover:text-white focus-visible:border-white focus-visible:ring-white/60 dark:hover:bg-white/15"
            : "text-muted-foreground",
        )}
        onClick={() => drawer.current?.showModal()}
      >
        <Icon name="footprints" class="size-5" />
      </button>
      {/* A native dialog, like the safety number's: it holds focus and dims the page without
          injecting a style, which the CSP blocks. A drawer from the right; on a phone it covers
          the screen. Its content stays rendered while closed. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click is on the dimmed page; Escape and the Close button close it from the keyboard */}
      <dialog
        ref={drawer}
        aria-labelledby={titleId}
        class="m-0 ml-auto h-dvh max-h-none w-full max-w-none overflow-y-auto border-border bg-popover text-[0.9rem] text-popover-foreground shadow-xl backdrop:bg-black/50 open:animate-in open:slide-in-from-right motion-reduce:animate-none sm:w-[28rem] sm:border-l [&_code]:text-[0.85rem]"
        // The padding is on the inner box, so a press on the dialog itself is a press on the dimmed page.
        onPointerDown={(event) => {
          pressedOutside.current = event.target === event.currentTarget;
        }}
        onClick={(event) => {
          if (pressedOutside.current && event.target === event.currentTarget) {
            event.currentTarget.close();
          }
          pressedOutside.current = false;
        }}
      >
        <div class="min-h-full p-6">
          <div class="flex items-center justify-between gap-4">
            <h2 id={titleId} class="m-0 text-[1.25rem] font-bold">
              {t.common.techDetails}
            </h2>
            <form method="dialog">
              <button type="submit" class={buttonVariants({ variant: "ghost", size: "sm" })}>
                {t.common.close}
              </button>
            </form>
          </div>
          {facts.length > 0 && <Facts rows={facts} />}
          <section class="mt-6" aria-labelledby={headingId}>
            <h3 id={headingId} class="m-0 text-[length:inherit] font-semibold">
              {t.server.heading}
            </h3>
            <Facts rows={serverRows(t, lang, panel)} />
          </section>
          <TraceLog log={traces} />
        </div>
      </dialog>
    </>
  );
}

export function Problem({ title, body }: { title: string; body: string }) {
  return (
    <Alert variant="destructive" className="mb-4">
      <Icon name="alert" class="size-4" />
      <AlertTitle>
        {/* The page heading: the receive page moves focus to `main h1` after each step. */}
        <h1 class="m-0 text-[length:inherit] font-[weight:inherit] leading-[inherit]">{title}</h1>
      </AlertTitle>
      <AlertDescription>{body}</AlertDescription>
    </Alert>
  );
}

/** Shows `active` in place of `idle` without the width changing: both share one grid cell and the hidden one keeps its space. */
export function SwapLabel({
  idle,
  active,
  on,
}: {
  idle: ComponentChildren;
  active: ComponentChildren;
  on: boolean;
}) {
  return (
    <span class="grid justify-items-center">
      <span class={`col-start-1 row-start-1 ${on ? "invisible" : ""}`}>{idle}</span>
      <span
        class={`col-start-1 row-start-1 inline-flex items-center gap-1.5 ${on ? "" : "invisible"}`}
      >
        <Icon name="check" class="size-4" />
        {active}
      </span>
    </span>
  );
}

type CopyNote = "copied" | "failed";

/** Copies a text to the clipboard; `note` says how it went, as a `copyNote` key, for 4 s. */
export function useCopyNote() {
  const [note, setNote] = useState<CopyNote | "">("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const showNote = (next: CopyNote) => {
    clearTimeout(timer.current);
    setNote(next);
    timer.current = setTimeout(() => setNote(""), 4000);
  };

  const copy = async (text: string) => {
    try {
      if (!navigator.clipboard) {
        throw new Error("no clipboard");
      }
      await navigator.clipboard.writeText(text);
      showNote("copied");
    } catch {
      showNote("failed");
    }
  };

  return { note, copy };
}

/** A section's [text, href] link, on its own line. */
export function SectionLink({ link: [text, href] }: { link: readonly [string, string] }) {
  // Same-site links navigate in place, so a send open in another page survives.
  const Anchor = href.startsWith("/") ? Link : "a";
  return (
    <p>
      <Anchor href={href} class="font-medium underline underline-offset-4">
        {text}
      </Anchor>
    </p>
  );
}

/** A safety number shown as "482 913", heard digit by digit when it appears. */
export function CheckNumber({ number }: { number: string | undefined }) {
  return (
    <p class="m-0" role="status">
      {number && (
        <>
          <span
            class="font-mono text-3xl font-semibold tracking-widest tabular-nums"
            aria-hidden="true"
          >
            {number}
          </span>
          <span class="sr-only">{[...number.replace(" ", "")].join(" ")}</span>
        </>
      )}
    </p>
  );
}
