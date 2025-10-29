/**
 * OWRR: Omega-Weighted Risk Ratio
 *
 * The Smart Money Signal for prediction markets
 *
 * Formula:
 *   vote = Omega_category × sqrt(open_risk)
 *   OWRR = S_YES / (S_YES + S_NO)
 *   Slider = round(100 × OWRR)
 *
 * Filters:
 *   - Only wallets with 10+ resolved trades in category
 *   - Omega capped at [0.1, 5.0] range
 */

import { clickhouse } from '@/lib/clickhouse/client'

export interface OWRRResult {
  owrr: number              // 0-1 scale
  slider: number            // 0-100 scale
  yes_score: number
  no_score: number
  yes_qualified: number     // How many of top 20 had 10+ trades
  no_qualified: number
  yes_avg_omega: number
  no_avg_omega: number
  yes_avg_risk: number
  no_avg_risk: number
  category: string
  confidence: 'high' | 'medium' | 'low' | 'insufficient_data'
  breakdown: {
    yes_votes: WalletVote[]
    no_votes: WalletVote[]
  }
}

export interface WalletVote {
  wallet: string
  omega: number
  open_risk: number
  vote: number
  resolved_bets: number
}

interface Position {
  wallet_address: string
  side: 'YES' | 'NO'
  total_shares: number
  weighted_avg_entry_price: number
  total_position_value: number
}

interface WalletMetrics {
  wallet_address: string
  category: string
  metric_2_omega_net: number
  metric_22_resolved_bets: number
}

/**
 * Calculate OWRR for a market
 */
export async function calculateOWRR(
  marketId: string,
  category: string
): Promise<OWRRResult> {

  // Get top 20 positions on each side
  const [yesPositions, noPositions] = await Promise.all([
    getTopPositions(marketId, 'YES', 20),
    getTopPositions(marketId, 'NO', 20)
  ])

  // Get wallet addresses for metric lookup
  const allWallets = [
    ...yesPositions.map(p => p.wallet_address),
    ...noPositions.map(p => p.wallet_address)
  ]

  // Get category metrics for all wallets
  const metrics = await getWalletCategoryMetrics(allWallets, category)
  const metricsMap = new Map(metrics.map(m => [m.wallet_address, m]))

  // Calculate votes for each side
  const yesVotes = yesPositions
    .map(pos => calculateVote(pos, metricsMap.get(pos.wallet_address)))
    .filter(v => v.vote > 0)  // Exclude unqualified wallets

  const noVotes = noPositions
    .map(pos => calculateVote(pos, metricsMap.get(pos.wallet_address)))
    .filter(v => v.vote > 0)

  // Check if we have enough data
  if (yesVotes.length < 3 || noVotes.length < 3) {
    return {
      owrr: 0.5,
      slider: 50,
      yes_score: 0,
      no_score: 0,
      yes_qualified: yesVotes.length,
      no_qualified: noVotes.length,
      yes_avg_omega: 0,
      no_avg_omega: 0,
      yes_avg_risk: 0,
      no_avg_risk: 0,
      category,
      confidence: 'insufficient_data',
      breakdown: {
        yes_votes: yesVotes,
        no_votes: noVotes
      }
    }
  }

  // Sum votes
  const S_YES = sum(yesVotes.map(v => v.vote))
  const S_NO = sum(noVotes.map(v => v.vote))

  // Calculate OWRR
  const owrr = S_YES / (S_YES + S_NO)
  const slider = Math.round(100 * owrr)

  // Calculate confidence based on qualified wallet counts
  const totalQualified = yesVotes.length + noVotes.length
  const confidence =
    totalQualified >= 20 ? 'high' :
    totalQualified >= 12 ? 'medium' : 'low'

  return {
    owrr,
    slider,
    yes_score: S_YES,
    no_score: S_NO,
    yes_qualified: yesVotes.length,
    no_qualified: noVotes.length,
    yes_avg_omega: avg(yesVotes.map(v => v.omega)),
    no_avg_omega: avg(noVotes.map(v => v.omega)),
    yes_avg_risk: avg(yesVotes.map(v => v.open_risk)),
    no_avg_risk: avg(noVotes.map(v => v.open_risk)),
    category,
    confidence,
    breakdown: {
      yes_votes: yesVotes,
      no_votes: noVotes
    }
  }
}

/**
 * Get top N positions on a side of a market
 */
async function getTopPositions(
  marketId: string,
  side: 'YES' | 'NO',
  limit: number
): Promise<Position[]> {
  const query = `
    SELECT
      wallet_address,
      side,
      sum(shares) as total_shares,
      sum(shares * entry_price) / sum(shares) as weighted_avg_entry_price,
      sum(usd_value) as total_position_value
    FROM trades_raw
    WHERE market_id = {marketId:String}
      AND is_closed = 0
      AND side = {side:String}
    GROUP BY wallet_address, side
    ORDER BY total_position_value DESC
    LIMIT {limit:UInt16}
  `

  const result = await clickhouse.query({
    query,
    query_params: {
      marketId,
      side,
      limit
    },
    format: 'JSONEachRow'
  })

  return (await result.json()) as Position[]
}

/**
 * Get category metrics for multiple wallets
 */
async function getWalletCategoryMetrics(
  walletAddresses: string[],
  category: string
): Promise<WalletMetrics[]> {
  if (walletAddresses.length === 0) return []

  const query = `
    SELECT
      wallet_address,
      category,
      metric_2_omega_net,
      metric_22_resolved_bets
    FROM wallet_metrics_by_category
    WHERE wallet_address IN ({walletAddresses:Array(String)})
      AND category = {category:String}
      AND window = 'lifetime'
  `

  const result = await clickhouse.query({
    query,
    query_params: {
      walletAddresses,
      category
    },
    format: 'JSONEachRow'
  })

  return (await result.json()) as WalletMetrics[]
}

/**
 * Calculate vote for a single wallet position
 */
function calculateVote(
  position: Position,
  metrics: WalletMetrics | undefined
): WalletVote {

  // Check if wallet is qualified (10+ trades in category)
  if (!metrics || metrics.metric_22_resolved_bets < 10) {
    return {
      wallet: position.wallet_address,
      omega: 0,
      open_risk: 0,
      vote: 0,
      resolved_bets: metrics?.metric_22_resolved_bets || 0
    }
  }

  // Get Omega, cap at [0.1, 5.0] range
  const omega = Math.min(
    Math.max(metrics.metric_2_omega_net || 1.0, 0.1),
    5.0
  )

  // Calculate open risk (money they'll lose if wrong)
  const open_risk = position.side === 'YES'
    ? position.total_shares * position.weighted_avg_entry_price
    : position.total_shares * (1 - position.weighted_avg_entry_price)

  // Calculate vote: Omega × sqrt(open_risk)
  const vote = omega * Math.sqrt(open_risk)

  return {
    wallet: position.wallet_address,
    omega,
    open_risk,
    vote,
    resolved_bets: metrics.metric_22_resolved_bets
  }
}

/**
 * Utility functions
 */
function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0)
}

function avg(arr: number[]): number {
  return arr.length > 0 ? sum(arr) / arr.length : 0
}
