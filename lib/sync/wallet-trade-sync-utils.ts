/**
 * Wallet Trade Sync Utilities
 * Shared functions for syncing wallet trades from Goldsky to ClickHouse
 */

import { createClient } from '@supabase/supabase-js'
import { fetchAllWalletTrades, resolveTokenId, OrderFilledEvent } from '@/lib/goldsky/client'
import { clickhouse } from '@/lib/clickhouse/client'

// PnL correction factor (from investigation)
// Goldsky's PnL subgraph returns values 13.2399x too high
export const PNL_CORRECTION_FACTOR = 13.2399

export interface ProcessedTrade {
  trade_id: string
  wallet_address: string
  market_id: string
  condition_id: string // Store for category joining
  timestamp: Date
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
  transaction_hash: string
  is_closed: boolean
}

export interface SyncResult {
  success: boolean
  wallet_address: string
  trades_fetched: number
  trades_processed: number
  trades_inserted: number
  duration_ms: number
  error?: string
}

export interface SyncMetadata {
  wallet_address: string
  sync_status: 'pending' | 'syncing' | 'completed' | 'failed' | 'skipped'
  total_trades_synced: number
  total_trades_processed: number
  last_synced_at?: Date
  last_error?: string
  error_count: number
  sync_duration_ms: number
  trades_per_second: number
  last_trade_timestamp?: Date
}

// Cache for condition -> market_id mapping
const conditionToMarketCache = new Map<string, string>()

// Cache for token ID -> condition mapping
const tokenIdCache = new Map<string, { condition: string; outcome: number }>()

/**
 * Create Supabase client for database operations
 */
export function createSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase credentials in environment variables')
  }

  return createClient(supabaseUrl, supabaseKey)
}

/**
 * Resolve condition ID to market ID using Supabase markets table
 */
export async function resolveConditionToMarket(
  conditionId: string,
  supabase: ReturnType<typeof createSupabaseClient>
): Promise<string | null> {
  // Check cache
  if (conditionToMarketCache.has(conditionId)) {
    return conditionToMarketCache.get(conditionId)!
  }

  // Query Supabase for market with this condition
  const { data, error } = await supabase
    .from('markets')
    .select('market_id')
    .eq('condition_id', conditionId)
    .single()

  if (error || !data) {
    // Don't warn on every miss - this is expected for some conditions
    return null
  }

  conditionToMarketCache.set(conditionId, data.market_id)
  return data.market_id
}

/**
 * Resolve token ID to condition and outcome index
 */
export async function resolveTokenIdToCondition(
  tokenId: string
): Promise<{ condition: string; outcome: number } | null> {
  // Check cache
  if (tokenIdCache.has(tokenId)) {
    return tokenIdCache.get(tokenId)!
  }

  // Token ID "0" is USDC collateral, not an outcome token
  if (tokenId === '0') {
    return null
  }

  // Query Goldsky positions subgraph
  const tokenInfo = await resolveTokenId(tokenId)

  if (!tokenInfo) {
    return null
  }

  const result = {
    condition: tokenInfo.condition.id,
    outcome: parseInt(tokenInfo.outcomeIndex),
  }

  tokenIdCache.set(tokenId, result)
  return result
}

/**
 * Process a single trade event into our standard format
 */
export async function processTradeForWallet(
  trade: OrderFilledEvent,
  walletAddress: string,
  supabase: ReturnType<typeof createSupabaseClient>
): Promise<ProcessedTrade | null> {
  try {
    const isWalletMaker = trade.maker.toLowerCase() === walletAddress.toLowerCase()

    // Determine which asset is the outcome token (not USDC)
    const makerIsToken = trade.makerAssetId !== '0'
    const takerIsToken = trade.takerAssetId !== '0'

    if (!makerIsToken && !takerIsToken) {
      // Both are USDC? Skip (shouldn't happen)
      return null
    }

    // Get token ID and resolve to condition
    const tokenId = makerIsToken ? trade.makerAssetId : trade.takerAssetId
    const tokenInfo = await resolveTokenIdToCondition(tokenId)

    if (!tokenInfo) {
      return null
    }

    // Resolve condition to market
    const marketId = await resolveConditionToMarket(tokenInfo.condition, supabase)

    if (!marketId) {
      // Still store the trade with condition_id even if we don't have market_id
      // This allows us to join later when markets are added
    }

    // Calculate amounts and side
    const makerAmount = parseFloat(trade.makerAmountFilled) / 1e6 // USDC has 6 decimals
    const takerAmount = parseFloat(trade.takerAmountFilled) / 1e6

    let side: 'YES' | 'NO'
    let shares: number
    let usdValue: number
    let price: number

    if (isWalletMaker) {
      // Wallet is maker
      if (makerIsToken) {
        // Maker gave tokens, received USDC - this is a SELL
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        // Selling means exiting a position, need to track differently
        // For now, treat as opposite side trade
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        // Maker gave USDC, received tokens - this is a BUY
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    } else {
      // Wallet is taker
      if (takerIsToken) {
        // Taker gave tokens, received USDC - this is a SELL
        shares = takerAmount
        usdValue = makerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'NO' : 'YES'
      } else {
        // Taker gave USDC, received tokens - this is a BUY
        shares = makerAmount
        usdValue = takerAmount
        price = usdValue / shares
        side = tokenInfo.outcome === 1 ? 'YES' : 'NO'
      }
    }

    return {
      trade_id: trade.id,
      wallet_address: walletAddress,
      market_id: marketId || '', // Empty string if no market found
      condition_id: tokenInfo.condition,
      timestamp: new Date(parseInt(trade.timestamp) * 1000),
      side,
      entry_price: price,
      shares,
      usd_value: usdValue,
      transaction_hash: trade.transactionHash,
      is_closed: false, // We'll update this later when we track position lifecycle
    }
  } catch (error) {
    console.error(`   ❌ Error processing trade ${trade.id}:`, error)
    return null
  }
}

/**
 * Insert trades into ClickHouse
 */
export async function insertTradesIntoClickHouse(
  trades: ProcessedTrade[]
): Promise<{ success: boolean; error?: string }> {
  if (trades.length === 0) {
    return { success: true }
  }

  try {
    await clickhouse.insert({
      table: 'trades_raw',
      values: trades.map((t) => ({
        trade_id: t.trade_id,
        wallet_address: t.wallet_address,
        market_id: t.market_id || 'unknown', // Store even if market not found
        condition_id: t.condition_id, // Store condition for future joins
        timestamp: Math.floor(t.timestamp.getTime() / 1000),
        side: t.side,
        entry_price: t.entry_price,
        exit_price: null,
        shares: t.shares,
        usd_value: t.usd_value,
        pnl: null,
        is_closed: t.is_closed,
        transaction_hash: t.transaction_hash,
        created_at: Math.floor(Date.now() / 1000),
      })),
      format: 'JSONEachRow',
    })

    return { success: true }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    return { success: false, error: errorMessage }
  }
}

/**
 * Update sync metadata in Supabase
 */
export async function updateSyncMetadata(
  metadata: SyncMetadata,
  supabase: ReturnType<typeof createSupabaseClient>
): Promise<void> {
  const { error } = await supabase.from('wallet_sync_metadata').upsert(
    {
      wallet_address: metadata.wallet_address,
      sync_status: metadata.sync_status,
      total_trades_synced: metadata.total_trades_synced,
      total_trades_processed: metadata.total_trades_processed,
      last_synced_at: metadata.last_synced_at?.toISOString(),
      last_error: metadata.last_error,
      error_count: metadata.error_count,
      sync_duration_ms: metadata.sync_duration_ms,
      trades_per_second: metadata.trades_per_second,
      last_trade_timestamp: metadata.last_trade_timestamp?.toISOString(),
      sync_version: '1.0',
    },
    {
      onConflict: 'wallet_address',
    }
  )

  if (error) {
    console.error(`Failed to update sync metadata for ${metadata.wallet_address}:`, error)
  }
}

/**
 * Get sync metadata for a wallet
 */
export async function getSyncMetadata(
  walletAddress: string,
  supabase: ReturnType<typeof createSupabaseClient>
): Promise<SyncMetadata | null> {
  const { data, error } = await supabase
    .from('wallet_sync_metadata')
    .select('*')
    .eq('wallet_address', walletAddress)
    .single()

  if (error || !data) {
    return null
  }

  return {
    wallet_address: data.wallet_address,
    sync_status: data.sync_status,
    total_trades_synced: data.total_trades_synced,
    total_trades_processed: data.total_trades_processed,
    last_synced_at: data.last_synced_at ? new Date(data.last_synced_at) : undefined,
    last_error: data.last_error,
    error_count: data.error_count,
    sync_duration_ms: data.sync_duration_ms,
    trades_per_second: data.trades_per_second,
    last_trade_timestamp: data.last_trade_timestamp ? new Date(data.last_trade_timestamp) : undefined,
  }
}

/**
 * Sync trades for a single wallet
 */
export async function syncWalletTrades(
  walletAddress: string,
  supabase: ReturnType<typeof createSupabaseClient>,
  options: {
    verbose?: boolean
    skipIfRecent?: boolean // Skip if synced within last 24 hours
  } = {}
): Promise<SyncResult> {
  const startTime = Date.now()
  const { verbose = false, skipIfRecent = false } = options

  if (verbose) {
    console.log(`\n🔄 Syncing trades for wallet: ${walletAddress}`)
  }

  // Check if we should skip
  if (skipIfRecent) {
    const metadata = await getSyncMetadata(walletAddress, supabase)
    if (
      metadata?.sync_status === 'completed' &&
      metadata.last_synced_at &&
      Date.now() - metadata.last_synced_at.getTime() < 24 * 60 * 60 * 1000
    ) {
      if (verbose) {
        console.log(
          `   ⏭️  Skipping - already synced ${Math.round((Date.now() - metadata.last_synced_at.getTime()) / (60 * 60 * 1000))}h ago`
        )
      }
      return {
        success: true,
        wallet_address: walletAddress,
        trades_fetched: 0,
        trades_processed: 0,
        trades_inserted: 0,
        duration_ms: Date.now() - startTime,
      }
    }
  }

  try {
    // Mark as syncing
    await updateSyncMetadata(
      {
        wallet_address: walletAddress,
        sync_status: 'syncing',
        total_trades_synced: 0,
        total_trades_processed: 0,
        error_count: 0,
        sync_duration_ms: 0,
        trades_per_second: 0,
      },
      supabase
    )

    // Fetch all trades from Goldsky
    if (verbose) {
      console.log('   📡 Fetching trades from Goldsky...')
    }
    const trades = await fetchAllWalletTrades(walletAddress)
    if (verbose) {
      console.log(`   ✅ Fetched ${trades.length} raw trade events`)
    }

    if (trades.length === 0) {
      // No trades found
      await updateSyncMetadata(
        {
          wallet_address: walletAddress,
          sync_status: 'completed',
          total_trades_synced: 0,
          total_trades_processed: 0,
          last_synced_at: new Date(),
          error_count: 0,
          sync_duration_ms: Date.now() - startTime,
          trades_per_second: 0,
        },
        supabase
      )

      return {
        success: true,
        wallet_address: walletAddress,
        trades_fetched: 0,
        trades_processed: 0,
        trades_inserted: 0,
        duration_ms: Date.now() - startTime,
      }
    }

    // Process trades
    if (verbose) {
      console.log('   🔄 Processing trades...')
    }
    const processedTrades: ProcessedTrade[] = []

    for (const trade of trades) {
      const processed = await processTradeForWallet(trade, walletAddress, supabase)
      if (processed) {
        processedTrades.push(processed)
      }
    }

    if (verbose) {
      console.log(`   ✅ Processed ${processedTrades.length} valid trades`)
    }

    // Insert into ClickHouse
    if (verbose) {
      console.log(`   📥 Inserting ${processedTrades.length} trades into ClickHouse...`)
    }

    const insertResult = await insertTradesIntoClickHouse(processedTrades)

    if (!insertResult.success) {
      throw new Error(`Failed to insert trades: ${insertResult.error}`)
    }

    // Get last trade timestamp
    const lastTradeTimestamp =
      processedTrades.length > 0
        ? processedTrades.reduce((latest, trade) =>
            trade.timestamp > latest ? trade.timestamp : latest
          , processedTrades[0].timestamp)
        : undefined

    // Update metadata as completed
    const duration = Date.now() - startTime
    await updateSyncMetadata(
      {
        wallet_address: walletAddress,
        sync_status: 'completed',
        total_trades_synced: processedTrades.length,
        total_trades_processed: trades.length,
        last_synced_at: new Date(),
        error_count: 0,
        sync_duration_ms: duration,
        trades_per_second: processedTrades.length / (duration / 1000),
        last_trade_timestamp: lastTradeTimestamp,
      },
      supabase
    )

    if (verbose) {
      console.log(`   ✅ Sync complete! (${(duration / 1000).toFixed(1)}s)`)
    }

    return {
      success: true,
      wallet_address: walletAddress,
      trades_fetched: trades.length,
      trades_processed: processedTrades.length,
      trades_inserted: processedTrades.length,
      duration_ms: duration,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    const duration = Date.now() - startTime

    // Get previous error count
    const prevMetadata = await getSyncMetadata(walletAddress, supabase)
    const errorCount = (prevMetadata?.error_count || 0) + 1

    // Update metadata as failed
    await updateSyncMetadata(
      {
        wallet_address: walletAddress,
        sync_status: 'failed',
        total_trades_synced: 0,
        total_trades_processed: 0,
        last_error: errorMessage,
        error_count: errorCount,
        sync_duration_ms: duration,
        trades_per_second: 0,
      },
      supabase
    )

    if (verbose) {
      console.error(`   ❌ Sync failed: ${errorMessage}`)
    }

    return {
      success: false,
      wallet_address: walletAddress,
      trades_fetched: 0,
      trades_processed: 0,
      trades_inserted: 0,
      duration_ms: duration,
      error: errorMessage,
    }
  }
}

/**
 * Clear caches (useful for testing or when starting a new batch)
 */
export function clearCaches() {
  conditionToMarketCache.clear()
  tokenIdCache.clear()
}
