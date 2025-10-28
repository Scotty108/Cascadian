/**
 * Wallet Specialist Card
 *
 * Displays a wallet's specialization and performance summary
 * Used in investor demos and dashboard analytics
 */

interface WalletSpecialistCardProps {
  wallet_address: string
  realized_pnl_usd: number
  coverage_pct: number
  top_category: string
  top_category_pnl_usd: number
  blurb: string
  specialist_in: string

  // Resolution accuracy (conviction accuracy)
  resolution_accuracy_overall_pct?: number | null
  resolution_markets_tracked?: number | null
  resolution_accuracy_top_category_pct?: number | null
  resolution_top_category?: string | null
  resolution_markets_tracked_in_top_category?: number | null
  resolution_blurb: string
}

export default function WalletSpecialistCard({
  wallet_address,
  realized_pnl_usd,
  coverage_pct,
  top_category,
  top_category_pnl_usd,
  blurb,
  specialist_in,
  resolution_accuracy_overall_pct,
  resolution_markets_tracked,
  resolution_accuracy_top_category_pct,
  resolution_top_category,
  resolution_markets_tracked_in_top_category,
  resolution_blurb
}: WalletSpecialistCardProps) {
  // Format wallet address (0xb744...5210)
  const shortAddress = `${wallet_address.slice(0, 6)}...${wallet_address.slice(-4)}`

  // Format currency
  const formatUSD = (amount: number) => {
    if (amount >= 1000) {
      return `$${(amount / 1000).toFixed(1)}K`
    }
    return `$${amount.toFixed(0)}`
  }

  // Get badge color based on category
  const getCategoryColor = (category: string) => {
    if (category.includes('Politics')) return 'bg-blue-500/20 text-blue-400'
    if (category.includes('Macro')) return 'bg-purple-500/20 text-purple-400'
    if (category.includes('Earnings')) return 'bg-green-500/20 text-green-400'
    if (category.includes('Crypto')) return 'bg-orange-500/20 text-orange-400'
    if (category.includes('Sports')) return 'bg-yellow-500/20 text-yellow-400'
    return 'bg-gray-500/20 text-gray-400'
  }

  return (
    <div className="border border-gray-800 rounded-lg p-4 bg-gray-900/50 hover:bg-gray-900/70 transition-colors">
      {/* Wallet Address */}
      <div className="flex items-center gap-2 mb-2">
        <code className="text-sm font-mono text-gray-300">{shortAddress}</code>
        <span className={`text-xs px-2 py-0.5 rounded-full ${getCategoryColor(top_category)}`}>
          {top_category}
        </span>
      </div>

      {/* Specialist Line */}
      <div className="mb-2">
        <span className="text-xs text-gray-500">Specialist in </span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${getCategoryColor(specialist_in)}`}>
          {specialist_in}
        </span>
      </div>

      {/* Blurb */}
      <p className="text-sm text-gray-400 mb-3 leading-relaxed">
        {blurb}
      </p>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-800">
        <div>
          <div className="text-xs text-gray-500 mb-1">Total P&L</div>
          <div className="text-base font-semibold text-gray-100">
            {formatUSD(realized_pnl_usd)}
            <span className="text-xs text-gray-500 ml-1">
              ({coverage_pct.toFixed(0)}% coverage)
            </span>
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-500 mb-1">Most edge in</div>
          <div className="text-base font-semibold text-gray-100">
            {formatUSD(top_category_pnl_usd)}
            <div className="text-xs text-gray-500 mt-0.5 truncate">
              {top_category}
            </div>
          </div>
        </div>
      </div>

      {/* Resolution Accuracy */}
      {resolution_blurb && resolution_blurb !== 'Resolution accuracy pending enrichment' && (
        <div className="mt-3 pt-3 border-t border-gray-800/50">
          <div className="flex items-center gap-2">
            <div className="flex-shrink-0 w-2 h-2 rounded-full bg-green-400"></div>
            <div className="text-xs text-gray-400">
              {resolution_blurb}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
