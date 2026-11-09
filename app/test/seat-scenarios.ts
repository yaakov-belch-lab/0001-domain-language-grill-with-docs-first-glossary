import { and, eq, isNull } from "drizzle-orm";
import * as schema from "~/db/schema";
import {
  RefundRequestStatus,
  UnenrollmentInitiator,
  UserRole,
} from "~/db/schema";
import type { TestDb } from "./setup";

/**
 * Arranges Seat Histories for tests, in glossary language.
 *
 * The seats module has no acts yet, so these write the records a Seat History
 * is made of directly. As each act lands (make a Purchase, Enroll, Unenroll,
 * Refund Request, Refund Approval, Refund Decline), tests should call the act
 * instead.
 */
export function seatScenario(db: TestDb) {
  let codes = 0;

  const instructor = person("Course Owner", UserRole.Instructor);
  const category = db
    .insert(schema.categories)
    .values({ name: "Programming", slug: "programming" })
    .returning()
    .get();

  function person(name: string, role = UserRole.Student) {
    return db
      .insert(schema.users)
      .values({
        name,
        email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.com`,
        role,
      })
      .returning()
      .get();
  }

  return {
    person,

    course(
      title: string,
      coursePrice = 7900,
      options: { pppEnabled?: boolean; owner?: { id: number } } = {}
    ) {
      return db
        .insert(schema.courses)
        .values({
          title,
          slug: title.toLowerCase().replace(/\W+/g, "-"),
          description: title,
          salesCopy: `## ${title}`,
          instructorId: (options.owner ?? instructor).id,
          categoryId: category.id,
          status: schema.CourseStatus.Published,
          price: coursePrice,
          pppEnabled: options.pppEnabled ?? false,
        })
        .returning()
        .get();
    },

    /** Gives a course one module of `count` lessons. */
    lessons(course: { id: number }, count: number) {
      const module = db
        .insert(schema.modules)
        .values({ courseId: course.id, title: "Module 1", position: 1 })
        .returning()
        .get();
      return Array.from({ length: count }, (_, i) =>
        db
          .insert(schema.lessons)
          .values({ moduleId: module.id, title: `Lesson ${i + 1}`, position: i })
          .returning()
          .get()
      );
    },

    /** A Student's video reaches `positionSeconds` in a lesson. */
    watch(
      student: { id: number },
      lesson: { id: number },
      positionSeconds: number,
      at: string
    ) {
      db.insert(schema.videoWatchEvents)
        .values({
          userId: student.id,
          lessonId: lesson.id,
          eventType: "progress",
          positionSeconds,
          createdAt: at,
        })
        .run();
    },

    /** A Student completes a lesson. */
    completeLesson(student: { id: number }, lesson: { id: number }, at: string) {
      db.insert(schema.lessonProgress)
        .values({
          userId: student.id,
          lessonId: lesson.id,
          status: schema.LessonProgressStatus.Completed,
          completedAt: at,
        })
        .run();
    },

    /** A Buyer pays for a Purchase of `seatCount` Seats. */
    purchase(
      buyer: { id: number },
      course: { id: number },
      options: {
        seatCount?: number;
        seatPrice: number;
        at: string;
        pppCountryRestriction?: string;
      }
    ) {
      const seatCount = options.seatCount ?? 1;
      const purchase = db
        .insert(schema.purchases)
        .values({
          userId: buyer.id,
          courseId: course.id,
          seatCount,
          seatPrice: options.seatPrice,
          amountPaid: seatCount * options.seatPrice,
          country: options.pppCountryRestriction ?? null,
          pppCountryRestriction: options.pppCountryRestriction ?? null,
          createdAt: options.at,
        })
        .returning()
        .get();
      const seats = Array.from({ length: seatCount }, () =>
        db
          .insert(schema.seats)
          .values({
            purchaseId: purchase.id,
            code: `SEAT-${++codes}`,
            createdAt: options.at,
          })
          .returning()
          .get()
      );
      return { purchase, seats };
    },

    /** A Student Enrolls on a Seat. */
    enroll(
      student: { id: number },
      seat: { id: number; purchaseId: number },
      at: string
    ) {
      const purchase = db
        .select()
        .from(schema.purchases)
        .where(eq(schema.purchases.id, seat.purchaseId))
        .get();
      if (!purchase) throw new Error("Seat without a Purchase");
      return db
        .insert(schema.enrollments)
        .values({
          userId: student.id,
          courseId: purchase.courseId,
          seatId: seat.id,
          enrolledAt: at,
        })
        .returning()
        .get();
    },

    /** An Unenrollment ends an Enrollment. */
    unenroll(
      enrollment: { id: number },
      initiator: UnenrollmentInitiator,
      at: string
    ) {
      db.update(schema.enrollments)
        .set({ endedAt: at, unenrollmentInitiator: initiator })
        .where(eq(schema.enrollments.id, enrollment.id))
        .run();
    },

    /**
     * The Student's Completion of the course. Recording Completion is not in
     * the app yet (#9), so tests set it directly.
     */
    complete(enrollment: { id: number }, at: string) {
      db.update(schema.enrollments)
        .set({ completedAt: at })
        .where(eq(schema.enrollments.id, enrollment.id))
        .run();
    },

    /** A Buyer makes a Refund Request for a Seat. */
    requestRefund(seat: { id: number }, reason: string, at: string) {
      return db
        .insert(schema.refundRequests)
        .values({ seatId: seat.id, reason, requestedAt: at })
        .returning()
        .get();
    },

    /** A Refund Approval, which also ends any active Enrollment on the Seat. */
    approveRefund(
      request: { id: number; seatId: number },
      by: { id: number },
      amountRefunded: number,
      at: string
    ) {
      db.update(schema.refundRequests)
        .set({
          status: RefundRequestStatus.Approved,
          amountRefunded,
          resolvedAt: at,
          resolvedByUserId: by.id,
        })
        .where(eq(schema.refundRequests.id, request.id))
        .run();
      db.update(schema.enrollments)
        .set({
          endedAt: at,
          unenrollmentInitiator: UnenrollmentInitiator.System,
        })
        .where(
          and(
            eq(schema.enrollments.seatId, request.seatId),
            isNull(schema.enrollments.endedAt)
          )
        )
        .run();
    },

    /** A Refund Decline. Nothing else changes. */
    declineRefund(request: { id: number }, by: { id: number }, at: string) {
      db.update(schema.refundRequests)
        .set({
          status: RefundRequestStatus.Declined,
          resolvedAt: at,
          resolvedByUserId: by.id,
        })
        .where(eq(schema.refundRequests.id, request.id))
        .run();
    },
  };
}
