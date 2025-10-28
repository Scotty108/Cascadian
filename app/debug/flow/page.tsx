/**
 * Smart Money Flow Debug Page
 *
 * OPERATOR CHECKLIST:
 * ====================
 * 0. Set NEXT_PUBLIC_DEMO_STRATEGY_ID in your .env.local:
 *    NEXT_PUBLIC_DEMO_STRATEGY_ID=<your-strategy-id>
 *    (Falls back to 'demo-strategy-id' if not set)
 *
 * 1. Run the always-on wallet monitor (writes runtime/watchlist_events.log):
 *    npm run flow:monitor
 *    (or: AUTONOMOUS_TRADING_ENABLED=true npx tsx scripts/monitor-signal-wallet-positions.ts)
 *
 * 2. In another terminal, run dev server:
 *    npm run flow:dev
 *    (or: npm run dev)
 *
 * 3. Open:
 *    http://localhost:3000/debug/flow
 *
 * Reality notes:
 * - Top Wallet Specialists = real audited P&L + real coverage from data/audited_wallet_pnl_extended.json
 * - Live Watchlist Stream = real recent flow from runtime/watchlist_events.log
 * - Category labels = real canonical categories from Polymarket tags
 * - Wallet #1 per-category breakdown = real ClickHouse JOIN data (trades_raw → condition_market_map → events_dim)
 * - Other wallets = fallback to generic category specialization (graceful degradation)
 */

'use client'

import { useEffect, useState } from 'react'
import WalletSpecialistCard from '@/components/WalletSpecialistCard'
import StrategyWatchlistRow from '@/components/StrategyWatchlistRow'

// Read strategy ID from environment variable, fallback to demo ID
const STRATEGY_ID = process.env.NEXT_PUBLIC_DEMO_STRATEGY_ID ?? 'demo-strategy-id'

interface Specialist {
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
  top_category: string
  top_category_pnl_usd: number
  blurb: string

  // Resolution accuracy
  resolution_accuracy_overall_pct: number | null
  resolution_markets_tracked: number | null
  resolution_accuracy_top_category_pct: number | null
  resolution_top_category: string | null
  resolution_markets_tracked_in_top_category: number | null
  resolution_blurb: string
}

interface WatchlistEntry {
  market_id: string
  question: string | null
  canonical_category: string
  raw_tags: string[]
  triggering_wallet_address: string | null
  triggering_wallet_rank: number | null
  triggering_wallet_coverage_pct: number | null
  added_at: string
  alerts?: boolean
}

export default function FlowDebugPage() {
  const [specialists, setSpecialists] = useState<Specialist[]>([])
  const [stream, setStream] = useState<WatchlistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true)

        // Fetch specialists (real data)
        const specialistsRes = await fetch('/api/wallets/specialists')
        if (!specialistsRes.ok) {
          throw new Error('Failed to fetch specialists')
        }
        const specialistsData = await specialistsRes.json()
        const top4 = specialistsData.slice(0, 4)

        // Enhance wallet #1 with real category breakdown from ClickHouse dimension joins
        if (top4.length > 0) {
          const wallet1Address = top4[0].wallet_address
          try {
            const breakdownRes = await fetch(`/api/wallets/${wallet1Address}/category-breakdown`)
            if (breakdownRes.ok) {
              const breakdownData = await breakdownRes.json()

              // If we have real category data with nonzero P&L, use it
              if (breakdownData.success && breakdownData.data && breakdownData.data.length > 0) {
                const topCategoryData = breakdownData.data[0] // Already sorted by pnl_usd desc

                // Upgrade wallet #1 with real ClickHouse data
                top4[0] = {
                  ...top4[0],
                  top_category: topCategoryData.canonical_category,
                  top_category_pnl_usd: topCategoryData.pnl_usd,
                  top_category_num_markets: topCategoryData.num_resolved_markets,
                  // Update blurb with real data
                  blurb: `Wallet ${wallet1Address.slice(0, 6)}...${wallet1Address.slice(-4)} has $${(top4[0].realized_pnl_usd / 1000).toFixed(1)}K realized P&L, including $${(topCategoryData.pnl_usd / 1000).toFixed(1)}K in ${topCategoryData.canonical_category}, across ${topCategoryData.num_resolved_markets} resolved markets. Coverage on this wallet is ${top4[0].coverage_pct.toFixed(0)}%.`
                }
              }
            }
          } catch (breakdownError) {
            // Gracefully degrade - keep original data from specialists API
            console.warn('Failed to fetch category breakdown for wallet #1:', breakdownError)
          }
        }

        setSpecialists(top4)

        // Fetch watchlist stream (real data from JSONL log)
        const streamRes = await fetch(`/api/strategies/${STRATEGY_ID}/watchlist/stream?limit=10`)
        if (!streamRes.ok) {
          throw new Error('Failed to fetch watchlist stream')
        }
        const streamData = await streamRes.json()
        setStream(streamData.data || [])

        setLoading(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data')
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-400">Loading smart money flow...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-red-400">Error: {error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Smart Money Flow</h1>
          <p className="text-gray-400">
            Real-time tracking of our top wallet specialists and their positions
          </p>
        </div>

        {/* Top Specialists Section */}
        <div className="mb-12">
          <h2 className="text-xl font-semibold mb-1">Top Wallet Specialists</h2>
          <p className="text-sm text-gray-500 mb-4">
            Ranked by realized P&L. Accuracy = % of markets they were on the correct side when it actually resolved.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {specialists.map((specialist) => (
              <WalletSpecialistCard
                key={specialist.wallet_address}
                wallet_address={specialist.wallet_address}
                realized_pnl_usd={specialist.realized_pnl_usd}
                coverage_pct={specialist.coverage_pct}
                top_category={specialist.top_category}
                top_category_pnl_usd={specialist.top_category_pnl_usd}
                blurb={specialist.blurb}
                specialist_in={specialist.top_category}
                resolution_accuracy_overall_pct={specialist.resolution_accuracy_overall_pct}
                resolution_markets_tracked={specialist.resolution_markets_tracked}
                resolution_accuracy_top_category_pct={specialist.resolution_accuracy_top_category_pct}
                resolution_top_category={specialist.resolution_top_category}
                resolution_markets_tracked_in_top_category={specialist.resolution_markets_tracked_in_top_category}
                resolution_blurb={specialist.resolution_blurb}
              />
            ))}
          </div>
        </div>

        {/* Live Watchlist Stream Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <span>Live Watchlist Stream</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
            </span>
            <span className="text-sm text-gray-500 font-normal">
              (What our specialists are watching right now)
            </span>
          </h2>

          {stream.length === 0 ? (
            // Empty state
            <div className="border border-gray-800 rounded-lg p-8 bg-gray-900/30 text-center">
              <div className="mb-3">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-800 mb-4">
                  <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </div>
              </div>
              <h3 className="text-lg font-medium text-gray-300 mb-2">
                No fresh smart money flow in the last 12h from our high-confidence wallets.
              </h3>
              <p className="text-sm text-gray-500">
                Check back soon or start the wallet monitor to begin tracking positions.
              </p>
              <div className="mt-4 p-3 bg-gray-800/50 rounded text-left">
                <code className="text-xs text-gray-400">
                  AUTONOMOUS_TRADING_ENABLED=true npx tsx scripts/monitor-signal-wallet-positions.ts
                </code>
              </div>
            </div>
          ) : (
            // Real stream data
            <div className="space-y-3">
              {stream.map((entry, idx) => (
                <StrategyWatchlistRow
                  key={`${entry.market_id}-${idx}`}
                  market_id={entry.market_id}
                  question={entry.question}
                  canonical_category={entry.canonical_category}
                  raw_tags={entry.raw_tags}
                  triggering_wallet_address={entry.triggering_wallet_address}
                  triggering_wallet_rank={entry.triggering_wallet_rank}
                  triggering_wallet_coverage_pct={entry.triggering_wallet_coverage_pct}
                  added_at={entry.added_at}
                  alerts={entry.alerts}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer Note */}
        <div className="mt-12 p-4 border border-gray-800 rounded bg-gray-900/30">
          <p className="text-sm text-gray-500">
            <strong className="text-gray-400">Data Sources:</strong>{' '}
            Wallet specialists from <code className="text-gray-400">data/audited_wallet_pnl_extended.json</code>.
            Watchlist stream from <code className="text-gray-400">runtime/watchlist_events.log</code>.
            All category labels derived from Polymarket event tags via canonical mapper.
          </p>
        </div>
      </div>
    </div>
  )
}
