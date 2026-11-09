import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb, type TestDb } from "~/test/setup";
import { seatScenario } from "~/test/seat-scenarios";
import { UnenrollmentInitiator, UserRole } from "~/db/schema";
import { createSeatAnalytics } from "./seat-analytics.server";

let db: TestDb;
let scenario: ReturnType<typeof seatScenario>;
let analytics: ReturnType<typeof createSeatAnalytics>;

const DAY_1 = "2026-11-01T10:00:00.000Z";
const DAY_2 = "2026-11-02T10:00:00.000Z";
const DAY_3 = "2026-11-03T10:00:00.000Z";

beforeEach(() => {
  db = createTestDb();
  scenario = seatScenario(db);
  analytics = createSeatAnalytics({ db });
});

const everyone = { instructorId: null, since: null };

describe("what each Student's Seats were paid", () => {
  it("credits the Buyer of a Personal Purchase with the whole Amount Paid", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Introduction to TypeScript");
    const { seats } = scenario.purchase(liam, course, {
      seatPrice: 7900,
      at: DAY_1,
    });
    scenario.enroll(liam, seats[0], DAY_1);

    expect(analytics.paidForStudents([liam.id], everyone)).toEqual(
      new Map([[liam.id, 7900]])
    );
  });

  it("credits a Student enrolled on a bought Seat with its share, unrounded", () => {
    // The page sums the shares first and rounds once, so three Seats out of
    // 10000 cents still add up to the Amount Paid.
    const bossy = scenario.person("Bossy");
    const olivia = scenario.person("Olivia");
    const course = scenario.course("Node.js");
    const { purchase, seats } = scenario.purchase(bossy, course, {
      seatCount: 3,
      seatPrice: 3333,
      at: DAY_1,
    });
    // Amount Paid is what the Buyer paid; the share is taken from it, not
    // from the stored (rounded) Seat Price.
    db.$client
      .prepare("update purchases set amount_paid = 10000 where id = ?")
      .run(purchase.id);
    scenario.enroll(olivia, seats[0], DAY_2);

    const paid = analytics.paidForStudents([olivia.id, bossy.id], everyone);

    expect(paid.get(olivia.id)).toBeCloseTo(10000 / 3, 6);
    // The Buyer did not enroll, so nothing is credited to them as a Student.
    expect(paid.has(bossy.id)).toBe(false);
  });

  it("credits a Seat once, however often the Student enrolled on it", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Introduction to TypeScript");
    const { seats } = scenario.purchase(liam, course, {
      seatPrice: 7900,
      at: DAY_1,
    });
    const first = scenario.enroll(liam, seats[0], DAY_1);
    scenario.unenroll(first, UnenrollmentInitiator.Student, DAY_2);
    scenario.enroll(liam, seats[0], DAY_3);

    expect(analytics.paidForStudents([liam.id], everyone).get(liam.id)).toBe(
      7900
    );
  });

  it("counts only the courses of the given Course Owner", () => {
    const liam = scenario.person("Liam");
    const other = scenario.person("Other Instructor", UserRole.Instructor);
    const mine = scenario.course("Mine");
    const theirs = scenario.course("Theirs", 5000, { owner: other });
    for (const course of [mine, theirs]) {
      const { seats } = scenario.purchase(liam, course, {
        seatPrice: course.price,
        at: DAY_1,
      });
      scenario.enroll(liam, seats[0], DAY_1);
    }

    expect(
      analytics
        .paidForStudents([liam.id], { instructorId: other.id })
        .get(liam.id)
    ).toBe(5000);
  });
});

describe("the Seats each Buyer bought for others", () => {
  it("leaves out Personal Purchases", () => {
    const liam = scenario.person("Liam");
    const course = scenario.course("Introduction to TypeScript");
    const { seats } = scenario.purchase(liam, course, {
      seatPrice: 7900,
      at: DAY_1,
    });
    scenario.enroll(liam, seats[0], DAY_1);

    expect(analytics.seatsBought([liam.id], everyone).has(liam.id)).toBe(false);
  });

  it("counts every Seat bought and those still open", () => {
    const bossy = scenario.person("Bossy");
    const olivia = scenario.person("Olivia");
    const liam = scenario.person("Liam");
    const course = scenario.course("Node.js");
    const { seats } = scenario.purchase(bossy, course, {
      seatCount: 5,
      seatPrice: 5999,
      at: DAY_1,
    });
    scenario.enroll(olivia, seats[0], DAY_2);
    scenario.enroll(liam, seats[1], DAY_2);

    expect(analytics.seatsBought([bossy.id], everyone).get(bossy.id)).toEqual({
      bought: 5,
      open: 3,
    });
  });

  it("counts a single Seat bought for someone else", () => {
    const bossy = scenario.person("Bossy");
    const course = scenario.course("Node.js");
    scenario.purchase(bossy, course, { seatPrice: 5999, at: DAY_1 });

    expect(analytics.seatsBought([bossy.id], everyone).get(bossy.id)).toEqual({
      bought: 1,
      open: 1,
    });
  });

  it("does not count a Refunded Seat as open", () => {
    const bossy = scenario.person("Bossy");
    const course = scenario.course("Node.js");
    const { seats } = scenario.purchase(bossy, course, {
      seatCount: 2,
      seatPrice: 5999,
      at: DAY_1,
    });
    const request = scenario.requestRefund(seats[0], "Nobody needs it", DAY_2);
    scenario.approveRefund(request, bossy, 5999, DAY_3);

    expect(analytics.seatsBought([bossy.id], everyone).get(bossy.id)).toEqual({
      bought: 2,
      open: 1,
    });
  });

  it("counts only Purchases made since the start of the range", () => {
    const bossy = scenario.person("Bossy");
    const course = scenario.course("Node.js");
    scenario.purchase(bossy, course, {
      seatCount: 2,
      seatPrice: 5999,
      at: DAY_1,
    });
    scenario.purchase(bossy, course, {
      seatCount: 3,
      seatPrice: 5999,
      at: DAY_3,
    });

    expect(
      analytics
        .seatsBought([bossy.id], { instructorId: null, since: DAY_2 })
        .get(bossy.id)
    ).toEqual({ bought: 3, open: 3 });
  });
});
