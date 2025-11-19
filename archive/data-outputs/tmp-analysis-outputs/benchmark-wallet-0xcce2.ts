#!/usr/bin/env npx tsx
import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'
import { writeFileSync } from 'fs'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
const DOME_API_BASE_URL = process.env.DOME_API_BASE_URL
const DOME_API_KEY = process.env.DOME_API_KEY

// Ground truth from Polymarket UI
const GROUND_TRUTH = {
  net_pnl: 95363.53,
  gains: 206781.48,
  losses: -111417.95,
  predictions: 192,
  volume: 1380000, // $1.38M
  open_positions_value: 151400 // $151.4k
}

interface DomePnLResponse {
  pnl_over_time: Array<{
    timestamp: number
    pnl_to_date: number
  }>
}

async function fetchDomePnL(wallet: string): Promise<number | null> {
  try {
    const url = `${DOME_API_BASE_URL}/polymarket/wallet/pnl/${wallet}?granularity=all`
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${DOME_API_KEY}`,
        'Accept': 'application/json'
      }
    })

    if (!response.ok) {
      console.log(`  ⚠️  Dome API ${response.status}`)
      return null
    }

    const data: DomePnLResponse = await response.json()
    if (!data.pnl_over_time || data.pnl_over_time.length === 0) {
      return null
    }

    return data.pnl_over_time[data.pnl_over_time.length - 1].pnl_to_date
  } catch (error: any) {
    console.log(`  ⚠️  Dome API error: ${error.message}`)
    return null
  }
}

async function benchmark() {
  const client = getClickHouseClient()

  try {
    console.log('='.repeat(80))
    console.log('WALLET BENCHMARK: 0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
    console.log('='.repeat(80))
    console.log('')
    console.log('Ground Truth (Polymarket UI):')
    console.log(`  Net P&L: $${GROUND_TRUTH.net_pnl.toLocaleString()}`)
    console.log(`  Gains: $${GROUND_TRUTH.gains.toLocaleString()}`)
    console.log(`  Losses: $${GROUND_TRUTH.losses.toLocaleString()}`)
    console.log(`  Predictions: ${GROUND_TRUTH.predictions}`)
    console.log(`  Volume: $${(GROUND_TRUTH.volume / 1000).toFixed(0)}k`)
    console.log(`  Open Positions: $${(GROUND_TRUTH.open_positions_value / 1000).toFixed(0)}k`)
    console.log('')

    // Step 1: Our realized P&L
    console.log('1. OUR REALIZED P&L (realized_pnl_by_market_final):')
    console.log('-'.repeat(80))

    const ourPnl = await client.query({
      query: `
        SELECT
          count() as market_count,
          sum(realized_pnl_usd) as total_pnl,
          sum(if(realized_pnl_usd > 0, realized_pnl_usd, 0)) as total_gains,
          sum(if(realized_pnl_usd < 0, realized_pnl_usd, 0)) as total_losses
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const ourData = await ourPnl.json<any[]>()

    const our_market_count = parseInt(ourData[0].market_count)
    const our_total_pnl = parseFloat(ourData[0].total_pnl)
    const our_gains = parseFloat(ourData[0].total_gains)
    const our_losses = parseFloat(ourData[0].total_losses)

    console.log(`  Markets: ${our_market_count}`)
    console.log(`  Total P&L: $${our_total_pnl.toLocaleString()}`)
    console.log(`  Gains: $${our_gains.toLocaleString()}`)
    console.log(`  Losses: $${our_losses.toLocaleString()}`)
    console.log('')

    // Step 2: CLOB fills (source data)
    console.log('2. CLOB FILLS (clob_fills table):')
    console.log('-'.repeat(80))

    const clobFills = await client.query({
      query: `
        SELECT
          count() as total_fills,
          count(DISTINCT asset_id) as unique_assets,
          count(DISTINCT condition_id) as unique_conditions,
          sum(abs(price * size / 1000000)) as total_volume
        FROM clob_fills
        WHERE proxy_wallet = '${WALLET}' OR user_eoa = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const clobData = await clobFills.json<any[]>()

    const clob_fills_count = parseInt(clobData[0].total_fills)
    const clob_unique_conditions = parseInt(clobData[0].unique_conditions)
    const clob_volume = parseFloat(clobData[0].total_volume)

    console.log(`  Total fills: ${clob_fills_count}`)
    console.log(`  Unique conditions: ${clob_unique_conditions}`)
    console.log(`  Total volume: $${clob_volume.toLocaleString()}`)
    console.log('')

    // Step 3: Cashflows (processed data)
    console.log('3. TRADE CASHFLOWS (trade_cashflows_v3):')
    console.log('-'.repeat(80))

    const cashflows = await client.query({
      query: `
        SELECT
          count() as total_cashflows,
          count(DISTINCT condition_id_norm) as unique_markets,
          sum(abs(cashflow_usdc)) as total_volume
        FROM trade_cashflows_v3
        WHERE wallet = '${WALLET}'
      `,
      format: 'JSONEachRow'
    })
    const cashflowData = await cashflows.json<any[]>()

    const cashflow_count = parseInt(cashflowData[0].total_cashflows)
    const cashflow_markets = parseInt(cashflowData[0].unique_markets)
    const cashflow_volume = parseFloat(cashflowData[0].total_volume)

    console.log(`  Total cashflows: ${cashflow_count}`)
    console.log(`  Unique markets: ${cashflow_markets}`)
    console.log(`  Total volume: $${cashflow_volume.toLocaleString()}`)
    console.log('')

    // Step 4: Top 20 markets by P&L
    console.log('4. TOP 20 MARKETS BY P&L:')
    console.log('-'.repeat(80))

    const topMarkets = await client.query({
      query: `
        SELECT
          condition_id_norm,
          realized_pnl_usd
        FROM realized_pnl_by_market_final
        WHERE wallet = '${WALLET}'
        ORDER BY abs(realized_pnl_usd) DESC
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })
    const markets = await topMarkets.json<any[]>()

    markets.forEach((m, idx) => {
      const pnl = parseFloat(m.realized_pnl_usd)
      const sign = pnl >= 0 ? '+' : ''
      console.log(`  ${(idx + 1).toString().padStart(2)}. ${m.condition_id_norm.substring(0, 16)}... : ${sign}$${pnl.toLocaleString()}`)
    })
    console.log('')

    // Step 5: Call Dome API
    console.log('5. DOME API:')
    console.log('-'.repeat(80))

    const domePnL = await fetchDomePnL(WALLET)
    if (domePnL !== null) {
      console.log(`  Dome P&L: $${domePnL.toLocaleString()}`)
    } else {
      console.log(`  ⚠️  Could not fetch Dome API data`)
    }
    console.log('')

    // Step 6: Comparison Analysis
    console.log('='.repeat(80))
    console.log('COMPARISON ANALYSIS')
    console.log('='.repeat(80))
    console.log('')

    // P&L Comparison
    const pnl_diff = our_total_pnl - GROUND_TRUTH.net_pnl
    const pnl_pct = (Math.abs(pnl_diff) / GROUND_TRUTH.net_pnl * 100)

    console.log('P&L Comparison:')
    console.log(`  Ground Truth (UI): $${GROUND_TRUTH.net_pnl.toLocaleString()}`)
    console.log(`  Our Calculation:   $${our_total_pnl.toLocaleString()}`)
    if (domePnL !== null) {
      console.log(`  Dome API:          $${domePnL.toLocaleString()}`)
    }
    console.log(`  Difference:        $${pnl_diff.toLocaleString()} (${pnl_pct.toFixed(1)}%)`)
    console.log('')

    // Market Count Comparison
    const market_coverage = (our_market_count / GROUND_TRUTH.predictions * 100)

    console.log('Market Count:')
    console.log(`  Ground Truth (UI): ${GROUND_TRUTH.predictions} predictions`)
    console.log(`  CLOB fills:        ${clob_unique_conditions} unique conditions`)
    console.log(`  Our cashflows:     ${cashflow_markets} markets`)
    console.log(`  Our realized P&L:  ${our_market_count} markets`)
    console.log(`  Coverage:          ${market_coverage.toFixed(1)}%`)
    console.log('')

    // Volume Comparison
    const volume_coverage = (clob_volume / GROUND_TRUTH.volume * 100)

    console.log('Volume:')
    console.log(`  Ground Truth (UI): $${(GROUND_TRUTH.volume / 1000).toFixed(0)}k`)
    console.log(`  CLOB fills:        $${(clob_volume / 1000).toFixed(0)}k`)
    console.log(`  Coverage:          ${volume_coverage.toFixed(1)}%`)
    console.log('')

    // Data Pipeline Coverage
    const pipeline_coverage = (cashflow_count / clob_fills_count * 100)

    console.log('Data Pipeline:')
    console.log(`  CLOB fills → Cashflows: ${pipeline_coverage.toFixed(1)}% (${cashflow_count}/${clob_fills_count})`)
    console.log(`  CLOB markets → Realized: ${(our_market_count / clob_unique_conditions * 100).toFixed(1)}% (${our_market_count}/${clob_unique_conditions})`)
    console.log('')

    // Diagnosis
    console.log('='.repeat(80))
    console.log('DIAGNOSIS')
    console.log('='.repeat(80))
    console.log('')

    let diagnosis = []

    if (market_coverage < 50) {
      diagnosis.push('❌ CRITICAL: CLOB ingestion missing >50% of markets')
      diagnosis.push('   → Only capturing ' + our_market_count + ' of ' + GROUND_TRUTH.predictions + ' markets')
      diagnosis.push('   → This is the PRIMARY blocker')
    } else if (market_coverage < 80) {
      diagnosis.push('⚠️  WARNING: CLOB ingestion missing 20-50% of markets')
      diagnosis.push('   → Capturing ' + our_market_count + ' of ' + GROUND_TRUTH.predictions + ' markets')
    } else {
      diagnosis.push('✅ GOOD: CLOB ingestion coverage >80%')
    }

    diagnosis.push('')

    if (pnl_pct > 10) {
      diagnosis.push('❌ CRITICAL: P&L calculation off by >10%')
      diagnosis.push('   → Error: $' + Math.abs(pnl_diff).toLocaleString() + ' (' + pnl_pct.toFixed(1) + '%)')
      diagnosis.push('   → Possible causes:')
      diagnosis.push('     • Formula sign error')
      diagnosis.push('     • Unrealized P&L contamination')
      diagnosis.push('     • Fee handling difference')
    } else if (pnl_pct > 5) {
      diagnosis.push('⚠️  WARNING: P&L calculation off by 5-10%')
      diagnosis.push('   → Error: $' + Math.abs(pnl_diff).toLocaleString() + ' (' + pnl_pct.toFixed(1) + '%)')
    } else {
      diagnosis.push('✅ GOOD: P&L calculation within 5%')
      diagnosis.push('   → Error: $' + Math.abs(pnl_diff).toLocaleString() + ' (' + pnl_pct.toFixed(1) + '%)')
    }

    diagnosis.push('')

    if (volume_coverage < 50) {
      diagnosis.push('❌ CRITICAL: Volume coverage <50%')
      diagnosis.push('   → Missing $' + ((GROUND_TRUTH.volume - clob_volume) / 1000).toFixed(0) + 'k of $' + (GROUND_TRUTH.volume / 1000).toFixed(0) + 'k')
    } else if (volume_coverage < 80) {
      diagnosis.push('⚠️  WARNING: Volume coverage 50-80%')
    } else {
      diagnosis.push('✅ GOOD: Volume coverage >80%')
    }

    diagnosis.forEach(line => console.log(line))
    console.log('')

    // Next Steps
    console.log('='.repeat(80))
    console.log('NEXT STEPS')
    console.log('='.repeat(80))
    console.log('')

    if (market_coverage < 50) {
      console.log('1. PRIORITY: Fix CLOB ingestion')
      console.log('   - Check proxy wallet mapping')
      console.log('   - Verify backfill time range')
      console.log('   - Check CLOB API pagination')
      console.log('')
      console.log('2. AFTER ingestion fixed: Re-run this benchmark')
      console.log('')
      console.log('3. THEN: Fix P&L formula if needed')
    } else if (pnl_pct > 5) {
      console.log('1. PRIORITY: Fix P&L formula')
      console.log('   - Investigate sign errors')
      console.log('   - Verify cost basis calculation')
      console.log('   - Check for unrealized contamination')
      console.log('')
      console.log('2. Run 100-wallet validation')
    } else {
      console.log('1. ✅ Ready for 100-wallet validation')
      console.log('   - Both coverage and formula look good')
      console.log('   - Minor tuning may still be needed')
    }
    console.log('')

    // Save analysis
    const analysis = {
      wallet: WALLET,
      ground_truth: GROUND_TRUTH,
      our_data: {
        market_count: our_market_count,
        total_pnl: our_total_pnl,
        gains: our_gains,
        losses: our_losses
      },
      clob_data: {
        fills_count: clob_fills_count,
        unique_conditions: clob_unique_conditions,
        volume: clob_volume
      },
      dome_pnl: domePnL,
      metrics: {
        pnl_diff,
        pnl_pct,
        market_coverage,
        volume_coverage,
        pipeline_coverage
      },
      diagnosis: diagnosis.filter(l => l.trim().length > 0)
    }

    writeFileSync('tmp/benchmark-wallet-0xcce2-results.json', JSON.stringify(analysis, null, 2))
    console.log('📊 Results saved to tmp/benchmark-wallet-0xcce2-results.json')

  } catch (error: any) {
    console.error('\n❌ Error:', error.message)
    console.error('Stack:', error.stack)
    throw error
  } finally {
    await client.close()
  }
}

benchmark()
