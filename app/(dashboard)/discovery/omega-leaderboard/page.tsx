import { redirect } from "next/navigation";

/**
 * Omega Leaderboard has been merged into the unified WIO Leaderboard.
 * This page now redirects to /discovery/leaderboard
 */
export default function OmegaLeaderboardPage() {
  redirect("/discovery/leaderboard");
}
