import { useState } from "react";
import { Link, data, isRouteErrorResponse } from "react-router";
import type { Route } from "./+types/seats";
import { getCurrentUserId } from "~/lib/session";
import { createSeatsModule, type SeatState } from "~/lib/seats.server";
import { formatPrice } from "~/lib/utils";
import { Card, CardContent, CardHeader } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { BookOpen, Copy, Check, AlertTriangle } from "lucide-react";

// The Buyer's seats page: every Purchase with its Seats. Seat states and
// holders come from the seats module, derived from each Seat History.

export function meta() {
  return [
    { title: "My Seats — Cadence" },
    {
      name: "description",
      content: "Your Purchases and the Seats they bought",
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const currentUserId = await getCurrentUserId(request);
  if (!currentUserId) {
    throw data("Select a user from the DevUI panel.", { status: 401 });
  }

  return { purchases: createSeatsModule().buyerPurchases(currentUserId) };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const stateBadge: Record<SeatState, { label: string; className: string }> = {
  open: {
    label: "Open",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  taken: {
    label: "Taken",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  refunded: {
    label: "Refunded",
    className: "bg-muted text-muted-foreground",
  },
};

function SeatStateBadge({ state }: { state: SeatState }) {
  const { label, className } = stateBadge[state];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

function CopySeatCodeLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const url = `${window.location.origin}/seat/${code}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
      title="Copy Seat Code link"
    >
      {copied ? (
        <>
          <Check className="size-3" />
          Copied
        </>
      ) : (
        <>
          <Copy className="size-3" />
          Copy Seat Code link
        </>
      )}
    </button>
  );
}

export default function Seats({ loaderData }: Route.ComponentProps) {
  const { purchases } = loaderData;

  return (
    <div className="mx-auto max-w-7xl p-6 lg:p-8">
      <nav className="mb-6 text-sm text-muted-foreground">
        <Link to="/" className="hover:text-foreground">
          Home
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">My Seats</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold">My Seats</h1>
        <p className="mt-1 text-muted-foreground">
          Your Purchases and their Seats. Hand the Seat Code link of an open
          Seat to the Student who should enroll on it.
        </p>
      </div>

      {purchases.length === 0 ? (
        <div className="text-center">
          <p className="mb-4 text-sm text-muted-foreground">
            You haven&apos;t made any Purchases yet.
          </p>
          <Link to="/courses">
            <Button variant="outline">Browse Courses</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {purchases.map((purchase) => (
            <Card key={purchase.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="size-4 text-muted-foreground" />
                    <Link
                      to={`/courses/${purchase.courseSlug}`}
                      className="font-semibold hover:underline"
                    >
                      {purchase.courseTitle}
                    </Link>
                  </div>
                  <Link
                    to={`/courses/${purchase.courseSlug}/purchase?mode=team`}
                  >
                    <Button variant="outline" size="sm">
                      Buy more Seats
                    </Button>
                  </Link>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <div>
                    <dt className="text-muted-foreground">Purchased</dt>
                    <dd>{formatDate(purchase.purchasedAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Seats</dt>
                    <dd>{purchase.seatCount}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Seat Price</dt>
                    <dd>{formatPrice(purchase.seatPrice)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Amount Paid</dt>
                    <dd>{formatPrice(purchase.amountPaid)}</dd>
                  </div>
                </dl>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="px-4 py-3 text-left font-medium">
                          Seat Code
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          State
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Held by
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchase.seats.map((seat) => (
                        <tr key={seat.id} className="border-b last:border-0">
                          <td className="px-4 py-3">
                            <code className="rounded bg-muted px-2 py-0.5 text-xs">
                              {seat.code}
                            </code>
                          </td>
                          <td className="px-4 py-3">
                            <SeatStateBadge state={seat.state} />
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {seat.holder?.name ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            {seat.state === "open" && (
                              <CopySeatCodeLink code={seat.code} />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
    if (error.status === 401) {
      title = "Sign in required";
      message =
        typeof error.data === "string"
          ? error.data
          : "Please select a user from the DevUI panel.";
    } else {
      title = `Error ${error.status}`;
      message = typeof error.data === "string" ? error.data : error.statusText;
    }
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
