import { redirect } from "react-router";

// The team page is gone: a Buyer's Purchases and Seats are on the seats page.
export function loader() {
  throw redirect("/seats", 301);
}
