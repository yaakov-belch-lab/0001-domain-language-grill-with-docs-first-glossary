import { data } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/api.video-tracking";
import { eq } from "drizzle-orm";
import { getCurrentUserId } from "~/lib/session";
import { requireContentAccess } from "~/lib/access.server";
import { parseJsonBody } from "~/lib/validation";
import { db } from "~/db";
import { lessons, modules, videoWatchEvents } from "~/db/schema";

const videoTrackingSchema = z.object({
  lessonId: z.number(),
  eventType: z.string(),
  positionSeconds: z.number(),
});

export async function action({ request }: Route.ActionArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Unauthorized", { status: 401 });
  }

  const parsed = await parseJsonBody(request, videoTrackingSchema);

  if (!parsed.success) {
    throw data("Invalid parameters", { status: 400 });
  }

  const { lessonId, eventType, positionSeconds } = parsed.data;

  // Watched time is progress tracking: it needs an active Enrollment, so it
  // stops at an Unenrollment like the lesson itself.
  const lesson = db
    .select({ courseId: modules.courseId })
    .from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .where(eq(lessons.id, lessonId))
    .get();
  if (!lesson) {
    throw data("Lesson not found", { status: 404 });
  }
  await requireContentAccess(request, lesson.courseId);

  db
    .insert(videoWatchEvents)
    .values({
      userId: currentUserId,
      lessonId,
      eventType,
      positionSeconds,
    })
    .returning()
    .get();

  return { success: true };
}
