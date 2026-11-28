// The dev panel: the app, plus a drawer that puts the live send and receive pages
// in any of their states without a transfer. The pages stay mounted and take each
// state in place, so going from one to the next shows what a real transfer shows.
// main.tsx loads this file only under `import.meta.env.DEV`, so the production
// build has none of it.

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { App } from "../App.tsx";
import { useI18n } from "../i18n/I18n.tsx";
import { barePath, localizedPath } from "../i18n/language.ts";
import type { Theme } from "../theme.ts";
import { navigate, SECRET_HREF } from "../ui.tsx";
import { type DevState, STATES } from "./states.ts";

const STATE_KEY = "dev-state";
const OPEN_KEY = "dev-open";
const INSECURE_KEY = "dev-insecure";
/** Bars the panel can hide, by their `data-banner` value, so a screenshot shows the page alone. */
const BANNERS = { localhost: "Localhost bar", "lost-server": "Server lost bar" } as const;
type Banner = keyof typeof BANNERS;
const hiddenKey = (banner: Banner) => `dev-hide-${banner}`;
const PLAY_MS = 1500;
const GROUPS = [...new Set(STATES.map((s) => s.group))];
const HREF: Record<DevState["page"], string> = {
  send: "/send",
  secret: SECRET_HREF,
  receive: "/r/dev",
};

/** Session storage keeps the pick over a reload, which is how the dev server applies an edit. */
function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | undefined): void {
  try {
    if (value === undefined) {
      sessionStorage.removeItem(key);
    } else {
      sessionStorage.setItem(key, value);
    }
  } catch {
    // Not kept: the panel still works until the next reload.
  }
}

/** The transfer page the address shows, if any. */
function shownPage(): DevState["page"] | undefined {
  const path = barePath(location.pathname);
  if (path.startsWith("/r/")) {
    return "receive";
  }
  if (path === "/send/secret") {
    return "secret";
  }
  return path === "/send" || path === "/send/file" ? "send" : undefined;
}

export function DevApp(props: { secure: boolean; theme: Theme }) {
  const { lang } = useI18n();
  const [index, setIndex] = useState(() => Number(read(STATE_KEY) ?? -1));
  const [open, setOpen] = useState(() => read(OPEN_KEY) !== "no");
  const [playing, setPlaying] = useState(false);
  const [hidden, setHidden] = useState(
    () => new Set((Object.keys(BANNERS) as Banner[]).filter((b) => read(hiddenKey(b)) === "yes")),
  );
  // Renders the app as on an address without HTTPS, to show the secure-connection screen.
  const [insecure, setInsecure] = useState(() => read(INSECURE_KEY) === "yes");
  const state = STATES[index];
  // A page keeps its last state while another page is picked, so it never goes back to connecting.
  const previews = useRef<NonNullable<Parameters<typeof App>[0]["preview"]>>({});
  // Built once per pick, so the page gets each state once.
  const preview = useMemo(() => {
    if (state) {
      previews.current = { ...previews.current, [state.page]: state.preview(), page: state.page };
    }
    return previews.current;
  }, [state]);

  const pick = (next: number) => {
    setIndex(next);
    write(STATE_KEY, String(next));
  };
  const step = (by: number) => pick((index + by + STATES.length) % STATES.length);
  const showBanner = (banner: Banner, show: boolean) => {
    const next = new Set(hidden);
    if (show) {
      next.delete(banner);
    } else {
      next.add(banner);
    }
    setHidden(next);
    write(hiddenKey(banner), show ? undefined : "yes");
  };
  const showInsecure = (on: boolean) => {
    setInsecure(on);
    write(INSECURE_KEY, on ? "yes" : undefined);
    // The screen shows only where a transfer page would.
    if (on && !shownPage()) {
      navigate(localizedPath("/send", lang));
    }
  };
  const toggle = () => {
    setOpen(!open);
    write(OPEN_KEY, open ? "no" : undefined);
  };

  useEffect(() => {
    if (state && shownPage() !== state.page) {
      navigate(localizedPath(HREF[state.page], lang));
    }
  }, [state]);

  // Plays to the end of the picked state's group.
  useEffect(() => {
    if (!playing) {
      return;
    }
    if (STATES[index + 1]?.group !== state?.group) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => pick(index + 1), PLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, index]);

  const button = "rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-50";
  return (
    <>
      {/* A new App when the box changes: without HTTPS no transfer page mounts, so no status
          a picked state reported may outlive its page. */}
      <App key={String(insecure)} {...props} secure={props.secure && !insecure} preview={preview} />
      {hidden.size > 0 && (
        <style>
          {[...hidden].map((banner) => `[data-banner="${banner}"]{display:none}`).join("")}
        </style>
      )}
      <button
        type="button"
        class="fixed top-1/2 right-0 z-[70] rounded-l-lg border border-r-0 border-border cursor-pointer bg-popover px-10 py-1.5 text-xs font-semibold text-popover-foreground shadow-lg [writing-mode:vertical-rl]"
        aria-expanded={open}
        aria-controls="dev-panel"
        onClick={toggle}
        hidden={open}
      >
        Dev
      </button>
      <aside
        id="dev-panel"
        aria-label="Dev panel"
        hidden={!open}
        class="fixed inset-y-0 right-0 z-[70] flex w-64 flex-col border-l border-border bg-popover text-xs text-popover-foreground shadow-xl"
      >
        <div class="flex flex-col gap-2 border-b border-border p-3">
          <div class="flex items-center justify-between">
            <strong class="text-sm">Dev panel</strong>
            <button type="button" class={button} onClick={toggle}>
              Hide
            </button>
          </div>
          <div class="flex flex-wrap gap-1">
            <button
              type="button"
              class={button}
              aria-label="Previous state"
              onClick={() => step(-1)}
            >
              ‹
            </button>
            <button type="button" class={button} aria-label="Next state" onClick={() => step(1)}>
              ›
            </button>
            <button
              type="button"
              class={button}
              disabled={!state}
              aria-pressed={playing}
              onClick={() => setPlaying(!playing)}
            >
              {playing ? "Pause" : "Play"}
            </button>
            {/* A reload, because the page's own state is gone once a state replaced it. */}
            <button
              type="button"
              class={button}
              disabled={!state}
              onClick={() => {
                write(STATE_KEY, undefined);
                // The receive page's address here is not a real link.
                location.assign(
                  shownPage() === "receive" ? localizedPath("/send", lang) : location.href,
                );
              }}
            >
              Back to live
            </button>
          </div>
          <fieldset class="m-0 flex flex-col gap-1 border-0 p-0">
            <legend class="mb-1 p-0 font-semibold">Show</legend>
            {(Object.keys(BANNERS) as Banner[]).map((banner) => (
              <label key={banner} class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!hidden.has(banner)}
                  onChange={(event) => showBanner(banner, event.currentTarget.checked)}
                />
                {BANNERS[banner]}
              </label>
            ))}
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!insecure}
                onChange={(event) => showInsecure(!event.currentTarget.checked)}
              />
              Secure connection
            </label>
          </fieldset>
          <p class="m-0 text-muted-foreground">
            {state
              ? "The page shows this state and connects to nothing."
              : "Live app. Pick a state to put its page in it."}
          </p>
        </div>
        <nav aria-label="States" class="flex-1 overflow-y-auto p-2">
          {GROUPS.map((group) => (
            <section key={group} class="mb-3">
              <h2 class="m-0 px-2 py-1 text-xs font-semibold text-muted-foreground">{group}</h2>
              {STATES.map(
                (s, i) =>
                  s.group === group && (
                    <button
                      key={s.name}
                      type="button"
                      aria-current={i === index ? "true" : undefined}
                      class="block w-full rounded px-2 py-1 text-left hover:bg-muted aria-[current]:bg-primary aria-[current]:text-primary-foreground"
                      onClick={() => {
                        setPlaying(false);
                        pick(i);
                      }}
                    >
                      {s.name}
                    </button>
                  ),
              )}
            </section>
          ))}
        </nav>
      </aside>
    </>
  );
}
