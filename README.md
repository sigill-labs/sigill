# Fidant

Secure file transfer. Files are encrypted in the sender's browser, and no infrastructure (our servers, hosts, relays, email) can read file content. Verified transfers add BankID identity, a signed receipt, and a tamper-evident audit log.

This repository is at the first demo: send one file from a browser to named recipients on the same network. BankID, receipts and the audit log come later.

## Run the first demo

Prerequisites:

- Node 26 (see `.node-version`).
- pnpm, at the version pinned in `package.json` (`packageManager`).
- gitleaks (`brew install gitleaks`), only if you commit. The pre-commit hook fails without it.
- openssl, for the local certificate. macOS and Linux ship with it.

Start the server:

```sh
pnpm install
pnpm start
```

`pnpm start` builds the web client and serves it over HTTPS on port 8443 (set `PORT` to change it), on all network interfaces. The first start creates a self-signed certificate in `.certs/`. The addresses to open are printed on stderr.

Send a file:

1. On the sending device, open the LAN address the server printed (like `https://192.168.1.20:8443`), not `localhost`. Links made on `localhost` won't work on other devices, and the page warns about it.
2. Accept the certificate warning. Do this once on each device.
3. Optionally type your name, then choose a file. The page computes its SHA-256 first. The name only travels inside the encrypted file description, and the recipient sees it marked as not verified.
4. Add each recipient by name. Each one gets their own link. Names stay in the sender's browser.
5. Copy each link and send it to that person yourself, for example in a chat.
6. The recipient opens the link, sees the file name and size, and clicks Download. Browsers with a save picker (desktop Chrome and Edge) ask where to save the file; others start the download by themselves when the transfer is done, with a "Save file" button as a fallback.
7. The sender's card for that recipient changes to "Delivered through <name>'s link" when the recipient's checksum matches.

Keep the sender's tab open until every recipient has the file. The file goes directly from the sender's browser to each recipient's browser, so it is only available while that tab is open.

A link works once: after a confirmed delivery, opening it again shows "This link has already been used" while the sender's page still offers it. There is no resume. If a transfer drops before delivery, the recipient starts over from the beginning with the same link.

## Network tips

- With a local `pnpm start`, sender and recipients must be on the same network: it hands out no STUN or TURN servers unless `TURN_URLS` and `TURN_SECRET_FILE` are set, `STUN_URLS` names STUN servers, or `RELAYS_FILE` and `RELAY_MASTER_FILE` name a relay list and a master file (see `AGENTS.md`), so browsers connect only over local addresses.
- Email is off until verified transfers (`docs/decisions/0030-email-off-until-verified-transfers.md`). A local `pnpm start` sends no mail, so the send page offers no email field. To try emailed links, run `mailpit` in another terminal and start with `MAIL_ENABLED=1 MAIL_SMTP_URL=smtp://127.0.0.1:1025 MAIL_FROM="Fidant <noreply@example.se>" PUBLIC_ORIGIN=https://localhost:8443 pnpm start` (`PUBLIC_ORIGIN` is the address recipients open). Mailpit shows the mail at http://localhost:8025.
- The hosted site at https://fidant.se has a STUN and TURN relay, so browsers there can be on different networks.
- A phone hotspot is a reliable network for a demo.
- Guest Wi-Fi with client isolation does not work: devices on it can't reach each other.
- On macOS, a browser on another Mac needs Local Network access (System Settings → Privacy & Security → Local Network), or the page "can't be reached" even though `curl` works. Restart the browser after allowing it.

## What the server sees

- Random link IDs, and encrypted signaling messages it passes between browsers to set up the connection. It cannot read them, except for a link it emails, so it cannot see or change the connection details (SDP, ICE candidates, DTLS fingerprints).
- The IP addresses of the browsers that connect to it, as any web server does.

It never sees keys, file content, file names, sizes or types, except that for a link it emails it sees that link's key (see `docs/how-fidant-works.md`):

- Each link's secret is in the URL fragment (the part after `#`). Browsers don't send the fragment to the server.
- The file, its name, size and type travel only over the encrypted connection between the two browsers.
- On that connection, file sizes are padded, so the network sees only a rounded size.

Server stdout is one JSON object per line, with allowlisted fields only: the event name, the first six characters of a link ID, a count of links, a message length in bytes, a reason or error code, and the port. Messages for humans go to stderr.

## Known limits of the demo

- A link is a bearer token. Anyone who opens an unused link first gets the file, so a forwarded link can be taken by someone else.
- The automated end-to-end test runs in headless Chromium only. Results of manual runs in other browsers and on other devices are tracked in [docs/demo-results.md](docs/demo-results.md).
- Browsers without a save picker (Safari, Firefox) hold the whole received file in memory until it is saved, so very large files may fail there.
- One file per session. To send a different file, remove all recipients first.

## Development

- `pnpm check`: lint, typecheck, unit tests and build. Run it before every commit.
- `pnpm format`: fixes formatting and safe lint issues.
- `pnpm build`: builds the web client into `apps/web/dist`.
- `pnpm e2e`: builds the web client and runs the end-to-end tests, including the first demo, in headless Chromium against the real server, with leak checks. Once per machine, install the browser with `pnpm --filter @fidant/e2e exec playwright install chromium`. `pnpm check` does not run it.

See [AGENTS.md](AGENTS.md) for the layout and conventions.
