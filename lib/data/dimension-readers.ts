/**
 * Dimension Table Readers
 *
 * Public API for reading markets_dim and events_dim from ClickHouse.
 * Read-only operations. No writes to production tables.
 */

import { createClient as createClickHouseClient } from '@clickhouse/client'
import type {
  WalletMarketActivity,
  EventMetadata,
  MarketDimension,
  EventDimension,
} from '@/lib/types/dimension-tables'

// ClickHouse client (read-only)
const clickhouse = createClickHouseClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

/**
 * Get all markets traded by a wallet
 *
 * Returns: condition_id, market_id, event_id, side (YES/NO), timestamp
 * Used by strategy runtime to build initial watchlist from high-score wallets.
 */
export async function getMarketsForWallet(
  walletAddress: string
): Promise<WalletMarketActivity[]> {
  const query = `
    SELECT DISTINCT
      wallet_address,
      condition_id,
      '' as market_id, -- Will populate from markets_dim join later
      '' as event_id,   -- Will populate from markets_dim join later
      side,
      timestamp,
      shares
    FROM trades_raw
    WHERE wallet_address = '${walletAddress}'
    ORDER BY timestamp DESC
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const rows: any[] = await result.json()

  return rows.map((row) => ({
    wallet_address: row.wallet_address,
    condition_id: row.condition_id,
    market_id: row.market_id || '',
    event_id: row.event_id || '',
    side: row.side as 'YES' | 'NO',
    timestamp: new Date(row.timestamp),
    shares: parseFloat(row.shares),
  }))
}

/**
 * Get event metadata by event_id
 *
 * Returns: category, tags, title, status
 * Used for category attribution and filtering.
 *
 * TODO: Replace with actual events_dim table when Path B provides it
 */
export async function getEventMetadata(eventId: string): Promise<EventMetadata | null> {
  // Stub implementation until events_dim is loaded
  // Will query: SELECT * FROM events_dim WHERE event_id = {eventId}

  return {
    event_id: eventId,
    category: 'unknown',
    tags: [],
    title: 'Unknown Event',
    status: 'active',
  }
}

/**
 * Get market dimension by condition_id
 *
 * Returns: market_id, event_id, resolved_outcome, question
 * Used to enrich watchlist entries with metadata.
 *
 * TODO: Replace with actual markets_dim table when Path B provides it
 */
export async function getMarketDimension(
  conditionId: string
): Promise<MarketDimension | null> {
  // Stub implementation until markets_dim is loaded
  // Will query: SELECT * FROM markets_dim WHERE condition_id = {conditionId}

  return {
    condition_id: conditionId,
    market_id: '',
    event_id: '',
    resolved_outcome: null,
    payout_yes: 0,
    payout_no: 0,
    question: 'Unknown market',
  }
}

/**
 * Batch get market dimensions for multiple condition_ids
 *
 * More efficient than calling getMarketDimension() in a loop.
 */
export async function getMarketDimensionsBatch(
  conditionIds: string[]
): Promise<Map<string, MarketDimension>> {
  // Stub implementation
  // Will query: SELECT * FROM markets_dim WHERE condition_id IN (...)

  const result = new Map<string, MarketDimension>()

  for (const conditionId of conditionIds) {
    const dim = await getMarketDimension(conditionId)
    if (dim) {
      result.set(conditionId, dim)
    }
  }

  return result
}
