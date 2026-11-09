import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "~/test/setup";
import { seatScenario } from "~/test/seat-scenarios";
import {
  UnenrollmentInitiator,
  UserRole,
  courses,
  enrollments,
  lessonProgress,
} from "~/db/schema";
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
      {
        id: bought[0].id,
        code: bought[0].code,
        state: "open",
        holder: null,
        enrollments: [],
        // Bought in October: the Refund Window has closed.
        refundOffer: null,
        refundPending: false,
        amountRefunded: null,
      },
      {
        id: bought[1].id,
        code: bought[1].code,
        state: "taken",
        holder: { id: olivia.id, name: "Olivia" },
        enrollments: [
          {
            student: { id: olivia.id, name: "Olivia" },
            enrolledAt: "2026-10-02T09:00:00.000Z",
            endedAt: null,
            initiator: null,
          },
        ],
        refundOffer: null,
        refundPending: false,
        amountRefunded: null,
      },
      {
        id: bought[2].id,
        code: bought[2].code,
        state: "open",
        holder: null,
        enrollments: [],
        // Bought in October: the Refund Window has closed.
        refundOffer: null,
        refundPending: false,
        amountRefunded: null,
      },
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

describe("the PPP Restriction Check on course content", () => {
  function restrictedCourse() {
    return scenario.course("Building REST APIs", 5999, { pppEnabled: true });
  }

  it("blocks a Buyer on their own Seat of a restricted Purchase outside the country of purchase", () => {
    const priya = scenario.person("Priya");
    const course = restrictedCourse();
    const { seats: bought } = scenario.purchase(priya, course, {
      seatPrice: 3000,
      pppCountryRestriction: "IN",
      at: "2026-11-01T10:00:00.000Z",
    });
    scenario.enroll(priya, bought[0], "2026-11-01T10:00:00.000Z");

    const check = (country: string | null) =>
      seats.pppRestrictionCheck({
        studentId: priya.id,
        courseId: course.id,
        country,
      });

    expect(check("US")).toEqual({
      blocked: true,
      pppCountryRestriction: "IN",
      country: "US",
    });
    // An unknown country cannot be shown to be the country of purchase.
    expect(check(null)).toEqual({
      blocked: true,
      pppCountryRestriction: "IN",
      country: null,
    });
    expect(check("IN")).toEqual({ blocked: false });
  });

  it("checks a Student enrolled with a Seat Code exactly like the Buyer", () => {
    const bossy = scenario.person("Bossy");
    const ana = scenario.person("Ana");
    const course = restrictedCourse();
    const made = seats.buySeats({
      buyerId: bossy.id,
      courseId: course.id,
      seatCount: 2,
      country: "IN",
    });
    expect(
      seats.enrollWithSeatCode({
        studentId: ana.id,
        seatCode: made.seats[0].code,
        country: "IN",
      }).ok
    ).toBe(true);

    expect(
      seats.pppRestrictionCheck({
        studentId: ana.id,
        courseId: course.id,
        country: "US",
      })
    ).toEqual({ blocked: true, pppCountryRestriction: "IN", country: "US" });
    expect(
      seats.pppRestrictionCheck({
        studentId: ana.id,
        courseId: course.id,
        country: "IN",
      })
    ).toEqual({ blocked: false });
  });

  it("never blocks a Student whose Purchase has no PPP Country Restriction, even if the course enables PPP later", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Introduction to TypeScript", 7900, {
      pppEnabled: false,
    });
    // Bought from a discounted country while the course had no PPP.
    const bought = seats.personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: "IN",
    });
    expect(bought.ok).toBe(true);

    db.update(courses)
      .set({ pppEnabled: true })
      .where(eq(courses.id, course.id))
      .run();

    expect(
      seats.pppRestrictionCheck({
        studentId: liam.id,
        courseId: course.id,
        country: "US",
      })
    ).toEqual({ blocked: false });
  });

  it("uses the Purchase behind the active Enrollment, not an earlier one", () => {
    const priya = scenario.person("Priya");
    const course = restrictedCourse();
    const restricted = scenario.purchase(priya, course, {
      seatPrice: 3000,
      pppCountryRestriction: "IN",
      at: "2026-10-01T10:00:00.000Z",
    });
    const first = scenario.enroll(
      priya,
      restricted.seats[0],
      "2026-10-01T10:00:00.000Z"
    );
    scenario.unenroll(
      first,
      UnenrollmentInitiator.Student,
      "2026-10-05T10:00:00.000Z"
    );
    const fullPrice = scenario.purchase(priya, course, {
      seatPrice: 5999,
      at: "2026-11-01T10:00:00.000Z",
    });
    scenario.enroll(priya, fullPrice.seats[0], "2026-11-01T10:00:00.000Z");

    expect(
      seats.pppRestrictionCheck({
        studentId: priya.id,
        courseId: course.id,
        country: "US",
      })
    ).toEqual({ blocked: false });
  });

  it("does not block someone with no active Enrollment", () => {
    const ana = scenario.person("Ana");
    const course = restrictedCourse();

    expect(
      seats.pppRestrictionCheck({
        studentId: ana.id,
        courseId: course.id,
        country: "US",
      })
    ).toEqual({ blocked: false });
  });
});

describe("Unenroll", () => {
  // A Buyer's Purchase of 2 Seats, with Ana enrolled on the first.
  function anaOnASeat() {
    const buyer = scenario.person("Buyer");
    const ana = scenario.person("Ana");
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
    return { buyer, ana, course, seat: bought[0], enrollment };
  }

  it("ends the Enrollment, recording the time and the Student as Initiator", () => {
    const { ana, course, seat, enrollment } = anaOnASeat();

    const result = seats.unenroll({ studentId: ana.id, courseId: course.id });

    expect(result).toEqual({
      ok: true,
      enrollmentId: enrollment.id,
      seatId: seat.id,
    });
    // The Unenrollment is part of the Seat History, so later decisions about
    // the Seat (who may enroll on it, its Seat Usage) can see it.
    expect(seats.seatHistory(seat.id)?.events.at(-1)).toEqual({
      type: "unenrolled",
      at: fixedClock().toISOString(),
      enrollmentId: enrollment.id,
      studentId: ana.id,
      initiator: UnenrollmentInitiator.Student,
    });
  });

  it("takes away the Student's access: they have no active Enrollment in the course", () => {
    const { ana, course } = anaOnASeat();

    seats.unenroll({ studentId: ana.id, courseId: course.id });

    // Every "is enrolled" check (lessons, quizzes, progress tracking) asks
    // this question, so no active Enrollment means no access.
    expect(seats.activeEnrollment(ana.id, course.id)).toBeUndefined();
  });

  it("refuses a Student with no active Enrollment in the course", () => {
    const { ana, course } = anaOnASeat();
    seats.unenroll({ studentId: ana.id, courseId: course.id });

    // A second Unenrollment would have nothing to end.
    expect(seats.unenroll({ studentId: ana.id, courseId: course.id })).toEqual(
      { ok: false, refusal: "not-enrolled" }
    );
  });

  it("only ends the Enrollment in that course", () => {
    const { ana, course } = anaOnASeat();
    const other = scenario.course("Other");
    const { seats: bought } = scenario.purchase(ana, other, {
      seatPrice: 5000,
      at: "2026-11-01T00:00:00.000Z",
    });
    scenario.enroll(ana, bought[0], "2026-11-01T00:00:00.000Z");

    seats.unenroll({ studentId: ana.id, courseId: course.id });

    expect(seats.activeEnrollment(ana.id, other.id)).toBeDefined();
  });

  it("opens the Seat again, and the Buyer sees its history", () => {
    const { buyer, ana, course, seat } = anaOnASeat();

    seats.unenroll({ studentId: ana.id, courseId: course.id });

    const shown = seats
      .buyerPurchases(buyer.id)[0]
      .seats.find((s) => s.id === seat.id);
    expect(shown).toMatchObject({ state: "open", holder: null });
    // The Buyer can tell a Seat nobody used from one a Student has left.
    expect(shown?.enrollments).toEqual([
      {
        student: { id: ana.id, name: "Ana" },
        enrolledAt: "2026-11-02T00:00:00.000Z",
        endedAt: fixedClock().toISOString(),
        initiator: UnenrollmentInitiator.Student,
      },
    ]);
  });

  it("lets the same Student enroll on the Seat again", () => {
    const { ana, course, seat } = anaOnASeat();
    seats.unenroll({ studentId: ana.id, courseId: course.id });

    const again = seats.enrollWithSeatCode({
      studentId: ana.id,
      seatCode: seat.code,
      country: null,
    });

    expect(again).toMatchObject({ ok: true, seatId: seat.id });
    expect(seats.activeEnrollment(ana.id, course.id)).toEqual(
      expect.objectContaining({ seatId: seat.id })
    );
  });

  it("refuses the Seat to another Student (Seat Reuse Limit 1)", () => {
    const { ana, course, seat } = anaOnASeat();
    const ben = scenario.person("Ben");
    seats.unenroll({ studentId: ana.id, courseId: course.id });

    expect(
      seats.enrollWithSeatCode({
        studentId: ben.id,
        seatCode: seat.code,
        country: null,
      })
    ).toEqual({ ok: false, refusal: "used-by-another-student" });
  });

  it("lets a Buyer leave the Seat of their Personal Purchase and come back", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course");
    const bought = seats.personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: null,
    });
    if (!bought.ok) throw new Error("Personal Purchase refused");

    seats.unenroll({ studentId: liam.id, courseId: course.id });
    const [seat] = seats.buyerPurchases(liam.id)[0].seats;

    expect(seat.state).toBe("open");
    expect(
      seats.enrollWithSeatCode({
        studentId: liam.id,
        seatCode: seat.code,
        country: null,
      }).ok
    ).toBe(true);
  });
});

describe("Completion", () => {
  function enrolledStudent(lessonCount: number) {
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const lessons = scenario.lessons(course, lessonCount);
    const { seats: bought } = scenario.purchase(ana, course, {
      seatPrice: 7900,
      at: "2026-11-01T00:00:00.000Z",
    });
    const enrollment = scenario.enroll(
      ana,
      bought[0],
      "2026-11-01T00:00:00.000Z"
    );
    return { ana, course, lessons, enrollment };
  }

  function completionOf(enrollment: { id: number }) {
    return db
      .select({ completedAt: enrollments.completedAt })
      .from(enrollments)
      .where(eq(enrollments.id, enrollment.id))
      .get()?.completedAt;
  }

  it("is recorded when the Student completes the last lesson of the course", () => {
    const { ana, course, lessons, enrollment } = enrolledStudent(2);

    const first = seats.completeLesson({
      studentId: ana.id,
      courseId: course.id,
      lessonId: lessons[0].id,
    });
    expect(first).toEqual({ ok: true, completedAt: null });
    expect(completionOf(enrollment)).toBeNull();

    const last = seats.completeLesson({
      studentId: ana.id,
      courseId: course.id,
      lessonId: lessons[1].id,
    });
    expect(last).toEqual({ ok: true, completedAt: fixedClock().toISOString() });
    expect(completionOf(enrollment)).toBe(fixedClock().toISOString());
  });

  it("is recorded once: completing a lesson again keeps the first time", () => {
    const { ana, course, lessons, enrollment } = enrolledStudent(1);
    const input = {
      studentId: ana.id,
      courseId: course.id,
      lessonId: lessons[0].id,
    };
    seats.completeLesson(input);

    const later = createSeatsModule({
      db,
      clock: () => new Date("2026-11-20T12:00:00.000Z"),
    });
    expect(later.completeLesson(input)).toEqual({
      ok: true,
      completedAt: fixedClock().toISOString(),
    });
    expect(completionOf(enrollment)).toBe(fixedClock().toISOString());
    // The lesson keeps its first completion time too, so Seat Usage does not move.
    const progress = db
      .select()
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, ana.id))
      .all();
    expect(progress).toEqual([
      expect.objectContaining({ completedAt: fixedClock().toISOString() }),
    ]);
  });

  it("counts lessons completed earlier", () => {
    const { ana, course, lessons, enrollment } = enrolledStudent(2);
    scenario.completeLesson(ana, lessons[0], "2026-11-02T00:00:00.000Z");

    seats.completeLesson({
      studentId: ana.id,
      courseId: course.id,
      lessonId: lessons[1].id,
    });

    expect(completionOf(enrollment)).toBe(fixedClock().toISOString());
  });

  it("is not recorded without an active Enrollment, though the lesson is", () => {
    const { ana, course, lessons, enrollment } = enrolledStudent(1);
    scenario.unenroll(
      enrollment,
      UnenrollmentInitiator.Student,
      "2026-11-03T00:00:00.000Z"
    );

    expect(
      seats.completeLesson({
        studentId: ana.id,
        courseId: course.id,
        lessonId: lessons[0].id,
      })
    ).toEqual({ ok: true, completedAt: null });
    expect(completionOf(enrollment)).toBeNull();
  });

  it("refuses a lesson of another course", () => {
    const { ana, course } = enrolledStudent(1);
    const other = scenario.course("Other Course");
    const [foreign] = scenario.lessons(other, 1);

    expect(
      seats.completeLesson({
        studentId: ana.id,
        courseId: course.id,
        lessonId: foreign.id,
      })
    ).toEqual({ ok: false, refusal: "unknown-lesson" });
  });

  it("keeps the Enrollment active once recorded", () => {
    const { ana, course, lessons, enrollment } = enrolledStudent(1);
    seats.completeLesson({
      studentId: ana.id,
      courseId: course.id,
      lessonId: lessons[0].id,
    });

    expect(seats.activeEnrollment(ana.id, course.id)).toEqual(
      expect.objectContaining({ enrollmentId: enrollment.id })
    );
  });

  it("never ends an Enrollment", () => {
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(ana, course, {
      seatPrice: 7900,
      at: "2026-11-01T00:00:00.000Z",
    });
    const enrollment = scenario.enroll(
      ana,
      bought[0],
      "2026-11-01T00:00:00.000Z"
    );
    scenario.complete(enrollment, "2026-11-05T00:00:00.000Z");

    // A Student who finished the course keeps access to it.
    expect(seats.activeEnrollment(ana.id, course.id)).toEqual(
      expect.objectContaining({ enrollmentId: enrollment.id })
    );
    expect(seats.buyerPurchases(ana.id)[0].seats[0].state).toBe("taken");
  });

  it("does not limit an Enrollment: a Student who completed the course can still Unenroll", () => {
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const { seats: bought } = scenario.purchase(ana, course, {
      seatPrice: 7900,
      at: "2026-11-01T00:00:00.000Z",
    });
    const enrollment = scenario.enroll(
      ana,
      bought[0],
      "2026-11-01T00:00:00.000Z"
    );
    scenario.complete(enrollment, "2026-11-05T00:00:00.000Z");

    expect(seats.unenroll({ studentId: ana.id, courseId: course.id }).ok).toBe(
      true
    );
  });
});

// ─── Refunds ───

// Times in the server's time zone: the Refund Window counts calendar days
// there, so these tests hold wherever they run.
function local(day: number, hour = 12, minute = 0) {
  return new Date(2026, 10, day, hour, minute);
}

function seatsAt(when: Date) {
  return createSeatsModule({ db, clock: () => when });
}

const REASON = "It is not what I expected.";

describe("Refund Eligibility", () => {
  // Liam's Personal Purchase, bought late on 1 November.
  function liamsPersonalPurchase(coursePrice = 7900) {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course", coursePrice);
    const { seats: bought } = scenario.purchase(liam, course, {
      seatPrice: coursePrice,
      at: local(1, 23).toISOString(),
    });
    const enrollment = scenario.enroll(
      liam,
      bought[0],
      local(1, 23).toISOString()
    );
    return { liam, course, seat: bought[0], enrollment };
  }

  it("allows a Refund Request for a fresh Personal Purchase, offering the Seat Price", () => {
    const { liam, course, seat } = liamsPersonalPurchase();

    expect(
      seatsAt(local(3)).refundEligibility({ buyerId: liam.id, seatId: seat.id })
    ).toEqual({
      eligible: true,
      seatId: seat.id,
      courseId: course.id,
      refundAmount: 7900,
      lastDayOfRefundWindow: "2026-11-15",
    });
  });

  it("keeps the Refund Window open to the end of its last day, 14 days after the day of purchase", () => {
    const { liam, seat } = liamsPersonalPurchase();

    // Bought at 23:00 on the 1st, the Buyer still gets all of the 15th.
    expect(
      seatsAt(local(15, 23, 59)).refundEligibility({
        buyerId: liam.id,
        seatId: seat.id,
      })
    ).toMatchObject({ eligible: true });
  });

  it("closes the Refund Window on the day after its last day", () => {
    const { liam, seat } = liamsPersonalPurchase();

    expect(
      seatsAt(local(16, 0, 0)).refundEligibility({
        buyerId: liam.id,
        seatId: seat.id,
      })
    ).toEqual({ eligible: false, refusal: "refund-window-closed" });
  });

  describe("the watch limit", () => {
    // Liam watches two lessons, across two Enrollments on the same Seat.
    function liamWatched(totalSeconds: number) {
      const { liam, course, seat, enrollment } = liamsPersonalPurchase();
      const [first, second] = scenario.lessons(course, 4);
      scenario.watch(liam, first, 3600, local(2).toISOString());
      scenario.unenroll(
        enrollment,
        UnenrollmentInitiator.Student,
        local(3).toISOString()
      );
      scenario.enroll(liam, seat, local(4).toISOString());
      scenario.watch(liam, second, totalSeconds - 3600, local(5).toISOString());
      return { liam, seat };
    }

    it("refuses a Seat whose Seat Usage, summed over every Enrollment, reaches 2 hours", () => {
      const { liam, seat } = liamWatched(2 * 3600);

      expect(
        seatsAt(local(6)).refundEligibility({
          buyerId: liam.id,
          seatId: seat.id,
        })
      ).toEqual({ eligible: false, refusal: "watch-limit-reached" });
    });

    it("allows a Seat watched for just under 2 hours", () => {
      const { liam, seat } = liamWatched(2 * 3600 - 1);

      expect(
        seatsAt(local(6)).refundEligibility({
          buyerId: liam.id,
          seatId: seat.id,
        })
      ).toMatchObject({ eligible: true });
    });

    it("counts the furthest position reached in a lesson, not every heartbeat", () => {
      const { liam, course, seat } = liamsPersonalPurchase();
      const [lesson] = scenario.lessons(course, 1);
      for (const position of [1800, 3600, 5400, 7000]) {
        scenario.watch(liam, lesson, position, local(2).toISOString());
      }

      expect(
        seatsAt(local(3)).refundEligibility({
          buyerId: liam.id,
          seatId: seat.id,
        })
      ).toMatchObject({ eligible: true });
    });

    it("does not count what was watched while not enrolled on the Seat", () => {
      const { liam, course, seat, enrollment } = liamsPersonalPurchase();
      const [lesson] = scenario.lessons(course, 1);
      scenario.unenroll(
        enrollment,
        UnenrollmentInitiator.Student,
        local(2).toISOString()
      );
      // Before the Purchase, and between Enrollments.
      scenario.watch(liam, lesson, 3 * 3600, local(1, 8).toISOString());
      scenario.watch(liam, lesson, 3 * 3600, local(3).toISOString());

      expect(
        seatsAt(local(4)).refundEligibility({
          buyerId: liam.id,
          seatId: seat.id,
        })
      ).toMatchObject({ eligible: true });
    });
  });

  describe("the completion limit", () => {
    function liamCompleted(lessonsCompleted: number) {
      const { liam, course, seat } = liamsPersonalPurchase();
      const lessons = scenario.lessons(course, 4);
      for (const lesson of lessons.slice(0, lessonsCompleted)) {
        scenario.completeLesson(liam, lesson, local(2).toISOString());
      }
      return { liam, seat };
    }

    it("refuses a Seat with half of the course's lessons completed", () => {
      const { liam, seat } = liamCompleted(2);

      expect(
        seatsAt(local(3)).refundEligibility({
          buyerId: liam.id,
          seatId: seat.id,
        })
      ).toEqual({ eligible: false, refusal: "completion-limit-reached" });
    });

    it("allows a Seat with less than half completed", () => {
      const { liam, seat } = liamCompleted(1);

      expect(
        seatsAt(local(3)).refundEligibility({
          buyerId: liam.id,
          seatId: seat.id,
        })
      ).toMatchObject({ eligible: true });
    });
  });

  describe("the Refund Amount", () => {
    it("is the discounted Seat Price when a PPP Discount was given", () => {
      const priya = scenario.person("Priya");
      const course = scenario.course("Course", 8000, { pppEnabled: true });
      const bought = seatsAt(local(1)).personalPurchase({
        buyerId: priya.id,
        courseId: course.id,
        country: "IN",
      });
      if (!bought.ok) throw new Error("Purchase refused");

      expect(
        seatsAt(local(2)).refundEligibility({
          buyerId: priya.id,
          seatId: bought.seatId,
        })
      ).toMatchObject({ eligible: true, refundAmount: 4000 });
    });

    it("is the full Seat Price when no PPP Discount was given", () => {
      const emma = scenario.person("Emma");
      const course = scenario.course("Course", 8000, { pppEnabled: true });
      const bought = seatsAt(local(1)).personalPurchase({
        buyerId: emma.id,
        courseId: course.id,
        country: "US",
      });
      if (!bought.ok) throw new Error("Purchase refused");

      expect(
        seatsAt(local(2)).refundEligibility({
          buyerId: emma.id,
          seatId: bought.seatId,
        })
      ).toMatchObject({ eligible: true, refundAmount: 8000 });
    });

    it("stays the Seat Price after the Course Price changes (#2)", () => {
      const { liam, course, seat } = liamsPersonalPurchase(7900);
      db.update(courses)
        .set({ price: 12900 })
        .where(eq(courses.id, course.id))
        .run();

      expect(
        seatsAt(local(3)).refundEligibility({
          buyerId: liam.id,
          seatId: seat.id,
        })
      ).toMatchObject({ eligible: true, refundAmount: 7900 });
    });
  });

  it("refuses a second Refund Request while one is Pending", () => {
    const { liam, seat } = liamsPersonalPurchase();
    scenario.requestRefund(seat, REASON, local(2).toISOString());

    expect(
      seatsAt(local(3)).refundEligibility({ buyerId: liam.id, seatId: seat.id })
    ).toEqual({ eligible: false, refusal: "pending-refund-request" });
  });

  it("refuses a refunded Seat, so it is never refunded twice (#6)", () => {
    const { liam, seat } = liamsPersonalPurchase();
    const admin = scenario.person("Admin");
    const request = scenario.requestRefund(seat, REASON, local(2).toISOString());
    scenario.approveRefund(request, admin, 7900, local(3).toISOString());

    expect(
      seatsAt(local(4)).refundEligibility({ buyerId: liam.id, seatId: seat.id })
    ).toEqual({ eligible: false, refusal: "refunded" });
  });

  it("allows a new Refund Request after a Refund Decline, which changes nothing else", () => {
    const { liam, seat } = liamsPersonalPurchase();
    const admin = scenario.person("Admin");
    const request = scenario.requestRefund(seat, REASON, local(2).toISOString());
    scenario.declineRefund(request, admin, local(3).toISOString());

    expect(
      seatsAt(local(4)).refundEligibility({ buyerId: liam.id, seatId: seat.id })
    ).toMatchObject({ eligible: true });
  });

  describe("a Purchase of several Seats", () => {
    function bossyBought3Seats() {
      const bossy = scenario.person("Bossy");
      const ana = scenario.person("Ana");
      const course = scenario.course("Course", 7900);
      const { seats: bought } = scenario.purchase(bossy, course, {
        seatCount: 3,
        seatPrice: 5999,
        at: local(1).toISOString(),
      });
      return { bossy, ana, course, bought };
    }

    it("offers the Seat Price of one Seat, not the Amount Paid (#3)", () => {
      const { bossy, bought } = bossyBought3Seats();

      expect(
        seatsAt(local(2)).refundEligibility({
          buyerId: bossy.id,
          seatId: bought[0].id,
        })
      ).toMatchObject({ eligible: true, refundAmount: 5999 });
    });

    it("refuses a Seat taken by another Student, but not the other Seats of the Purchase", () => {
      const { bossy, ana, bought } = bossyBought3Seats();
      scenario.enroll(ana, bought[0], local(2).toISOString());
      const now = seatsAt(local(3));

      expect(
        now.refundEligibility({ buyerId: bossy.id, seatId: bought[0].id })
      ).toEqual({ eligible: false, refusal: "taken-by-another-student" });
      expect(
        now.refundEligibility({ buyerId: bossy.id, seatId: bought[1].id })
      ).toMatchObject({ eligible: true });
    });

    it("refuses a Seat another Student has used, even after they unenrolled", () => {
      const { bossy, ana, bought } = bossyBought3Seats();
      const enrollment = scenario.enroll(ana, bought[0], local(2).toISOString());
      scenario.unenroll(
        enrollment,
        UnenrollmentInitiator.Student,
        local(3).toISOString()
      );

      expect(
        seatsAt(local(4)).refundEligibility({
          buyerId: bossy.id,
          seatId: bought[0].id,
        })
      ).toEqual({ eligible: false, refusal: "taken-by-another-student" });
    });

    it("allows the Buyer's own Seat while they are enrolled on it", () => {
      const { bossy, bought } = bossyBought3Seats();
      scenario.enroll(bossy, bought[2], local(2).toISOString());

      expect(
        seatsAt(local(3)).refundEligibility({
          buyerId: bossy.id,
          seatId: bought[2].id,
        })
      ).toMatchObject({ eligible: true });
    });
  });

  it("refuses anyone but the Seat's Buyer", () => {
    const { seat } = liamsPersonalPurchase();
    const ana = scenario.person("Ana");

    expect(
      seatsAt(local(2)).refundEligibility({ buyerId: ana.id, seatId: seat.id })
    ).toEqual({ eligible: false, refusal: "not-buyer" });
  });

  it("refuses an unknown Seat", () => {
    const liam = scenario.person("Liam");

    expect(
      seatsAt(local(2)).refundEligibility({ buyerId: liam.id, seatId: 999 })
    ).toEqual({ eligible: false, refusal: "unknown-seat" });
  });
});

describe("making a Refund Request", () => {
  function liamsPersonalPurchase() {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course", 7900);
    const bought = seatsAt(local(1)).personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: "US",
    });
    if (!bought.ok) throw new Error("Purchase refused");
    return { liam, course, seatId: bought.seatId };
  }

  it("records a Pending Refund Request with its Refund Reason; the Buyer keeps access", () => {
    const { liam, course, seatId } = liamsPersonalPurchase();

    const result = seatsAt(local(2)).requestRefund({
      buyerId: liam.id,
      seatId,
      reason: REASON,
    });

    expect(result).toMatchObject({
      ok: true,
      seatId,
      courseId: course.id,
      refundAmount: 7900,
    });
    expect(seats.seatHistory(seatId)?.events.at(-1)).toMatchObject({
      type: "refund-requested",
      at: local(2).toISOString(),
      reason: REASON,
    });
    // Nothing changes before a decision.
    expect(seats.activeEnrollment(liam.id, course.id)).toBeDefined();
    expect(seats.buyerPurchases(liam.id)[0].seats[0].state).toBe("taken");
  });

  it("re-checks Refund Eligibility: a second request while one is Pending is refused", () => {
    const { liam, seatId } = liamsPersonalPurchase();
    const now = seatsAt(local(2));
    now.requestRefund({ buyerId: liam.id, seatId, reason: REASON });

    expect(
      now.requestRefund({ buyerId: liam.id, seatId, reason: REASON })
    ).toEqual({ ok: false, refusal: "pending-refund-request" });
  });

  it("re-checks Refund Eligibility: refused once the Refund Window has closed", () => {
    const { liam, seatId } = liamsPersonalPurchase();

    expect(
      seatsAt(local(16)).requestRefund({
        buyerId: liam.id,
        seatId,
        reason: REASON,
      })
    ).toEqual({ ok: false, refusal: "refund-window-closed" });
  });

  it("asks for a Refund Reason of 10 to 1000 characters", () => {
    const { liam, seatId } = liamsPersonalPurchase();
    const now = seatsAt(local(2));
    const request = (reason: string) =>
      now.requestRefund({ buyerId: liam.id, seatId, reason });

    expect(request("Too short")).toEqual({
      ok: false,
      refusal: "refund-reason-length",
    });
    expect(request("x".repeat(1001))).toEqual({
      ok: false,
      refusal: "refund-reason-length",
    });
    expect(request("x".repeat(1000))).toMatchObject({ ok: true });
  });

  it("shows up among the Buyer's Pending Refund Requests, with its Refund Amount", () => {
    const { liam, course, seatId } = liamsPersonalPurchase();
    const ana = scenario.person("Ana");
    seatsAt(local(2)).requestRefund({ buyerId: liam.id, seatId, reason: REASON });

    expect(seats.pendingRefundRequests(liam.id)).toEqual([
      {
        id: expect.any(Number),
        seatId,
        courseTitle: course.title,
        courseSlug: course.slug,
        refundAmount: 7900,
        reason: REASON,
        requestedAt: local(2).toISOString(),
      },
    ]);
    expect(seats.pendingRefundRequests(ana.id)).toEqual([]);
  });

  it("leaves decided Refund Requests out of the Pending ones", () => {
    const { liam, seatId } = liamsPersonalPurchase();
    const admin = scenario.person("Admin");
    const result = seatsAt(local(2)).requestRefund({
      buyerId: liam.id,
      seatId,
      reason: REASON,
    });
    if (!result.ok) throw new Error("Refund Request refused");
    scenario.declineRefund(
      { id: result.refundRequestId },
      admin,
      local(3).toISOString()
    );

    expect(seats.pendingRefundRequests(liam.id)).toEqual([]);
  });
});

describe("the Cancellation", () => {
  it("is offered to a Student on the Seat of their own Personal Purchase, with its Refund Amount", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course", 7900);
    const bought = seatsAt(local(1)).personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: "US",
    });
    if (!bought.ok) throw new Error("Purchase refused");

    expect(
      seatsAt(local(2)).cancellation({ studentId: liam.id, courseId: course.id })
    ).toEqual({
      eligible: true,
      seatId: bought.seatId,
      courseId: course.id,
      refundAmount: 7900,
      lastDayOfRefundWindow: "2026-11-15",
    });
  });

  it("checks the Seat the Student is enrolled on, not a later Purchase of Seats (#1)", () => {
    const liam = scenario.person("Liam");
    const ana = scenario.person("Ana");
    const course = scenario.course("Course", 7900);
    const bought = seatsAt(local(1)).personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: "US",
    });
    if (!bought.ok) throw new Error("Purchase refused");
    const later = seatsAt(local(2)).buySeats({
      buyerId: liam.id,
      courseId: course.id,
      seatCount: 2,
      country: "US",
    });
    seatsAt(local(3)).enrollWithSeatCode({
      studentId: ana.id,
      seatCode: later.seats[0].code,
      country: "US",
    });

    expect(
      seatsAt(local(4)).cancellation({ studentId: liam.id, courseId: course.id })
    ).toMatchObject({ eligible: true, seatId: bought.seatId });
  });

  it("is not offered to a Student enrolled with someone else's Seat Code", () => {
    const bossy = scenario.person("Bossy");
    const ana = scenario.person("Ana");
    const course = scenario.course("Course");
    const made = seatsAt(local(1)).buySeats({
      buyerId: bossy.id,
      courseId: course.id,
      seatCount: 1,
      country: "US",
    });
    seatsAt(local(1)).enrollWithSeatCode({
      studentId: ana.id,
      seatCode: made.seats[0].code,
      country: "US",
    });

    expect(
      seatsAt(local(2)).cancellation({ studentId: ana.id, courseId: course.id })
    ).toBeNull();
  });

  it("is not offered to a Buyer enrolled on a Seat of a Purchase of several Seats", () => {
    const bossy = scenario.person("Bossy");
    const course = scenario.course("Course");
    const made = seatsAt(local(1)).buySeats({
      buyerId: bossy.id,
      courseId: course.id,
      seatCount: 3,
      country: "US",
    });
    seatsAt(local(1)).enrollWithSeatCode({
      studentId: bossy.id,
      seatCode: made.seats[0].code,
      country: "US",
    });

    // Those Seats are refunded one by one from the seats page.
    expect(
      seatsAt(local(2)).cancellation({ studentId: bossy.id, courseId: course.id })
    ).toBeNull();
  });

  it("is not offered while a Refund Request is Pending", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course");
    const bought = seatsAt(local(1)).personalPurchase({
      buyerId: liam.id,
      courseId: course.id,
      country: "US",
    });
    if (!bought.ok) throw new Error("Purchase refused");
    const now = seatsAt(local(2));
    now.requestRefund({ buyerId: liam.id, seatId: bought.seatId, reason: REASON });

    expect(
      now.cancellation({ studentId: liam.id, courseId: course.id })
    ).toBeNull();
  });

  it("is not offered to someone not enrolled", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Course");

    expect(
      seats.cancellation({ studentId: liam.id, courseId: course.id })
    ).toBeNull();
  });
});

describe("Refund Requests on the seats page", () => {
  it("offers a Refund Request for each eligible Seat, with its Refund Amount", () => {
    const bossy = scenario.person("Bossy");
    const ana = scenario.person("Ana");
    const course = scenario.course("Course", 7900);
    const { seats: bought } = scenario.purchase(bossy, course, {
      seatCount: 3,
      seatPrice: 5999,
      at: local(1).toISOString(),
    });
    scenario.enroll(ana, bought[0], local(2).toISOString());
    scenario.requestRefund(bought[1], REASON, local(2).toISOString());

    const [purchase] = seatsAt(local(3)).buyerPurchases(bossy.id);

    expect(
      purchase.seats.map((s) => ({
        refundOffer: s.refundOffer,
        refundPending: s.refundPending,
      }))
    ).toEqual([
      { refundOffer: null, refundPending: false },
      { refundOffer: null, refundPending: true },
      {
        refundOffer: { refundAmount: 5999, lastDayOfRefundWindow: "2026-11-15" },
        refundPending: false,
      },
    ]);
  });
});

describe("deciding a Refund Request", () => {
  // Bossy buys 2 Seats of Kim's course on 1 November; Ana enrolls on one.
  function bossysPurchase() {
    const kim = scenario.person("Kim", UserRole.Instructor);
    const admin = scenario.person("Admin", UserRole.Admin);
    const bossy = scenario.person("Bossy");
    const ana = scenario.person("Ana");
    const course = scenario.course("Course", 7900, { owner: kim });
    const bought = seatsAt(local(1)).buySeats({
      buyerId: bossy.id,
      courseId: course.id,
      seatCount: 2,
      country: null,
    });
    const [taken, open] = bought.seats;
    return { kim, admin, bossy, ana, course, taken, open };
  }

  // The Buyer makes a Refund Request on 2 November.
  function pendingRequest(buyerId: number, seatId: number) {
    const result = seatsAt(local(2)).requestRefund({
      buyerId,
      seatId,
      reason: REASON,
    });
    if (!result.ok) throw new Error(`Refund Request refused: ${result.refusal}`);
    return result.refundRequestId;
  }

  describe("Refund Approval", () => {
    it("of a taken Seat records the Amount Refunded, who and when, ends the Enrollment with the system as Initiator, and access is lost", () => {
      const liam = scenario.person("Liam");
      const admin = scenario.person("Admin", UserRole.Admin);
      const course = scenario.course("Course", 7900);
      const bought = seatsAt(local(1)).personalPurchase({
        buyerId: liam.id,
        courseId: course.id,
        country: null,
      });
      if (!bought.ok) throw new Error("Purchase refused");
      const refundRequestId = pendingRequest(liam.id, bought.seatId);

      const result = seatsAt(local(3)).approveRefund({
        deciderId: admin.id,
        refundRequestId,
      });

      expect(result).toEqual({
        ok: true,
        refundRequestId,
        seatId: bought.seatId,
        courseId: course.id,
        buyerId: liam.id,
        amountRefunded: 7900,
      });
      const history = seats.seatHistory(bought.seatId);
      expect(history?.events.slice(-2)).toEqual([
        {
          type: "unenrolled",
          at: local(3).toISOString(),
          enrollmentId: bought.enrollmentId,
          studentId: liam.id,
          initiator: UnenrollmentInitiator.System,
        },
        {
          type: "refund-approved",
          at: local(3).toISOString(),
          refundRequestId,
          amountRefunded: 7900,
          resolvedByUserId: admin.id,
        },
      ]);
      // The Student loses access to the course.
      expect(seats.activeEnrollment(liam.id, course.id)).toBeUndefined();
      expect(seats.buyerPurchases(liam.id)[0].seats[0]).toMatchObject({
        state: "refunded",
        holder: null,
        amountRefunded: 7900,
        refundOffer: null,
        refundPending: false,
      });
    });

    it("of an open Seat makes it refunded, with its Seat Price as the Amount Refunded", () => {
      const { kim, bossy, open } = bossysPurchase();
      const refundRequestId = pendingRequest(bossy.id, open.id);

      expect(
        seatsAt(local(3)).approveRefund({ deciderId: kim.id, refundRequestId })
      ).toMatchObject({ ok: true, amountRefunded: 7900 });

      const seat = seats
        .buyerPurchases(bossy.id)[0]
        .seats.find((s) => s.id === open.id);
      expect(seat).toMatchObject({
        state: "refunded",
        amountRefunded: 7900,
        enrollments: [],
      });
    });

    it("refunds the Seat Price paid, not today's Course Price", () => {
      const { admin, bossy, course, open } = bossysPurchase();
      const refundRequestId = pendingRequest(bossy.id, open.id);
      db.update(courses).set({ price: 9900 }).where(eq(courses.id, course.id)).run();

      expect(
        seatsAt(local(3)).approveRefund({ deciderId: admin.id, refundRequestId })
      ).toMatchObject({ ok: true, amountRefunded: 7900 });
    });

    it("makes the Seat Code refused, and the Seat never eligible for another Refund Request", () => {
      const { admin, bossy, ana, open } = bossysPurchase();
      const refundRequestId = pendingRequest(bossy.id, open.id);
      seatsAt(local(3)).approveRefund({ deciderId: admin.id, refundRequestId });

      const later = seatsAt(local(4));
      expect(
        later.enrollWithSeatCode({
          studentId: ana.id,
          seatCode: open.code,
          country: null,
        })
      ).toEqual({ ok: false, refusal: "refunded" });
      expect(
        later.requestRefund({ buyerId: bossy.id, seatId: open.id, reason: REASON })
      ).toEqual({ ok: false, refusal: "refunded" });
    });

    it("leaves the other Seats of the Purchase alone", () => {
      const { admin, bossy, ana, taken, open } = bossysPurchase();
      seatsAt(local(1)).enrollWithSeatCode({
        studentId: ana.id,
        seatCode: taken.code,
        country: null,
      });
      const refundRequestId = pendingRequest(bossy.id, open.id);
      seatsAt(local(3)).approveRefund({ deciderId: admin.id, refundRequestId });

      const states = seats
        .buyerPurchases(bossy.id)[0]
        .seats.map((s) => [s.id, s.state]);
      expect(states).toEqual([
        [taken.id, "taken"],
        [open.id, "refunded"],
      ]);
    });
  });

  describe("Refund Decline", () => {
    it("records who declined it and when, and changes nothing else", () => {
      const liam = scenario.person("Liam");
      const admin = scenario.person("Admin", UserRole.Admin);
      const course = scenario.course("Course", 7900);
      const bought = seatsAt(local(1)).personalPurchase({
        buyerId: liam.id,
        courseId: course.id,
        country: null,
      });
      if (!bought.ok) throw new Error("Purchase refused");
      const refundRequestId = pendingRequest(liam.id, bought.seatId);

      expect(
        seatsAt(local(3)).declineRefund({ deciderId: admin.id, refundRequestId })
      ).toEqual({
        ok: true,
        refundRequestId,
        seatId: bought.seatId,
        courseId: course.id,
        buyerId: liam.id,
      });
      expect(seats.seatHistory(bought.seatId)?.events.at(-1)).toEqual({
        type: "refund-declined",
        at: local(3).toISOString(),
        refundRequestId,
        resolvedByUserId: admin.id,
      });
      // The Student keeps access and the Seat stays taken.
      expect(seats.activeEnrollment(liam.id, course.id)).toBeDefined();
      expect(seats.buyerPurchases(liam.id)[0].seats[0]).toMatchObject({
        state: "taken",
        amountRefunded: null,
        refundPending: false,
      });
      expect(seats.pendingRefundRequests(liam.id)).toEqual([]);
    });
  });

  describe("who may decide", () => {
    it("lets an Admin decide a Refund Request for any course", () => {
      const { admin, bossy, open } = bossysPurchase();
      const refundRequestId = pendingRequest(bossy.id, open.id);

      expect(seats.mayDecideRefunds(admin.id)).toBe(true);
      expect(
        seatsAt(local(3)).declineRefund({ deciderId: admin.id, refundRequestId })
      ).toMatchObject({ ok: true });
    });

    it("lets the Course Owner decide a Refund Request for their own course", () => {
      const { kim, bossy, open } = bossysPurchase();
      const refundRequestId = pendingRequest(bossy.id, open.id);

      expect(seats.mayDecideRefunds(kim.id)).toBe(true);
      expect(
        seatsAt(local(3)).approveRefund({ deciderId: kim.id, refundRequestId })
      ).toMatchObject({ ok: true });
    });

    it("refuses another Instructor, the Buyer and a Student, and changes nothing", () => {
      const { bossy, ana, open } = bossysPurchase();
      const otherInstructor = scenario.person("Ola", UserRole.Instructor);
      scenario.course("Ola's course", 5000, { owner: otherInstructor });
      const refundRequestId = pendingRequest(bossy.id, open.id);
      const now = seatsAt(local(3));

      for (const person of [otherInstructor, bossy, ana]) {
        expect(
          now.approveRefund({ deciderId: person.id, refundRequestId })
        ).toEqual({ ok: false, refusal: "not-decider" });
        expect(
          now.declineRefund({ deciderId: person.id, refundRequestId })
        ).toEqual({ ok: false, refusal: "not-decider" });
      }
      expect(seats.pendingRefundRequests(bossy.id)).toHaveLength(1);
      expect(seats.mayDecideRefunds(bossy.id)).toBe(false);
      expect(seats.mayDecideRefunds(ana.id)).toBe(false);
    });

    it("refuses a Refund Request that has already been decided", () => {
      const { admin, kim, bossy, open } = bossysPurchase();
      const refundRequestId = pendingRequest(bossy.id, open.id);
      seatsAt(local(3)).declineRefund({ deciderId: admin.id, refundRequestId });

      const now = seatsAt(local(4));
      expect(now.approveRefund({ deciderId: kim.id, refundRequestId })).toEqual(
        { ok: false, refusal: "not-pending" }
      );
      expect(now.declineRefund({ deciderId: kim.id, refundRequestId })).toEqual(
        { ok: false, refusal: "not-pending" }
      );
    });

    it("refuses an unknown Refund Request", () => {
      const { admin } = bossysPurchase();

      expect(
        seats.approveRefund({ deciderId: admin.id, refundRequestId: 999 })
      ).toEqual({ ok: false, refusal: "unknown-refund-request" });
    });
  });

  describe("the Refund Requests waiting for a decision", () => {
    it("shows each with its course, Buyer, Seat holder, Refund Amount, Refund Reason and Seat Usage", () => {
      const { admin, bossy, ana, course, taken } = bossysPurchase();
      const [lesson1] = scenario.lessons(course, 4);
      seatsAt(local(1)).enrollWithSeatCode({
        studentId: ana.id,
        seatCode: taken.code,
        country: null,
      });
      scenario.watch(ana, lesson1, 600, local(1, 13).toISOString());
      scenario.completeLesson(ana, lesson1, local(1, 13).toISOString());
      // A Seat taken by another Student cannot be refunded, so the request
      // is arranged directly; it can still be Pending (e.g. migrated data).
      const request = scenario.requestRefund(taken, REASON, local(2).toISOString());

      expect(seats.refundDecisions(admin.id)).toEqual([
        {
          id: request.id,
          seatId: taken.id,
          courseId: course.id,
          courseTitle: course.title,
          courseSlug: course.slug,
          buyer: { id: bossy.id, name: "Bossy" },
          holder: { id: ana.id, name: "Ana" },
          refundAmount: 7900,
          reason: REASON,
          requestedAt: local(2).toISOString(),
          seatUsage: { watchedSeconds: 600, completion: 0.25 },
        },
      ]);
    });

    it("lists every Pending Refund Request for an Admin, and only their own courses' for a Course Owner", () => {
      const { admin, kim, bossy, open } = bossysPurchase();
      const ola = scenario.person("Ola", UserRole.Instructor);
      const olasCourse = scenario.course("Ola's course", 5000, { owner: ola });
      const liam = scenario.person("Liam");
      const bought = seatsAt(local(1)).personalPurchase({
        buyerId: liam.id,
        courseId: olasCourse.id,
        country: null,
      });
      if (!bought.ok) throw new Error("Purchase refused");
      const bossysRequest = pendingRequest(bossy.id, open.id);
      const liamsRequest = pendingRequest(liam.id, bought.seatId);

      const ids = (deciderId: number) =>
        seats.refundDecisions(deciderId).map((r) => r.id);
      expect(ids(admin.id)).toEqual([bossysRequest, liamsRequest]);
      expect(ids(kim.id)).toEqual([bossysRequest]);
      expect(ids(ola.id)).toEqual([liamsRequest]);
      expect(ids(bossy.id)).toEqual([]);
    });

    it("leaves out decided Refund Requests", () => {
      const { admin, bossy, open } = bossysPurchase();
      const refundRequestId = pendingRequest(bossy.id, open.id);
      seatsAt(local(3)).approveRefund({ deciderId: admin.id, refundRequestId });

      expect(seats.refundDecisions(admin.id)).toEqual([]);
    });
  });

  describe("on the Buyer's Settings", () => {
    it("shows each decided Refund Request, with the Amount Refunded of an approval", () => {
      const { admin, bossy, taken, open, course } = bossysPurchase();
      const approved = pendingRequest(bossy.id, open.id);
      const declined = pendingRequest(bossy.id, taken.id);
      seatsAt(local(3)).approveRefund({ deciderId: admin.id, refundRequestId: approved });
      seatsAt(local(4)).declineRefund({ deciderId: admin.id, refundRequestId: declined });

      expect(seats.decidedRefundRequests(bossy.id)).toEqual([
        {
          id: declined,
          seatId: taken.id,
          courseTitle: course.title,
          courseSlug: course.slug,
          status: "declined",
          amountRefunded: null,
          decidedAt: local(4).toISOString(),
        },
        {
          id: approved,
          seatId: open.id,
          courseTitle: course.title,
          courseSlug: course.slug,
          status: "approved",
          amountRefunded: 7900,
          decidedAt: local(3).toISOString(),
        },
      ]);
    });
  });
});
