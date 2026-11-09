import { Link, useFetcher, redirect } from "react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/seat.$code";
import { getCurrentUserId } from "~/lib/session";
import { resolveCountry } from "~/lib/country.server";
import { parseParams, parseFormData } from "~/lib/validation";
import { countryName } from "~/lib/ppp";
import { createSeatsModule, type EnrollmentRefusal } from "~/lib/seats.server";
import { mirrorEnrollmentOnCoupon } from "~/lib/coupon-mirror.server";
import { Card, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Ticket, AlertCircle, CheckCircle2, Globe } from "lucide-react";
import { data } from "react-router";
import { db } from "~/db";
import { courses } from "~/db/schema";
import { eq } from "drizzle-orm";

// The Seat Code page: a Student Enrolls on the Seat a Seat Code identifies.
// Enrollment Eligibility is decided by the seats module.

function getCourseById(id: number) {
  return db.select().from(courses).where(eq(courses.id, id)).get();
}

function refusalMessage(refusal: EnrollmentRefusal): {
  title: string;
  detail: string;
} {
  switch (refusal.refusal) {
    case "unknown-seat-code":
      return {
        title: "This Seat Code doesn't match any Seat",
        detail:
          "Check the link with the person who gave it to you. It may have been copied incompletely.",
      };
    case "refunded":
      return {
        title: "This Seat has been refunded",
        detail:
          "A refunded Seat can no longer be used. Ask the person who gave you this link for another Seat Code.",
      };
    case "used-by-another-student":
      return {
        title: "This Seat is already used by another Student",
        detail:
          "Each Seat serves one Student. Ask the person who gave you this link for another Seat Code.",
      };
    case "already-enrolled":
      return {
        title: "You're already enrolled in this course",
        detail:
          "You already have access to this course. This Seat is still open, so it can be given to someone else.",
      };
    case "country-mismatch":
      return {
        title: "This Seat can only be used from the country of purchase",
        detail: `This Seat was bought with a PPP Discount, so it can only be used from ${countryName(refusal.country)}.`,
      };
  }
}

const seatParamsSchema = z.object({
  code: z.string().min(1),
});

const seatActionSchema = z.object({
  intent: z.literal("enroll"),
});

export function meta({ loaderData }: Route.MetaArgs) {
  const title = loaderData?.course?.title ?? "Seat Code";
  return [
    { title: `Enroll: ${title} — Cadence` },
    { name: "description", content: `Enroll in ${title} with a Seat Code` },
  ];
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const { code } = parseParams(params, seatParamsSchema);

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw redirect(`/login?redirectTo=${encodeURIComponent(`/seat/${code}`)}`);
  }

  const eligibility = createSeatsModule().enrollmentEligibility({
    studentId: currentUserId,
    seatCode: code,
    country: await resolveCountry(request),
  });

  const course = eligibility.seat
    ? getCourseById(eligibility.seat.courseId)
    : undefined;

  return {
    code,
    course: course
      ? { id: course.id, title: course.title, slug: course.slug }
      : null,
    pppCountryRestriction: eligibility.seat?.pppCountryRestriction ?? null,
    refusal: eligibility.eligible ? null : eligibility.refusal,
    message: eligibility.eligible ? null : refusalMessage(eligibility),
  };
}

export async function action({ params, request }: Route.ActionArgs) {
  const { code } = parseParams(params, seatParamsSchema);

  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("You must be logged in.", { status: 401 });
  }

  const formData = await request.formData();
  const parsed = parseFormData(formData, seatActionSchema);
  if (!parsed.success) {
    throw data("Invalid action.", { status: 400 });
  }

  const result = createSeatsModule().enrollWithSeatCode({
    studentId: currentUserId,
    seatCode: code,
    country: await resolveCountry(request),
  });

  if (!result.ok) {
    return data({ error: refusalMessage(result).title }, { status: 400 });
  }

  mirrorEnrollmentOnCoupon(code, currentUserId);

  const course = getCourseById(result.courseId);
  throw redirect(course ? `/courses/${course.slug}/welcome` : "/courses");
}

export default function SeatCode({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { course, code, pppCountryRestriction, refusal, message } = loaderData;
  const fetcher = useFetcher();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const error =
      fetcher.data?.error ?? (actionData as { error?: string })?.error;
    if (error) {
      toast.error(error);
    }
  }, [fetcher.data, actionData]);

  return (
    <div className="mx-auto max-w-2xl p-6 lg:p-8">
      <h1 className="mb-2 text-2xl font-bold">Enroll with a Seat Code</h1>
      <p className="mb-8 text-muted-foreground">
        Someone has given you a Seat in a course.
      </p>

      <Card>
        <CardContent className="p-8 text-center">
          <div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
            <Ticket className="size-8 text-primary" />
          </div>

          {course && (
            <h2 className="mb-2 text-xl font-semibold">{course.title}</h2>
          )}
          <p className="mb-6 text-sm text-muted-foreground">
            Seat Code:{" "}
            <code className="rounded bg-muted px-2 py-0.5">{code}</code>
          </p>

          {message && refusal === "already-enrolled" && course ? (
            <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
              <div className="flex items-center justify-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="size-5" />
                <span className="font-medium">{message.title}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {message.detail}
              </p>
              <Link to={`/courses/${course.slug}`}>
                <Button className="mt-4" size="lg">
                  Go to Course
                </Button>
              </Link>
            </div>
          ) : message && refusal === "country-mismatch" ? (
            <div className="rounded-lg bg-amber-50 p-4 dark:bg-amber-900/20">
              <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-400">
                <Globe className="size-5" />
                <span className="font-medium">{message.title}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {message.detail}
              </p>
            </div>
          ) : message ? (
            <div className="rounded-lg bg-destructive/10 p-4">
              <div className="flex items-center justify-center gap-2 text-destructive">
                <AlertCircle className="size-5" />
                <span className="font-medium">{message.title}</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {message.detail}
              </p>
            </div>
          ) : (
            <>
              {pppCountryRestriction && (
                <p className="mb-4 text-sm text-muted-foreground">
                  This Seat was bought with a PPP Discount, so it can only be
                  used from {countryName(pppCountryRestriction)}.
                </p>
              )}
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="enroll" />
                <Button
                  size="lg"
                  className="w-full max-w-sm"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Enrolling..." : "Enroll Now"}
                </Button>
              </fetcher.Form>
            </>
          )}

          {course && (
            <div className="mt-6">
              <Link
                to={`/courses/${course.slug}`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                View course details
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
