#!/usr/bin/env npx tsx

/**
 * Test Enrichment Fixes on 1000 Recent Trades
 *
 * This script validates that the enrichment fixes work on real data by:
 * 1. Finding 1000 recent trades from closed markets
 * 2. Running enrichment with fixed outcomePrices parsing
 * 3. Writing pnl and outcome back to ClickHouse
 * 4. Reporting success rate
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { createClient } from '@supabase/supabase-js'
import { createClient as createClickHouseClient } from '@clickhouse/client'

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

// ============================================================================
// Types
// ============================================================================

interface ResolvedMarket {
  market_id: string
  condition_id: string
  title: string
  closed: boolean
  current_price: number
  end_date: string | null
  raw_polymarket_data: any
}

interface Trade {
  trade_id: string
  condition_id: string
  side: 'YES' | 'NO'
  timestamp: number
  entry_price: number
  shares: number
  usd_value: number
}

// ============================================================================
// Enrichment Logic (with FIXES applied)
// ============================================================================

function calculateOutcome(
  market: ResolvedMarket,
  side: 'YES' | 'NO'
): number | null {
  if (!market.closed) {
    return null
  }

  // PRIORITY 1: resolvedOutcome field (if present)
  const resolvedOutcome = market.raw_polymarket_data?.resolvedOutcome

  if (resolvedOutcome !== undefined && resolvedOutcome !== null) {
    if (resolvedOutcome === 1) {
      return side === 'YES' ? 1 : 0
    } else if (resolvedOutcome === 0) {
      return side === 'NO' ? 1 : 0
    }
  }

  // PRIORITY 2: Parse outcomePrices array (THE FIX!)
  const outcomePrices = market.raw_polymarket_data?.outcomePrices

  if (outcomePrices && Array.isArray(outcomePrices) && outcomePrices.length === 2) {
    const yesPrice = parseFloat(outcomePrices[0])
    const noPrice = parseFloat(outcomePrices[1])

    if (!isNaN(yesPrice) && !isNaN(noPrice)) {
      if (yesPrice >= 0.90) {
        // YES won
        return side === 'YES' ? 1 : 0
      } else if (noPrice >= 0.90) {
        // NO won
        return side === 'NO' ? 1 : 0
      }
    }
  }

  // PRIORITY 3: Fallback to current_price
  const finalPrice = market.current_price

  if (finalPrice >= 0.90) {
    return side === 'YES' ? 1 : 0
  } else if (finalPrice <= 0.10) {
    return side === 'NO' ? 1 : 0
  }

  return null
}

function calculatePnL(
  trade: Trade,
  outcome: number
): { pnl_gross: number; pnl_net: number; fee_usd: number } {
  const FEE_RATE = 0.002 // 0.2% fees

  let pnl_gross = 0

  if (outcome === 1) {
    // Trade won - winner gets $1 per share
    pnl_gross = trade.shares - trade.usd_value
  } else {
    // Trade lost - lost the entire investment
    pnl_gross = -trade.usd_value
  }

  const fee_usd = trade.usd_value * FEE_RATE
  const pnl_net = pnl_gross - fee_usd

  return {
    pnl_gross,
    pnl_net,
    fee_usd,
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function testEnrichmentSample() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('     TEST ENRICHMENT FIXES ON 1000 RECENT TRADES          ')
  console.log('═══════════════════════════════════════════════════════════\n')

  // Step 1: Find closed markets
  console.log('📊 Step 1: Finding closed markets from Supabase...')

  const { data: closedMarkets, error: marketError } = await supabase
    .from('markets')
    .select('market_id, condition_id, title, closed, current_price, end_date, raw_polymarket_data')
    .eq('closed', true)
    .not('raw_polymarket_data', 'is', null)
    .limit(100)

  if (marketError) {
    throw new Error(`Failed to fetch markets: ${marketError.message}`)
  }

  console.log(`✅ Found ${closedMarkets?.length || 0} closed markets\n`)

  const conditionIds = closedMarkets?.map(m => m.condition_id) || []

  if (conditionIds.length === 0) {
    console.log('❌ No closed markets found. Cannot test.')
    return
  }

  // Step 2: Find recent trades in those markets
  console.log('📊 Step 2: Finding recent trades in closed markets from ClickHouse...')

  const conditionIdsStr = conditionIds.map(id => `'${id}'`).join(',')

  const tradesQuery = `
    SELECT
      trade_id,
      condition_id,
      side,
      timestamp,
      entry_price,
      shares,
      usd_value
    FROM trades_raw
    WHERE condition_id IN (${conditionIdsStr})
      AND is_closed = false
    ORDER BY timestamp DESC
    LIMIT 1000
  `

  const tradesResult = await clickhouse.query({
    query: tradesQuery,
    format: 'JSONEachRow',
  })

  const trades: Trade[] = await tradesResult.json() as any

  console.log(`✅ Found ${trades.length} recent trades to enrich\n`)

  if (trades.length === 0) {
    console.log('❌ No trades found in closed markets. Cannot test.')
    return
  }

  // Step 3: Build market lookup
  const marketsByConditionId = new Map<string, ResolvedMarket>()
  closedMarkets?.forEach(m => {
    marketsByConditionId.set(m.condition_id, m as ResolvedMarket)
  })

  // Step 4: Enrich trades
  console.log('📊 Step 3: Enriching trades with fixed logic...')

  const enrichedTrades = []
  let successCount = 0
  let failureCount = 0

  for (const trade of trades) {
    const market = marketsByConditionId.get(trade.condition_id)

    if (!market) {
      failureCount++
      continue
    }

    const outcome = calculateOutcome(market, trade.side)

    if (outcome === null) {
      failureCount++
      continue
    }

    const closePrice = outcome === 1 ? 1.0 : 0.0
    const pnl = calculatePnL(trade, outcome)

    enrichedTrades.push({
      trade_id: trade.trade_id,
      outcome,
      close_price: closePrice,
      pnl_gross: pnl.pnl_gross,
      pnl_net: pnl.pnl_net,
      fee_usd: pnl.fee_usd,
    })

    successCount++
  }

  const successRate = (successCount / trades.length * 100).toFixed(1)

  console.log(`\n📊 Enrichment Results:`)
  console.log(`   Total trades: ${trades.length}`)
  console.log(`   ✅ Successfully enriched: ${successCount} (${successRate}%)`)
  console.log(`   ❌ Failed to enrich: ${failureCount}\n`)

  // Step 5: Write back to ClickHouse
  console.log('📊 Step 4: Writing enriched data to ClickHouse...')

  if (enrichedTrades.length === 0) {
    console.log('❌ No trades were enriched. Fix may not be working!')
    return
  }

  // Build CASE statements for batch update
  const tradeIds = enrichedTrades.map(t => `'${t.trade_id}'`).join(',')

  const outcomeUpdates = enrichedTrades
    .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.outcome}`)
    .join(' ')

  const closePriceUpdates = enrichedTrades
    .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.close_price}`)
    .join(' ')

  const pnlGrossUpdates = enrichedTrades
    .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.pnl_gross}`)
    .join(' ')

  const pnlNetUpdates = enrichedTrades
    .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.pnl_net}`)
    .join(' ')

  const feeUpdates = enrichedTrades
    .map(t => `WHEN trade_id = '${t.trade_id}' THEN ${t.fee_usd}`)
    .join(' ')

  try {
    // Update 1: outcome and is_closed
    await clickhouse.command({
      query: `
        ALTER TABLE trades_raw
        UPDATE
          outcome = CASE ${outcomeUpdates} END,
          is_closed = true
        WHERE trade_id IN (${tradeIds})
      `,
    })

    // Update 2: prices and P&L
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

    console.log(`✅ Successfully wrote ${enrichedTrades.length} enriched trades to ClickHouse\n`)

  } catch (error) {
    console.error('❌ Error writing to ClickHouse:', error)
    throw error
  }

  // Step 6: Verify writes
  console.log('📊 Step 5: Verifying writes...')

  const verifyQuery = `
    SELECT
      COUNT(*) as total,
      COUNT(CASE WHEN pnl_net IS NOT NULL THEN 1 END) as with_pnl,
      COUNT(CASE WHEN outcome IS NOT NULL THEN 1 END) as with_outcome
    FROM trades_raw
    WHERE trade_id IN (${tradeIds})
  `

  const verifyResult = await clickhouse.query({
    query: verifyQuery,
    format: 'JSONEachRow',
  })

  const verification: any = (await verifyResult.json() as any)[0]

  console.log(`\n✅ Verification:`)
  console.log(`   Total trades checked: ${verification.total}`)
  console.log(`   With non-null pnl_net: ${verification.with_pnl}`)
  console.log(`   With non-null outcome: ${verification.with_outcome}`)

  // Final summary
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('                      SUMMARY                              ')
  console.log('═══════════════════════════════════════════════════════════\n')

  console.log(`✅ Success Rate: ${successRate}%`)
  console.log(`✅ Enriched ${successCount} / ${trades.length} trades`)
  console.log(`✅ Wrote ${enrichedTrades.length} trades to ClickHouse`)

  if (parseFloat(successRate) >= 80) {
    console.log('\n🎉 SUCCESS! Fix is working at high hit rate!')
    console.log('   Ready for full enrichment re-run.\n')
  } else {
    console.log('\n⚠️  WARNING: Success rate below 80%')
    console.log('   May need additional fixes.\n')
  }
}

testEnrichmentSample()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
