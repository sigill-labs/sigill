// The tab's icon follows the transfer: a green dot while one is open, like the one beside Send in
// the header, and a green check once it is done. The screen that asks for a secure connection
// shows a red stop sign, since nothing can be sent or received there.
//
// Every icon is a data: URL, the normal one too, so a change of status asks the server for
// nothing and the server can't tell from a request that a transfer started, finished or stopped.

export type TransferStatus = "idle" | "active" | "done";
export type TabIcon = TransferStatus | "insecure";

/** One status for the whole tab: an open transfer outranks a finished one. */
export function overallStatus(statuses: readonly TransferStatus[]): TransferStatus {
  return statuses.includes("active") ? "active" : statuses.includes("done") ? "done" : "idle";
}

// The same drawing and colours as public/favicon.svg, which a test checks.
const MARK =
  '<path d="M11.25 24.25V12.75a5 5 0 0 1 10 0v.5" stroke-width="3"/><circle cx="21.25" cy="19.75" r="2.5" stroke="none"/>';
const CHECK = '<path d="M9 16.5l5 5 9-10.5" stroke-width="3.5" stroke-linejoin="round"/>';
const colours = (tile: string, ink: string) =>
  `rect{fill:${tile}}g{stroke:${ink}}circle{fill:${ink}}`;
const tile = (style: string, glyph: string) =>
  `<style>${style}</style><rect width="32" height="32" rx="7"/><g fill="none" stroke-linecap="round">${glyph}</g>`;

const ICON: Record<TabIcon, string> = {
  idle: tile(
    `${colours("#111", "#fff")}@media (prefers-color-scheme:dark){${colours("#f5f5f5", "#111")}}`,
    MARK,
  ),
  // The header's live dot (emerald-500) with its ring held still: a browser draws only the first
  // frame of an SVG icon. No tile, so it reads on a light or a dark tab bar.
  active:
    '<circle cx="16" cy="16" r="15.5" fill="#10b981" fill-opacity=".3"/><circle cx="16" cy="16" r="10.5" fill="#10b981"/>',
  done: tile(colours("#059669", "#fff"), CHECK),
  // A stop sign: a red octagon (red-600) with a white rim and a white bar, which still reads at
  // 16 pixels where the word STOP would not.
  insecure:
    '<path d="M9.4.5h13.2l8.9 8.9v13.2l-8.9 8.9H9.4L.5 22.6V9.4z" fill="#dc2626"/>' +
    '<path d="M10.3 2.75h11.4l7.55 7.55v11.4l-7.55 7.55H10.3l-7.55-7.55V10.3z" fill="none" stroke="#fff" stroke-width="1.5"/>' +
    '<rect x="8" y="13.5" width="16" height="5" rx="1" fill="#fff"/>',
};

export function faviconHref(status: TabIcon): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${ICON[status]}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
