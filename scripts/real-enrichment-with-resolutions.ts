import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function realEnrichment() {
  try {
    console.log('REAL ENRICHMENT: Using market_resolutions_final')
    console.log('═'.repeat(70))

    // First, check what we're working with
    const check1 = await clickhouse.query({
      query: `SELECT COUNT(*) as cnt FROM trades_raw WHERE condition_id = ''`
    })
    const missingCount = parseInt(JSON.parse(await check1.text()).data[0].cnt)
    console.log(`Trades without condition_id: ${missingCount.toLocaleString()}`)

    // Check market_resolutions_final structure
    const check2 = await clickhouse.query({
      query: `SELECT COUNT(DISTINCT market_id) as markets FROM market_resolutions_final`
    })
    const resMarkets = parseInt(JSON.parse(await check2.text()).data[0].markets)
    console.log(`Markets in market_resolutions_final: ${resMarkets.toLocaleString()}`)
    console.log()

    // Now do the REAL enrichment
    console.log('Enriching trades WITHOUT condition_id using market_resolutions_final...')
    console.log('Strategy: For each trade missing condition_id, lookup condition_id by market_id from resolutions')
    console.log()

    // Create a view to test the join first
    console.log('Testing join logic on small sample...')
    const testQuery = `
SELECT
  COUNT(*) as found,
  COUNT(CASE WHEN r.condition_id != '' THEN 1 END) as with_resolution_id
FROM trades_raw t
LEFT JOIN market_resolutions_final r ON t.market_id = r.market_id
WHERE t.condition_id = ''
LIMIT 1000000
    `

    const testResult = await clickhouse.query({ query: testQuery })
    const testData = JSON.parse(await testResult.text()).data[0]
    const testFound = parseInt(testData.found)
    const testWithId = parseInt(testData.with_resolution_id)
    const testRecovery = ((testWithId / testFound) * 100).toFixed(1)

    console.log(`Sample of 1M trades without condition_id:`)
    console.log(`  Matched to market_resolutions_final: ${testWithId.toLocaleString()} (${testRecovery}%)`)
    console.log()

    if (testRecovery > 80) {
      console.log(`✓ Recovery rate looks excellent (${testRecovery}%)`)
      console.log('Proceeding with full enrichment...')
      console.log()

      // Now do batched insert with real resolution IDs
      const batchSize = 5_000_000
      let offset = 0
      let totalRecovered = 0
      let batchNum = 0

      while (offset < missingCount) {
        batchNum++
        const limit = Math.min(batchSize, missingCount - offset)

        process.stdout.write(`Batch ${batchNum} (${limit.toLocaleString()} rows)...`)
        const start = Date.now()

        try {
          // Use atomic approach: update with resolution IDs
          const insertSql = `
INSERT INTO trades_raw_enriched_final
SELECT
  t.trade_id,
  t.wallet_address,
  t.market_id,
  t.timestamp,
  t.side,
  t.entry_price,
  t.exit_price,
  t.shares,
  t.usd_value,
  t.pnl,
  t.is_closed,
  t.transaction_hash,
  t.created_at,
  t.close_price,
  t.fee_usd,
  t.slippage_usd,
  t.hours_held,
  t.bankroll_at_entry,
  t.outcome,
  t.fair_price_at_entry,
  t.pnl_gross,
  t.pnl_net,
  t.return_pct,
  COALESCE(t.condition_id, r.condition_id) as condition_id,
  t.was_win,
  t.tx_timestamp,
  t.canonical_category,
  t.raw_tags,
  t.realized_pnl_usd,
  t.is_resolved,
  t.resolved_outcome
FROM (SELECT * FROM trades_raw WHERE condition_id = '' LIMIT ${limit} OFFSET ${offset}) t
LEFT JOIN market_resolutions_final r ON t.market_id = r.market_id
          `

          await clickhouse.query({ query: insertSql })

          const elapsed = ((Date.now() - start) / 1000).toFixed(0)
          totalRecovered += limit
          offset += limit
          console.log(` ✓ ${elapsed}s`)
        } catch (e: any) {
          console.log(` ✗`)
          console.error(`Error: ${e.message.substring(0, 100)}`)
          if (e.message.includes('Header overflow')) {
            console.log('Hit API limit, stopping enrichment')
            break
          }
        }
      }

      console.log()
      console.log('═'.repeat(70))
      console.log('ENRICHMENT COMPLETE - Final Verification')
      console.log('═'.repeat(70))

      const finalCheck = await clickhouse.query({
        query: `
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
  ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as coverage
FROM trades_raw_enriched_final
        `
      })

      const finalData = JSON.parse(await finalCheck.text()).data[0]
      const totalRows = parseInt(finalData.total)
      const withId = parseInt(finalData.with_id)
      const coverage = parseFloat(finalData.coverage)

      console.log(`Total rows: ${totalRows.toLocaleString()}`)
      console.log(`With condition_id: ${withId.toLocaleString()} (${coverage}%)`)
      console.log(`Without: ${totalRows - withId}`)
      console.log()
      console.log(`📊 IMPROVEMENT: 51.47% → ${coverage}%`)

    } else {
      console.log(`⚠️  Recovery rate low (${testRecovery}%) - need to investigate relationship between market_id and condition_id`)
    }

  } catch (e: any) {
    console.error('Fatal error:', e.message.substring(0, 200))
  }
}

realEnrichment()
