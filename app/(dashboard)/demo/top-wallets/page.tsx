/**
 * Top Wallets Table Demo Page
 *
 * Demonstrates the Top Wallets Table component with sorting and filtering
 */

"use client"

import { TopWalletsTable } from "@/components/top-wallets-table"
import { Card } from "@/components/ui/card"

export default function TopWalletsDemo() {
  return (
    <Card className="shadow-sm rounded-2xl border-0 dark:bg-[#18181b]">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 border-b border-border/50">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">Top Performing Wallets</h1>
        <p className="text-sm text-muted-foreground">
          Elite traders ranked by Tier 1 metrics (Omega, P&L, Win Rate, EV per Bet)
        </p>
      </div>

      <div className="px-6 py-6 space-y-6">
      {/* Full Table */}
      <TopWalletsTable
        defaultWindow="lifetime"
        defaultLimit={50}
        showPagination={true}
        compact={false}
      />

      {/* Compact Table Example */}
      <div>
        <h2 className="text-xl font-semibold mb-4">Compact View (30-Day Window)</h2>
        <TopWalletsTable
          defaultWindow="30d"
          defaultLimit={25}
          showPagination={false}
          compact={true}
        />
      </div>

      {/* Usage Notes */}
      <div className="p-4 bg-muted rounded-lg">
        <h3 className="font-semibold mb-2">Features</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Sortable columns: Omega, Net P&L, Win Rate, EV per Bet, Trades</li>
          <li>Time window filtering: 30d, 90d, 180d, Lifetime</li>
          <li>Pagination with 50 wallets per page</li>
          <li>Omega grade badges: S (3.0+), A (2.0+), B (1.5+), C (1.0+), D (0.5+), F (&lt;0.5)</li>
          <li>Copy wallet address to clipboard</li>
          <li>Open wallet detail page in new tab</li>
          <li>Currently using mock data (toggle in <code>hooks/use-top-wallets.ts</code>)</li>
        </ul>
      </div>
      </div>
    </Card>
  )
}
