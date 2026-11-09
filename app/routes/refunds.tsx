import { useEffect } from "react";
import { Link, data, isRouteErrorResponse, useFetcher } from "react-router";
import { toast } from "sonner";
import { z } from "zod";
import type { Route } from "./+types/refunds";
import { requireUserId } from "~/lib/access.server";
import {
  COMPLETION_LIMIT,
  WATCH_LIMIT_SECONDS,
  createSeatsModule,
  type RefundDecision,
  type RefundDecisionRefusal,
} from "~/lib/seats.server";
import { parseFormData } from "~/lib/validation";
import { formatPrice } from "~/lib/utils";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { AlertTriangle } from "lucide-react";

// The refund decisions page: an Admin decides every Pending Refund Request, a
// Course Owner those for their own courses. The seats module decides who may
// decide and what a Refund Approval or Refund Decline records.

export function meta() {
  return [
    { title: "Refund Requests — Cadence" },
    {
      name: "description",
      content: "Approve or decline Pending Refund Requests",
    },
  ];
}

async function requireDecider(request: Request) {
  const userId = await requireUserId(request);
  const seats = createSeatsModule();
  if (!seats.mayDecideRefunds(userId)) {
    throw data("Only an Admin or a Course Owner can decide Refund Requests.", {
      status: 403,
    });
  }
  return { userId, seats };
}

export async function loader({ request }: Route.LoaderArgs) {
  const { userId, seats } = await requireDecider(request);
  return { refundRequests: seats.refundDecisions(userId) };
}

const decisionSchema = z.object({
  refundRequestId: z.coerce.number().int().positive(),
  decision: z.enum(["approve", "decline"]),
});

const refusalMessages: Record<
  RefundDecisionRefusal["refusal"],
  { status: number; message: string }
> = {
  "unknown-refund-request": {
    status: 404,
    message: "Refund Request not found.",
  },
  "not-decider": {
    status: 403,
    message:
      "Only an Admin or this course's Course Owner can decide this Refund Request.",
  },
  "not-pending": {
    status: 409,
    message: "This Refund Request has already been decided.",
  },
};

export async function action({ request }: Route.ActionArgs) {
  const { userId, seats } = await requireDecider(request);
  const parsed = parseFormData(await request.formData(), decisionSchema);
  if (!parsed.success) throw data("Invalid decision", { status: 400 });

  const { refundRequestId, decision } = parsed.data;
  const input = { deciderId: userId, refundRequestId };
  const result =
    decision === "approve"
      ? seats.approveRefund(input)
      : seats.declineRefund(input);
  if (!result.ok) {
    const { status, message } = refusalMessages[result.refusal];
    throw data(message, { status });
  }
  return { decided: decision };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatWatched(seconds: number) {
  const minutes = Math.round(seconds / 60);
  return minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function Decide({ refundRequest }: { refundRequest: RefundDecision }) {
  const fetcher = useFetcher<typeof action>();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    toast.success(
      fetcher.data.decided === "approve"
        ? "Refund Request approved."
        : "Refund Request declined."
    );
  }, [fetcher.state, fetcher.data]);

  return (
    <fetcher.Form method="post" className="flex gap-2">
      <input type="hidden" name="refundRequestId" value={refundRequest.id} />
      <Button
        type="submit"
        name="decision"
        value="approve"
        size="sm"
        disabled={isSubmitting}
      >
        Approve
      </Button>
      <Button
        type="submit"
        name="decision"
        value="decline"
        variant="outline"
        size="sm"
        disabled={isSubmitting}
      >
        Decline
      </Button>
    </fetcher.Form>
  );
}

export default function Refunds({ loaderData }: Route.ComponentProps) {
  const { refundRequests } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">Refund Requests</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">Refund Requests</h1>
        <p className="mt-1 text-muted-foreground">
          Pending Refund Requests waiting for your decision. A Refund Approval
          refunds the Seat and ends any Enrollment on it; a Refund Decline
          changes nothing else.
        </p>
      </div>

      {refundRequests.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No Refund Requests are Pending.
        </p>
      ) : (
        <div className="space-y-4">
          {refundRequests.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    to={`/courses/${r.courseSlug}`}
                    className="font-semibold hover:underline"
                  >
                    {r.courseTitle}
                  </Link>
                  <Decide refundRequest={r} />
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
                  <div>
                    <dt className="text-muted-foreground">Buyer</dt>
                    <dd>{r.buyer.name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Seat held by</dt>
                    <dd>{r.holder?.name ?? "Nobody (open)"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Refund Amount</dt>
                    <dd>{formatPrice(r.refundAmount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Seat Usage</dt>
                    <dd>
                      {formatWatched(r.seatUsage.watchedSeconds)} watched (limit{" "}
                      {formatWatched(WATCH_LIMIT_SECONDS)}),{" "}
                      {Math.round(r.seatUsage.completion * 100)}% completed
                      (limit {Math.round(COMPLETION_LIMIT * 100)}%)
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Requested</dt>
                    <dd>{formatDate(r.requestedAt)}</dd>
                  </div>
                </dl>
                <div className="text-sm">
                  <span className="text-muted-foreground">Refund Reason: </span>
                  {r.reason}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Something went wrong";
  let message = "An unexpected error occurred.";

  if (isRouteErrorResponse(error)) {
    title = error.status === 401 ? "Sign in required" : `Error ${error.status}`;
    message = typeof error.data === "string" ? error.data : error.statusText;
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="text-center">
        <AlertTriangle className="mx-auto mb-4 size-12 text-muted-foreground" />
        <h1 className="mb-2 text-2xl font-bold">{title}</h1>
        <p className="mb-6 text-muted-foreground">{message}</p>
        <Link to="/">
          <Button>Go Home</Button>
        </Link>
      </div>
    </div>
  );
}
