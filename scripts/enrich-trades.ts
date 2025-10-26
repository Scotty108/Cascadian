/**
 * Trade Enrichment Pipeline
 *
 * Fills the critical data gap between raw trade ingestion and metrics calculation.
 *
 * PROBLEM:
 * - Sync scripts populate trades_raw with basic fields (trade_id, wallet, timestamp, etc.)
 * - But they DON'T populate the metric calculation fields that ClickHouse needs
 * - This leaves outcome, is_closed, pnl_gross, pnl_net, hours_held, etc. as NULL
 *
 * SOLUTION:
 * - Fetch resolved markets from Supabase
 * - Match trades to markets by condition_id
 * - Calculate all metric fields based on market resolution
 * - Update ClickHouse trades_raw in batches
 *
 * USAGE:
 *   npx tsx scripts/enrich-trades.ts              # Enrich all trades
 *   npx tsx scripts/enrich-trades.ts --limit 1000 # Process first 1000
 *   npx tsx scripts/enrich-trades.ts --condition-id <id> # Single market
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ============================================================================
// Types
// ============================================================================

interface ResolvedMarket {
  market_id: string
  condition_id: string
  title: string
  closed: boolean
  end_date: string | null
  current_price: number // Final YES price (0-1)
  raw_polymarket_data: {
    conditionId?: string
    clobTokenIds?: string[]
    outcomes?: string[]
    outcomePrices?: string
    resolvedOutcome?: number // 0 or 1 (NO or YES)
    [key: string]: unknown
  } | null
}

interface TradeToEnrich {
  trade_id: string
  wallet_address: string
  market_id: string
  condition_id: string
  timestamp: number // Unix timestamp in seconds
  side: 'YES' | 'NO'
  entry_price: number
  shares: number
  usd_value: number
}

interface EnrichmentStats {
  totalTrades: number
  enrichedTrades: number
  skippedNoMarket: number
  skippedUnresolved: number
  errors: number
  startTime: number
  batchesProcessed: number
}

// ============================================================================
// Configuration
// ============================================================================

const BATCH_SIZE = 10000
const CLICKHOUSE_BATCH_SIZE = 200 // Limit for UPDATE CASE statements to avoid max_query_size errors
const FEE_RATE = 0.02 // 2% fee assumption (maker/taker average)

// ============================================================================
// Market Resolution Fetcher
// ============================================================================

/**
 * Fetch all resolved markets from Supabase
 */
async function fetchResolvedMarkets(): Promise<Map<string, ResolvedMarket>> {
  console.log('📡 Fetching resolved markets from Supabase...')

  const { data, error } = await supabase
    .from('markets')
    .select('market_id, condition_id, title, closed, end_date, current_price, raw_polymarket_data')
    .eq('closed', true)
    .not('condition_id', 'is', null)

  if (error) {
    throw new Error(`Failed to fetch markets: ${error.message}`)
  }

  if (!data || data.length === 0) {
    console.log('⚠️  No resolved markets found in Supabase')
    return new Map()
  }

  console.log(`✅ Fetched ${data.length} resolved markets`)

  // Build condition_id -> market map
  const marketMap = new Map<string, ResolvedMarket>()

  for (const market of data) {
    if (market.condition_id) {
      marketMap.set(market.condition_id, market as ResolvedMarket)
    }
  }

  console.log(`📊 Indexed ${marketMap.size} markets by condition_id\n`)

  return marketMap
}

// ============================================================================
// Trade Fetcher
// ============================================================================

/**
 * Fetch trades that need enrichment from ClickHouse
 */
async function fetchTradesToEnrich(
  conditionId?: string,
  limit?: number
): Promise<TradeToEnrich[]> {
  let query = `
    SELECT
      trade_id,
      wallet_address,
      market_id,
      condition_id,
      toUnixTimestamp(timestamp) as timestamp,
      side,
      entry_price,
      shares,
      usd_value
    FROM trades_raw
    WHERE condition_id != ''
      AND outcome IS NULL
  `

  if (conditionId) {
    query += ` AND condition_id = '${conditionId}'`
  }

  if (limit) {
    query += ` LIMIT ${limit}`
  }

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const trades = await result.json<TradeToEnrich>()
  return Array.isArray(trades) ? trades : []
}

// ============================================================================
// Enrichment Logic
// ============================================================================

/**
 * Calculate outcome from market resolution and trade side
 *
 * @param market - Resolved market data
 * @param tradeSide - YES or NO
 * @returns 1 if trade won, 0 if lost, null if unresolved
 */
function calculateOutcome(
  market: ResolvedMarket,
  tradeSide: 'YES' | 'NO'
): number | null {
  if (!market.closed) {
    return null
  }

  // Try to get resolved outcome from raw data
  // First priority: resolvedOutcome field (if present)
  const resolvedOutcome = market.raw_polymarket_data?.resolvedOutcome

  if (resolvedOutcome !== undefined && resolvedOutcome !== null) {
    // resolvedOutcome: 0 = NO won, 1 = YES won
    if (resolvedOutcome === 1) {
      return tradeSide === 'YES' ? 1 : 0
    } else if (resolvedOutcome === 0) {
      return tradeSide === 'NO' ? 1 : 0
    }
  }

  // Second priority: Parse outcomePrices array
  // Format: ["yesPrice", "noPrice"] e.g. ["0", "1"] means NO won
  const outcomePrices = market.raw_polymarket_data?.outcomePrices

  if (outcomePrices && Array.isArray(outcomePrices) && outcomePrices.length === 2) {
    const yesPrice = parseFloat(outcomePrices[0])
    const noPrice = parseFloat(outcomePrices[1])

    // Use 0.90 threshold for more flexibility (was 0.98)
    if (!isNaN(yesPrice) && !isNaN(noPrice)) {
      if (yesPrice >= 0.90) {
        // YES won (YES price settled at ~$1)
        return tradeSide === 'YES' ? 1 : 0
      } else if (noPrice >= 0.90) {
        // NO won (NO price settled at ~$1)
        return tradeSide === 'NO' ? 1 : 0
      }
    }
  }

  // Fallback: infer from final price
  // If current_price is very close to 1, YES won
  // If current_price is very close to 0, NO won
  const finalPrice = market.current_price

  if (finalPrice >= 0.90) {
    // YES won (price settled at ~$1)
    return tradeSide === 'YES' ? 1 : 0
  } else if (finalPrice <= 0.10) {
    // NO won (price settled at ~$0)
    return tradeSide === 'NO' ? 1 : 0
  }

  // Ambiguous resolution - skip for now
  console.warn(`   ⚠️  Ambiguous resolution for market ${market.market_id} (price: ${finalPrice})`)
  return null
}

/**
 * Calculate hours held from trade timestamp to market resolution
 */
function calculateHoursHeld(
  tradeTimestamp: number,
  resolutionDate: string | null
): number {
  if (!resolutionDate) {
    return 0
  }

  const tradeDate = new Date(tradeTimestamp * 1000)
  const resolveDate = new Date(resolutionDate)
  const diffMs = resolveDate.getTime() - tradeDate.getTime()
  const hours = diffMs / (1000 * 60 * 60)

  return Math.max(0, hours) // Ensure non-negative
}

/**
 * Calculate P&L for a trade
 *
 * For a YES trade:
 * - If YES won (outcome=1): pnl_gross = shares * (1 - entry_price)
 * - If NO won (outcome=0): pnl_gross = -shares * entry_price
 *
 * For a NO trade:
 * - If NO won (outcome=1): pnl_gross = shares * (1 - entry_price)
 * - If YES won (outcome=0): pnl_gross = -shares * entry_price
 */
function calculatePnL(
  side: 'YES' | 'NO',
  outcome: number,
  shares: number,
  entryPrice: number,
  usdValue: number
): { pnl_gross: number; pnl_net: number; fee_usd: number; return_pct: number } {
  let pnl_gross = 0

  if (outcome === 1) {
    // Trade won
    // Winner gets $1 per share, so profit = shares - amount_paid
    pnl_gross = shares - usdValue
  } else {
    // Trade lost
    // Lost the entire investment
    pnl_gross = -usdValue
  }

  // Calculate fees (as % of trade size)
  const fee_usd = usdValue * FEE_RATE

  // Net P&L after fees
  const pnl_net = pnl_gross - fee_usd

  // Return percentage
  const return_pct = usdValue > 0 ? (pnl_net / usdValue) * 100 : 0

  return {
    pnl_gross,
    pnl_net,
    fee_usd,
    return_pct,
  }
}

/**
 * Enrich a single trade with market resolution data
 */
function enrichTrade(
  trade: TradeToEnrich,
  market: ResolvedMarket
): {
  trade_id: string
  outcome: number | null
  is_closed: boolean
  close_price: number
  pnl_gross: number
  pnl_net: number
  hours_held: number
  return_pct: number
  fee_usd: number
} | null {
  // Calculate outcome
  const outcome = calculateOutcome(market, trade.side)

  if (outcome === null) {
    // Can't determine outcome - skip this trade
    return null
  }

  // Calculate P&L
  const { pnl_gross, pnl_net, fee_usd, return_pct } = calculatePnL(
    trade.side,
    outcome,
    trade.shares,
    trade.entry_price,
    trade.usd_value
  )

  // Calculate hours held
  const hours_held = calculateHoursHeld(trade.timestamp, market.end_date)

  // Close price is the final YES price
  const close_price = market.current_price

  return {
    trade_id: trade.trade_id,
    outcome,
    is_closed: true,
    close_price,
    pnl_gross,
    pnl_net,
    hours_held,
    return_pct,
    fee_usd,
  }
}

// ============================================================================
// ClickHouse Update
// ============================================================================

/**
 * Update trades in ClickHouse using ALTER TABLE UPDATE
 */
async function updateTradesInClickHouse(
  enrichedTrades: Array<{
    trade_id: string
    outcome: number | null
    is_closed: boolean
    close_price: number
    pnl_gross: number
    pnl_net: number
    hours_held: number
    return_pct: number
    fee_usd: number
  }>
): Promise<void> {
  if (enrichedTrades.length === 0) {
    return
  }

  // Process in smaller batches for UPDATE queries
  for (let i = 0; i < enrichedTrades.length; i += CLICKHOUSE_BATCH_SIZE) {
    const batch = enrichedTrades.slice(i, i + CLICKHOUSE_BATCH_SIZE)
    const batchNum = Math.floor(i / CLICKHOUSE_BATCH_SIZE) + 1
    const totalBatches = Math.ceil(enrichedTrades.length / CLICKHOUSE_BATCH_SIZE)

    console.log(`   💾 [${batchNum}/${totalBatches}] Updating ${batch.length} trades in ClickHouse...`)

    // Build CASE statements for each field
    const tradeIds = batch.map(t => `'${t.trade_id}'`).join(',')

    // Use multiple ALTER TABLE UPDATE statements for better performance
    try {
      // Update outcome and is_closed
      const outcomeUpdates = batch
        .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.outcome}`)
        .join(' ')

      await clickhouse.command({
        query: `
          ALTER TABLE trades_raw
          UPDATE
            outcome = CASE ${outcomeUpdates} END,
            is_closed = true
          WHERE trade_id IN (${tradeIds})
        `,
      })

      // Update price and P&L fields (use raw numeric values for ClickHouse type inference)
      const closePriceUpdates = batch
        .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.close_price}`)
        .join(' ')
      const pnlGrossUpdates = batch
        .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.pnl_gross}`)
        .join(' ')
      const pnlNetUpdates = batch
        .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.pnl_net}`)
        .join(' ')
      const feeUpdates = batch
        .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.fee_usd}`)
        .join(' ')

      await clickhouse.command({
        query: `
          ALTER TABLE trades_raw
          UPDATE
            close_price = CASE ${closePriceUpdates} END,
            pnl_gross = CASE ${pnlGrossUpdates} END,
            pnl_net = CASE ${pnlNetUpdates} END,
            fee_usd = CASE ${feeUpdates} END
          WHERE trade_id IN (${tradeIds})
        `,
      })

      // Update time and return metrics (use raw numeric values for ClickHouse type inference)
      const hoursHeldUpdates = batch
        .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.hours_held}`)
        .join(' ')
      const returnPctUpdates = batch
        .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.return_pct}`)
        .join(' ')

      await clickhouse.command({
        query: `
          ALTER TABLE trades_raw
          UPDATE
            hours_held = CASE ${hoursHeldUpdates} END,
            return_pct = CASE ${returnPctUpdates} END
          WHERE trade_id IN (${tradeIds})
        `,
      })

      console.log(`   ✅ Batch ${batchNum}/${totalBatches} updated successfully`)
    } catch (error) {
      console.error(`   ❌ Failed to update batch ${batchNum}:`, error)
      throw error
    }

    // Small delay between batches to avoid overloading
    if (i + CLICKHOUSE_BATCH_SIZE < enrichedTrades.length) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }
  }
}

// ============================================================================
// Progress Reporting
// ============================================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

function printProgress(stats: EnrichmentStats, trades: TradeToEnrich[]): void {
  const elapsed = Date.now() - stats.startTime
  const processed = stats.enrichedTrades + stats.skippedNoMarket + stats.skippedUnresolved
  const rate = processed / (elapsed / 1000)
  const remaining = trades.length - processed
  const eta = remaining / rate

  console.log(`\n📊 Progress Report:`)
  console.log(`   Processed: ${processed.toLocaleString()}/${trades.length.toLocaleString()} trades`)
  console.log(`   Enriched: ${stats.enrichedTrades.toLocaleString()}`)
  console.log(`   Skipped (no market): ${stats.skippedNoMarket.toLocaleString()}`)
  console.log(`   Skipped (unresolved): ${stats.skippedUnresolved.toLocaleString()}`)
  console.log(`   Errors: ${stats.errors}`)
  console.log(`   Rate: ${rate.toFixed(1)} trades/sec`)
  console.log(`   Elapsed: ${formatDuration(elapsed)}`)
  console.log(`   ETA: ${formatDuration(eta * 1000)}`)
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function enrichTrades(
  conditionId?: string,
  limit?: number
): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('           TRADE ENRICHMENT PIPELINE                       ')
  console.log('═══════════════════════════════════════════════════════════\n')

  const stats: EnrichmentStats = {
    totalTrades: 0,
    enrichedTrades: 0,
    skippedNoMarket: 0,
    skippedUnresolved: 0,
    errors: 0,
    startTime: Date.now(),
    batchesProcessed: 0,
  }

  try {
    // Step 1: Fetch resolved markets
    const marketMap = await fetchResolvedMarkets()

    if (marketMap.size === 0) {
      console.log('❌ No resolved markets found. Cannot enrich trades.')
      return
    }

    // Step 2: Fetch trades to enrich
    console.log('📡 Fetching trades to enrich from ClickHouse...')
    const trades = await fetchTradesToEnrich(conditionId, limit)

    if (trades.length === 0) {
      console.log('✅ No trades need enrichment. All done!')
      return
    }

    stats.totalTrades = trades.length
    console.log(`✅ Found ${trades.length.toLocaleString()} trades to enrich\n`)

    // Step 3: Process in batches
    console.log(`🔄 Processing in batches of ${BATCH_SIZE.toLocaleString()}...\n`)

    for (let i = 0; i < trades.length; i += BATCH_SIZE) {
      const batch = trades.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      const totalBatches = Math.ceil(trades.length / BATCH_SIZE)

      console.log(`\n[Batch ${batchNum}/${totalBatches}] Processing ${batch.length} trades...`)

      const enrichedTrades: Array<{
        trade_id: string
        outcome: number | null
        is_closed: boolean
        close_price: number
        pnl_gross: number
        pnl_net: number
        hours_held: number
        return_pct: number
        fee_usd: number
      }> = []

      // Enrich each trade in the batch
      for (const trade of batch) {
        try {
          // Find market by condition_id
          const market = marketMap.get(trade.condition_id)

          if (!market) {
            stats.skippedNoMarket++
            continue
          }

          // Enrich the trade
          const enriched = enrichTrade(trade, market)

          if (!enriched) {
            stats.skippedUnresolved++
            continue
          }

          enrichedTrades.push(enriched)
          stats.enrichedTrades++
        } catch (error) {
          console.error(`   ⚠️  Error enriching trade ${trade.trade_id}:`, error)
          stats.errors++
        }
      }

      // Update ClickHouse with enriched data
      if (enrichedTrades.length > 0) {
        await updateTradesInClickHouse(enrichedTrades)
      }

      stats.batchesProcessed++

      // Print progress every 5 batches
      if (batchNum % 5 === 0 || batchNum === totalBatches) {
        printProgress(stats, trades)
      }
    }

    // Step 4: Verification
    console.log('\n\n🔍 Verifying enrichment...')
    await verifyEnrichment()

    // Step 5: Summary
    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('                     SUMMARY                               ')
    console.log('═══════════════════════════════════════════════════════════\n')

    const elapsed = Date.now() - stats.startTime
    const successRate = ((stats.enrichedTrades / stats.totalTrades) * 100).toFixed(1)

    console.log(`✅ Total trades processed: ${stats.totalTrades.toLocaleString()}`)
    console.log(`✅ Successfully enriched: ${stats.enrichedTrades.toLocaleString()} (${successRate}%)`)
    console.log(`⚠️  Skipped (no market): ${stats.skippedNoMarket.toLocaleString()}`)
    console.log(`⚠️  Skipped (unresolved): ${stats.skippedUnresolved.toLocaleString()}`)
    console.log(`❌ Errors: ${stats.errors}`)
    console.log(`⏱️  Total time: ${formatDuration(elapsed)}`)

    console.log('\n📊 Next steps:')
    console.log('   1. Verify data: npx tsx scripts/verify-clickhouse-data.ts')
    console.log('   2. Calculate metrics: npx tsx scripts/calculate-wallet-metrics.ts')
    console.log('   3. Test queries: SELECT * FROM trades_raw WHERE outcome IS NOT NULL LIMIT 10\n')

  } catch (error) {
    console.error('\n❌ Fatal error during enrichment:', error)
    throw error
  }
}

// ============================================================================
// Verification Queries
// ============================================================================

async function verifyEnrichment(): Promise<void> {
  try {
    // Count enriched vs total trades
    const countResult = await clickhouse.query({
      query: `
        SELECT
          count() as total_trades,
          countIf(outcome IS NOT NULL) as enriched_trades,
          countIf(outcome = 1) as winning_trades,
          countIf(outcome = 0) as losing_trades,
          avg(pnl_net) as avg_pnl,
          sum(pnl_net) as total_pnl
        FROM trades_raw
      `,
      format: 'JSONEachRow',
    })

    const stats = await countResult.json<{
      total_trades: string
      enriched_trades: string
      winning_trades: string
      losing_trades: string
      avg_pnl: string
      total_pnl: string
    }>()

    const data = Array.isArray(stats) ? stats[0] : stats

    console.log('\n📊 Enrichment Statistics:')
    console.log(`   Total trades: ${parseInt(data.total_trades).toLocaleString()}`)
    console.log(`   Enriched trades: ${parseInt(data.enriched_trades).toLocaleString()}`)
    console.log(`   Winning trades: ${parseInt(data.winning_trades).toLocaleString()}`)
    console.log(`   Losing trades: ${parseInt(data.losing_trades).toLocaleString()}`)
    console.log(`   Average P&L: $${parseFloat(data.avg_pnl).toFixed(2)}`)
    console.log(`   Total P&L: $${parseFloat(data.total_pnl).toFixed(2)}`)

    // Sample enriched trades
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          trade_id,
          wallet_address,
          side,
          entry_price,
          outcome,
          pnl_net,
          return_pct,
          hours_held
        FROM trades_raw
        WHERE outcome IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT 5
      `,
      format: 'JSONEachRow',
    })

    const samples = await sampleResult.json()
    const sampleData = Array.isArray(samples) ? samples : [samples]

    console.log('\n📋 Sample Enriched Trades:')
    console.table(sampleData)

  } catch (error) {
    console.error('   ⚠️  Verification failed:', error)
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  const args = process.argv.slice(2)

  let conditionId: string | undefined
  let limit: number | undefined

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--condition-id' && args[i + 1]) {
      conditionId = args[i + 1]
      i++
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1])
      i++
    } else if (args[i] === '--help') {
      console.log(`
Trade Enrichment Pipeline

USAGE:
  npx tsx scripts/enrich-trades.ts [options]

OPTIONS:
  --condition-id <id>   Enrich only trades for a specific market
  --limit <n>           Process only first N trades
  --help                Show this help message

EXAMPLES:
  # Enrich all trades
  npx tsx scripts/enrich-trades.ts

  # Enrich first 1000 trades (testing)
  npx tsx scripts/enrich-trades.ts --limit 1000

  # Enrich trades for a specific market
  npx tsx scripts/enrich-trades.ts --condition-id 0x1234...

WHAT IT DOES:
  1. Fetches resolved markets from Supabase
  2. Matches trades to markets by condition_id
  3. Calculates outcome, P&L, fees, returns, hours held
  4. Updates ClickHouse trades_raw table
  5. Verifies enrichment with statistics
      `)
      process.exit(0)
    }
  }

  await enrichTrades(conditionId, limit)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
