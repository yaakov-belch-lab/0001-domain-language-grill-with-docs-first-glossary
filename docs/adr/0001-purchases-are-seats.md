---
status: accepted
---

# A Purchase is a set of Seats; teams do not exist

Every Purchase buys one or more Seats, and every Enrollment is made on a Seat. A Personal Purchase is just the shortcut "buy one Seat, then enroll on it at once", so individual buyers and bulk buyers go through the same concepts and the same code, and a free or promotional course is a Purchase at a Seat Price of zero rather than a special case. Refunds are per Seat and the money goes to the Buyer. Every decision about a Seat (Enrollment Eligibility, Refund Eligibility, Refund Amount) is made from its Seat History, not from a stored status.

We chose this over keeping "teams" as a separate system beside individual purchases. That would duplicate every rule for two kinds of buyer, and those rules have already drifted apart.

## Consequences

The migration to this model is complete (spec #11):

- Every Purchase has its rows in `seats`, each with a Seat Code. Personal Purchases have one Seat.
- `enrollments` record their Seat, when they ended and the Initiator of the Unenrollment.
- Refund Requests (`refund_requests`) point at a Seat, and are approved or declined.
- One seats module makes every decision about a Seat from its Seat History.
- The old `teams`, `team_members`, `coupons` and `refunds` tables were filled into the Seat model by migration 0011 and dropped by migration 0012. Their old URLs (`/team`, `/redeem/:code`) redirect to the seats page and the Seat Code page.

See `docs/current-rules.md` for the rules as they work today.
