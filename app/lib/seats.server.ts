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
        if (r.status === RefundRequestStatus.Approved) {
          events.push({
            type: "refund-approved",
            at: r.resolvedAt ?? r.requestedAt,
            refundRequestId: r.id,
            amountRefunded: r.amountRefunded,
            resolvedByUserId: r.resolvedByUserId,
          });
        } else if (r.status === RefundRequestStatus.Declined) {
          events.push({
            type: "refund-declined",
            at: r.resolvedAt ?? r.requestedAt,
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

  return {
    clock,

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
        const name = id === null ? undefined : holderNames.get(id);
        return id === null || name === undefined ? null : { id, name };
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
    activeEnrollment(
      studentId: number,
      courseId: number
    ): ActiveEnrollment | undefined {
      const row = db
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
      return row;
    },
  };
}

// ─── Derived from a Seat History ───

/** The Student whose Enrollment on the Seat is active, if any. */
export function seatHolderId(history: SeatHistory): number | null {
  const active = new Map<number, number>();
  for (const event of history.events) {
    if (event.type === "enrolled")
      active.set(event.enrollmentId, event.studentId);
    if (event.type === "unenrolled") active.delete(event.enrollmentId);
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
