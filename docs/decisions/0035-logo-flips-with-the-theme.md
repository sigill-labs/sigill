# 0035: The logo flips with the theme

- Status: Accepted
- Date: 2026-11-28
- Linear: FID-374

## Context

- The logo is a rounded tile with a mark on it: a crook with a dot (`public/favicon.svg`). Manual testing found it unclear whether the logo is white or black, because it shows up in both forms.
- The header's mark (`Header` in `apps/web/src/ui.tsx`) uses the page's colours, `bg-foreground text-background`: a black tile with a white mark in the light theme, a light tile with a black mark in the dark one. It follows the theme the site's switch chose (`apps/web/src/theme.ts`), and the system's when the switch is on "system".
- `public/favicon.svg` flips the same way, but only through `prefers-color-scheme`, so it follows the system and never the site's switch. Once the app runs, the tab's normal icon in `apps/web/src/lib/favicon.ts` is the same drawing with the same media query.
- So with the switch on "dark" on a light system, the header showed a light tile and the tab a black one.
- `public/favicon.ico` (for clients that can't draw an SVG icon) and `public/apple-touch-icon.png` (the home-screen and share-sheet icon) are bitmaps, always a black tile with a white mark. A bitmap can't follow a theme, and a browser picks them without running the page.

## Options considered

| Option                                                                | For                                                                                             | Against                                                                                                                       |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Always a black tile with a white mark                                 | One form everywhere, which the bitmaps already have.                                            | In the dark theme the header's mark is a black tile on a near-black page, and a black tab icon on a dark tab bar reads badly. |
| Always a light tile with a black mark                                 | One form everywhere.                                                                            | The same problem in the light theme. The bitmaps need redrawing.                                                              |
| Flip with the theme: black tile in light, light tile in dark (chosen) | The tile always stands out from the page and the tab bar. The header and the SVG already do it. | Two forms. The bitmaps can't flip, so they keep one.                                                                          |

## Decision

- The logo flips with the theme. In the light theme it is a black tile (`#111`) with a white mark (`#fff`). In the dark theme it is a light tile (`#f5f5f5`) with a black mark (`#111`). The header's mark draws the same with the page's foreground and background colours.
- Every drawing of the logo the page controls follows the theme the site's switch chose, and the system's when the switch is on "system". That covers the header's mark and the tab's normal icon, which `faviconHref` in `apps/web/src/lib/favicon.ts` now draws for the chosen theme.
- `public/favicon.svg` follows the system's theme, because the browser loads it before the page runs. The page replaces it with the icon for the chosen theme as soon as it runs.
- The bitmaps, `public/favicon.ico` and `public/apple-touch-icon.png`, keep the light theme's form, a black tile with a white mark. They are the exception to the rule above.
- The tab's status icons (a green dot, a green check, a red stop sign) are not the logo and stay the same in both themes.

## Consequences

- With the switch on a theme that differs from the system's, the tab shows the system's form until the page runs, then switches. Pages that never run JavaScript keep the system's form.
- A home-screen icon and the `.ico` show a black tile in the dark theme too.
- A new drawing of the logo, for example in an email or a new image, follows this record: the light form where it can't know the theme.
