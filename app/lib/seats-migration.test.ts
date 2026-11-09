import { describe, it, expect, beforeAll } from "vitest";
import {
  applyRemainingMigrations,
  createTestDb,
  type TestDb,
} from "~/test/setup";
import { createSeatsModule } from "./seats.server";

// 0010 adds the Seat tables and columns; 0011 fills them from teams, coupons
// and refunds; 0012 drops those old tables. Rows are written in the shape they
// had before 0010, then all three run and the result is read back through the
// seats module.
const FIRST_SEATS_MIGRATION = "0010";

const T = "2026-10-01T10:00:00.000Z";

let db: TestDb;
let seats: ReturnType<typeof createSeatsModule>;
let ids: Record<string, number>;

beforeAll(() => {
  db = createTestDb({ stopBefore: FIRST_SEATS_MIGRATION });
  const sql = db.$client;

  function insert(statement: string, ...params: unknown[]) {
    return Number(sql.prepare(statement).run(...params).lastInsertRowid);
  }
  const user = (name: string) =>
    insert(
      "INSERT INTO users (name, email, role, created_at) VALUES (?, ?, 'student', ?)",
      name,
      `${name}@example.com`,
      T
    );
  const course = (slug: string, price: number) =>
    insert(
      `INSERT INTO courses (title, slug, description, sales_copy, instructor_id, category_id, status, price, created_at, updated_at)
       VALUES (?, ?, 'd', 's', ?, ?, 'published', ?, ?, ?)`,
      slug,
      slug,
      owner,
      category,
      price,
      T,
      T
    );
  const purchase = (
    userId: number,
    courseId: number,
    amountPaid: number,
    country: string | null
  ) =>
    insert(
      "INSERT INTO purchases (user_id, course_id, amount_paid, country, created_at) VALUES (?, ?, ?, ?, ?)",
      userId,
      courseId,
      amountPaid,
      country,
      T
    );
  const enroll = (userId: number, courseId: number) =>
    insert(
      "INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES (?, ?, ?)",
      userId,
      courseId,
      T
    );

  const owner = insert(
    "INSERT INTO users (name, email, role, created_at) VALUES ('Owner', 'owner@example.com', 'instructor', ?)",
    T
  );
  const category = insert(
    "INSERT INTO categories (name, slug) VALUES ('Programming', 'programming')"
  );
  const typescript = course("typescript", 7900);
  const node = course("node", 5999);
  const free = course("free", 0);

  const emma = user("Emma");
  const james = user("James");
  const bossy = user("Bossy");
  const olivia = user("Olivia");
  const sophia = user("Sophia");

  // A Personal Purchase at the full Course Price.
  const emmaPurchase = purchase(emma, typescript, 7900, "US");
  const emmaEnrollment = enroll(emma, typescript);
  insert(
    "INSERT INTO refunds (purchase_id, status, reason, requested_at) VALUES (?, 'requested', 'Not what I expected.', ?)",
    emmaPurchase,
    T
  );

  // A Personal Purchase with a PPP Discount.
  purchase(james, typescript, 2500, "IN");
  enroll(james, typescript);

  // A team Purchase of three coupons, one redeemed.
  const teamPurchase = purchase(bossy, node, 5999 * 3, "US");
  const team = insert("INSERT INTO teams (created_at) VALUES (?)", T);
  insert(
    "INSERT INTO team_members (team_id, user_id, role, created_at) VALUES (?, ?, 'admin', ?)",
    team,
    bossy,
    T
  );
  for (const code of ["TEAM-A", "TEAM-B", "TEAM-C"]) {
    insert(
      `INSERT INTO coupons (team_id, course_id, code, purchase_id, redeemed_by_user_id, redeemed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      team,
      node,
      code,
      teamPurchase,
      code === "TEAM-B" ? olivia : null,
      code === "TEAM-B" ? T : null,
      T
    );
  }
  const oliviaEnrollment = enroll(olivia, node);

  // An Enrollment no Purchase backs.
  enroll(sophia, free);

  applyRemainingMigrations(db);
  seats = createSeatsModule({ db });
  ids = {
    emma,
    emmaEnrollment,
    james,
    bossy,
    olivia,
    oliviaEnrollment,
    sophia,
    node,
    free,
  };
});

describe("filling the Seat model from today's data", () => {
  it("gives a Personal Purchase one Seat held by the Buyer's Enrollment", () => {
    const [purchase] = seats.buyerPurchases(ids.emma);

    expect(purchase).toMatchObject({
      seatCount: 1,
      seatPrice: 7900,
      amountPaid: 7900,
      // Full price: the Seat may be used from anywhere.
      pppCountryRestriction: null,
    });
    expect(purchase.seats).toEqual([
      expect.objectContaining({
        state: "taken",
        holder: { id: ids.emma, name: "Emma" },
      }),
    ]);
  });

  it("gives a Purchase with a PPP Discount a PPP Country Restriction", () => {
    const [purchase] = seats.buyerPurchases(ids.james);

    expect(purchase).toMatchObject({
      seatPrice: 2500,
      pppCountryRestriction: "IN",
    });
  });

  it("turns each coupon into a Seat with the same code, held by whoever redeemed it", () => {
    const [purchase] = seats.buyerPurchases(ids.bossy);

    expect(purchase).toMatchObject({
      seatCount: 3,
      seatPrice: 5999,
      amountPaid: 5999 * 3,
      pppCountryRestriction: null,
    });
    expect(
      purchase.seats.map(({ code, state, holder }) => ({ code, state, holder }))
    ).toEqual([
      { code: "TEAM-A", state: "open", holder: null },
      {
        code: "TEAM-B",
        state: "taken",
        holder: { id: ids.olivia, name: "Olivia" },
      },
      { code: "TEAM-C", state: "open", holder: null },
    ]);
    expect(seats.activeEnrollment(ids.olivia, ids.node)).toMatchObject({
      enrollmentId: ids.oliviaEnrollment,
      seatId: purchase.seats[1].id,
    });
  });

  it("moves a refund to a Pending Refund Request for the Seat of its Purchase", () => {
    const [purchase] = seats.buyerPurchases(ids.emma);
    const history = seats.seatHistory(purchase.seats[0].id);

    expect(history?.events).toContainEqual(
      expect.objectContaining({
        type: "refund-requested",
        reason: "Not what I expected.",
      })
    );
    // Still Pending: no decision was ever recorded.
    expect(history?.events.map((e) => e.type)).not.toContain("refund-approved");
    expect(history?.events.map((e) => e.type)).not.toContain("refund-declined");
  });

  it("leaves an Enrollment no Purchase backs without a Seat", () => {
    expect(seats.activeEnrollment(ids.sophia, ids.free)).toMatchObject({
      seatId: null,
    });
  });
});
