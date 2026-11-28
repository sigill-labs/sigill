# First demo results (FID-21)

Manual test results for the first demo. Fill this in by hand after running it on real devices; see the README for how to run it. Replace "not tested yet" with what you saw.

The automated end-to-end tests (`pnpm e2e`, `apps/e2e/tests/delivery.spec.ts` and the transfer specs beside it) cover headless Chromium only.

## Browsers

Result is one of: works, works with notes, fails.

| Browser | Role      | Version        | OS             | Result         | Notes |
| ------- | --------- | -------------- | -------------- | -------------- | ----- |
| Chrome  | Sender    | not tested yet | not tested yet | not tested yet |       |
| Chrome  | Recipient | not tested yet | not tested yet | not tested yet |       |
| Safari  | Sender    | not tested yet | not tested yet | not tested yet |       |
| Safari  | Recipient | not tested yet | not tested yet | not tested yet |       |
| Firefox | Sender    | not tested yet | not tested yet | not tested yet |       |
| Firefox | Recipient | not tested yet | not tested yet | not tested yet |       |

For Safari and Firefox recipients, the file is held in memory until it is saved. Note the largest file that worked and how the browser behaved (memory use, slowdowns, crashes).

## 1 GB run

One sender, two recipients on two other devices, same network.

- Date: not tested yet
- Server machine: not tested yet
- Sender device and browser: not tested yet
- Recipient 1 device and browser: not tested yet
- Recipient 2 device and browser: not tested yet
- Network (for example home Wi-Fi, office Wi-Fi, phone hotspot): not tested yet
- File size in bytes: not tested yet
- Time from Download to "Delivered through <name>'s link", recipient 1: not tested yet
- Time from Download to "Delivered through <name>'s link", recipient 2: not tested yet
- "Delivered" on both cards (yes/no): not tested yet
- SHA-256 of the saved files matches the source (`shasum -a 256`), yes/no: not tested yet
- Notes:

## Server log excerpt

Paste the server's stdout from the 1 GB run (JSON lines). Check that it contains no recipient name, file name, file size, link secret (the part after `#`) or file data.

```text
not tested yet
```

## Checklist

From the FID-21 "Done when" list:

- [ ] A 1 GB file reaches two recipients on two other devices on the same network, and each recipient's browser confirms the checksum back to the sender.
- [ ] A used link is refused ("This link has already been used").
- [ ] A link that is not on the sender's list is refused ("Link not found").
- [ ] The server log shows it never received a key, a name, file metadata or file data.
- [ ] It works in Chrome.
- [ ] Safari and Firefox results are written down above.
