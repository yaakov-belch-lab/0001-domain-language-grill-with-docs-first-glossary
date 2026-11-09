import { and, eq, isNull } from "drizzle-orm";
import { db } from "~/db";
import { coupons, teamMembers, teams, TeamMemberRole } from "~/db/schema";
import type { MadePurchase } from "~/lib/seats.server";

// Temporary (spec #11, issue #13): the analytics page still reads teams and
// coupons. Until it moves to the seats module, every Seat bought through a
// Purchase of several Seats is also written as a coupon with the same code,
// and every Enrollment with a Seat Code marks that coupon as redeemed. Delete
// this file when teams and coupons are dropped.

/** Writes the Seats of a Purchase as coupons of the Buyer's team. */
export function mirrorSeatsAsCoupons(
  buyerId: number,
  courseId: number,
  purchase: MadePurchase
) {
  db.transaction((tx) => {
    const membership = tx
      .select({ teamId: teamMembers.teamId })
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, buyerId),
          eq(teamMembers.role, TeamMemberRole.Admin)
        )
      )
      .get();
    const teamId =
      membership?.teamId ?? tx.insert(teams).values({}).returning().get().id;
    if (!membership) {
      tx.insert(teamMembers)
        .values({ teamId, userId: buyerId, role: TeamMemberRole.Admin })
        .run();
    }

    tx.insert(coupons)
      .values(
        purchase.seats.map((seat) => ({
          teamId,
          courseId,
          code: seat.code,
          purchaseId: purchase.purchaseId,
        }))
      )
      .run();
  });
}

/** Marks the coupon with a Seat's code as redeemed by the Student. */
export function mirrorEnrollmentOnCoupon(seatCode: string, studentId: number) {
  db.update(coupons)
    .set({ redeemedByUserId: studentId, redeemedAt: new Date().toISOString() })
    .where(and(eq(coupons.code, seatCode), isNull(coupons.redeemedByUserId)))
    .run();
}
