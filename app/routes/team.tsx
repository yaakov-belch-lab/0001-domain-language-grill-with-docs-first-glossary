import { redirect } from "react-router";
import type { Route } from "./+types/team";

// The team page is gone: a Buyer's Purchases and Seats are on the seats page.
export function loader(_: Route.LoaderArgs) {
  throw redirect("/seats", 301);
}
