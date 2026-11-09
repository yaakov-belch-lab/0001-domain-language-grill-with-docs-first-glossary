import { redirect } from "react-router";
import type { Route } from "./+types/redeem.$code";

// Old redemption links keep working: they now open the Seat Code page.
export function loader({ params }: Route.LoaderArgs) {
  throw redirect(`/seat/${encodeURIComponent(params.code)}`, 301);
}
