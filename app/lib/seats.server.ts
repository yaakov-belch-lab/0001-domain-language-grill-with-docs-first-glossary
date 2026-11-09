import crypto from "crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { db as appDb } from "~/db";
import * as schema from "~/db/schema";
import {
  courses,
  enrollments,
  purchases,
  refundRequests,
  RefundRequestStatus,
  seats,
  UnenrollmentInitiator,
  users,
} from "~/db/schema";
import { calculatePppPrice } from "~/lib/ppp";

// The seats module owns the model in ADR 0001: a Purchase is a set of Seats,
// and every Enrollment is made on a Seat. Every answer about a Seat is derived
// from its Seat History; Seat states are never stored. Terms: GLOSSARY.md.

export type SeatsDatabase = BetterSQLite3Database<typeof schema>;
export type Clock = () => Date;

export type SeatState = "open" | "taken" | "refunded";

export type SeatEvent =
  | { type: "purchased"; at: string; buyerId: number }
  | { type: "enrolled"; at: string; enrollmentId: number; studentId: number }
  | {
      type: "unenrolled";
      at: string;
      enrollmentId: number;
      studentId: number;
      initiator: UnenrollmentInitiator | null;
    }
  | {
      type: "refund-requested";
      at: string;
      refundRequestId: number;
      reason: string;
    }
  | {
      type: "refund-approved";
      at: string;
      refundRequestId: number;
      amountRefunded: number | null;
      resolvedByUserId: number | null;
    }
  | {
      type: "refund-declined";
      at: string;
      refundRequestId: number;
      resolvedByUserId: number | null;
    };

export type SeatHistory = {
  seatId: number;
  seatCode: string;
  purchaseId: number;
  courseId: number;
  buyerId: number;
  seatPrice: number;
  pppCountryRestriction: string | null;
  events: SeatEvent[];
};

export type Holder = { id: number; name: string };

export type BuyerSeat = {
  id: number;
  code: string;
  state: SeatState;
  holder: Holder | null;
};

export type BuyerPurchase = {
  id: number;
  courseId: number;
  courseTitle: string;
  purchasedAt: string;
  seatCount: number;
  seatPrice: number;
  amountPaid: number;
  pppCountryRestriction: string | null;
  seats: BuyerSeat[];
};

export type ActiveEnrollment = {
  enrollmentId: number;
  // Null only for an Enrollment no Purchase backs (see enrollments.seatId).
  seatId: number | null;
  enrolledAt: string;
};

/** How many different Students one Seat may serve over its Seat History. */
export const SEAT_REUSE_LIMIT = 1;

/** What a Seat of a course costs a Buyer in a given country, right now. */
export type SeatQuote = {
  coursePrice: number;
  seatPrice: number;
  // The country of purchase when a PPP Discount is given, otherwise null.
  pppCountryRestriction: string | null;
};

export type EnrollmentRefusal =
  | { refusal: "unknown-seat-code" }
  | { refusal: "refunded" }
  | { refusal: "used-by-another-student" }
  | { refusal: "already-enrolled" }
  | { refusal: "country-mismatch"; country: string };

export type EnrollmentEligibility =
  | { eligible: true; seat: SeatHistory }
  // `seat` is null only for an unknown Seat Code.
  | ({ eligible: false; seat: SeatHistory | null } & EnrollmentRefusal);

/** The PPP Restriction Check on a person's access to course content. */
export type PppRestrictionCheck =
  | { blocked: false }
  | {
      blocked: true;
      // The country of purchase the Seat may only be used from.
      pppCountryRestriction: string;
      // Where the person is now, or null when that is unknown.
      country: string | null;
    };

export type Enrolled = {
  ok: true;
  enrollmentId: number;
  seatId: number;
  courseId: number;
};

export type MadePurchase = {
  purchaseId: number;
  seats: { id: number; code: string }[];
};

export function createSeatsModule(
  deps: { db?: SeatsDatabase; clock?: Clock } = {}
) {
  const db = deps.db ?? appDb;
  // The acts (Enroll, Unenroll, Refund Request, …) and the decisions that
  // depend on today's date read the time from here, never from `new Date()`.
  const clock = deps.clock ?? (() => new Date());

  function seatHistories(seatIds: number[]): SeatHistory[] {
    if (seatIds.length === 0) return [];

    const seatRows = db
      .select({
        seatId: seats.id,
        seatCode: seats.code,
        purchaseId: purchases.id,
        courseId: purchases.courseId,
        buyerId: purchases.userId,
        seatPrice: purchases.seatPrice,
        pppCountryRestriction: purchases.pppCountryRestriction,
        purchasedAt: purchases.createdAt,
      })
      .from(seats)
      .innerJoin(purchases, eq(seats.purchaseId, purchases.id))
      .where(inArray(seats.id, seatIds))
      .orderBy(asc(seats.id))
      .all();

    const enrollmentRows = db
      .select()
      .from(enrollments)
      .where(inArray(enrollments.seatId, seatIds))
      .orderBy(asc(enrollments.id))
      .all();

    const requestRows = db
      .select()
      .from(refundRequests)
      .where(inArray(refundRequests.seatId, seatIds))
      .orderBy(asc(refundRequests.id))
      .all();

    return seatRows.map(({ purchasedAt, ...seat }) => {
      // Built in causal order, then sorted by time. The sort is stable, so
      // events at the same moment (a Personal Purchase and its Enrollment)
      // keep that order.
      const events: SeatEvent[] = [
        { type: "purchased", at: purchasedAt, buyerId: seat.buyerId },
      ];

      for (const e of enrollmentRows) {
        if (e.seatId !== seat.seatId) continue;
        events.push({
          type: "enrolled",
          at: e.enrolledAt,
          enrollmentId: e.id,
          studentId: e.userId,
        });
        if (e.endedAt) {
          events.push({
            type: "unenrolled",
            at: e.endedAt,
            enrollmentId: e.id,
            studentId: e.userId,
            initiator: e.unenrollmentInitiator,
          });
        }
      }

      for (const r of requestRows) {
        if (r.seatId !== seat.seatId) continue;
        events.push({
          type: "refund-requested",
          at: r.requestedAt,
          refundRequestId: r.id,
          reason: r.reason,
        });
        const resolvedAt = r.resolvedAt ?? r.requestedAt;
        if (r.status === RefundRequestStatus.Approved) {
          events.push({
            type: "refund-approved",
            at: resolvedAt,
            refundRequestId: r.id,
            amountRefunded: r.amountRefunded,
            resolvedByUserId: r.resolvedByUserId,
          });
        } else if (r.status === RefundRequestStatus.Declined) {
          events.push({
            type: "refund-declined",
            at: resolvedAt,
            refundRequestId: r.id,
            resolvedByUserId: r.resolvedByUserId,
          });
        }
      }

      events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      return { ...seat, events };
    });
  }

  function names(ids: number[]): Map<number, string> {
    if (ids.length === 0) return new Map();
    return new Map(
      db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, ids))
        .all()
        .map((u) => [u.id, u.name])
    );
  }

  function now() {
    return clock().toISOString();
  }

  function quote(courseId: number, country: string | null): SeatQuote {
    const course = db
      .select({ price: courses.price, pppEnabled: courses.pppEnabled })
      .from(courses)
      .where(eq(courses.id, courseId))
      .get();
    if (!course) throw new Error(`No course ${courseId}`);

    const seatPrice = course.pppEnabled
      ? calculatePppPrice(course.price, country)
      : course.price;
    return {
      coursePrice: course.price,
      seatPrice,
      pppCountryRestriction:
        country !== null && seatPrice < course.price ? country : null,
    };
  }

  // Make a Purchase of N Seats. Callers run it inside a transaction.
  function makePurchase(
    tx: SeatsDatabase,
    input: {
      buyerId: number;
      courseId: number;
      seatCount: number;
      country: string | null;
    },
    at: string
  ): MadePurchase {
    if (!Number.isInteger(input.seatCount) || input.seatCount < 1) {
      throw new Error("A Purchase has one or more Seats");
    }
    const { seatPrice, pppCountryRestriction } = quote(
      input.courseId,
      input.country
    );
    const purchase = tx
      .insert(purchases)
      .values({
        userId: input.buyerId,
        courseId: input.courseId,
        seatCount: input.seatCount,
        seatPrice,
        amountPaid: input.seatCount * seatPrice,
        country: input.country,
        pppCountryRestriction,
        createdAt: at,
      })
      .returning({ id: purchases.id })
      .get();
    const made = tx
      .insert(seats)
      .values(
        Array.from({ length: input.seatCount }, () => ({
          purchaseId: purchase.id,
          code: newSeatCode(),
          createdAt: at,
        }))
      )
      .returning({ id: seats.id, code: seats.code })
      .all();
    return { purchaseId: purchase.id, seats: made };
  }

  function activeEnrollment(
    studentId: number,
    courseId: number
  ): ActiveEnrollment | undefined {
    return db
      .select({
        enrollmentId: enrollments.id,
        seatId: enrollments.seatId,
        enrolledAt: enrollments.enrolledAt,
      })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, studentId),
          eq(enrollments.courseId, courseId),
          isNull(enrollments.endedAt)
        )
      )
      .get();
  }

  function enrollmentEligibility(input: {
    studentId: number;
    seatCode: string;
    country: string | null;
  }): EnrollmentEligibility {
    const seat = db
      .select({ id: seats.id })
      .from(seats)
      .where(eq(seats.code, input.seatCode))
      .get();
    const history = seat && seatHistories([seat.id])[0];
    if (!history) {
      return { eligible: false, seat: null, refusal: "unknown-seat-code" };
    }

    const refusal = decideEnrollmentEligibility(history, {
      studentId: input.studentId,
      country: input.country,
      alreadyEnrolled: !!activeEnrollment(input.studentId, history.courseId),
    });
    return refusal
      ? { eligible: false, seat: history, ...refusal }
      : { eligible: true, seat: history };
  }

  function pppRestrictionCheck(input: {
    studentId: number;
    courseId: number;
    country: string | null;
  }): PppRestrictionCheck {
    const seatId = activeEnrollment(input.studentId, input.courseId)?.seatId;
    if (seatId == null) return { blocked: false };
    const purchase = db
      .select({ pppCountryRestriction: purchases.pppCountryRestriction })
      .from(seats)
      .innerJoin(purchases, eq(seats.purchaseId, purchases.id))
      .where(eq(seats.id, seatId))
      .get();
    const restriction = blockingRestriction(
      purchase?.pppCountryRestriction ?? null,
      input.country
    );
    return restriction === null
      ? { blocked: false }
      : {
          blocked: true,
          pppCountryRestriction: restriction,
          country: input.country,
        };
  }

  function enroll(
    tx: SeatsDatabase,
    studentId: number,
    seat: { id: number; courseId: number },
    at: string
  ) {
    return tx
      .insert(enrollments)
      .values({
        userId: studentId,
        courseId: seat.courseId,
        seatId: seat.id,
        enrolledAt: at,
      })
      .returning({ id: enrollments.id })
      .get();
  }

  return {
    clock,

    // ─── Acts ───

    /** A Buyer makes a Purchase of N Seats. The Buyer is not enrolled. */
    buySeats(input: {
      buyerId: number;
      courseId: number;
      seatCount: number;
      country: string | null;
    }): MadePurchase {
      return db.transaction((tx) => makePurchase(tx, input, now()));
    },

    /** Buy one Seat and enroll the Buyer on it at once. */
    personalPurchase(input: {
      buyerId: number;
      courseId: number;
      country: string | null;
    }):
      | (Enrolled & { purchaseId: number })
      | ({ ok: false } & EnrollmentRefusal) {
      return db.transaction((tx) => {
        if (activeEnrollment(input.buyerId, input.courseId)) {
          return { ok: false, refusal: "already-enrolled" } as const;
        }
        const at = now();
        const made = makePurchase(tx, { ...input, seatCount: 1 }, at);
        const [seat] = made.seats;
        const enrollment = enroll(
          tx,
          input.buyerId,
          { id: seat.id, courseId: input.courseId },
          at
        );
        return {
          ok: true,
          enrollmentId: enrollment.id,
          seatId: seat.id,
          courseId: input.courseId,
          purchaseId: made.purchaseId,
        } as const;
      });
    },

    /** A Student Enrolls on the Seat a Seat Code identifies. */
    enrollWithSeatCode(input: {
      studentId: number;
      seatCode: string;
      country: string | null;
    }): Enrolled | ({ ok: false } & EnrollmentRefusal) {
      return db.transaction((tx) => {
        const eligibility = enrollmentEligibility(input);
        if (!eligibility.eligible) {
          const { eligible: _, seat: __, ...refusal } = eligibility;
          return { ok: false, ...refusal };
        }
        const { seat } = eligibility;
        const enrollment = enroll(
          tx,
          input.studentId,
          { id: seat.seatId, courseId: seat.courseId },
          now()
        );
        return {
          ok: true,
          enrollmentId: enrollment.id,
          seatId: seat.seatId,
          courseId: seat.courseId,
        };
      });
    },

    // ─── Questions ───

    /** The Seat Price and PPP Country Restriction a Purchase would get now. */
    quote,

    /** Whether a person may Enroll now on the Seat a Seat Code identifies. */
    enrollmentEligibility,

    /** A Seat's Seat History, or undefined for an unknown Seat. */
    seatHistory(seatId: number): SeatHistory | undefined {
      return seatHistories([seatId])[0];
    },

    /** A Buyer's Purchases, oldest first, with each Seat's state and holder. */
    buyerPurchases(buyerId: number): BuyerPurchase[] {
      const purchaseRows = db
        .select({
          id: purchases.id,
          courseId: purchases.courseId,
          courseTitle: courses.title,
          purchasedAt: purchases.createdAt,
          seatCount: purchases.seatCount,
          seatPrice: purchases.seatPrice,
          amountPaid: purchases.amountPaid,
          pppCountryRestriction: purchases.pppCountryRestriction,
        })
        .from(purchases)
        .innerJoin(courses, eq(purchases.courseId, courses.id))
        .where(eq(purchases.userId, buyerId))
        .orderBy(asc(purchases.createdAt), asc(purchases.id))
        .all();
      if (purchaseRows.length === 0) return [];

      const seatIds = db
        .select({ id: seats.id })
        .from(seats)
        .where(
          inArray(
            seats.purchaseId,
            purchaseRows.map((p) => p.id)
          )
        )
        .all()
        .map((s) => s.id);
      const histories = seatHistories(seatIds);

      const holderNames = names(
        histories.flatMap((h) => seatHolderId(h) ?? [])
      );
      const holder = (h: SeatHistory): Holder | null => {
        const id = seatHolderId(h);
        if (id === null) return null;
        const name = holderNames.get(id);
        return name === undefined ? null : { id, name };
      };

      return purchaseRows.map((purchase) => ({
        ...purchase,
        seats: histories
          .filter((h) => h.purchaseId === purchase.id)
          .map((h) => ({
            id: h.seatId,
            code: h.seatCode,
            state: seatState(h),
            holder: holder(h),
          })),
      }));
    },

    /** A person's active Enrollment in a course, and its Seat. */
    activeEnrollment,

    /**
     * The PPP Restriction Check on course content: whether the PPP Country
     * Restriction of the Purchase behind the person's active Enrollment
     * blocks them in their current country.
     */
    pppRestrictionCheck,
  };
}

// ─── Derived from a Seat History ───

/** The Student whose Enrollment on the Seat is active, if any. */
export function seatHolderId(history: SeatHistory): number | null {
  const active = new Map<number, number>();
  for (const event of history.events) {
    if (event.type === "enrolled") {
      active.set(event.enrollmentId, event.studentId);
    } else if (event.type === "unenrolled") {
      active.delete(event.enrollmentId);
    }
  }
  const [holder] = active.values();
  return holder ?? null;
}

/** Open, taken or refunded. */
export function seatState(history: SeatHistory): SeatState {
  if (history.events.some((e) => e.type === "refund-approved")) {
    return "refunded";
  }
  return seatHolderId(history) === null ? "open" : "taken";
}

/**
 * Enrollment Eligibility: why a Student may not Enroll on a Seat now, or
 * null when they may.
 */
export function decideEnrollmentEligibility(
  history: SeatHistory,
  person: {
    studentId: number;
    country: string | null;
    alreadyEnrolled: boolean;
  }
): EnrollmentRefusal | null {
  if (seatState(history) === "refunded") return { refusal: "refunded" };

  const holder = seatHolderId(history);
  const students = new Set(
    history.events.flatMap((e) => (e.type === "enrolled" ? [e.studentId] : []))
  );
  students.add(person.studentId);
  if (
    (holder !== null && holder !== person.studentId) ||
    students.size > SEAT_REUSE_LIMIT
  ) {
    return { refusal: "used-by-another-student" };
  }

  if (person.alreadyEnrolled) return { refusal: "already-enrolled" };

  const restriction = blockingRestriction(
    history.pppCountryRestriction,
    person.country
  );
  if (restriction !== null) {
    return { refusal: "country-mismatch", country: restriction };
  }

  return null;
}

/**
 * The PPP Restriction Check, the same wherever a Seat is enrolled on or its
 * content is accessed. It applies only to Purchases with a PPP Country
 * Restriction (#8). An unknown country cannot be shown to be the country of
 * purchase, so it fails. Returns the PPP Country Restriction that blocks
 * the person, or null when they pass.
 */
function blockingRestriction(
  pppCountryRestriction: string | null,
  country: string | null
): string | null {
  return pppCountryRestriction !== null && country !== pppCountryRestriction
    ? pppCountryRestriction
    : null;
}

function newSeatCode() {
  return crypto.randomBytes(12).toString("base64url");
}
