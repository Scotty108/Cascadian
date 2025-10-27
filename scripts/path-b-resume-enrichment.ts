#!/usr/bin/env npx tsx

/**
 * Path B: Resume enrichment from existing market_resolution_map
 *
 * Assumes market_resolution_map already exists with 9,926 resolutions
 * Proceeds with:
 * 1. Wipe corrupted data
 * 2. Fetch and deduplicate trades
 * 3. Calculate corrected P&L
 * 4. Write to ClickHouse
 * 5. Generate top 50 leaderboard
 * 6. Validate rank 1 against Goldsky
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient as createClickHouseClient } from '@clickhouse/client'
import { fetchWalletPnL } from '@/lib/goldsky/client'

const clickhouse = createClickHouseClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const BATCH_SIZE = 200
const FEE_RATE = 0.002

// ============================================================================
// STEP 1: Check resolution map
// ============================================================================

async function checkResolutionMap() {
  console.log('📊 STEP 1: Checking existing market_resolution_map...')

  try {
    const result = await clickhouse.query({
      query: 'SELECT COUNT(*) as count FROM market_resolution_map',
      format: 'JSONEachRow',
    })
    const data: any = await result.json()
    const count = data[0]?.count || 0
    console.log(`✅ Found ${count} resolutions in existing map\n`)
    return count
  } catch (error) {
    console.log('❌ market_resolution_map table does not exist')
    console.log('   Please run fix-enrichment-pipeline-comprehensive.ts first\n')
    throw error
  }
}

// ============================================================================
// STEP 2: Wipe corrupted data
// ============================================================================

async function wipeCorruptedData() {
  console.log('📊 STEP 2: Wiping corrupted pnl_net, pnl_gross, was_win from ClickHouse...')

  await clickhouse.command({
    query: `
      ALTER TABLE trades_raw
      UPDATE
        pnl_net = NULL,
        pnl_gross = NULL,
        was_win = NULL,
        is_closed = false
      WHERE pnl_net IS NOT NULL OR pnl_gross IS NOT NULL
    `,
  })

  console.log('✅ Corrupted data wiped\n')
}

// ============================================================================
// STEP 3: Fetch and deduplicate trades
// ============================================================================

interface Closure {
  key: string
  trade_ids: string[]
  total_shares: number
  total_cost: number
  avg_entry_price: number
  resolved_outcome: string
  side: string
}

async function fetchAndDeduplicateTrades() {
  console.log('📊 STEP 3: Fetching all trades with resolution data...')

  const tradesQuery = `
    SELECT
      t.trade_id,
      t.wallet_address,
      t.market_id,
      t.side,
      t.timestamp,
      t.shares,
      t.usd_value,
      t.tx_hash,
      m.resolved_outcome
    FROM trades_raw t
    INNER JOIN market_resolution_map m ON t.market_id = m.market_id
    WHERE t.is_closed = false
    ORDER BY t.timestamp DESC
  `

  const tradesResult = await clickhouse.query({
    query: tradesQuery,
    format: 'JSONEachRow',
  })

  const trades: any[] = await tradesResult.json()

  console.log(`✅ Found ${trades.length.toLocaleString()} trades with resolution data\n`)

  if (trades.length === 0) {
    console.log('⚠️  No trades to enrich\n')
    return []
  }

  // Deduplicate: Group fills by closure key
  console.log('📊 Deduplicating fills into logical closures...')

  const closureMap = new Map<string, Closure>()

  for (const trade of trades) {
    // Create stable grouping key
    const closeMinute = Math.floor(trade.timestamp / 60)
    const keyStr = `${trade.wallet_address}|${trade.market_id}|${trade.side}|${closeMinute}|${trade.tx_hash || ''}`

    if (!closureMap.has(keyStr)) {
      closureMap.set(keyStr, {
        key: keyStr,
        trade_ids: [],
        total_shares: 0,
        total_cost: 0,
        avg_entry_price: 0,
        resolved_outcome: trade.resolved_outcome,
        side: trade.side,
      })
    }

    const closure = closureMap.get(keyStr)!
    closure.trade_ids.push(trade.trade_id)
    closure.total_shares += trade.shares
    closure.total_cost += trade.usd_value
  }

  // Calculate average entry price for each closure
  for (const closure of closureMap.values()) {
    closure.avg_entry_price = closure.total_shares > 0
      ? closure.total_cost / closure.total_shares
      : 0
  }

  const uniqueClosures = Array.from(closureMap.values())

  console.log(`📊 Deduplication Results:`)
  console.log(`   Total fills: ${trades.length.toLocaleString()}`)
  console.log(`   Unique closures: ${uniqueClosures.length.toLocaleString()}`)
  console.log(`   Dedup ratio: ${(trades.length / uniqueClosures.length).toFixed(2)}x\n`)

  return uniqueClosures
}

// ============================================================================
// STEP 4: Calculate corrected P&L
// ============================================================================

interface EnrichedTrade {
  trade_id: string
  was_win: number
  close_price: number
  pnl_gross: number
  pnl_net: number
  fee_usd: number
}

function calculateCorrectPnL(closures: Closure[]): EnrichedTrade[] {
  console.log('📊 STEP 4: Calculating P&L with CORRECT outcome logic...')

  const enrichedTrades: EnrichedTrade[] = []

  for (const closure of closures) {
    // FIX BUG B: Correct win/loss logic
    const won = (closure.side === closure.resolved_outcome)
    const was_win = won ? 1 : 0
    const close_price = won ? 1.0 : 0.0

    // Calculate P&L per token
    const payout_per_token = won ? 1.0 : 0.0
    const pnl_per_token = payout_per_token - closure.avg_entry_price

    // Total P&L for the closure
    const pnl_gross = pnl_per_token * closure.total_shares
    const fee_usd = closure.total_cost * FEE_RATE
    const pnl_net = pnl_gross - fee_usd

    // Apply this P&L to ALL trade_ids in the closure
    for (const trade_id of closure.trade_ids) {
      enrichedTrades.push({
        trade_id,
        was_win,
        close_price,
        pnl_gross,
        pnl_net,
        fee_usd,
      })
    }
  }

  console.log(`✅ Calculated P&L for ${enrichedTrades.length.toLocaleString()} trades\n`)

  return enrichedTrades
}

// ============================================================================
// STEP 5: Write corrected P&L to ClickHouse
// ============================================================================

async function writeCorrectPnL(enrichedTrades: EnrichedTrade[]) {
  console.log('📊 STEP 5: Writing corrected P&L to ClickHouse in batches...')

  let written = 0

  for (let i = 0; i < enrichedTrades.length; i += BATCH_SIZE) {
    const batch = enrichedTrades.slice(i, i + BATCH_SIZE)

    const tradeIds = batch.map(t => `'${t.trade_id}'`).join(',')
    const wasWinUpdates = batch.map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.was_win}`).join(' ')
    const closePriceUpdates = batch.map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.close_price}`).join(' ')
    const pnlGrossUpdates = batch.map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.pnl_gross}`).join(' ')
    const pnlNetUpdates = batch.map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.pnl_net}`).join(' ')
    const feeUpdates = batch.map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.fee_usd}`).join(' ')

    await clickhouse.command({
      query: `
        ALTER TABLE trades_raw
        UPDATE
          was_win = CASE ${wasWinUpdates} END,
          is_closed = true,
          close_price = CASE ${closePriceUpdates} END,
          pnl_gross = CASE ${pnlGrossUpdates} END,
          pnl_net = CASE ${pnlNetUpdates} END,
          fee_usd = CASE ${feeUpdates} END
        WHERE trade_id IN (${tradeIds})
      `,
    })

    written += batch.length

    if ((i / BATCH_SIZE) % 20 === 0 && i > 0) {
      const progress = (written / enrichedTrades.length * 100).toFixed(1)
      console.log(`   Progress: ${written.toLocaleString()} / ${enrichedTrades.length.toLocaleString()} (${progress}%)`)
    }
  }

  console.log(`✅ Wrote ${written.toLocaleString()} enriched trades\n`)
}

// ============================================================================
// STEP 6: Query top 50 wallets
// ============================================================================

async function queryTop50Wallets() {
  console.log('📊 STEP 6: Querying top 50 wallets with CORRECTED pnl_net...\n')

  const query = `
    SELECT
      wallet_address,
      SUM(pnl_net) as pnl_sum_usd,
      COUNT(*) as enriched_trades
    FROM trades_raw
    WHERE pnl_net IS NOT NULL
    GROUP BY wallet_address
    HAVING enriched_trades >= 5
    ORDER BY pnl_sum_usd DESC
    LIMIT 50
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const wallets: any[] = await result.json()

  console.log('═══════════════════════════════════════════════════════════')
  console.log('    TOP 50 WALLETS BY CORRECTED P&L (DELIVERABLE 1)       ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log('Rank | Wallet Address                              | P&L (USD)    | Trades')
  console.log('-----+---------------------------------------------+--------------+--------')

  wallets.forEach((w, i) => {
    const rank = (i + 1).toString().padStart(4)
    const address = w.wallet_address.substring(0, 42).padEnd(42)
    const pnl = `$${parseFloat(w.pnl_sum_usd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.padStart(12)
    const trades = w.enriched_trades.toString().padStart(6)

    console.log(`${rank} | ${address} | ${pnl} | ${trades}`)
  })

  console.log('\n═══════════════════════════════════════════════════════════\n')

  return wallets
}

// ============================================================================
// STEP 7: Validate rank 1 wallet against Goldsky
// ============================================================================

async function validateRank1Wallet(wallets: any[]) {
  console.log('📊 STEP 7: Validating rank 1 wallet against Goldsky (DELIVERABLE 2)...\n')

  if (wallets.length === 0) {
    console.log('❌ No wallets to validate\n')
    return
  }

  const rank1 = wallets[0]
  const walletAddress = rank1.wallet_address
  const pnl_clickhouse = parseFloat(rank1.pnl_sum_usd)

  console.log(`Fetching Goldsky P&L for rank 1 wallet: ${walletAddress}`)

  try {
    const goldskyData = await fetchWalletPnL(walletAddress)

    // Apply correction: divide by 13.2399 and 1e6
    const realizedPnl = goldskyData.realized_pnl || 0
    const pnl_goldsky_corrected = realizedPnl / 13.2399 / 1e6

    const percent_diff = pnl_clickhouse !== 0
      ? ((pnl_clickhouse - pnl_goldsky_corrected) / pnl_goldsky_corrected * 100)
      : 0

    console.log('\n═══════════════════════════════════════════════════════════')
    console.log('         RANK 1 WALLET VALIDATION (DELIVERABLE 2)         ')
    console.log('═══════════════════════════════════════════════════════════\n')

    console.log(`Wallet Address: ${walletAddress}`)
    console.log(`pnl_sum_usd_clickhouse: $${pnl_clickhouse.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`pnl_sum_usd_goldsky_corrected: $${pnl_goldsky_corrected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    console.log(`percent_diff: ${percent_diff.toFixed(2)}%`)

    console.log('\n═══════════════════════════════════════════════════════════\n')

    if (Math.abs(percent_diff) > 1000) {
      console.log('⚠️  WARNING: Ratio is still crazy (>1000%). Dedupe or payout logic may still be wrong.')
    } else if (Math.abs(percent_diff) > 100) {
      console.log('⚠️  WARNING: Difference is large (>100%). May need further investigation.')
    } else {
      console.log('✅ Validation passed - difference is within reasonable range.')
    }

  } catch (error) {
    console.error('❌ Error fetching Goldsky data:', error)
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('   PATH B: Resume Enrichment with Corrected Pipeline      ')
  console.log('═══════════════════════════════════════════════════════════\n')

  try {
    const resolutionCount = await checkResolutionMap()

    if (resolutionCount === 0) {
      console.log('❌ No resolutions in map. Cannot proceed.')
      return
    }

    await wipeCorruptedData()

    const closures = await fetchAndDeduplicateTrades()

    if (closures.length === 0) {
      console.log('⚠️  No trades to enrich.')
      return
    }

    const enrichedTrades = calculateCorrectPnL(closures)

    await writeCorrectPnL(enrichedTrades)

    const wallets = await queryTop50Wallets()

    await validateRank1Wallet(wallets)

    console.log('✅ PATH B COMPLETE!\n')

  } catch (error) {
    console.error('\n❌ Fatal error:', error)
    throw error
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
