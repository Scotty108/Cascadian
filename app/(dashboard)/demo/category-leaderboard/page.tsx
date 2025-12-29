/**
 * Category Leaderboard Demo Page
 *
 * Demonstrates the Category Leaderboard component using Austin Methodology
 */

"use client"

import { CategoryLeaderboard } from "@/components/category-leaderboard"
import { Card } from "@/components/ui/card"

export default function CategoryLeaderboardDemo() {
  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Category Winnability Leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          Find &quot;winnable games&quot; using Austin Methodology - categories where elite wallets succeed
        </p>
      </div>

      <div className="px-6 py-6 space-y-6">

      {/* Main Leaderboard */}
      <CategoryLeaderboard
        defaultWindow="30d"
        limit={20}
        showOnlyWinnable={false}
        compact={false}
      />

      {/* Winnable Games Only */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Winnable Games Only (7-Day Window)</h2>
        <CategoryLeaderboard
          defaultWindow="7d"
          limit={10}
          showOnlyWinnable={true}
          compact={false}
        />
      </div>

      {/* Compact View */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Compact View</h2>
        <CategoryLeaderboard
          defaultWindow="24h"
          limit={15}
          showOnlyWinnable={false}
          compact={true}
        />
      </div>

      {/* Methodology Notes */}
      <div className="p-4 bg-muted rounded-lg">
        <h3 className="font-semibold mb-2">Austin Methodology - &quot;Winnable Game&quot; Criteria</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Elite wallet count ≥ 20 (enough smart money)</li>
          <li>Median Omega of elites ≥ 2.0 (they&apos;re actually winning)</li>
          <li>Mean CLV ≥ 2% (edge on closing prices)</li>
          <li>Avg EV per hour ≥ $10 (worth the time)</li>
          <li>Total volume ≥ $100k (liquid enough)</li>
        </ul>
        <h3 className="font-semibold mt-4 mb-2">Winnability Score Formula (0-100)</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Elite Count: (count/50) × 25 points</li>
          <li>Median Omega: (omega/5) × 25 points</li>
          <li>Mean CLV: (clv/0.05) × 20 points</li>
          <li>EV per Hour: (ev/20) × 20 points</li>
          <li>Total Volume: (volume/1M) × 10 points</li>
        </ul>
        <p className="text-xs mt-4 text-muted-foreground">
          Note: Currently using mock data. Toggle <code>useMockData</code> in the hook when API is ready.
        </p>
      </div>
      </div>
    </Card>
  )
}
