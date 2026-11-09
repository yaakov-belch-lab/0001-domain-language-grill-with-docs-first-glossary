---
status: accepted
---

# A Purchase is a set of Seats; teams do not exist

Every Purchase buys one or more Seats, and every Enrollment is made on a Seat. A Personal Purchase is just the shortcut "buy one Seat, then enroll on it at once", so individual buyers and bulk buyers go through the same concepts and the same code, and a free or promotional course is a Purchase at a Seat Price of zero rather than a special case. Refunds are per Seat and the money goes to the Buyer. Every decision about a Seat (Enrollment Eligibility, Refund Eligibility, Refund Amount) is made from its Seat History, not from a stored status.

We chose this over keeping "teams" as a separate system beside individual purchases. That would duplicate every rule for two kinds of buyer, and those rules have already drifted apart.

## Consequences

The code does not follow this yet. Until it is migrated:

- `teams` and `team_members` (with role `admin`) exist only to group one Buyer's Purchases. They have no counterpart in the model.
- The `coupons` table holds the Seats of Purchases with more than one Seat, and "redeem" means Enroll. Personal Purchases have no Seat row at all.
- Refund Requests point at a Purchase, not at a Seat.
- `enrollments` cannot be ended, so there is no Unenrollment and no Seat History of it.

See `docs/current-rules.md` for the rules as they work today, and for the bugs where the code contradicts this model.
