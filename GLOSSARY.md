# Cadence

An online course platform. This glossary covers how a course is paid for, how people gain access to it by enrolling, and how that can be undone: unenrollment and refunds.

## People

**Student**:
A person who takes a course through an Enrollment.
_Avoid_: Learner, user (when the course-taking role is meant)

**Buyer**:
The person who pays for a Purchase and owns its Seats. A Buyer may enroll on one of their own Seats.
_Avoid_: Purchaser, reseller, team admin, team owner, customer

**Instructor**:
A person whose account may create and teach courses.
_Avoid_: Lecturer, teacher, author

**Course Owner**:
The one Instructor a particular course belongs to.
_Avoid_: Owning instructor (in prose), instructor (when this specific course is meant)

**Admin**:
A site administrator, who may act in place of any Course Owner.
_Avoid_: Staff (for admins alone), team admin

## Purchases and Seats

**Course Price**:
The list price of a course at a given moment. It can change at any time and never changes what an earlier Purchase cost.
_Avoid_: Price (unqualified), purchase price

**Purchase**:
A Buyer paying for one or more Seats in one course, at one moment.
_Avoid_: Order, team, team purchase, bulk purchase, volume purchase, licence

**Seat Price**:
The price paid for one Seat of a Purchase.
_Avoid_: Per-seat price, PPP price

**Amount Paid**:
What the Buyer paid for a Purchase: its number of Seats times its Seat Price.
_Avoid_: Purchase price, total price

**Seat**:
The right for one Student to enroll in the course of a Purchase. Every Purchase has one or more Seats.
_Avoid_: Coupon, licence, team seat

**Seat Code**:
The secret that identifies a Seat and lets whoever holds it enroll on it.
_Avoid_: Coupon code, redemption code

**Personal Purchase**:
A shortcut: a Purchase of one Seat followed at once by the Buyer's own Enrollment on it. The usual way a Student buys a course.
_Avoid_: Individual purchase, single purchase

**Open Seat**:
A Seat with no active Enrollment that has not been refunded. Derived from its Seat History.

**Taken Seat**:
A Seat with an active Enrollment. Derived from its Seat History.

**Refunded Seat**:
A Seat whose Refund Request was approved. It can never carry an Enrollment again.

**Seat History**:
Everything that has happened to a Seat, in order: its purchase, every Enrollment and Unenrollment on it, and every Refund Request for it. Every decision about a Seat is made from its Seat History.
_Avoid_: Seat status (as a stored fact)

## Enrollment

**Enrollment**:
A Student taking a course on a Seat. It gives the Student access to the course's content. It is active until an Unenrollment ends it.
_Avoid_: Access (as a stored fact), registration, claim, redemption

**Enroll**:
To start an Enrollment on a Seat.
_Avoid_: Claim, redeem

**Unenrollment**:
The end of an Enrollment. Recorded with its Initiator.
_Avoid_: Withdrawal, drop, cancellation, revocation

**Completion**:
The Student's achievement of finishing every lesson of the course. It never ends or limits an Enrollment.
_Avoid_: Ended, finished (for an Enrollment)

**Initiator**:
Who caused an Unenrollment: the Student, the Buyer, an Admin or Course Owner, or the system acting on an approved Refund.

**Seat Usage**:
How much of the course has been used on a Seat: its watched time and its completion, summed over every Enrollment in its Seat History.
_Avoid_: Consumption, progress (for this purpose)

## Refunds

**Refund Request**:
A request to give money back to the Buyer for one Seat. It is pending until it is approved or declined.
_Avoid_: Reversal, chargeback, refund claim

**Cancellation**:
A shortcut: the Refund Request a Student makes for the Seat of their own Personal Purchase. Its approval also ends their Enrollment, as every Refund Approval does.
_Avoid_: Cancel my purchase (as a term), withdrawal

**Refund Reason**:
The note that explains why a Refund Request was made.

**Pending**:
A Refund Request that is waiting for a decision.
_Avoid_: Open, requested

**Refund Approval**:
The decision to grant a Refund Request. The Seat is refunded and any Enrollment on it ends.
_Avoid_: Acceptance, grant

**Refund Decline**:
The decision to refuse a Refund Request. Nothing else changes.
_Avoid_: Rejection, denial

**Amount Refunded**:
The money actually given back to the Buyer by a Refund Approval. Never more than the Seat Price.
_Avoid_: Refundable amount, refund amount (as a stored fact)

**Refund Window**:
The period in which a Refund Request may be made, defined by a starting point and a length.
_Avoid_: Cancel window, cooling-off period, money-back guarantee

**Usage Limits**:
The amounts of Seat Usage beyond which a Seat can no longer be refunded: a watch limit and a completion limit.

## Decisions

A decision is named after what it decides, and is made from a Seat History.

**Enrollment Eligibility**:
Whether a given person may Enroll on a given Seat now.

**Refund Eligibility**:
Whether a Refund Request may be made for a given Seat now.

**Refund Amount**:
How much a Refund Request offers to give back for its Seat. Shown to whoever makes the request.

**Seat Reuse Limit**:
How many different Students a single Seat may serve over its Seat History. An input to Enrollment Eligibility.

## PPP (Purchasing Power Parity)

**PPP Discount**:
A reduction of the Course Price based on the Buyer's country at the moment of purchase.

**PPP Country Restriction**:
A property a Purchase receives when it was made with a PPP Discount: its Seats may only be used from the country of purchase.
_Avoid_: PPP block (as a property)

**PPP Restriction Check**:
The check that applies a PPP Country Restriction wherever a Seat is enrolled on or its course content is accessed.
