import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function enrich() {
  try {
    console.log('ENRICHMENT: Using market_id_mapping to recover condition_ids')
    console.log('═'.repeat(70))
    console.log()

    // Step 1: Verify market_id_mapping exists and is ready
    console.log('Step 1: Verifying market_id_mapping...')
    const mappingCheck = `
SELECT COUNT(DISTINCT market_id) as markets FROM market_id_mapping
    `
    const mappingResult = await clickhouse.query({ query: mappingCheck })
    const mappingCount = JSON.parse(await mappingResult.text()).data[0].markets

    console.log(`✓ Market mapping ready: ${mappingCount} distinct markets`)
    console.log()

    // Step 2: Get stats on missing trades
    console.log('Step 2: Analyzing missing trades...')

    const missingQuery = `
SELECT COUNT(*) as total FROM trades_raw WHERE condition_id = ''
    `
    const missingResult = await clickhouse.query({ query: missingQuery })
    const missingTotal = parseInt(JSON.parse(await missingResult.text()).data[0].total)

    console.log(`Trades missing condition_id: ${missingTotal.toLocaleString()}`)
    console.log()

    // Step 3: Test recovery on sample
    console.log('Step 3: Testing recovery on 1M sample...')

    const sampleQuery = `
SELECT
  COUNT(*) as tested,
  COUNT(CASE WHEN m.condition_id IS NOT NULL THEN 1 END) as recoverable
FROM (SELECT * FROM trades_raw WHERE condition_id = '' LIMIT 1000000) t
LEFT JOIN market_id_mapping m ON t.market_id = m.market_id
    `

    const sampleResult = await clickhouse.query({ query: sampleQuery })
    const sampleData = JSON.parse(await sampleResult.text()).data[0]
    const tested = parseInt(sampleData.tested)
    const recoverable = parseInt(sampleData.recoverable)
    const recoveryRate = ((recoverable / tested) * 100).toFixed(1)

    console.log(`Sample results:`)
    console.log(`  Tested: ${tested.toLocaleString()}`)
    console.log(`  Recoverable: ${recoverable.toLocaleString()}`)
    console.log(`  Recovery rate: ${recoveryRate}%`)
    console.log()

    if (recoveryRate < 10) {
      console.log(`⚠️  Low recovery rate (${recoveryRate}%) - most missing trades cannot be recovered`)
      console.log('This suggests these trades are from markets not in the historical data.')
      return
    }

    // Step 4: Proceed with enrichment in batches
    console.log('Step 4: Executing enrichment in batches...')
    console.log()

    const batchSize = 2_000_000  // 2M per batch
    const numBatches = Math.ceil(missingTotal / batchSize)

    let totalEnriched = 0
    let successBatches = 0
    let failBatches = 0

    for (let i = 0; i < numBatches; i++) {
      const batchNum = i + 1
      const limit = Math.min(batchSize, missingTotal - (i * batchSize))

      process.stdout.write(
        `Batch ${batchNum}/${numBatches} (${limit.toLocaleString()} rows)...`
      )
      const start = Date.now()

      try {
        // Enrich missing trades using market_id_mapping
        const enrichQuery = `
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
  COALESCE(t.condition_id, m.condition_id) as condition_id,
  t.was_win,
  t.tx_timestamp,
  t.canonical_category,
  t.raw_tags,
  t.realized_pnl_usd,
  t.is_resolved,
  t.resolved_outcome
FROM (
  SELECT *
  FROM trades_raw
  WHERE condition_id = ''
  LIMIT ${limit}
) t
LEFT JOIN market_id_mapping m ON t.market_id = m.market_id
        `

        await clickhouse.query({ query: enrichQuery })

        const elapsed = ((Date.now() - start) / 1000).toFixed(0)
        totalEnriched += limit
        successBatches++
        console.log(` ✓ ${elapsed}s`)
      } catch (e: any) {
        failBatches++
        const msg = e.message || ''
        console.log(` ✗`)
        console.error(`  Error: ${msg.substring(0, 100)}`)

        if (msg.includes('Header overflow')) {
          console.log('  Hit API header limit - enrichment may be incomplete')
          break
        }
      }
    }

    console.log()
    console.log('═'.repeat(70))
    console.log('ENRICHMENT SUMMARY')
    console.log('═'.repeat(70))
    console.log(`Batches attempted: ${numBatches}`)
    console.log(`Batches succeeded: ${successBatches}`)
    console.log(`Batches failed: ${failBatches}`)
    console.log(`Rows processed: ${totalEnriched.toLocaleString()}`)
    console.log()

    // Step 5: Final verification
    console.log('Step 5: Final verification...')

    const finalQuery = `
SELECT
  COUNT(*) as total,
  COUNT(CASE WHEN condition_id != '' THEN 1 END) as with_id,
  ROUND(COUNT(CASE WHEN condition_id != '' THEN 1 END) / COUNT(*) * 100, 2) as coverage
FROM trades_raw_enriched_final
    `

    const finalResult = await clickhouse.query({ query: finalQuery })
    const finalData = JSON.parse(await finalResult.text()).data[0]
    const totalRows = parseInt(finalData.total)
    const withId = parseInt(finalData.with_id)
    const coverage = parseFloat(finalData.coverage)

    console.log(`Total rows enriched: ${totalRows.toLocaleString()}`)
    console.log(`With condition_id: ${withId.toLocaleString()}`)
    console.log(`Coverage: ${coverage}%`)
    console.log()
    console.log(`📊 IMPROVEMENT: 51.47% → ${coverage}%`)

    if (coverage >= 90) {
      console.log('✅ Excellent coverage achieved!')
    } else if (coverage >= 70) {
      console.log('⚠️  Moderate coverage - may need additional enrichment sources')
    }

  } catch (e: any) {
    console.error('Error:', e.message.substring(0, 200))
  }
}

enrich()
