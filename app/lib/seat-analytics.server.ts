import {
  and,
  count,
  eq,
  exists,
  gte,
  inArray,
  isNull,
  ne,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db as appDb } from "~/db";
import {
  RefundRequestStatus,
  courses,
  enrollments,
  purchases,
  refundRequests,
  seats,
} from "~/db/schema";
import type { SeatsDatabase } from "~/lib/seats.server";

/**
 * Which courses and Purchases an analytics figure covers: one Course Owner's
 * courses (or every course, for null), and Purchases made since an ISO
 * timestamp (or all time, for null).
 */
export type AnalyticsScope = {
  instructorId: number | null;
  since: string | null;
};

export type SeatsBought = { bought: number; open: number };

/**
 * The analytics page's questions about Seats (ADR 0001). Read-only: every
 * answer is derived from Purchases, Seats, Enrollments and Refund Requests.
 */
export function createSeatAnalytics(options: { db?: SeatsDatabase } = {}) {
  const db = options.db ?? appDb;

  const ownedBy = (instructorId: number | null) =>
    instructorId === null ? undefined : eq(courses.instructorId, instructorId);

  return {
    /**
     * What was paid for the Seats each Student has enrolled on, in cents and
     * unrounded: each Seat is worth its Purchase's Amount Paid divided by its
     * number of Seats. A Seat counts once per Student, however often they
     * enrolled on it. Takes no `since`: the money is credited to whoever is
     * learning, whenever it was paid.
     */
    paidForStudents(
      studentIds: number[],
      scope: Pick<AnalyticsScope, "instructorId">
    ): Map<number, number> {
      if (studentIds.length === 0) return new Map();

      const seatsUsed = db
        .selectDistinct({
          userId: enrollments.userId,
          seatId: enrollments.seatId,
        })
        .from(enrollments)
        .where(inArray(enrollments.userId, studentIds))
        .as("seats_used");

      const rows = db
        .select({
          userId: seatsUsed.userId,
          // Divided rather than rounded per Seat: the shares are summed first
          // and rounded once by the caller.
          paid: sql<number>`sum(${purchases.amountPaid} * 1.0 / ${purchases.seatCount})`,
        })
        .from(seatsUsed)
        .innerJoin(seats, eq(seats.id, seatsUsed.seatId))
        .innerJoin(purchases, eq(purchases.id, seats.purchaseId))
        .innerJoin(courses, eq(courses.id, purchases.courseId))
        .where(ownedBy(scope.instructorId))
        .groupBy(seatsUsed.userId)
        .all();

      return new Map(rows.map((row) => [row.userId, Number(row.paid)]));
    },

    /**
     * How many Seats each Buyer bought for others, and how many of those are
     * Open Seats. Personal Purchases are left out: their one Seat is the
     * Buyer's own.
     */
    seatsBought(
      buyerIds: number[],
      scope: AnalyticsScope
    ): Map<number, SeatsBought> {
      if (buyerIds.length === 0) return new Map();

      const buyerEnrolledOnIt = db
        .select({ one: sql`1` })
        .from(enrollments)
        .innerJoin(seats, eq(seats.id, enrollments.seatId))
        .where(
          and(
            eq(seats.purchaseId, purchases.id),
            eq(enrollments.userId, purchases.userId)
          )
        );
      const notPersonalPurchase = or(
        ne(purchases.seatCount, 1),
        notExists(buyerEnrolledOnIt)
      );

      const activeEnrollment = db
        .select({ one: sql`1` })
        .from(enrollments)
        .where(
          and(eq(enrollments.seatId, seats.id), isNull(enrollments.endedAt))
        );
      const approvedRefund = db
        .select({ one: sql`1` })
        .from(refundRequests)
        .where(
          and(
            eq(refundRequests.seatId, seats.id),
            eq(refundRequests.status, RefundRequestStatus.Approved)
          )
        );

      const rows = db
        .select({
          userId: purchases.userId,
          bought: count(seats.id),
          open: sql<number>`sum(case when ${not(exists(activeEnrollment))} and ${not(exists(approvedRefund))} then 1 else 0 end)`,
        })
        .from(seats)
        .innerJoin(purchases, eq(purchases.id, seats.purchaseId))
        .innerJoin(courses, eq(courses.id, purchases.courseId))
        .where(
          and(
            inArray(purchases.userId, buyerIds),
            ownedBy(scope.instructorId),
            scope.since === null
              ? undefined
              : gte(purchases.createdAt, scope.since),
            notPersonalPurchase
          )
        )
        .groupBy(purchases.userId)
        .all();

      return new Map(
        rows.map((row) => [
          row.userId,
          { bought: row.bought, open: Number(row.open) },
        ])
      );
    },
  };
}
