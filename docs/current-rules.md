# Purchases, Enrollments and Refunds: current rules

Terms are defined in [GLOSSARY.md](../GLOSSARY.md). The model is in [ADR 0001](adr/0001-purchases-are-seats.md).

## Principles

1. **Name, don't decide.** Every rule is a named decision with explicit inputs. Changing a rule's values is a product decision taken elsewhere.
2. **Unify, don't special-case.** One Seat bought and enrolled on at once is a Personal Purchase; a free course is a Seat Price of zero. Shortcuts get names, but they combine existing concepts.
3. **Each party acts only on what it owns.** A Student owns their Enrollment, a Buyer owns their Seats, an Admin or Course Owner owns the decisions.
4. **Decisions are made from history.** A decision is named after what it decides and takes the Seat History as input.
5. **The language leads the code.** Code that contradicts the glossary or this model is a bug, and is listed below to be fixed.

## Current rules

| Decision | Current behaviour |
|---|---|
| **Enrollment Eligibility** (Personal Purchase) | The Student is not already enrolled in the course. |
| **Enrollment Eligibility** (Seat Code) | The Seat has never been used; the Student is not already enrolled in the course; the Student's current country equals the country of purchase. |
| **Seat Reuse Limit** | 1. A Seat that has been enrolled on can never serve anyone else. |
| **Refund Eligibility** | No Refund Request is pending; no Seat of the Purchase is taken by someone other than the Buyer; the Refund Window is open; watched time is under the watch limit; completion is under the completion limit. A Refund Reason of 10 to 1000 characters is required. |
| **Refund Window** | Starts on the calendar day of the Purchase and ends 14 days later, inclusive, in the server's time zone. |
| **Usage Limits** | Watch limit: 2 hours, where watched time is the sum, over the course's lessons, of the furthest video position reached in each. Completion limit: 50% of the course's lessons completed. |
| **Refund Amount** | The Amount Paid if the country of purchase has a PPP Discount; otherwise the current Course Price. |
| **Refund Approval / Decline** | Not implemented. |
| **PPP Restriction Check** (content access) | Applies when the course currently has PPP enabled and the country of purchase is in a discounted tier. |
| **PPP Restriction Check** (Seat Code) | Applies to every Purchase that has a country of purchase. |

## Bugs: code that contradicts the model

Bugs 1–10 are GitHub issues #1–#10. Bug 11 belongs to the migration to the model in ADR 0001.

1. (#1) Refund Requests are made per Purchase, not per Seat. The "latest Purchase" of the course is the one checked, so a later Purchase of Seats can block or take the Refund Request of an earlier Personal Purchase.
2. (#2) The Refund Amount uses the current Course Price instead of the Seat Price.
3. (#3) A Purchase of several Seats can be refunded by posting straight to the refund action. The Refund Amount is one Course Price, and its Seat Codes stay usable.
4. (#4) The completion limit is checked only when the Cancellation button is shown, not when the Refund Request is made. The two places keep separate copies of the rules.
5. (#5) Refund Approval and Refund Decline do not exist, so no money is ever given back and no Enrollment ever ends.
6. (#6) A Refund Request can be made again for a Seat whose request was approved, because only pending requests are checked.
7. (#7) Unenrollment does not exist.
8. (#8) The PPP Country Restriction is inferred from the country of purchase, not from whether a PPP Discount was given. The check on Seat Codes applies it to full-price Purchases, and the check on content access skips Students enrolled through a Seat Code.
9. (#9) Completion is never recorded by the app: `enrollments.completed_at` is set only by the seed.
10. (#10) The UI names the same thing "Cancel my purchase", "Reversal" (email) and "Chargeback" (settings). The settings page shows the Amount Paid, while the form and email show a different amount.
11. Team language (team, team admin, coupon, redeem, redemption link) contradicts the model in ADR 0001.
