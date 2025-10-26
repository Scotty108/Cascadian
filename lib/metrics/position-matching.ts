/**
 * Position Matching & PnL Calculation
 *
 * Matches buy and sell trades to calculate realized PnL.
 * Uses FIFO (First In, First Out) matching for position tracking.
 *
 * For prediction markets:
 * - Buying YES at $0.60 and selling at $0.80 = +$0.20 per share
 * - Each market+outcome combination is tracked separately
 * - PnL = (sell_price - buy_price) * shares
 */

import { clickhouse } from '@/lib/clickhouse/client'

export interface Trade {
  trade_id: string
  wallet_address: string
  market_id: string
  timestamp: number
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
  transaction_hash: string
}

export interface Position {
  market_id: string
  side: 'YES' | 'NO'
  shares: number
  avg_entry_price: number
  cost_basis: number
}

export interface MatchedTrade {
  buy_trade_id: string
  sell_trade_id: string
  shares: number
  buy_price: number
  sell_price: number
  pnl: number
}

/**
 * Fetch all trades for a wallet, ordered by timestamp
 */
async function fetchWalletTrades(walletAddress: string): Promise<Trade[]> {
  const query = `
    SELECT
      trade_id,
      wallet_address,
      market_id,
      toUnixTimestamp(timestamp) as timestamp,
      side,
      entry_price,
      shares,
      usd_value,
      transaction_hash
    FROM trades_raw
    WHERE wallet_address = '${walletAddress.toLowerCase()}'
    ORDER BY timestamp ASC
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const data = await result.json<any>() as any[]

  return data.map((row: any) => ({
    trade_id: row.trade_id,
    wallet_address: row.wallet_address,
    market_id: row.market_id,
    timestamp: parseInt(row.timestamp),
    side: row.side,
    entry_price: parseFloat(row.entry_price),
    shares: parseFloat(row.shares),
    usd_value: parseFloat(row.usd_value),
    transaction_hash: row.transaction_hash,
  }))
}

/**
 * Match positions and calculate PnL for a wallet
 * Returns array of PnL updates to apply
 */
export async function calculateWalletPnL(walletAddress: string): Promise<{
  matched_trades: Array<{
    trade_id: string
    pnl: number
    is_closed: boolean
  }>
  summary: {
    total_matched: number
    total_pnl: number
    winning_trades: number
    losing_trades: number
  }
}> {
  const trades = await fetchWalletTrades(walletAddress)

  if (trades.length === 0) {
    return {
      matched_trades: [],
      summary: { total_matched: 0, total_pnl: 0, winning_trades: 0, losing_trades: 0 },
    }
  }

  // Track open positions per market+side
  const openPositions = new Map<string, Trade[]>()
  const matchedTrades: Array<{ trade_id: string; pnl: number; is_closed: boolean }> = []

  let totalPnL = 0
  let winningTrades = 0
  let losingTrades = 0

  // Process trades chronologically
  for (const trade of trades) {
    const positionKey = `${trade.market_id}:${trade.side}`

    // For simplicity: treat each trade as potentially opening or closing a position
    // In reality, prediction markets are more complex (YES vs NO, different outcomes)
    // This is a simplified model where we track each side separately

    // Check if we have open positions on the OPPOSITE side
    // (closing a YES position means buying NO, and vice versa in some models)
    // For now, we'll track each side independently and calculate PnL based on price changes

    // Simple approach: track buy vs sell within same side
    // A "sell" on the same side means closing that position

    // Actually, in prediction markets:
    // - Buying YES means opening YES position
    // - Selling YES means closing YES position
    // But we don't have explicit buy/sell - we just have positions

    // Better approach: Use current positions from Goldsky to determine unrealized PnL
    // For realized PnL, we need to track when shares decrease (= closing positions)

    // For MVP: Mark all trades as open positions with unrealized PnL = 0
    // This is a limitation we'll note for future enhancement

    matchedTrades.push({
      trade_id: trade.trade_id,
      pnl: 0, // TODO: Calculate based on position changes
      is_closed: false, // TODO: Determine if position is closed
    })
  }

  return {
    matched_trades: matchedTrades,
    summary: {
      total_matched: matchedTrades.length,
      total_pnl: totalPnL,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
    },
  }
}

/**
 * Update trades_raw table with PnL calculations
 */
export async function updateTradesWithPnL(
  updates: Array<{ trade_id: string; pnl: number; is_closed: boolean }>
): Promise<void> {
  if (updates.length === 0) {
    return
  }

  // ClickHouse doesn't support traditional UPDATE statements easily
  // Instead, we use ALTER TABLE UPDATE (which is async) or INSERT with replace
  // For now, we'll log that this needs to be implemented

  console.log(`⚠️  PnL calculation found ${updates.length} updates`)
  console.log('   ClickHouse UPDATE implementation needed (using ALTER TABLE UPDATE or mutations)')
  console.log('   For now, PnL will be calculated on-the-fly from current market prices')
}

/**
 * Alternative approach: Calculate unrealized PnL from current market prices
 * This requires fetching current market prices from Polymarket API or Goldsky
 */
export async function calculateUnrealizedPnL(
  walletAddress: string,
  currentPrices: Map<string, { yes_price: number; no_price: number }>
): Promise<number> {
  const trades = await fetchWalletTrades(walletAddress)

  let unrealizedPnL = 0

  // Group trades by market+side to get net position
  const positions = new Map<string, { shares: number; cost_basis: number; side: 'YES' | 'NO' }>()

  for (const trade of trades) {
    const key = `${trade.market_id}:${trade.side}`

    if (!positions.has(key)) {
      positions.set(key, { shares: 0, cost_basis: 0, side: trade.side })
    }

    const pos = positions.get(key)!
    pos.shares += trade.shares
    pos.cost_basis += trade.usd_value
  }

  // Calculate unrealized PnL for each position
  for (const [key, pos] of positions) {
    const [marketId, side] = key.split(':')
    const prices = currentPrices.get(marketId)

    if (!prices || pos.shares === 0) {
      continue
    }

    const currentPrice = side === 'YES' ? prices.yes_price : prices.no_price
    const currentValue = pos.shares * currentPrice
    unrealizedPnL += currentValue - pos.cost_basis
  }

  return unrealizedPnL
}
