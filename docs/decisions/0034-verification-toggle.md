# 0034: A verification toggle instead of two buttons

- Status: Accepted
- Date: 2026-11-28
- Linear: FID-120

This record amends 0024 (`0024-safety-number-buttons.md`). Read it with the replacement under Decision.

## Context

- 0024 put the safety number on the button that adds the recipient: one button for a plain link and one for a link with a safety number.
- The product owner asked for a toggle instead, so that a third kind of verification, BankID, can join the list later. Two buttons don't scale to three: the form would need a third button, and each kind that has an email variant would need another.
- Email is off (0030), so the email variants of the buttons are not on any deployment. The record still says what they read, for when it comes back.

## Options considered

| Option                                                       | For                                                                   | Against                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1. A "Verification" toggle above the name and one Add button | A new kind is one more option. The button says what the toggle holds. | The choice stays between adds, so a sender can forget what it holds. The button label shows it. |
| 2. Keep two buttons and add a third for BankID               | The choice is made by the button that adds the recipient.             | Each new kind adds a button, and email doubles them.                                            |
| 3. A select list                                             | Scales to any number of kinds.                                        | Hides the options behind a click, for a choice with two or three values.                        |

## Decision

Option 1.

- **Who turns it on** (replaces 0024's paragraph of that name). A "Verification" toggle above "Who is it for?" chooses the kind: "Link" or "Safety number". One Add button follows it, and its label follows the toggle: "Add recipient", "Add recipient with safety number", and, once the sender ticks "Email the link for me (less private)", "Add recipient and email link" or "Add recipient and email link with safety number". Enter adds the kind the toggle holds. The toggle starts on "Link". Ticking "Email the link for me (less private)" switches it to "Safety number", and the sender can switch it back to "Link". While "Safety number" is chosen, a line under the form says what it shows.
- **The choice stays.** The toggle keeps its value between adds, for emailed links too. A sender who picks "Link" for an emailed recipient keeps it for the next one. 0024's "the same defaults as 0017" now means that email preselects the safety number, not that it forces it.
- **The kinds are a list in the code**, so BankID can be added as a third option by a later record.
- Nothing else in 0024 changes: the name "safety number" and Swedish "kontrollnummer", and the relay checkbox label.

## Consequences

- 0024 stays Accepted. Read its "Who turns it on" with the paragraph above. Its two buttons are one button and a toggle, and its consequence that the e2e tests check that the safety number is the first button once email is chosen now reads: they check that the button's label has the safety number once email is ticked.
- 0032 (Proposed) is left as it is here. Its quotes of 0024's button order (under Context and under FID-336's list) are read with this record. FID-336 makes "Safety number" the preselected option on a page opened with `#chat`, instead of reordering buttons.
- The e2e tests pick the option and then press the button.
- `docs/how-fidant-works.md` describes the toggle.
