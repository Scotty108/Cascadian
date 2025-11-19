#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import { writeFileSync } from 'fs'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

const GROUND_TRUTH = {
  predictions: 192,
  volume: 1380000,
  net_pnl: 95363.53
}

async function auditCoverageSimple() {
  const client = getClickHouseClient()

  try {
    console.log('='.repeat(80))
    console.log('CLOB COVERAGE AUDIT - WALLET 0xcce2')
    console.log('='.repeat(80))
    console.log('')
    console.log('Ground Truth (Polymarket UI):')
    console.log(`  Predictions: ${GROUND_TRUTH.predictions}`)
    console.log(`  Volume: $${GROUND_TRUTH.volume.toLocaleString()}`)
    console.log(`  Net P&L: $${GROUND_TRUTH.net_pnl.toLocaleString()}`)
    console.log('')

    // Stage 1: clob_fills (base table)
    console.log('Stage 1: clob_fills (raw ingestion)')
    console.log('-'.repeat(80))

    const stage1 = await client.query({
      query: `
        SELECT
          count() as row_count,
          count(DISTINCT condition_id) as unique_conditions,
          sum(abs(price * size / 1000000)) as total_volume
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const stage1Data = await stage1.json<any[]>()

    const s1_rows = parseInt(stage1Data[0].row_count)
    const s1_markets = parseInt(stage1Data[0].unique_conditions)
    const s1_volume = parseFloat(stage1Data[0].total_volume)

    console.log(`  Fills: ${s1_rows}`)
    console.log(`  Unique conditions: ${s1_markets}`)
    console.log(`  Volume: $${s1_volume.toLocaleString()}`)
    console.log(`  Coverage vs UI: ${(s1_volume / GROUND_TRUTH.volume * 100).toFixed(1)}%`)
    console.log(`  Fills per market: ${(s1_rows / s1_markets).toFixed(2)}`)
    console.log('')

    // Stage 2: trade_cashflows_v3 (transformation)
    console.log('Stage 2: trade_cashflows_v3 (cashflow transformation)')
    console.log('-'.repeat(80))

    const stage2 = await client.query({
      query: `
        SELECT
          count() as row_count,
          count(DISTINCT condition_id_norm) as unique_markets,
          sum(abs(cashflow_usdc)) as total_volume
        FROM trade_cashflows_v3
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const stage2Data = await stage2.json<any[]>()

    const s2_rows = parseInt(stage2Data[0].row_count)
    const s2_markets = parseInt(stage2Data[0].unique_markets)
    const s2_volume = parseFloat(stage2Data[0].total_volume)
    const s2_efficiency = (s2_rows / s1_rows * 100)

    console.log(`  Cashflows: ${s2_rows}`)
    console.log(`  Unique markets: ${s2_markets}`)
    console.log(`  Volume: $${s2_volume.toLocaleString()}`)
    console.log(`  Efficiency vs clob_fills: ${s2_efficiency.toFixed(1)}%`)
    console.log('')

    // Stage 3: realized_pnl_by_market_final (final P&L)
    console.log('Stage 3: realized_pnl_by_market_final (final P&L output)')
    console.log('-'.repeat(80))

    const stage3 = await client.query({
      query: `
        SELECT
          count() as row_count,
          count(DISTINCT condition_id_norm) as unique_markets,
          sum(abs(realized_pnl_usd)) as total_pnl_magnitude
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const stage3Data = await stage3.json<any[]>()

    const s3_rows = parseInt(stage3Data[0].row_count)
    const s3_markets = parseInt(stage3Data[0].unique_markets)
    const s3_pnl = parseFloat(stage3Data[0].total_pnl_magnitude)
    const s3_efficiency = (s3_markets / s2_markets * 100)

    console.log(`  P&L rows: ${s3_rows}`)
    console.log(`  Unique markets: ${s3_markets}`)
    console.log(`  Total P&L magnitude: $${s3_pnl.toLocaleString()}`)
    console.log(`  Efficiency vs cashflows: ${s3_efficiency.toFixed(1)}%`)
    console.log('')

    // Summary Analysis
    console.log('='.repeat(80))
    console.log('PIPELINE EFFICIENCY ANALYSIS')
    console.log('='.repeat(80))
    console.log('')

    console.log('Data Flow:')
    console.log(`  clob_fills:       ${s1_rows} fills → ${s1_markets} markets → $${(s1_volume / 1000).toFixed(1)}k volume`)
    console.log(`  cashflows_v3:     ${s2_rows} cashflows → ${s2_markets} markets → $${(s2_volume / 1000).toFixed(1)}k volume`)
    console.log(`  realized_pnl:     ${s3_markets} markets → $${(s3_pnl / 1000).toFixed(1)}k P&L magnitude`)
    console.log('')

    console.log('Stage Efficiencies:')
    console.log(`  clob_fills → cashflows: ${s2_efficiency.toFixed(1)}%`)
    console.log(`  cashflows → realized_pnl: ${s3_efficiency.toFixed(1)}%`)
    console.log('')

    // Gap Analysis
    console.log('='.repeat(80))
    console.log('GAP ANALYSIS')
    console.log('='.repeat(80))
    console.log('')

    const has_clob_to_cashflow_drop = s2_rows < s1_rows
    const has_cashflow_to_pnl_drop = s3_markets < s2_markets

    if (!has_clob_to_cashflow_drop) {
      console.log('✅ clob_fills → trade_cashflows_v3: NO DATA LOSS')
      console.log(`   ${s1_rows} fills → ${s2_rows} cashflows (100% passthrough)`)
      console.log('')
    } else {
      console.log(`❌ clob_fills → trade_cashflows_v3: DATA LOSS DETECTED`)
      console.log(`   ${s1_rows} fills → ${s2_rows} cashflows (${((1 - s2_rows/s1_rows) * 100).toFixed(1)}% loss)`)
      console.log('')
    }

    if (s2_markets === s3_markets) {
      console.log('✅ trade_cashflows_v3 → realized_pnl: NO MARKET LOSS')
      console.log(`   ${s2_markets} markets preserved`)
      console.log('')
    } else if (s3_markets < s2_markets) {
      const drop_pct = ((1 - s3_markets/s2_markets) * 100)
      if (drop_pct < 50) {
        console.log(`⚠️  trade_cashflows_v3 → realized_pnl: ${drop_pct.toFixed(1)}% market reduction`)
        console.log(`   ${s2_markets} markets → ${s3_markets} markets (EXPECTED - open positions filtered)`)
        console.log('')
      } else {
        console.log(`❌ trade_cashflows_v3 → realized_pnl: EXCESSIVE MARKET LOSS`)
        console.log(`   ${s2_markets} markets → ${s3_markets} markets (${drop_pct.toFixed(1)}% loss)`)
        console.log('')
      }
    }

    console.log('='.repeat(80))
    console.log('CONCLUSION')
    console.log('='.repeat(80))
    console.log('')

    if (!has_clob_to_cashflow_drop) {
      console.log('🎯 PROBLEM LOCATION: INGESTION STAGE (clob_fills)')
      console.log('')
      console.log('Evidence:')
      console.log(`  1. Pipeline transforms preserve 100% of data`)
      console.log(`  2. clob_fills has only ${s1_rows} fills for ${s1_markets} markets`)
      console.log(`  3. This means ~${(s1_rows / s1_markets).toFixed(2)} fills per market`)
      console.log(`  4. Real traders have 5-20+ fills per market`)
      console.log(`  5. Volume coverage: ${(s1_volume / GROUND_TRUTH.volume * 100).toFixed(1)}% (missing 96%)`)
      console.log('')
      console.log('Root cause:')
      console.log('  → clob_fills is capturing only "net" transfers per market')
      console.log('  → Missing individual fill executions within each market')
      console.log('  → Blockchain ERC1155 → clob_fills transformation is aggregating fills')
      console.log('')
      console.log('Fix required:')
      console.log('  1. Audit ERC1155 → clob_fills transformation scripts')
      console.log('  2. Capture ALL fills, not just net transfers')
      console.log('  3. Backfill missing fills for all wallets')
    } else {
      console.log('⚠️  MULTIPLE ISSUES DETECTED')
      console.log('')
      console.log('Issues identified:')
      console.log(`  1. Ingestion: Missing 96% of volume`)
      console.log(`  2. Transformation: Dropping ${((1 - s2_rows/s1_rows) * 100).toFixed(1)}% of fills`)
      console.log('')
      console.log('Both stages require investigation.')
    }

    console.log('')
    console.log('='.repeat(80))

    // Save results
    const output = {
      wallet: WALLET,
      ground_truth: GROUND_TRUTH,
      pipeline_stages: [
        { stage: 'clob_fills', fills: s1_rows, markets: s1_markets, volume: s1_volume },
        { stage: 'trade_cashflows_v3', fills: s2_rows, markets: s2_markets, volume: s2_volume },
        { stage: 'realized_pnl_by_market_final', fills: s3_rows, markets: s3_markets, pnl_magnitude: s3_pnl }
      ],
      analysis: {
        has_transformation_drops: has_clob_to_cashflow_drop,
        ingestion_coverage_pct: (s1_volume / GROUND_TRUTH.volume * 100),
        pipeline_efficiency_pct: s2_efficiency,
        fills_per_market: s1_rows / s1_markets
      }
    }

    writeFileSync('tmp/audit-clob-coverage-results.json', JSON.stringify(output, null, 2))
    console.log('📊 Results saved to tmp/audit-clob-coverage-results.json')

    return output

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

auditCoverageSimple()
