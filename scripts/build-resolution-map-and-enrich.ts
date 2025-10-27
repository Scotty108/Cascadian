#!/usr/bin/env npx tsx

/**
 * Complete Path B: Build Resolution Map and Enrich All Trades
 *
 * Steps:
 * 1. Create market_resolution_map in ClickHouse
 * 2. Populate from fetchEvents (with fixed no-filter client)
 * 3. Update Supabase markets with resolution data
 * 4. Enrich ALL trades using the resolution map
 * 5. Query top 50 wallets by P&L
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { createClient as createClickHouseClient } from '@clickhouse/client'
import { fetchEvents } from '@/lib/polymarket/client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const clickhouse = createClickHouseClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

const BATCH_SIZE = 200

// ============================================================================
// STEP 1: Create Resolution Map Table
// ============================================================================

async function createResolutionMapTable() {
  console.log('\n📊 STEP 1: Creating market_resolution_map table in ClickHouse...')

  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS market_resolution_map (
      market_id String,
      condition_id String,
      resolved_outcome UInt8,
      resolved_timestamp DateTime,
      final_price_settlement Float64
    ) ENGINE = MergeTree()
    ORDER BY market_id
  `

  await clickhouse.command({ query: createTableQuery })
  console.log('✅ Table created/verified\n')
}

// ============================================================================
// STEP 2: Build Resolution Map from Events
// ============================================================================

async function buildResolutionMap() {
  console.log('📊 STEP 2: Fetching all events and building resolution map...')

  const events = await fetchEvents()
  console.log(`✅ Fetched ${events.length} events\n`)

  const resolutions: Array<{
    market_id: string
    condition_id: string
    resolved_outcome: number
    resolved_timestamp: Date
    final_price_settlement: number
  }> = []

  for (const event of events) {
    if (!event.markets || event.markets.length === 0) continue

    for (const market of event.markets) {
      // Check if market has resolution data
      const outcomePrices = market.outcomePrices

      if (!outcomePrices || !Array.isArray(outcomePrices) || outcomePrices.length !== 2) {
        continue
      }

      const yesPrice = parseFloat(outcomePrices[0])
      const noPrice = parseFloat(outcomePrices[1])

      if (isNaN(yesPrice) || isNaN(noPrice)) continue

      let resolvedOutcome: number | null = null
      let finalPrice: number | null = null

      if (yesPrice >= 0.90) {
        resolvedOutcome = 1 // YES won
        finalPrice = yesPrice
      } else if (noPrice >= 0.90) {
        resolvedOutcome = 0 // NO won
        finalPrice = noPrice
      }

      if (resolvedOutcome !== null) {
        resolutions.push({
          market_id: market.id,
          condition_id: market.conditionId || '',
          resolved_outcome: resolvedOutcome,
          resolved_timestamp: market.endDate ? new Date(market.endDate) : new Date(),
          final_price_settlement: finalPrice,
        })
      }
    }
  }

  console.log(`✅ Found ${resolutions.length} resolved markets\n`)

  // Insert into ClickHouse
  console.log('📊 Inserting into ClickHouse...')

  if (resolutions.length > 0) {
    await clickhouse.insert({
      table: 'market_resolution_map',
      values: resolutions,
      format: 'JSONEachRow',
    })

    console.log(`✅ Inserted ${resolutions.length} resolutions into ClickHouse\n`)
  }

  // Update Supabase
  console.log('📊 Updating Supabase markets table...')

  let supabaseUpdated = 0
  for (const res of resolutions) {
    const { error } = await supabase
      .from('markets')
      .update({
        resolved_outcome: res.resolved_outcome,
        resolved_timestamp: res.resolved_timestamp.toISOString(),
      })
      .eq('market_id', res.market_id)

    if (!error) supabaseUpdated++
  }

  console.log(`✅ Updated ${supabaseUpdated} markets in Supabase\n`)

  return resolutions.length
}

// ============================================================================
// STEP 3: Enrich All Trades
// ============================================================================

async function enrichAllTrades() {
  console.log('📊 STEP 3: Enriching all trades...')

  // Get total count
  const countResult = await clickhouse.query({
    query: 'SELECT COUNT(*) as count FROM trades_raw WHERE is_closed = false',
    format: 'JSONEachRow',
  })
  const countData: any = await countResult.json()
  const totalTrades = countData[0]?.count || 0

  console.log(`   Total unenriched trades: ${totalTrades.toLocaleString()}`)

  if (totalTrades === 0) {
    console.log('✅ No trades to enrich\n')
    return
  }

  // Fetch all unenriched trades
  console.log('   Fetching trades...')

  const tradesQuery = `
    SELECT
      t.trade_id,
      t.market_id,
      t.condition_id,
      t.side,
      t.shares,
      t.usd_value,
      m.resolved_outcome,
      m.final_price_settlement
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

  console.log(`   ✅ Found ${trades.length.toLocaleString()} trades with resolution data\n`)

  if (trades.length === 0) {
    console.log('⚠️  No trades matched with resolution map\n')
    return
  }

  // Enrich and batch update
  console.log('   Processing in batches of 200...')

  const FEE_RATE = 0.002
  let enriched = 0

  for (let i = 0; i < trades.length; i += BATCH_SIZE) {
    const batch = trades.slice(i, i + BATCH_SIZE)

    const updates = batch.map(trade => {
      const outcome = trade.side === 'YES'
        ? (trade.resolved_outcome === 1 ? 1 : 0)
        : (trade.resolved_outcome === 0 ? 1 : 0)

      const pnl_gross = outcome === 1
        ? trade.shares - trade.usd_value
        : -trade.usd_value

      const fee_usd = trade.usd_value * FEE_RATE
      const pnl_net = pnl_gross - fee_usd

      return {
        trade_id: trade.trade_id,
        outcome,
        close_price: outcome === 1 ? 1.0 : 0.0,
        pnl_gross,
        pnl_net,
        fee_usd,
      }
    })

    // Build UPDATE queries
    const tradeIds = updates.map(u => `'${u.trade_id}'`).join(',')

    const outcomeUpdates = updates.map(u => `WHEN trade_id = '${u.trade_id}' THEN ${u.outcome}`).join(' ')
    const closePriceUpdates = updates.map(u => `WHEN trade_id = '${u.trade_id}' THEN ${u.close_price}`).join(' ')
    const pnlGrossUpdates = updates.map(u => `WHEN trade_id = '${u.trade_id}' THEN ${u.pnl_gross}`).join(' ')
    const pnlNetUpdates = updates.map(u => `WHEN trade_id = '${u.trade_id}' THEN ${u.pnl_net}`).join(' ')
    const feeUpdates = updates.map(u => `WHEN trade_id = '${u.trade_id}' THEN ${u.fee_usd}`).join(' ')

    await clickhouse.command({
      query: `
        ALTER TABLE trades_raw
        UPDATE
          outcome = CASE ${outcomeUpdates} END,
          is_closed = true,
          close_price = CASE ${closePriceUpdates} END,
          pnl_gross = CASE ${pnlGrossUpdates} END,
          pnl_net = CASE ${pnlNetUpdates} END,
          fee_usd = CASE ${feeUpdates} END
        WHERE trade_id IN (${tradeIds})
      `,
    })

    enriched += batch.length

    if ((i / BATCH_SIZE) % 10 === 0) {
      const progress = (enriched / trades.length * 100).toFixed(1)
      console.log(`   Progress: ${enriched.toLocaleString()} / ${trades.length.toLocaleString()} (${progress}%)`)
    }
  }

  console.log(`\n✅ Enriched ${enriched.toLocaleString()} trades\n`)
}

// ============================================================================
// STEP 4: Query Top 50 Wallets
// ============================================================================

async function queryTop50Wallets() {
  console.log('📊 STEP 4: Querying top 50 wallets by P&L...\n')

  const query = `
    SELECT
      wallet_address,
      SUM(pnl_net) as pnl_sum_usd,
      COUNT(*) as enriched_trades
    FROM trades_raw
    WHERE pnl_net IS NOT NULL
    GROUP BY wallet_address
    ORDER BY pnl_sum_usd DESC
    LIMIT 50
  `

  const result = await clickhouse.query({
    query,
    format: 'JSONEachRow',
  })

  const wallets: any[] = await result.json()

  console.log('═══════════════════════════════════════════════════════════')
  console.log('          TOP 50 WALLETS BY P&L (Path B)                  ')
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

  console.log('\n═══════════════════════════════════════════════════════════')
  console.log(`Total wallets in leaderboard: ${wallets.length}`)
  console.log('═══════════════════════════════════════════════════════════\n')

  // Return wallet addresses for Path A
  return wallets.map(w => w.wallet_address)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('     PATH B: BUILD RESOLUTION MAP & ENRICH TRADES         ')
  console.log('═══════════════════════════════════════════════════════════')

  try {
    await createResolutionMapTable()
    await buildResolutionMap()
    await enrichAllTrades()
    const topWallets = await queryTop50Wallets()

    console.log('\n✅ PATH B COMPLETE!')
    console.log('\nWallet addresses for Path A comparison:')
    console.log(topWallets.slice(0, 10).join('\n'))
    console.log(`\n...and ${topWallets.length - 10} more`)

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
