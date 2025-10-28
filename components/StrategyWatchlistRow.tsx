/**
 * Strategy Watchlist Row
 *
 * Displays a watchlist entry with canonical category, wallet context, and tags
 * Used in strategy dashboard to show what markets are being watched and why
 */

interface StrategyWatchlistRowProps {
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

export default function StrategyWatchlistRow({
  market_id,
  question,
  canonical_category,
  raw_tags,
  triggering_wallet_address,
  triggering_wallet_rank,
  triggering_wallet_coverage_pct,
  added_at,
  alerts = false
}: StrategyWatchlistRowProps) {
  // Get badge color based on category
  const getCategoryColor = (category: string) => {
    if (category.includes('Politics')) return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
    if (category.includes('Macro')) return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
    if (category.includes('Earnings')) return 'bg-green-500/20 text-green-400 border-green-500/30'
    if (category.includes('Crypto')) return 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    if (category.includes('Sports')) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    return 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  }

  // Format timestamp
  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  // Format wallet address
  const shortAddress = triggering_wallet_address
    ? `${triggering_wallet_address.slice(0, 6)}...${triggering_wallet_address.slice(-4)}`
    : null

  return (
    <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/30 hover:bg-gray-900/50 transition-colors">
      <div className="flex items-start justify-between gap-4">
        {/* Left: Market info */}
        <div className="flex-1 min-w-0">
          {/* Question */}
          <h3 className="text-sm font-medium text-gray-200 mb-2 line-clamp-2">
            {question || market_id}
          </h3>

          {/* Category badge and alerts */}
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2 py-1 rounded border ${getCategoryColor(canonical_category)}`}>
              {canonical_category}
            </span>

            {alerts && (
              <span className="relative flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                </span>
                LIVE FLOW
              </span>
            )}
          </div>

          {/* Wallet context */}
          {triggering_wallet_address && (
            <div className="text-xs text-gray-500">
              Surfaced by wallet{' '}
              {triggering_wallet_rank && (
                <span className="text-gray-400 font-medium">
                  #{triggering_wallet_rank}
                </span>
              )}{' '}
              {shortAddress && (
                <code className="text-gray-400">{shortAddress}</code>
              )}
              {triggering_wallet_coverage_pct !== null && (
                <span className="text-gray-500">
                  {' '}(coverage {triggering_wallet_coverage_pct.toFixed(0)}%)
                </span>
              )}
            </div>
          )}

          {/* Tags */}
          {raw_tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {raw_tags.slice(0, 5).map((tag, idx) => (
                <span
                  key={idx}
                  className="text-xs px-1.5 py-0.5 rounded bg-gray-800/50 text-gray-400"
                >
                  {tag}
                </span>
              ))}
              {raw_tags.length > 5 && (
                <span className="text-xs px-1.5 py-0.5 text-gray-500">
                  +{raw_tags.length - 5} more
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Timestamp */}
        <div className="text-xs text-gray-500 whitespace-nowrap">
          {formatTime(added_at)}
        </div>
      </div>
    </div>
  )
}
