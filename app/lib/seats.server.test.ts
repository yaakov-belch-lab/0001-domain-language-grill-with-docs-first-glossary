import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "~/test/setup";
import { seatScenario } from "~/test/seat-scenarios";
import { UnenrollmentInitiator } from "~/db/schema";
import { createSeatsModule } from "./seats.server";

const fixedClock = () => new Date("2026-11-09T12:00:00.000Z");

let db: TestDb;
let scenario: ReturnType<typeof seatScenario>;
let seats: ReturnType<typeof createSeatsModule>;

beforeEach(() => {
  db = createTestDb();
  scenario = seatScenario(db);
  seats = createSeatsModule({ db, clock: fixedClock });
});

describe("a Buyer's Purchases", () => {
  it("shows a Personal Purchase as one Seat held by the Buyer", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Introduction to TypeScript");
    const { seats: bought } = scenario.purchase(liam, course, {
      seatPrice: 7900,
      at: "2026-11-01T10:00:00.000Z",
    });
    scenario.enroll(liam, bought[0], "2026-11-01T10:00:00.000Z");

    const purchases = seats.buyerPurchases(liam.id);

    expect(purchases).toHaveLength(1);
    expect(purchases[0].seats).toEqual([
      expect.objectContaining({
        state: "taken",
        holder: { id: liam.id, name: "Liam" },
      }),
    ]);
  });

  it("shows a Purchase of several Seats with open and taken Seats", () => {
    const bossy = scenario.person("Bossy");
    const olivia = scenario.person("Olivia");
    const course = scenario.course("Building REST APIs");
    const { seats: bought } = scenario.purchase(bossy, course, {
      seatCount: 3,
      seatPrice: 5999,
      at: "2026-10-01T09:00:00.000Z",
    });
    scenario.enroll(olivia, bought[1], "2026-10-02T09:00:00.000Z");

    const [purchase] = seats.buyerPurchases(bossy.id);

    // Amount Paid is the number of Seats times the Seat Price.
    expect(purchase).toMatchObject({
      courseTitle: "Building REST APIs",
      seatCount: 3,
      seatPrice: 5999,
      amountPaid: 3 * 5999,
    });
    // The Buyer hands out the Seat Code of each open Seat, so it must be shown.
    expect(purchase.seats).toEqual([
      { id: bought[0].id, code: bought[0].code, state: "open", holder: null },
      {
        id: bought[1].id,
        code: bought[1].code,
        state: "taken",
        holder: { id: olivia.id, name: "Olivia" },
      },
      { id: bought[2].id, code: bought[2].code, state: "open", holder: null },
    ]);
  });

  it("shows only the Buyer's own Purchases, oldest first", () => {
    const emma = scenario.person("Emma");
    const james = scenario.person("James");
    const ts = scenario.course("TypeScript");
    const node = scenario.course("Node");
    scenario.purchase(emma, node, {
      seatPrice: 5999,
      at: "2026-10-05T00:00:00.000Z",
    });
    scenario.purchase(james, ts, {
      seatPrice: 7900,
      at: "2026-10-03T00:00:00.000Z",
    });
    scenario.purchase(emma, ts, {
      seatPrice: 7900,
      at: "2026-10-01T00:00:00.000Z",
    });

    expect(seats.buyerPurchases(emma.id).map((p) => p.courseTitle)).toEqual([
      "TypeScript",
      "Node",
    ]);
  });

  it("shows a Seat the Student has unenrolled from as open again", () => {
    const buyer = scenario.person("Buyer");
    const student = scenario.person("Student");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(buyer, course, {
      seatPrice: 7900,
      at: "2026-10-01T00:00:00.000Z",
    });
    const enrollment = scenario.enroll(
      student,
      bought[0],
      "2026-10-02T00:00:00.000Z"
    );
    scenario.unenroll(
      enrollment,
      UnenrollmentInitiator.Student,
      "2026-10-03T00:00:00.000Z"
    );

    expect(seats.buyerPurchases(buyer.id)[0].seats[0]).toMatchObject({
      state: "open",
      holder: null,
    });
  });

  it("shows a Seat whose Refund Request was approved as refunded, with no holder", () => {
    const liam = scenario.person("Liam");
    const admin = scenario.person("Admin");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(liam, course, {
      seatPrice: 7900,
      at: "2026-11-01T00:00:00.000Z",
    });
    scenario.enroll(liam, bought[0], "2026-11-01T00:00:00.000Z");
    const request = scenario.requestRefund(
      bought[0],
      "Not for me, sorry.",
      "2026-11-02T00:00:00.000Z"
    );
    scenario.approveRefund(request, admin, 7900, "2026-11-03T00:00:00.000Z");

    expect(seats.buyerPurchases(liam.id)[0].seats[0]).toMatchObject({
      state: "refunded",
      holder: null,
    });
  });

  it("keeps a Seat taken when its Refund Request is declined or still Pending", () => {
    const liam = scenario.person("Liam");
    const ana = scenario.person("Ana");
    const admin = scenario.person("Admin");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(liam, course, {
      seatCount: 2,
      seatPrice: 7900,
      at: "2026-11-01T00:00:00.000Z",
    });
    scenario.enroll(liam, bought[0], "2026-11-01T00:00:00.000Z");
    scenario.enroll(ana, bought[1], "2026-11-02T00:00:00.000Z");
    const declined = scenario.requestRefund(
      bought[0],
      "Changed my mind.",
      "2026-11-02T00:00:00.000Z"
    );
    scenario.declineRefund(declined, admin, "2026-11-03T00:00:00.000Z");
    scenario.requestRefund(
      bought[1],
      "Changed my mind.",
      "2026-11-02T00:00:00.000Z"
    );

    // A Refund Decline changes nothing else, and a Buyer keeps access while
    // a Refund Request is Pending.
    expect(seats.buyerPurchases(liam.id)[0].seats.map((s) => s.state)).toEqual([
      "taken",
      "taken",
    ]);
  });

  it("carries each course's slug, so the page can link back to the course", () => {
    const emma = scenario.person("Emma");
    const course = scenario.course("Node");
    scenario.purchase(emma, course, {
      seatPrice: 5999,
      at: "2026-10-01T00:00:00.000Z",
    });

    expect(seats.buyerPurchases(emma.id)[0].courseSlug).toBe(course.slug);
  });
});

describe("whether a person is a Buyer", () => {
  // The seats page is shown to everyone with at least one Purchase.
  it("is true for a person with a Personal Purchase", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("TypeScript");
    const { seats: bought } = scenario.purchase(liam, course, {
      seatPrice: 7900,
      at: "2026-11-01T10:00:00.000Z",
    });
    scenario.enroll(liam, bought[0], "2026-11-01T10:00:00.000Z");

    expect(seats.isBuyer(liam.id)).toBe(true);
  });

  it("is false for a Student enrolled only on someone else's Seat", () => {
    const bossy = scenario.person("Bossy");
    const olivia = scenario.person("Olivia");
    const course = scenario.course("Node");
    const { seats: bought } = scenario.purchase(bossy, course, {
      seatCount: 2,
      seatPrice: 5999,
      at: "2026-10-01T00:00:00.000Z",
    });
    scenario.enroll(olivia, bought[0], "2026-10-02T00:00:00.000Z");

    expect(seats.isBuyer(bossy.id)).toBe(true);
    expect(seats.isBuyer(olivia.id)).toBe(false);
  });
});

describe("a Seat's Seat History", () => {
  it("lists the purchase, every Enrollment and Unenrollment, and every Refund Request, in order", () => {
    const buyer = scenario.person("Buyer");
    const ana = scenario.person("Ana");
    const admin = scenario.person("Admin");
    const course = scenario.course("Course");
    const { purchase, seats: bought } = scenario.purchase(buyer, course, {
      seatCount: 2,
      seatPrice: 3950,
      pppCountryRestriction: "IN",
      at: "2026-11-01T00:00:00.000Z",
    });
    const first = scenario.enroll(ana, bought[0], "2026-11-02T00:00:00.000Z");
    scenario.unenroll(
      first,
      UnenrollmentInitiator.Student,
      "2026-11-03T00:00:00.000Z"
    );
    const second = scenario.enroll(ana, bought[0], "2026-11-04T00:00:00.000Z");
    const request = scenario.requestRefund(
      bought[0],
      "Ana left the company.",
      "2026-11-05T00:00:00.000Z"
    );
    scenario.approveRefund(request, admin, 3950, "2026-11-06T00:00:00.000Z");

    expect(seats.seatHistory(bought[0].id)).toEqual({
      seatId: bought[0].id,
      seatCode: bought[0].code,
      purchaseId: purchase.id,
      courseId: course.id,
      buyerId: buyer.id,
      seatPrice: 3950,
      pppCountryRestriction: "IN",
      events: [
        {
          type: "purchased",
          at: "2026-11-01T00:00:00.000Z",
          buyerId: buyer.id,
        },
        {
          type: "enrolled",
          at: "2026-11-02T00:00:00.000Z",
          enrollmentId: first.id,
          studentId: ana.id,
        },
        {
          type: "unenrolled",
          at: "2026-11-03T00:00:00.000Z",
          enrollmentId: first.id,
          studentId: ana.id,
          initiator: UnenrollmentInitiator.Student,
        },
        {
          type: "enrolled",
          at: "2026-11-04T00:00:00.000Z",
          enrollmentId: second.id,
          studentId: ana.id,
        },
        {
          type: "refund-requested",
          at: "2026-11-05T00:00:00.000Z",
          refundRequestId: request.id,
          reason: "Ana left the company.",
        },
        // A Refund Approval ends the active Enrollment, with the system as
        // Initiator.
        {
          type: "unenrolled",
          at: "2026-11-06T00:00:00.000Z",
          enrollmentId: second.id,
          studentId: ana.id,
          initiator: UnenrollmentInitiator.System,
        },
        {
          type: "refund-approved",
          at: "2026-11-06T00:00:00.000Z",
          refundRequestId: request.id,
          amountRefunded: 3950,
          resolvedByUserId: admin.id,
        },
      ],
    });
  });

  it("keeps a Seat's history apart from the other Seats of its Purchase", () => {
    const buyer = scenario.person("Buyer");
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(buyer, course, {
      seatCount: 2,
      seatPrice: 5000,
      at: "2026-11-01T00:00:00.000Z",
    });
    scenario.enroll(ana, bought[0], "2026-11-02T00:00:00.000Z");

    expect(seats.seatHistory(bought[1].id)?.events).toEqual([
      { type: "purchased", at: "2026-11-01T00:00:00.000Z", buyerId: buyer.id },
    ]);
  });

  it("has no history for an unknown Seat", () => {
    expect(seats.seatHistory(999)).toBeUndefined();
  });
});

describe("a person's active Enrollment in a course", () => {
  it("is the Enrollment that has not ended, with its Seat", () => {
    const buyer = scenario.person("Buyer");
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(buyer, course, {
      seatCount: 2,
      seatPrice: 5000,
      at: "2026-11-01T00:00:00.000Z",
    });
    const first = scenario.enroll(ana, bought[0], "2026-11-02T00:00:00.000Z");
    scenario.unenroll(
      first,
      UnenrollmentInitiator.Student,
      "2026-11-03T00:00:00.000Z"
    );
    const second = scenario.enroll(ana, bought[1], "2026-11-04T00:00:00.000Z");

    // A Student may have several Enrollments in one course over time, but at
    // most one active one.
    expect(seats.activeEnrollment(ana.id, course.id)).toEqual({
      enrollmentId: second.id,
      seatId: bought[1].id,
      enrolledAt: "2026-11-04T00:00:00.000Z",
    });
  });

  it("is none once the Student has unenrolled", () => {
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(ana, course, {
      seatPrice: 5000,
      at: "2026-11-01T00:00:00.000Z",
    });
    const enrollment = scenario.enroll(
      ana,
      bought[0],
      "2026-11-01T00:00:00.000Z"
    );
    scenario.unenroll(
      enrollment,
      UnenrollmentInitiator.Student,
      "2026-11-03T00:00:00.000Z"
    );

    expect(seats.activeEnrollment(ana.id, course.id)).toBeUndefined();
  });

  it("is none in a course the person never enrolled in", () => {
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const other = scenario.course("Other");
    const { seats: bought } = scenario.purchase(ana, course, {
      seatPrice: 5000,
      at: "2026-11-01T00:00:00.000Z",
    });
    scenario.enroll(ana, bought[0], "2026-11-01T00:00:00.000Z");

    expect(seats.activeEnrollment(ana.id, other.id)).toBeUndefined();
  });
});

describe("a Personal Purchase", () => {
  it("buys one Seat at the Course Price and enrolls the Buyer on it", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Introduction to TypeScript", 7900);

    const result = seats.personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: "US",
    });

    expect(result.ok).toBe(true);
    const [purchase] = seats.buyerPurchases(liam.id);
    // Amount Paid is one Seat times the Seat Price. A full-price Purchase
    // carries no PPP Country Restriction.
    expect(purchase).toMatchObject({
      seatCount: 1,
      seatPrice: 7900,
      amountPaid: 7900,
      pppCountryRestriction: null,
    });
    expect(purchase.seats).toEqual([
      expect.objectContaining({
        state: "taken",
        holder: { id: liam.id, name: "Liam" },
      }),
    ]);
    expect(seats.activeEnrollment(liam.id, course.id)).toEqual(
      expect.objectContaining({ seatId: purchase.seats[0].id })
    );
  });

  it("records the PPP Country Restriction when a PPP Discount was given", () => {
    const priya = scenario.person("Priya");
    const course = scenario.course("Course", 8000, { pppEnabled: true });

    seats.personalPurchase({
      buyerId: priya.id,
      courseId: course.id,
      country: "IN",
    });

    expect(seats.buyerPurchases(priya.id)[0]).toMatchObject({
      seatPrice: 4000,
      amountPaid: 4000,
      pppCountryRestriction: "IN",
    });
  });

  it("gives no PPP Country Restriction when the course has no PPP, whatever the country", () => {
    const priya = scenario.person("Priya");
    const course = scenario.course("Course", 8000);

    seats.personalPurchase({
      buyerId: priya.id,
      courseId: course.id,
      country: "IN",
    });

    expect(seats.buyerPurchases(priya.id)[0]).toMatchObject({
      seatPrice: 8000,
      pppCountryRestriction: null,
    });
  });

  it("is refused to a Student already actively enrolled in the course", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course");
    seats.personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: null,
    });

    const again = seats.personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: null,
    });

    expect(again).toEqual({ ok: false, refusal: "already-enrolled" });
    expect(seats.buyerPurchases(liam.id)).toHaveLength(1);
  });

  it("buys the course again after the Student has unenrolled", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(liam, course, {
      seatPrice: 7900,
      at: "2026-10-01T00:00:00.000Z",
    });
    const enrollment = scenario.enroll(
      liam,
      bought[0],
      "2026-10-01T00:00:00.000Z"
    );
    scenario.unenroll(
      enrollment,
      UnenrollmentInitiator.Student,
      "2026-10-02T00:00:00.000Z"
    );

    expect(
      seats.personalPurchase({
        buyerId: liam.id,
        courseId: course.id,
        country: null,
      }).ok
    ).toBe(true);
  });
});

describe("buying Seats", () => {
  it("makes a Purchase of N open Seats, each with its own Seat Code, without enrolling the Buyer", () => {
    const bossy = scenario.person("Bossy");
    const course = scenario.course("Building REST APIs", 5999);

    seats.buySeats({
      buyerId: bossy.id,
      courseId: course.id,
      seatCount: 3,
      country: "US",
    });

    const [purchase] = seats.buyerPurchases(bossy.id);
    expect(purchase).toMatchObject({
      seatCount: 3,
      seatPrice: 5999,
      amountPaid: 3 * 5999,
      pppCountryRestriction: null,
    });
    expect(purchase.seats.map((s) => s.state)).toEqual([
      "open",
      "open",
      "open",
    ]);
    // Each Seat Code identifies one Seat, so the Buyer can hand them out.
    expect(new Set(purchase.seats.map((s) => s.code)).size).toBe(3);
    expect(seats.activeEnrollment(bossy.id, course.id)).toBeUndefined();
  });

  it("gives every Seat the PPP Seat Price and the Purchase a PPP Country Restriction", () => {
    const buyer = scenario.person("Buyer");
    const course = scenario.course("Course", 10000, { pppEnabled: true });

    seats.buySeats({
      buyerId: buyer.id,
      courseId: course.id,
      seatCount: 2,
      country: "BR",
    });

    expect(seats.buyerPurchases(buyer.id)[0]).toMatchObject({
      seatPrice: 7000,
      amountPaid: 14000,
      pppCountryRestriction: "BR",
    });
  });

  it("is allowed in a course the Buyer is already enrolled in, and leaves that Enrollment alone", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course");
    seats.personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: null,
    });
    const before = seats.activeEnrollment(liam.id, course.id);

    seats.buySeats({
      buyerId: liam.id,
      courseId: course.id,
      seatCount: 2,
      country: null,
    });

    const purchases = seats.buyerPurchases(liam.id);
    expect(purchases).toHaveLength(2);
    expect(purchases[1].seats.map((s) => s.state)).toEqual(["open", "open"]);
    expect(seats.activeEnrollment(liam.id, course.id)).toEqual(before);
  });
});

describe("Enrollment Eligibility with a Seat Code", () => {
  function boughtSeats(
    options: { pppEnabled?: boolean; country?: string | null } = {}
  ) {
    const buyer = scenario.person("Buyer");
    const course = scenario.course("Course", 8000, {
      pppEnabled: options.pppEnabled,
    });
    seats.buySeats({
      buyerId: buyer.id,
      courseId: course.id,
      seatCount: 2,
      country: options.country ?? null,
    });
    const [purchase] = seats.buyerPurchases(buyer.id);
    return { buyer, course, codes: purchase.seats.map((s) => s.code) };
  }

  it("enrolls a Student on an open Seat", () => {
    const { buyer, course, codes } = boughtSeats();
    const ana = scenario.person("Ana");

    const result = seats.enrollWithSeatCode({
      studentId: ana.id,
      seatCode: codes[0],
      country: "US",
    });

    expect(result).toMatchObject({ ok: true, courseId: course.id });
    expect(seats.buyerPurchases(buyer.id)[0].seats[0]).toMatchObject({
      state: "taken",
      holder: { id: ana.id, name: "Ana" },
    });
  });

  it("refuses an unknown Seat Code", () => {
    const ana = scenario.person("Ana");

    expect(
      seats.enrollmentEligibility({
        studentId: ana.id,
        seatCode: "NOPE",
        country: null,
      })
    ).toEqual({ eligible: false, seat: null, refusal: "unknown-seat-code" });
    expect(
      seats.enrollWithSeatCode({
        studentId: ana.id,
        seatCode: "NOPE",
        country: null,
      })
    ).toEqual({ ok: false, refusal: "unknown-seat-code" });
  });

  it("refuses a refunded Seat", () => {
    const buyer = scenario.person("Buyer");
    const admin = scenario.person("Admin");
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(buyer, course, {
      seatPrice: 7900,
      at: "2026-11-01T00:00:00.000Z",
    });
    const request = scenario.requestRefund(
      bought[0],
      "No longer needed.",
      "2026-11-02T00:00:00.000Z"
    );
    scenario.approveRefund(request, admin, 7900, "2026-11-03T00:00:00.000Z");

    expect(
      seats.enrollWithSeatCode({
        studentId: ana.id,
        seatCode: bought[0].code,
        country: null,
      })
    ).toEqual({ ok: false, refusal: "refunded" });
  });

  it("refuses a Seat taken by another Student", () => {
    const { codes } = boughtSeats();
    const ana = scenario.person("Ana");
    const ben = scenario.person("Ben");
    seats.enrollWithSeatCode({
      studentId: ana.id,
      seatCode: codes[0],
      country: null,
    });

    expect(
      seats.enrollWithSeatCode({
        studentId: ben.id,
        seatCode: codes[0],
        country: null,
      })
    ).toEqual({ ok: false, refusal: "used-by-another-student" });
  });

  it("refuses a Seat another Student has used, even after they unenrolled (Seat Reuse Limit 1)", () => {
    const buyer = scenario.person("Buyer");
    const ana = scenario.person("Ana");
    const ben = scenario.person("Ben");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(buyer, course, {
      seatCount: 2,
      seatPrice: 7900,
      at: "2026-11-01T00:00:00.000Z",
    });
    const enrollment = scenario.enroll(
      ana,
      bought[0],
      "2026-11-02T00:00:00.000Z"
    );
    scenario.unenroll(
      enrollment,
      UnenrollmentInitiator.Student,
      "2026-11-03T00:00:00.000Z"
    );

    expect(
      seats.enrollWithSeatCode({
        studentId: ben.id,
        seatCode: bought[0].code,
        country: null,
      })
    ).toEqual({ ok: false, refusal: "used-by-another-student" });
  });

  it("lets a Student enroll again on their own Seat after unenrolling from it", () => {
    const buyer = scenario.person("Buyer");
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(buyer, course, {
      seatPrice: 7900,
      at: "2026-11-01T00:00:00.000Z",
    });
    const enrollment = scenario.enroll(
      ana,
      bought[0],
      "2026-11-02T00:00:00.000Z"
    );
    scenario.unenroll(
      enrollment,
      UnenrollmentInitiator.Student,
      "2026-11-03T00:00:00.000Z"
    );

    expect(
      seats.enrollWithSeatCode({
        studentId: ana.id,
        seatCode: bought[0].code,
        country: null,
      }).ok
    ).toBe(true);
  });

  it("refuses a Student already actively enrolled in the course, leaving the Seat open", () => {
    const { buyer, course, codes } = boughtSeats();
    const liam = scenario.person("Liam");
    seats.personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: null,
    });

    expect(
      seats.enrollWithSeatCode({
        studentId: liam.id,
        seatCode: codes[0],
        country: null,
      })
    ).toEqual({ ok: false, refusal: "already-enrolled" });
    expect(seats.buyerPurchases(buyer.id)[0].seats[0].state).toBe("open");
  });

  it("refuses a Seat of a Purchase with a PPP Country Restriction from another country", () => {
    const { codes } = boughtSeats({ pppEnabled: true, country: "IN" });
    const ana = scenario.person("Ana");

    expect(
      seats.enrollWithSeatCode({
        studentId: ana.id,
        seatCode: codes[0],
        country: "US",
      })
    ).toEqual({ ok: false, refusal: "country-mismatch", country: "IN" });
    // An unknown country cannot be shown to be the country of purchase.
    expect(
      seats.enrollWithSeatCode({
        studentId: ana.id,
        seatCode: codes[0],
        country: null,
      })
    ).toEqual({ ok: false, refusal: "country-mismatch", country: "IN" });
    expect(
      seats.enrollWithSeatCode({
        studentId: ana.id,
        seatCode: codes[0],
        country: "IN",
      }).ok
    ).toBe(true);
  });

  it("accepts a full-price Seat from another country, because no PPP Discount was given", () => {
    // Bought in a discounted country, but the course had no PPP, so the
    // Purchase has no PPP Country Restriction (#8).
    const { codes } = boughtSeats({ pppEnabled: false, country: "IN" });
    const ana = scenario.person("Ana");

    expect(
      seats.enrollmentEligibility({
        studentId: ana.id,
        seatCode: codes[0],
        country: "US",
      })
    ).toMatchObject({ eligible: true });
    expect(
      seats.enrollWithSeatCode({
        studentId: ana.id,
        seatCode: codes[0],
        country: "US",
      }).ok
    ).toBe(true);
  });
});
