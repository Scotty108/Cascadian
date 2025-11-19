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

interface StageMetrics {
  stage: string
  rows: number
  unique_markets: number
  volume: number
  efficiency_vs_previous: number
}

async function auditCoverageByStage() {
  const client = getClickHouseClient()
  const results: StageMetrics[] = []

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
    console.log('')

    results.push({
      stage: 'clob_fills',
      rows: s1_rows,
      unique_markets: s1_markets,
      volume: s1_volume,
      efficiency_vs_previous: 100
    })

    // Stage 2: vw_clob_fills_enriched (enrichment view)
    console.log('Stage 2: vw_clob_fills_enriched (enriched view)')
    console.log('-'.repeat(80))

    const stage2 = await client.query({
      query: `
        SELECT
          count() as row_count,
          count(DISTINCT condition_id) as unique_conditions,
          sum(abs(price * size / 1000000)) as total_volume
        FROM vw_clob_fills_enriched
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const stage2Data = await stage2.json<any[]>()

    const s2_rows = parseInt(stage2Data[0].row_count)
    const s2_markets = parseInt(stage2Data[0].unique_conditions)
    const s2_volume = parseFloat(stage2Data[0].total_volume)
    const s2_efficiency = (s2_rows / s1_rows * 100)

    console.log(`  Fills: ${s2_rows}`)
    console.log(`  Unique conditions: ${s2_markets}`)
    console.log(`  Volume: $${s2_volume.toLocaleString()}`)
    console.log(`  Efficiency vs clob_fills: ${s2_efficiency.toFixed(1)}%`)
    console.log('')

    results.push({
      stage: 'vw_clob_fills_enriched',
      rows: s2_rows,
      unique_markets: s2_markets,
      volume: s2_volume,
      efficiency_vs_previous: s2_efficiency
    })

    // Stage 3: trade_cashflows_v3 (transformation)
    console.log('Stage 3: trade_cashflows_v3 (cashflow transformation)')
    console.log('-'.repeat(80))

    const stage3 = await client.query({
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
    const stage3Data = await stage3.json<any[]>()

    const s3_rows = parseInt(stage3Data[0].row_count)
    const s3_markets = parseInt(stage3Data[0].unique_markets)
    const s3_volume = parseFloat(stage3Data[0].total_volume)
    const s3_efficiency = (s3_rows / s2_rows * 100)

    console.log(`  Cashflows: ${s3_rows}`)
    console.log(`  Unique markets: ${s3_markets}`)
    console.log(`  Volume: $${s3_volume.toLocaleString()}`)
    console.log(`  Efficiency vs enriched: ${s3_efficiency.toFixed(1)}%`)
    console.log('')

    results.push({
      stage: 'trade_cashflows_v3',
      rows: s3_rows,
      unique_markets: s3_markets,
      volume: s3_volume,
      efficiency_vs_previous: s3_efficiency
    })

    // Stage 4: realized_pnl_by_market_final (final P&L)
    console.log('Stage 4: realized_pnl_by_market_final (final P&L output)')
    console.log('-'.repeat(80))

    const stage4 = await client.query({
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
    const stage4Data = await stage4.json<any[]>()

    const s4_rows = parseInt(stage4Data[0].row_count)
    const s4_markets = parseInt(stage4Data[0].unique_markets)
    const s4_pnl = parseFloat(stage4Data[0].total_pnl_magnitude)
    const s4_efficiency = (s4_markets / s3_markets * 100)

    console.log(`  P&L rows: ${s4_rows}`)
    console.log(`  Unique markets: ${s4_markets}`)
    console.log(`  Total P&L magnitude: $${s4_pnl.toLocaleString()}`)
    console.log(`  Efficiency vs cashflows: ${s4_efficiency.toFixed(1)}%`)
    console.log('')

    results.push({
      stage: 'realized_pnl_by_market_final',
      rows: s4_rows,
      unique_markets: s4_markets,
      volume: s4_pnl,
      efficiency_vs_previous: s4_efficiency
    })

    // Summary Analysis
    console.log('='.repeat(80))
    console.log('PIPELINE EFFICIENCY ANALYSIS')
    console.log('='.repeat(80))
    console.log('')

    console.log('Stage-by-Stage Efficiency:')
    results.forEach((r, idx) => {
      console.log(`  ${idx + 1}. ${r.stage}`)
      console.log(`     Rows: ${r.rows.toLocaleString()}`)
      console.log(`     Markets: ${r.unique_markets}`)
      console.log(`     Efficiency: ${r.efficiency_vs_previous.toFixed(1)}%`)
    })
    console.log('')

    console.log('Overall Pipeline:')
    console.log(`  Input: ${s1_rows} fills from clob_fills`)
    console.log(`  Output: ${s4_markets} markets in realized_pnl_by_market_final`)
    console.log(`  End-to-end efficiency: ${(s4_markets / s1_markets * 100).toFixed(1)}%`)
    console.log('')

    // Gap Analysis
    console.log('='.repeat(80))
    console.log('GAP ANALYSIS')
    console.log('='.repeat(80))
    console.log('')

    const has_clob_to_enriched_drop = s2_rows < s1_rows
    const has_enriched_to_cashflow_drop = s3_rows < s2_rows
    const has_cashflow_to_pnl_drop = s4_markets < s3_markets

    if (!has_clob_to_enriched_drop && !has_enriched_to_cashflow_drop && !has_cashflow_to_pnl_drop) {
      console.log('✅ NO TRANSFORMATION DROPS DETECTED')
      console.log('')
      console.log('All pipeline stages preserve data with 100% efficiency:')
      console.log(`  clob_fills (${s1_rows}) → enriched (${s2_rows}) → cashflows (${s3_rows})`)
      console.log('')
      console.log('Market count drop from cashflows (${s3_markets}) to P&L (${s4_markets}) is expected:')
      console.log('  - Some markets are still open/unrealized')
      console.log('  - Only resolved markets appear in realized_pnl_by_market_final')
      console.log('')
      console.log('🔴 CONCLUSION: Problem is PURELY at ingestion stage')
      console.log(`  - We capture ${s1_rows} fills for ${s1_markets} markets`)
      console.log(`  - Polymarket UI shows 192 predictions`)
      console.log(`  - This means ~1 fill per market (should be 5-20+)`)
      console.log(`  - Volume coverage: ${(s1_volume / GROUND_TRUTH.volume * 100).toFixed(1)}% (should be >80%)`)
    } else {
      console.log('⚠️  TRANSFORMATION DROPS DETECTED')
      console.log('')
      if (has_clob_to_enriched_drop) {
        console.log(`❌ Drop at enrichment: ${s1_rows} → ${s2_rows} (${((1 - s2_rows/s1_rows) * 100).toFixed(1)}% loss)`)
      }
      if (has_enriched_to_cashflow_drop) {
        console.log(`❌ Drop at cashflow transform: ${s2_rows} → ${s3_rows} (${((1 - s3_rows/s2_rows) * 100).toFixed(1)}% loss)`)
      }
      if (has_cashflow_to_pnl_drop) {
        console.log(`⚠️  Market reduction at P&L: ${s3_markets} → ${s4_markets} (expected for open positions)`)
      }
      console.log('')
      console.log('🔴 MULTIPLE ISSUES IDENTIFIED:')
      console.log('  1. Ingestion missing 96% of volume')
      console.log('  2. Transformation filtering additional data')
    }

    console.log('')
    console.log('='.repeat(80))

    // Save results
    const output = {
      wallet: WALLET,
      ground_truth: GROUND_TRUTH,
      pipeline_stages: results,
      analysis: {
        has_transformation_drops: has_clob_to_enriched_drop || has_enriched_to_cashflow_drop || has_cashflow_to_pnl_drop,
        ingestion_coverage_pct: (s1_volume / GROUND_TRUTH.volume * 100),
        end_to_end_efficiency_pct: (s4_markets / s1_markets * 100)
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

auditCoverageByStage()
