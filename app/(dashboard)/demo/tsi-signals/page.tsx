/**
 * TSI Signal Card Demo Page
 *
 * Demonstrates the TSI Signal Card component with live mock data
 */

"use client"

import { TSISignalCard } from "@/components/tsi-signal-card"

export default function TSISignalsDemo() {
  // Example market IDs (using mock data for now)
  const demoMarkets = [
    {
      id: "0x1234567890abcdef",
      title: "Will Trump win the 2024 Presidential Election?"
    },
    {
      id: "0xabcdef1234567890",
      title: "Will Bitcoin reach $100k by end of 2024?"
    },
    {
      id: "0x9876543210fedcba",
      title: "Will the Fed cut rates in December 2024?"
    }
  ]

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">TSI Momentum Signals</h1>
        <p className="text-muted-foreground mt-2">
          Live TSI (True Strength Index) crossover signals with smart money conviction scores
        </p>
      </div>

      {/* Single Card Example */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Featured Signal</h2>
        <div className="max-w-2xl">
          <TSISignalCard
            marketId={demoMarkets[0].id}
            marketTitle={demoMarkets[0].title}
            showLiveIndicator={true}
            compact={false}
          />
        </div>
      </div>

      {/* Multiple Cards Grid */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Watchlist Signals</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {demoMarkets.map((market) => (
            <TSISignalCard
              key={market.id}
              marketId={market.id}
              marketTitle={market.title}
              showLiveIndicator={true}
              compact={false}
            />
          ))}
        </div>
      </div>

      {/* Compact Mode Example */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Compact Mode</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {demoMarkets.map((market) => (
            <TSISignalCard
              key={market.id}
              marketId={market.id}
              showLiveIndicator={false}
              compact={true}
            />
          ))}
        </div>
      </div>

      {/* Usage Notes */}
      <div className="mt-8 p-4 bg-muted rounded-lg">
        <h3 className="font-semibold mb-2">Developer Notes</h3>
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          <li>Currently using mock data (toggle in <code>hooks/use-market-tsi.ts</code>)</li>
          <li>Signals auto-refresh every 10 seconds</li>
          <li>Entry Signal badge appears when conviction ≥ 90%</li>
          <li>Color coding: Green (≥90%), Yellow (≥70%), Orange (≥50%), Red (&lt;50%)</li>
          <li>Conviction formula: 50% Elite + 30% Specialists + 20% Omega-weighted</li>
        </ul>
      </div>
    </div>
  )
}
