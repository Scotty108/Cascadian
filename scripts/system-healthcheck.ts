#!/usr/bin/env tsx
/**
 * System Healthcheck
 *
 * Validates the complete ingestion spine and demo readiness
 * Run before investor demos to ensure everything is operational
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

// Suppress errors, keep going to generate full report
async function safeQuery(queryStr: string, stepName: string): Promise<any[] | null> {
  try {
    const result = await clickhouse.query({
      query: queryStr,
      format: 'JSONEachRow',
    })
    return (await result.json()) as any[]
  } catch (error: any) {
    console.log(`[ERROR in ${stepName}]: ${error.message}`)
    return null
  }
}

async function main() {
  console.log('🏥 System Healthcheck')
  console.log('=====================\n')

  let readyForDemo = true

  // ==========================================================================
  // (a) trades_raw schema check
  // ==========================================================================

  console.log('📋 (a) trades_raw schema check')
  console.log('-------------------------------')

  const requiredColumns = [
    { name: 'tx_timestamp', type: 'DateTime' },
    { name: 'wallet_address', type: 'String' },
    { name: 'condition_id', type: 'String' },
    { name: 'market_id', type: 'String' },
    { name: 'realized_pnl_usd', type: 'Float64' },
    { name: 'is_resolved', type: 'UInt8' },
  ]

  const schemaResult = await safeQuery('DESCRIBE TABLE trades_raw', 'schema check')

  if (schemaResult) {
    const schemaMap = new Map(schemaResult.map((row) => [row.name, row.type]))

    for (const col of requiredColumns) {
      const actualType = schemaMap.get(col.name)
      if (!actualType) {
        console.log(`   ❌ ${col.name}: MISSING`)
        readyForDemo = false
      } else if (actualType === col.type) {
        console.log(`   ✅ ${col.name}: OK (${col.type})`)
      } else {
        console.log(`   ⚠️  ${col.name}: WRONG TYPE (expected ${col.type}, got ${actualType})`)
        readyForDemo = false
      }
    }
  } else {
    console.log('   ❌ Could not query trades_raw schema')
    readyForDemo = false
  }

  console.log('')

  // ==========================================================================
  // (b) coverage check BEFORE backfill
  // ==========================================================================

  console.log('📊 (b) coverage check BEFORE backfill')
  console.log('--------------------------------------')

  const coverageResult = await safeQuery(
    `
    SELECT
      COUNT(*) as total_rows,
      countIf(market_id != '' AND market_id != 'unknown') as good_rows
    FROM trades_raw
  `,
    'coverage check'
  )

  let coveragePct = 0

  if (coverageResult && coverageResult.length > 0) {
    const totalRows = parseInt(coverageResult[0].total_rows)
    const goodRows = parseInt(coverageResult[0].good_rows)
    coveragePct = totalRows > 0 ? (goodRows / totalRows) * 100 : 0

    console.log(
      `   Current coverage: ${coveragePct.toFixed(2)}% (${goodRows.toLocaleString()} / ${totalRows.toLocaleString()})`
    )

    if (coveragePct < 90) {
      readyForDemo = false
    }
  } else {
    console.log('   ❌ Could not check coverage')
    readyForDemo = false
  }

  console.log('')

  // ==========================================================================
  // (c) condition_market_map sanity
  // ==========================================================================

  console.log('🗺️  (c) condition_market_map sanity')
  console.log('----------------------------------')

  const conditionMapResult = await safeQuery(
    `
    SELECT
      COUNT(DISTINCT condition_id) as distinct_conditions,
      COUNT(DISTINCT market_id) as distinct_markets
    FROM condition_market_map
  `,
    'condition_market_map sanity'
  )

  if (conditionMapResult && conditionMapResult.length > 0) {
    const distinctConditions = parseInt(conditionMapResult[0].distinct_conditions)
    const distinctMarkets = parseInt(conditionMapResult[0].distinct_markets)

    console.log(`   Distinct condition_ids: ${distinctConditions.toLocaleString()}`)
    console.log(`   Distinct market_ids: ${distinctMarkets.toLocaleString()}`)
  } else {
    console.log('   ❌ Could not query condition_market_map')
  }

  console.log('')

  // ==========================================================================
  // (d) dimension tables sanity
  // ==========================================================================

  console.log('📚 (d) dimension tables sanity')
  console.log('-------------------------------')

  const marketsCountResult = await safeQuery('SELECT COUNT(*) as cnt FROM markets_dim', 'markets_dim count')
  const eventsCountResult = await safeQuery('SELECT COUNT(*) as cnt FROM events_dim', 'events_dim count')
  const categoriesResult = await safeQuery(
    'SELECT COUNT(DISTINCT canonical_category) as cnt FROM events_dim',
    'events_dim categories'
  )

  let marketsCount = 0
  let eventsCount = 0
  let categoriesCount = 0

  if (marketsCountResult && marketsCountResult.length > 0) {
    marketsCount = parseInt(marketsCountResult[0].cnt)
    console.log(`   markets_dim rows: ${marketsCount.toLocaleString()}`)
    if (marketsCount === 0) readyForDemo = false
  } else {
    console.log('   ❌ Could not query markets_dim')
    readyForDemo = false
  }

  if (eventsCountResult && eventsCountResult.length > 0) {
    eventsCount = parseInt(eventsCountResult[0].cnt)
    console.log(`   events_dim rows: ${eventsCount.toLocaleString()}`)
    if (eventsCount === 0) readyForDemo = false
  } else {
    console.log('   ❌ Could not query events_dim')
    readyForDemo = false
  }

  if (categoriesResult && categoriesResult.length > 0) {
    categoriesCount = parseInt(categoriesResult[0].cnt)
    console.log(`   Distinct canonical_categories: ${categoriesCount}`)
  } else {
    console.log('   ❌ Could not query canonical categories')
  }

  console.log('')

  // ==========================================================================
  // (e) wallet-level category join works
  // ==========================================================================

  console.log('👤 (e) wallet-level category join works')
  console.log('----------------------------------------')

  // Load top wallet
  const walletPnlPath = resolve(process.cwd(), 'data/audited_wallet_pnl_extended.json')

  if (!fs.existsSync(walletPnlPath)) {
    console.log('   ❌ audited_wallet_pnl_extended.json not found')
  } else {
    const wallets = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))
    const topWallet = wallets.sort((a: any, b: any) => {
      const bPnl = b.realized_pnl_usd || b.realizedPnlUsd || 0
      const aPnl = a.realized_pnl_usd || a.realizedPnlUsd || 0
      return bPnl - aPnl
    })[0]

    const topWalletAddress = topWallet.wallet_address || topWallet.address

    console.log(`   Top wallet: ${topWalletAddress}`)

    const categoryJoinQuery = `
      SELECT
        COALESCE(e.canonical_category, 'Uncategorized') as canonical_category,
        SUM(t.realized_pnl_usd) as pnl_usd
      FROM trades_raw t
      LEFT JOIN condition_market_map c ON t.condition_id = c.condition_id
      LEFT JOIN markets_dim m ON c.market_id = m.market_id
      LEFT JOIN events_dim e ON m.event_id = e.event_id
      WHERE t.wallet_address = '${topWalletAddress}'
        AND t.is_resolved = 1
      GROUP BY canonical_category
      ORDER BY pnl_usd DESC
      LIMIT 5
    `

    const categoryResult = await safeQuery(categoryJoinQuery, 'wallet category join')

    if (categoryResult && categoryResult.length > 0) {
      console.log(`   Top 5 categories by P&L:`)

      let allUncategorized = true
      for (const row of categoryResult) {
        const category = row.canonical_category || 'Uncategorized'
        const pnl = parseFloat(row.pnl_usd)
        console.log(`      ${category}: $${pnl.toFixed(2)}`)

        if (category !== 'Uncategorized') {
          allUncategorized = false
        }
      }

      if (allUncategorized) {
        console.log('   ⚠️  WARNING: category enrichment not applied yet')
      }
    } else {
      console.log('   ⚠️  No resolved trades found for top wallet or join failed')
    }
  }

  console.log('')

  // ==========================================================================
  // (f) watchlist stream check
  // ==========================================================================

  console.log('📡 (f) watchlist stream check')
  console.log('-----------------------------')

  const watchlistLogPath = resolve(process.cwd(), 'runtime/watchlist_events.log')

  if (fs.existsSync(watchlistLogPath)) {
    const logContent = fs.readFileSync(watchlistLogPath, 'utf-8').trim()
    const lines = logContent.split('\n').filter((l) => l)
    const lastLines = lines.slice(-5)

    console.log(`   Found ${lines.length} total entries. Last 5:`)

    for (const line of lastLines) {
      try {
        const entry = JSON.parse(line)
        console.log(`      ${entry.timestamp} | ${entry.wallet?.slice(0, 8)}... | ${entry.market_id} | ${entry.canonical_category || 'N/A'} | rank=${entry.triggering_wallet_rank || entry.pnl_rank || '?'} | coverage=${(entry.triggering_wallet_coverage_pct || entry.coverage_pct || 0).toFixed(1)}%`)
      } catch (error) {
        console.log(`      [invalid JSON line]`)
      }
    }
  } else {
    console.log('   ⚠️  No watchlist_events.log yet.')
    console.log('   Run: AUTONOMOUS_TRADING_ENABLED=true npx tsx scripts/monitor-signal-wallet-positions.ts')
  }

  console.log('')

  // ==========================================================================
  // (g) category P&L attribution check (wallet #1)
  // ==========================================================================

  console.log('💰 (g) category P&L attribution check (wallet #1)')
  console.log('-------------------------------------------------')

  // Load top wallet (same as section e)
  if (fs.existsSync(walletPnlPath)) {
    const wallets = JSON.parse(fs.readFileSync(walletPnlPath, 'utf-8'))
    const topWallet = wallets.sort((a: any, b: any) => {
      const bPnl = b.realized_pnl_usd || b.realizedPnlUsd || 0
      const aPnl = a.realized_pnl_usd || a.realizedPnlUsd || 0
      return bPnl - aPnl
    })[0]

    const topWalletAddress = topWallet.wallet_address || topWallet.address

    console.log(`   Testing category breakdown for wallet #1: ${topWalletAddress}`)

    // Same query as the API route
    const categoryBreakdownQuery = `
      SELECT
        e.canonical_category,
        SUM(t.realized_pnl_usd) as pnl_usd,
        COUNT(*) as num_trades,
        COUNT(DISTINCT t.condition_id) as num_resolved_markets
      FROM trades_raw t
      LEFT JOIN condition_market_map c ON t.condition_id = c.condition_id
      LEFT JOIN events_dim e ON c.event_id = e.event_id
      WHERE t.wallet_address = '${topWalletAddress}'
        AND t.is_resolved = 1
        AND t.realized_pnl_usd != 0
      GROUP BY e.canonical_category
      ORDER BY pnl_usd DESC
    `

    const breakdownResult = await safeQuery(categoryBreakdownQuery, 'category P&L breakdown')

    if (breakdownResult && breakdownResult.length > 0) {
      // Filter out empty categories
      const validCategories = breakdownResult.filter(
        (row) => row.canonical_category && row.canonical_category.trim() !== ''
      )

      if (validCategories.length > 0) {
        console.log(`   ✅ Category P&L attribution: READY (wallet-level)`)
        console.log(`   Found ${validCategories.length} categories with realized P&L:`)

        for (const row of validCategories.slice(0, 3)) {
          const category = row.canonical_category
          const pnl = parseFloat(row.pnl_usd)
          const markets = parseInt(row.num_resolved_markets)
          console.log(`      ${category}: $${pnl.toFixed(2)} across ${markets} markets`)
        }
      } else {
        console.log('   ⚠️  Category P&L attribution: PARTIAL (pnl populated but categories empty)')
        console.log('      This means realized_pnl_usd is backfilled but category enrichment is missing')
      }
    } else {
      console.log('   ⚠️  Category P&L attribution: PARTIAL (pnl not populated on trades yet)')
      console.log('      Run: npx tsx scripts/backfill-trade-pnl-and-resolution.ts')
      console.log('      This will populate realized_pnl_usd and is_resolved for top wallets')
    }
  } else {
    console.log('   ❌ Cannot check - audited_wallet_pnl_extended.json not found')
  }

  console.log('')

  // ==========================================================================
  // Summary
  // ==========================================================================

  console.log('📋 SUMMARY')
  console.log('==========')
  console.log(`   Coverage: ${coveragePct.toFixed(2)}%`)
  console.log(`   markets_dim rows: ${marketsCount.toLocaleString()}`)
  console.log(`   events_dim rows: ${eventsCount.toLocaleString()}`)
  console.log(`   categories: ${categoriesCount}`)
  console.log('')

  if (readyForDemo && coveragePct >= 90 && marketsCount > 0 && eventsCount > 0) {
    console.log('✅ HEALTHCHECK STATUS: READY FOR DEMO')
  } else {
    console.log('⚠️  HEALTHCHECK STATUS: INGESTION NOT COMPLETE')
    console.log('')
    if (coveragePct < 90) {
      console.log(`   - Coverage below 90% (${coveragePct.toFixed(2)}%)`)
    }
    if (marketsCount === 0) {
      console.log('   - markets_dim is empty')
    }
    if (eventsCount === 0) {
      console.log('   - events_dim is empty')
    }
  }
}

main().catch((error) => {
  console.error('\n💥 Healthcheck failed:', error.message)
  process.exit(1)
})
