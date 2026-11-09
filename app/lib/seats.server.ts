import crypto from "crypto";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";
import { db as appDb } from "~/db";
import * as schema from "~/db/schema";
import {
  courses,
  enrollments,
  lessonProgress,
  LessonProgressStatus,
  lessons,
  modules,
  purchases,
  refundRequests,
  RefundRequestStatus,
  seats,
  UnenrollmentInitiator,
  UserRole,
  users,
  videoWatchEvents,
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

/** One Enrollment on a Seat, as its Buyer sees it in the Seat History. */
export type SeatEnrollment = Omit<EnrollmentOnSeat, "studentId"> & {
  student: Holder;
};

export type BuyerSeat = {
  id: number;
  code: string;
  state: SeatState;
  holder: Holder | null;
  // Every Enrollment on the Seat, oldest first.
  enrollments: SeatEnrollment[];
  // What a Refund Request for the Seat would offer now, or null when Refund
  // Eligibility refuses one.
  refundOffer: RefundOffer | null;
  refundPending: boolean;
  // What its Refund Approval gave back, or null while it is not refunded.
  amountRefunded: number | null;
};

export type BuyerPurchase = {
  id: number;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
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

export type Unenrolled = {
  ok: true;
  enrollmentId: number;
  // Null only for an Enrollment no Purchase backs (see enrollments.seatId).
  seatId: number | null;
};

export type UnenrollmentRefusal = { refusal: "not-enrolled" };

export type MadePurchase = {
  purchaseId: number;
  seats: { id: number; code: string }[];
};

// ─── Refund rules (docs/current-rules.md) ───

/** The Refund Window: calendar days after the day of purchase, inclusive. */
export const REFUND_WINDOW_DAYS = 14;
/** Usage Limits: a Seat watched this long, or completed this far, is not refundable. */
export const WATCH_LIMIT_SECONDS = 2 * 60 * 60;
export const COMPLETION_LIMIT = 0.5;
/** The length of a Refund Reason, in characters. */
export const REFUND_REASON_MIN_LENGTH = 10;
export const REFUND_REASON_MAX_LENGTH = 1000;

/** What a Refund Request for a Seat offers, while Refund Eligibility allows one. */
export type RefundOffer = {
  refundAmount: number;
  // The last calendar day of the Refund Window, as YYYY-MM-DD.
  lastDayOfRefundWindow: string;
};

export type RefundRefusal =
  | { refusal: "unknown-seat" }
  | { refusal: "not-buyer" }
  | { refusal: "refunded" }
  | { refusal: "pending-refund-request" }
  | { refusal: "taken-by-another-student" }
  | { refusal: "refund-window-closed" }
  | { refusal: "watch-limit-reached" }
  | { refusal: "completion-limit-reached" };

export type RefundEligibility =
  | ({ eligible: true; seatId: number; courseId: number } & RefundOffer)
  | ({ eligible: false } & RefundRefusal);

export type RefundRequested = {
  ok: true;
  refundRequestId: number;
  seatId: number;
  courseId: number;
  refundAmount: number;
};

export type RefundRequestRefusal =
  | RefundRefusal
  | { refusal: "refund-reason-length" };

export type PendingRefundRequest = {
  id: number;
  seatId: number;
  courseTitle: string;
  courseSlug: string;
  refundAmount: number;
  reason: string;
  requestedAt: string;
};

/** A Pending Refund Request as the person deciding it sees it. */
export type RefundDecision = {
  id: number;
  seatId: number;
  courseId: number;
  courseTitle: string;
  courseSlug: string;
  buyer: Holder;
  // The Student whose Enrollment on the Seat is active, if any.
  holder: Holder | null;
  refundAmount: number;
  reason: string;
  requestedAt: string;
  seatUsage: SeatUsage;
};

/** A Buyer's Refund Request that has been approved or declined. */
export type DecidedRefundRequest = {
  id: number;
  seatId: number;
  courseTitle: string;
  courseSlug: string;
  status: RefundRequestStatus.Approved | RefundRequestStatus.Declined;
  amountRefunded: number | null;
  decidedAt: string;
};

export type RefundDecisionRefusal =
  | { refusal: "unknown-refund-request" }
  | { refusal: "not-decider" }
  | { refusal: "not-pending" };

export type RefundDeclined = {
  ok: true;
  refundRequestId: number;
  seatId: number;
  courseId: number;
  buyerId: number;
};

export type RefundApproved = RefundDeclined & { amountRefunded: number };

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

  // Every Unenrollment goes through here, whoever its Initiator is.
  function endEnrollment(
    tx: SeatsDatabase,
    enrollmentId: number,
    initiator: UnenrollmentInitiator,
    at: string
  ) {
    tx.update(enrollments)
      .set({ endedAt: at, unenrollmentInitiator: initiator })
      .where(and(eq(enrollments.id, enrollmentId), isNull(enrollments.endedAt)))
      .run();
  }

  /**
   * Seat Usage: what was watched and completed while enrolled on the Seat,
   * summed over every Enrollment in its Seat History.
   */
  function seatUsage(history: SeatHistory): SeatUsage {
    const none = { watchedSeconds: 0, completion: 0 };
    const periods = seatEnrollments(history);
    if (periods.length === 0) return none;
    const lessonIds = db
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(modules, eq(lessons.moduleId, modules.id))
      .where(eq(modules.courseId, history.courseId))
      .all()
      .map((l) => l.id);
    if (lessonIds.length === 0) return none;

    // Whether a row of `userId` at time `at` falls inside an Enrollment.
    const whileEnrolled = (
      userId: SQLiteColumn,
      at: SQLiteColumn
    ): SQL | undefined =>
      or(
        ...periods.map((p) =>
          and(
            eq(userId, p.studentId),
            gte(at, p.enrolledAt),
            p.endedAt === null ? undefined : lte(at, p.endedAt)
          )
        )
      );

    // Watched time is the furthest position reached in each lesson.
    const furthest = db
      .select({
        furthest: sql<number>`max(${videoWatchEvents.positionSeconds})`,
      })
      .from(videoWatchEvents)
      .where(
        and(
          inArray(videoWatchEvents.lessonId, lessonIds),
          whileEnrolled(videoWatchEvents.userId, videoWatchEvents.createdAt)
        )
      )
      .groupBy(videoWatchEvents.userId, videoWatchEvents.lessonId)
      .all();

    const completed = db
      .select({
        count: sql<number>`count(distinct ${lessonProgress.lessonId})`,
      })
      .from(lessonProgress)
      .where(
        and(
          inArray(lessonProgress.lessonId, lessonIds),
          eq(lessonProgress.status, LessonProgressStatus.Completed),
          or(
            whileEnrolled(lessonProgress.userId, lessonProgress.completedAt),
            // A completed lesson with no time cannot be placed outside the
            // Enrollments, so it counts.
            and(
              inArray(
                lessonProgress.userId,
                periods.map((p) => p.studentId)
              ),
              isNull(lessonProgress.completedAt)
            )
          )
        )
      )
      .get();

    return {
      watchedSeconds: furthest.reduce((sum, row) => sum + row.furthest, 0),
      completion: (completed?.count ?? 0) / lessonIds.length,
    };
  }

  function refundEligibilityOf(
    history: SeatHistory,
    buyerId: number
  ): RefundEligibility {
    const refusal = decideRefundEligibility(history, {
      buyerId,
      now: clock(),
      usage: () => seatUsage(history),
    });
    return refusal
      ? { eligible: false, ...refusal }
      : {
          eligible: true,
          seatId: history.seatId,
          courseId: history.courseId,
          ...refundOffer(history),
        };
  }

  function refundEligibility(input: {
    buyerId: number;
    seatId: number;
  }): RefundEligibility {
    const history = seatHistories([input.seatId])[0];
    if (!history) return { eligible: false, refusal: "unknown-seat" };
    return refundEligibilityOf(history, input.buyerId);
  }

  function isAdmin(personId: number): boolean {
    const person = db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, personId))
      .get();
    return person?.role === UserRole.Admin;
  }

  // Who may decide Refund Requests for a course: an Admin for any course, the
  // Course Owner for their own.
  function mayDecideFor(personId: number, courseId: number): boolean {
    if (isAdmin(personId)) return true;
    const course = db
      .select({ ownerId: courses.instructorId })
      .from(courses)
      .where(eq(courses.id, courseId))
      .get();
    return course?.ownerId === personId;
  }

  // A Refund Approval or Refund Decline. Both are refused unless the person
  // may decide for the Seat's course and the request is still Pending.
  function decideRefund<T>(
    input: { deciderId: number; refundRequestId: number },
    record: (tx: SeatsDatabase, history: SeatHistory, at: string) => T
  ): T | ({ ok: false } & RefundDecisionRefusal) {
    return db.transaction((tx) => {
      const request = tx
        .select({ seatId: refundRequests.seatId })
        .from(refundRequests)
        .where(eq(refundRequests.id, input.refundRequestId))
        .get();
      const history = request && seatHistories([request.seatId])[0];
      if (!history) {
        return { ok: false, refusal: "unknown-refund-request" } as const;
      }
      if (!mayDecideFor(input.deciderId, history.courseId)) {
        return { ok: false, refusal: "not-decider" } as const;
      }
      if (pendingRefundRequestId(history) !== input.refundRequestId) {
        return { ok: false, refusal: "not-pending" } as const;
      }
      return record(tx, history, now());
    });
  }

  function resolve(
    tx: SeatsDatabase,
    input: { deciderId: number; refundRequestId: number },
    status: RefundRequestStatus.Approved | RefundRequestStatus.Declined,
    amountRefunded: number | null,
    at: string
  ) {
    tx.update(refundRequests)
      .set({
        status,
        amountRefunded,
        resolvedAt: at,
        resolvedByUserId: input.deciderId,
      })
      .where(
        and(
          eq(refundRequests.id, input.refundRequestId),
          eq(refundRequests.status, RefundRequestStatus.Pending)
        )
      )
      .run();
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

    /**
     * A Student Unenrolls from a course: their active Enrollment ends, with
     * the Student as Initiator. Its Seat becomes open again.
     */
    unenroll(input: {
      studentId: number;
      courseId: number;
    }): Unenrolled | ({ ok: false } & UnenrollmentRefusal) {
      return db.transaction((tx) => {
        const active = activeEnrollment(input.studentId, input.courseId);
        if (!active) return { ok: false, refusal: "not-enrolled" } as const;
        endEnrollment(
          tx,
          active.enrollmentId,
          UnenrollmentInitiator.Student,
          now()
        );
        return {
          ok: true,
          enrollmentId: active.enrollmentId,
          seatId: active.seatId,
        } as const;
      });
    },

    /**
     * The Buyer makes a Refund Request for one Seat, with a Refund Reason.
     * It is Pending until decided; nothing else changes until then.
     */
    requestRefund(input: {
      buyerId: number;
      seatId: number;
      reason: string;
    }): RefundRequested | ({ ok: false } & RefundRequestRefusal) {
      const reason = input.reason.trim();
      if (
        reason.length < REFUND_REASON_MIN_LENGTH ||
        reason.length > REFUND_REASON_MAX_LENGTH
      ) {
        return { ok: false, refusal: "refund-reason-length" };
      }
      return db.transaction((tx) => {
        const eligibility = refundEligibility(input);
        if (!eligibility.eligible) {
          const { eligible: _, ...refusal } = eligibility;
          return { ok: false, ...refusal };
        }
        const request = tx
          .insert(refundRequests)
          .values({ seatId: input.seatId, reason, requestedAt: now() })
          .returning({ id: refundRequests.id })
          .get();
        return {
          ok: true,
          refundRequestId: request.id,
          seatId: eligibility.seatId,
          courseId: eligibility.courseId,
          refundAmount: eligibility.refundAmount,
        } as const;
      });
    },

    /**
     * An Admin or the Course Owner approves a Pending Refund Request. The
     * Amount Refunded is the Refund Amount, the Seat becomes refunded, and any
     * active Enrollment on it ends with the system as Initiator. No money
     * moves: there is no payment provider, so this only records the refund.
     */
    approveRefund(input: {
      deciderId: number;
      refundRequestId: number;
    }): RefundApproved | ({ ok: false } & RefundDecisionRefusal) {
      return decideRefund(input, (tx, history, at) => {
        const { refundAmount } = refundOffer(history);
        const active = tx
          .select({ id: enrollments.id })
          .from(enrollments)
          .where(
            and(
              eq(enrollments.seatId, history.seatId),
              isNull(enrollments.endedAt)
            )
          )
          .all();
        for (const enrollment of active) {
          endEnrollment(tx, enrollment.id, UnenrollmentInitiator.System, at);
        }
        resolve(tx, input, RefundRequestStatus.Approved, refundAmount, at);
        return {
          ok: true,
          refundRequestId: input.refundRequestId,
          seatId: history.seatId,
          courseId: history.courseId,
          buyerId: history.buyerId,
          amountRefunded: refundAmount,
        } as const;
      });
    },

    /** An Admin or the Course Owner declines a Pending Refund Request. Nothing else changes. */
    declineRefund(input: {
      deciderId: number;
      refundRequestId: number;
    }): RefundDeclined | ({ ok: false } & RefundDecisionRefusal) {
      return decideRefund(input, (tx, history, at) => {
        resolve(tx, input, RefundRequestStatus.Declined, null, at);
        return {
          ok: true,
          refundRequestId: input.refundRequestId,
          seatId: history.seatId,
          courseId: history.courseId,
          buyerId: history.buyerId,
        } as const;
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
          courseSlug: courses.slug,
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

      const studentNames = names([
        ...new Set(
          histories.flatMap((h) =>
            h.events.flatMap((e) => (e.type === "enrolled" ? [e.studentId] : []))
          )
        ),
      ]);
      const person = (id: number): Holder => ({
        id,
        name: studentNames.get(id) ?? "Unknown",
      });
      const holder = (h: SeatHistory): Holder | null => {
        const id = seatHolderId(h);
        return id === null ? null : person(id);
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
            enrollments: seatEnrollments(h).map(({ studentId, ...e }) => ({
              student: person(studentId),
              ...e,
            })),
            refundOffer: offerOf(refundEligibilityOf(h, buyerId)),
            refundPending: pendingRefundRequestId(h) !== null,
            amountRefunded: amountRefunded(h),
          })),
      }));
    },

    /** Whether the Buyer may make a Refund Request for a Seat now, and for how much. */
    refundEligibility,

    /**
     * The Cancellation a Student is offered: Refund Eligibility of the Seat
     * they are enrolled on, when that Seat is their own Personal Purchase.
     * Null when there is none to offer.
     */
    cancellation(input: {
      studentId: number;
      courseId: number;
    }): Extract<RefundEligibility, { eligible: true }> | null {
      const seatId = activeEnrollment(input.studentId, input.courseId)?.seatId;
      if (seatId == null) return null;
      const purchase = db
        .select({ buyerId: purchases.userId, seatCount: purchases.seatCount })
        .from(seats)
        .innerJoin(purchases, eq(seats.purchaseId, purchases.id))
        .where(eq(seats.id, seatId))
        .get();
      const isPersonalPurchase =
        purchase?.buyerId === input.studentId && purchase.seatCount === 1;
      if (!isPersonalPurchase) return null;
      const eligibility = refundEligibility({
        buyerId: input.studentId,
        seatId,
      });
      return eligibility.eligible ? eligibility : null;
    },

    /** A Buyer's Pending Refund Requests, oldest first, with their Refund Amount. */
    pendingRefundRequests(buyerId: number): PendingRefundRequest[] {
      return db
        .select({
          id: refundRequests.id,
          seatId: refundRequests.seatId,
          courseTitle: courses.title,
          courseSlug: courses.slug,
          // The Refund Amount is the Seat Price.
          refundAmount: purchases.seatPrice,
          reason: refundRequests.reason,
          requestedAt: refundRequests.requestedAt,
        })
        .from(refundRequests)
        .innerJoin(seats, eq(refundRequests.seatId, seats.id))
        .innerJoin(purchases, eq(seats.purchaseId, purchases.id))
        .innerJoin(courses, eq(purchases.courseId, courses.id))
        .where(
          and(
            eq(purchases.userId, buyerId),
            eq(refundRequests.status, RefundRequestStatus.Pending)
          )
        )
        .orderBy(asc(refundRequests.requestedAt), asc(refundRequests.id))
        .all();
    },

    /**
     * Whether a person may see the refund decisions page: an Admin, or the
     * Course Owner of at least one course.
     */
    mayDecideRefunds(personId: number): boolean {
      if (isAdmin(personId)) return true;
      return !!db
        .select({ id: courses.id })
        .from(courses)
        .where(eq(courses.instructorId, personId))
        .limit(1)
        .get();
    },

    /**
     * The Pending Refund Requests a person may decide, oldest first: all of
     * them for an Admin, those for their own courses for a Course Owner.
     */
    refundDecisions(deciderId: number): RefundDecision[] {
      const deciderIsAdmin = isAdmin(deciderId);
      const rows = db
        .select({
          id: refundRequests.id,
          seatId: refundRequests.seatId,
          courseId: courses.id,
          courseTitle: courses.title,
          courseSlug: courses.slug,
          buyerId: purchases.userId,
          reason: refundRequests.reason,
          requestedAt: refundRequests.requestedAt,
        })
        .from(refundRequests)
        .innerJoin(seats, eq(refundRequests.seatId, seats.id))
        .innerJoin(purchases, eq(seats.purchaseId, purchases.id))
        .innerJoin(courses, eq(purchases.courseId, courses.id))
        .where(
          and(
            eq(refundRequests.status, RefundRequestStatus.Pending),
            deciderIsAdmin ? undefined : eq(courses.instructorId, deciderId)
          )
        )
        .orderBy(asc(refundRequests.requestedAt), asc(refundRequests.id))
        .all();
      if (rows.length === 0) return [];

      const histories = new Map(
        seatHistories(rows.map((r) => r.seatId)).map((h) => [h.seatId, h])
      );
      const holderIds = new Map(
        [...histories.values()].map((h) => [h.seatId, seatHolderId(h)])
      );
      const peopleNames = names([
        ...new Set([
          ...rows.map((r) => r.buyerId),
          ...[...holderIds.values()].filter((id) => id !== null),
        ]),
      ]);
      const person = (id: number): Holder => ({
        id,
        name: peopleNames.get(id) ?? "Unknown",
      });

      return rows.flatMap(({ buyerId, ...row }) => {
        const history = histories.get(row.seatId);
        if (!history) return [];
        const holderId = holderIds.get(row.seatId) ?? null;
        return [
          {
            ...row,
            buyer: person(buyerId),
            holder: holderId === null ? null : person(holderId),
            refundAmount: refundOffer(history).refundAmount,
            seatUsage: seatUsage(history),
          },
        ];
      });
    },

    /** A Buyer's decided Refund Requests, most recently decided first. */
    decidedRefundRequests(buyerId: number): DecidedRefundRequest[] {
      return db
        .select({
          id: refundRequests.id,
          seatId: refundRequests.seatId,
          courseTitle: courses.title,
          courseSlug: courses.slug,
          status: refundRequests.status,
          amountRefunded: refundRequests.amountRefunded,
          resolvedAt: refundRequests.resolvedAt,
          requestedAt: refundRequests.requestedAt,
        })
        .from(refundRequests)
        .innerJoin(seats, eq(refundRequests.seatId, seats.id))
        .innerJoin(purchases, eq(seats.purchaseId, purchases.id))
        .innerJoin(courses, eq(purchases.courseId, courses.id))
        .where(
          and(
            eq(purchases.userId, buyerId),
            ne(refundRequests.status, RefundRequestStatus.Pending)
          )
        )
        .orderBy(desc(refundRequests.resolvedAt), desc(refundRequests.id))
        .all()
        .flatMap(({ status, resolvedAt, requestedAt, ...row }) =>
          status === RefundRequestStatus.Pending
            ? []
            : [{ ...row, status, decidedAt: resolvedAt ?? requestedAt }]
        );
    },

    /** Whether a person has made at least one Purchase. */
    isBuyer(personId: number): boolean {
      return !!db
        .select({ id: purchases.id })
        .from(purchases)
        .where(eq(purchases.userId, personId))
        .limit(1)
        .get();
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
  const active = seatEnrollments(history).find((e) => e.endedAt === null);
  return active?.studentId ?? null;
}

/** One Enrollment in a Seat History: who, when, and how it ended. */
export type EnrollmentOnSeat = {
  studentId: number;
  enrolledAt: string;
  // Null while the Enrollment is active.
  endedAt: string | null;
  initiator: UnenrollmentInitiator | null;
};

/** Every Enrollment on the Seat, oldest first. */
export function seatEnrollments(history: SeatHistory): EnrollmentOnSeat[] {
  const byId = new Map<number, EnrollmentOnSeat>();
  for (const event of history.events) {
    if (event.type === "enrolled") {
      byId.set(event.enrollmentId, {
        studentId: event.studentId,
        enrolledAt: event.at,
        endedAt: null,
        initiator: null,
      });
    } else if (event.type === "unenrolled") {
      const enrollment = byId.get(event.enrollmentId);
      if (enrollment) {
        enrollment.endedAt = event.at;
        enrollment.initiator = event.initiator;
      }
    }
  }
  return [...byId.values()];
}

/** Open, taken or refunded. */
export function seatState(history: SeatHistory): SeatState {
  if (history.events.some((e) => e.type === "refund-approved")) {
    return "refunded";
  }
  return seatHolderId(history) === null ? "open" : "taken";
}

/** What the Seat's Refund Approval gave back, or null while it is not refunded. */
export function amountRefunded(history: SeatHistory): number | null {
  const approval = history.events.find((e) => e.type === "refund-approved");
  return approval?.type === "refund-approved"
    ? approval.amountRefunded
    : null;
}

/** The Pending Refund Request for the Seat, if any. */
export function pendingRefundRequestId(history: SeatHistory): number | null {
  const decided = new Set(
    history.events.flatMap((e) =>
      e.type === "refund-approved" || e.type === "refund-declined"
        ? [e.refundRequestId]
        : []
    )
  );
  const pending = history.events.find(
    (e) => e.type === "refund-requested" && !decided.has(e.refundRequestId)
  );
  return pending?.type === "refund-requested" ? pending.refundRequestId : null;
}

/** Watched time and completion used on a Seat. */
export type SeatUsage = {
  // The furthest video position reached in each lesson, summed.
  watchedSeconds: number;
  // The share of the course's lessons completed, from 0 to 1.
  completion: number;
};

/**
 * Refund Eligibility: why the Buyer may not make a Refund Request for a Seat
 * now, or null when they may. Seat Usage is asked for only when every other
 * rule passes.
 */
export function decideRefundEligibility(
  history: SeatHistory,
  input: { buyerId: number; now: Date; usage: () => SeatUsage }
): RefundRefusal | null {
  if (history.buyerId !== input.buyerId) return { refusal: "not-buyer" };
  if (seatState(history) === "refunded") return { refusal: "refunded" };
  if (pendingRefundRequestId(history) !== null) {
    return { refusal: "pending-refund-request" };
  }
  const takenByAnother = history.events.some(
    (e) => e.type === "enrolled" && e.studentId !== history.buyerId
  );
  if (takenByAnother) return { refusal: "taken-by-another-student" };

  if (calendarDay(input.now) > lastDayOfRefundWindow(history)) {
    return { refusal: "refund-window-closed" };
  }

  const usage = input.usage();
  if (usage.watchedSeconds >= WATCH_LIMIT_SECONDS) {
    return { refusal: "watch-limit-reached" };
  }
  if (usage.completion >= COMPLETION_LIMIT) {
    return { refusal: "completion-limit-reached" };
  }
  return null;
}

/** The Refund Amount (the Seat Price) and the Refund Window's last day. */
export function refundOffer(history: SeatHistory): RefundOffer {
  return {
    refundAmount: history.seatPrice,
    lastDayOfRefundWindow: lastDayOfRefundWindow(history),
  };
}

function offerOf(eligibility: RefundEligibility): RefundOffer | null {
  if (!eligibility.eligible) return null;
  const { refundAmount, lastDayOfRefundWindow } = eligibility;
  return { refundAmount, lastDayOfRefundWindow };
}

// The Refund Window counts whole calendar days in the server's time zone:
// someone who buys at 23:00 still gets all of their fourteenth day after.
function lastDayOfRefundWindow(history: SeatHistory): string {
  const purchased = history.events.find((e) => e.type === "purchased");
  if (!purchased) throw new Error(`Seat ${history.seatId} has no purchase`);
  const lastDay = new Date(purchased.at);
  lastDay.setDate(lastDay.getDate() + REFUND_WINDOW_DAYS);
  return calendarDay(lastDay);
}

function calendarDay(when: Date): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${when.getFullYear()}-${month}-${day}`;
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
