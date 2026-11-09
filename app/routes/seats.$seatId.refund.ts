import { data, redirect } from "react-router";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Route } from "./+types/seats.$seatId.refund";
import { db } from "~/db";
import { courses, users } from "~/db/schema";
import { requireUserId } from "~/lib/access.server";
import {
  createSeatsModule,
  REFUND_REASON_MAX_LENGTH,
  REFUND_REASON_MIN_LENGTH,
  type RefundRequestRefusal,
} from "~/lib/seats.server";
import { parseFormData, parseParams } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";

// A Buyer makes a Refund Request for one Seat. The course page posts here for
// a Cancellation and the seats page for any other Seat. The seats module
// re-checks Refund Eligibility, so the page and this action never disagree.

const paramsSchema = z.object({
  seatId: z.coerce.number().int().positive(),
});

const refundRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(
      REFUND_REASON_MIN_LENGTH,
      `Please give a Refund Reason of at least ${REFUND_REASON_MIN_LENGTH} characters.`
    )
    .max(
      REFUND_REASON_MAX_LENGTH,
      `Please keep your Refund Reason under ${REFUND_REASON_MAX_LENGTH} characters.`
    ),
});

const refusalMessages: Record<
  RefundRequestRefusal["refusal"],
  { status: number; message: string }
> = {
  "unknown-seat": { status: 404, message: "Seat not found." },
  "not-buyer": {
    status: 403,
    message: "Only the Buyer of a Seat can make a Refund Request for it.",
  },
  refunded: { status: 409, message: "This Seat has already been refunded." },
  "pending-refund-request": {
    status: 409,
    message: "This Seat already has a Pending Refund Request.",
  },
  "taken-by-another-student": {
    status: 403,
    message:
      "Another Student has enrolled on this Seat, so it cannot be refunded.",
  },
  "refund-window-closed": {
    status: 403,
    message: "The Refund Window for this Seat has closed.",
  },
  "watch-limit-reached": {
    status: 403,
    message: "Too much of the course has been watched on this Seat to refund it.",
  },
  "completion-limit-reached": {
    status: 403,
    message:
      "Too much of the course has been completed on this Seat to refund it.",
  },
  "refund-reason-length": {
    status: 400,
    message: `A Refund Reason has ${REFUND_REASON_MIN_LENGTH} to ${REFUND_REASON_MAX_LENGTH} characters.`,
  },
};

/**
 * The confirmation the Buyer gets in their inbox. There is no mail transport
 * wired up yet, so the built message goes to the server log.
 */
function buildRefundRequestEmail(input: {
  buyerName: string;
  buyerEmail: string;
  courseTitle: string;
  refundAmount: number;
}) {
  return {
    to: input.buyerEmail,
    subject: `Refund Request received — ${input.courseTitle}`,
    body: [
      `Hi ${input.buyerName},`,
      "",
      `We have your Refund Request for a Seat of "${input.courseTitle}".`,
      `Its Refund Amount is ${formatPrice(input.refundAmount)}.`,
      "",
      "Your Refund Request is Pending until it is approved or declined. You keep access to the course until then, and we will email you again when it is decided.",
      "",
      "— The Cadence team",
    ].join("\n"),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const buyerId = await requireUserId(request);
  const { seatId } = parseParams(params, paramsSchema);

  const parsed = parseFormData(await request.formData(), refundRequestSchema);
  if (!parsed.success) {
    return data({ errors: parsed.errors }, { status: 400 });
  }

  const result = createSeatsModule().requestRefund({
    buyerId,
    seatId,
    reason: parsed.data.reason,
  });
  if (!result.ok) {
    const { status, message } = refusalMessages[result.refusal];
    throw data(message, { status });
  }

  const buyer = db.select().from(users).where(eq(users.id, buyerId)).get();
  const course = db
    .select({ title: courses.title })
    .from(courses)
    .where(eq(courses.id, result.courseId))
    .get();
  if (buyer && course) {
    const email = buildRefundRequestEmail({
      buyerName: buyer.name,
      buyerEmail: buyer.email,
      courseTitle: course.title,
      refundAmount: result.refundAmount,
    });
    console.log(
      `[email] to=${email.to} subject=${email.subject}\n${email.body}`
    );
  }

  return redirect("/settings");
}
