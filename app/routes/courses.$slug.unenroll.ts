import { data, redirect } from "react-router";
import { eq } from "drizzle-orm";
import type { Route } from "./+types/courses.$slug.unenroll";
import { db } from "~/db";
import { courses } from "~/db/schema";
import { requireUserId } from "~/lib/access.server";
import { createSeatsModule } from "~/lib/seats.server";

// A Student Unenrolls from a course. The seats module ends their active
// Enrollment with the Student as Initiator; this route only wires it up.
export async function action({ params, request }: Route.ActionArgs) {
  const studentId = await requireUserId(request);

  const course = db
    .select({ id: courses.id, slug: courses.slug })
    .from(courses)
    .where(eq(courses.slug, params.slug))
    .get();
  if (!course) throw data("Course not found", { status: 404 });

  const result = createSeatsModule().unenroll({
    studentId,
    courseId: course.id,
  });
  if (!result.ok) {
    throw data("You are not enrolled in this course.", { status: 409 });
  }

  return redirect(`/courses/${course.slug}?unenrolled=1`);
}
