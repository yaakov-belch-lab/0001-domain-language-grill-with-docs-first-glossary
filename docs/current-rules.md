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
| **Enrollment Eligibility** (Personal Purchase) | The Student has no active Enrollment in the course. |
| **Enrollment Eligibility** (Seat Code) | Decided by the seats module from the Seat History: the Seat Code is known; the Seat is not refunded; no other Student has used the Seat (Seat Reuse Limit); the Student has no active Enrollment in the course; if the Purchase has a PPP Country Restriction, the Student's current country is that country. |
| **Seat Reuse Limit** | 1. A Seat that has been enrolled on can never serve anyone else. |
| **Refund Eligibility** | Decided by the seats module for one Seat, from its Seat History, on the course page, the seats page and the refund action alike: the person is the Seat's Buyer; the Seat is not refunded; it has no Pending Refund Request; it was never taken by anyone but its Buyer; the Refund Window is open; Seat Usage is under both Usage Limits. A Refund Reason of 10 to 1000 characters is required. A Refund Decline makes the Seat eligible again. |
| **Cancellation** | Offered on the course page only to a Student enrolled on the Seat of their own Personal Purchase, when Refund Eligibility allows it. A Buyer makes a Refund Request for any other Seat from the seats page. Access continues while the request is Pending. |
| **Refund Window** | Starts on the calendar day of the Purchase and ends 14 days later, inclusive, in the server's time zone. |
| **Usage Limits** | Watch limit: 2 hours, where watched time is the sum, over the course's lessons, of the furthest video position reached in each. Completion limit: 50% of the course's lessons completed. Both count Seat Usage: what was watched or completed during any Enrollment on the Seat, summed over every Enrollment in its Seat History. A Seat at a limit is refused; just below it is eligible. |
| **Refund Amount** | The Seat Price of the Seat's Purchase, with or without a PPP Discount. A later change of the Course Price does not change it. |
| **Refund Approval / Decline** | An Admin decides any Pending Refund Request; a Course Owner those for their own courses, on the Refund Requests page. A Refund Approval records the Amount Refunded (the Refund Amount), who approved it and when; the Seat is refunded and any active Enrollment on it ends with the system as Initiator. No money moves. A Refund Decline records who declined it and when, and changes nothing else. A decided Refund Request cannot be decided again. |
| **Unenrollment** | A Student with an active Enrollment may Unenroll from the course page. The seats module ends the Enrollment, recording the time and the Student as Initiator. The Seat becomes open again; the same Student may enroll on it again (Seat Reuse Limit). Completion never ends or limits an Enrollment. Only active Enrollments give access to lessons, quizzes and progress tracking, and only they count as "enrolled" on every page except the instructor analytics, which reports history. |
| **PPP Restriction Check** (content access) | Decided by the seats module: applies the PPP Country Restriction of the Purchase behind the Student's active Enrollment, whether they made the Purchase or enrolled with a Seat Code. A Purchase without one is never blocked, even if the course enables PPP later. An unknown current country fails the check. Admins and Course Owners are exempt. |
| **PPP Restriction Check** (Seat Code) | Applies only to Purchases with a PPP Country Restriction. |

## Bugs: code that contradicts the model

Bugs 1–10 are GitHub issues #1–#10. Bug 11 belongs to the migration to the model in ADR 0001. Spec #11 fixed every bug here except #9.

1. (#1, fixed in #17) Refund Requests are made per Purchase, not per Seat. The "latest Purchase" of the course is the one checked, so a later Purchase of Seats can block or take the Refund Request of an earlier Personal Purchase.
2. (#2, fixed in #17) The Refund Amount uses the current Course Price instead of the Seat Price.
3. (#3, fixed in #17) A Purchase of several Seats can be refunded by posting straight to the refund action. The Refund Amount is one Course Price, and its Seat Codes stay usable.
4. (#4, fixed in #17) The completion limit is checked only when the Cancellation button is shown, not when the Refund Request is made. The two places keep separate copies of the rules.
5. (#5, fixed in #18) Refund Approval and Refund Decline do not exist, so no money is ever given back and no Enrollment ever ends.
6. (#6, fixed in #17) A Refund Request can be made again for a Seat whose request was approved, because only pending requests are checked.
7. (#7, fixed in #16 and #18) Unenrollment does not exist. A Student can now Unenroll, and a Refund Approval ends the Enrollment with the system as Initiator.
8. (#8, fixed: enrollment side in #13, content access in #15) The PPP Country Restriction is inferred from the country of purchase, not from whether a PPP Discount was given. The check on Seat Codes applies it to full-price Purchases, and the check on content access skips Students enrolled through a Seat Code.
9. (#9) Completion is never recorded by the app: `enrollments.completed_at` is set only by the seed.
10. (#10, fixed in #17) The UI names the same thing "Cancel my purchase", "Reversal" (email) and "Chargeback" (settings). The settings page shows the Amount Paid, while the form and email show a different amount.
11. (fixed in #13, #14 and #20) Team language (team, team admin, coupon, redeem, redemption link) contradicts the model in ADR 0001. The teams, team members, coupons and old refunds tables are dropped; screens, code and the seed use glossary words. Only the redirects from the old URLs remain.
