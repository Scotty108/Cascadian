/**
 * UI Parity Spot Check
 *
 * Generate comparison tables for manual UI verification.
 * Compare our V4 PnL calculations against Polymarket UI for selected wallets.
 *
 * ⚠️  V3 IS DEPRECATED (broken per-outcome aggregation)
 * ✅ V4 IS CANONICAL (correct per-outcome multiplication)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

// Wallets to check
const WALLETS = [
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', // Egg wallet
  '0xd69be738370bc835e8a9ef45645f1ce5cc7e9c14', // Top #1 ($1.5B)
  '0xd91e80cf2e7be2e162e7847f54af3fae28ab8ca5', // Top #2 ($364M)
  '0x1f2dd6d473f3e824cd2f8a03e370dc0b88e94c15', // Top #3 ($54.8M)
  '0xb5fc4d5388952dc7a723aefb35e1975fb8e3e28c', // Top #4 ($53.9M)
  '0x9f47f1fcb1701bf9ea85e8b3a77ffe99cf24b75f', // Top #5 ($52M)
]

async function uiParitySpotCheck() {
  console.log('🔍 UI Parity Spot Check\n')
  console.log('='.repeat(80))
  console.log('\n📋 Manual verification against Polymarket UI (All-Time / Closed)\n')
  console.log('Wallets to check:')
  WALLETS.forEach((w, i) => {
    const label = i === 0 ? '(Egg wallet)' : `(Top #${i})`
    console.log(`  ${i + 1}. ${w} ${label}`)
  })
  console.log('\n' + '='.repeat(80))

  try {
    // Step 1: Wallet Summary (resolved-only)
    console.log('\n📊 Step 1: Wallet Summary (Resolved Markets Only)\n')
    console.log('Compare these totals against UI "All-Time" tab (Closed markets):\n')

    const summaryResult = await clickhouse.query({
      query: `
        SELECT
          wallet_address,
          sum(realized_pnl) AS pnl_usdc,
          countDistinct(condition_id) AS markets_resolved,
          count(*) AS positions
        FROM vw_pm_realized_pnl_v4
        WHERE lower(wallet_address) IN (${WALLETS.map(w => `'${w.toLowerCase()}'`).join(', ')})
          AND is_resolved = 1
        GROUP BY wallet_address
        ORDER BY pnl_usdc DESC
      `,
      format: 'JSONEachRow'
    })
    const summary = await summaryResult.json() as Array<{
      wallet_address: string
      pnl_usdc: number
      markets_resolved: string
      positions: string
    }>

    console.log('Wallet (first 20)            | Our PnL (V4)     | Markets | Positions')
    console.log('-------------------------------------------------------------------------')
    summary.forEach(w => {
      const wallet = w.wallet_address.slice(0, 20).padEnd(28)
      const pnl = (`$${parseFloat(w.pnl_usdc).toLocaleString(undefined, {maximumFractionDigits: 2})}`).padStart(16)
      const markets = w.markets_resolved.toString().padStart(7)
      const positions = w.positions.toString().padStart(9)
      console.log(`${wallet} | ${pnl} | ${markets} | ${positions}`)
    })

    // Step 2: Top 10 Markets per Wallet (with quality flags)
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Step 2: Top 10 Markets by |PnL| per Wallet\n')
    console.log('Compare these market-level numbers against UI market history:\n')

    for (const wallet of WALLETS) {
      console.log(`\n📍 Wallet: ${wallet}\n`)

      const marketsResult = await clickhouse.query({
        query: `
          WITH wallet_markets AS (
            SELECT
              condition_id,
              sum(realized_pnl) AS pnl_usdc,
              any(data_quality) AS data_quality
            FROM vw_pm_realized_pnl_v4_with_quality
            WHERE lower(wallet_address) = '${wallet.toLowerCase()}'
              AND is_resolved = 1
            GROUP BY condition_id
          )
          SELECT
            w.condition_id,
            w.pnl_usdc,
            w.data_quality,
            m.question
          FROM wallet_markets w
          LEFT JOIN pm_market_metadata m ON w.condition_id = lower(m.condition_id)
          ORDER BY abs(w.pnl_usdc) DESC
          LIMIT 10
        `,
        format: 'JSONEachRow'
      })
      const markets = await marketsResult.json() as Array<{
        condition_id: string
        pnl_usdc: number
        data_quality: string
        question: string | null
      }>

      if (markets.length === 0) {
        console.log('   ⚠️  No resolved markets found for this wallet\n')
        continue
      }

      console.log('   Market (first 16)    | PnL          | Quality      | Question (first 50)')
      console.log('   ' + '-'.repeat(120))
      markets.forEach(m => {
        const market = m.condition_id.slice(0, 16).padEnd(24)
        const pnl = (`$${parseFloat(m.pnl_usdc).toLocaleString(undefined, {maximumFractionDigits: 2})}`).padStart(12)
        const quality = (m.data_quality || 'ok').padEnd(12)
        const question = (m.question || '(no metadata)').slice(0, 50).padEnd(50)
        console.log(`   ${market} | ${pnl} | ${quality} | ${question}`)
      })
      console.log()
    }

    // Step 3: Data Quality Summary
    console.log('='.repeat(80))
    console.log('\n📊 Step 3: Data Quality Flags Summary\n')

    const qualityResult = await clickhouse.query({
      query: `
        SELECT
          data_quality,
          count(DISTINCT condition_id) AS markets,
          sum(realized_pnl) AS total_pnl
        FROM vw_pm_realized_pnl_v4_with_quality
        WHERE lower(wallet_address) IN (${WALLETS.map(w => `'${w.toLowerCase()}'`).join(', ')})
          AND is_resolved = 1
        GROUP BY data_quality
        ORDER BY data_quality
      `,
      format: 'JSONEachRow'
    })
    const quality = await qualityResult.json() as Array<{
      data_quality: string
      markets: string
      total_pnl: number
    }>

    console.log('Quality Flag    | Markets | Total PnL')
    console.log('-'.repeat(50))
    quality.forEach(q => {
      const flag = q.data_quality.padEnd(15)
      const markets = q.markets.toString().padStart(7)
      const pnl = `$${parseFloat(q.total_pnl).toLocaleString(undefined, {maximumFractionDigits: 2})}`
      console.log(`${flag} | ${markets} | ${pnl}`)
    })

    // Step 4: Manual Verification Checklist
    console.log('\n' + '='.repeat(80))
    console.log('\n✅ Manual Verification Checklist\n')
    console.log('For each wallet above:')
    console.log('  1. Go to https://polymarket.com/profile/<wallet>')
    console.log('  2. Click "All-Time" tab')
    console.log('  3. Check "Closed" markets')
    console.log('  4. Compare:')
    console.log('     - Total PnL (our V3 vs UI)')
    console.log('     - Number of resolved markets')
    console.log('     - Top 5-10 market PnLs')
    console.log('  5. Note any discrepancies:')
    console.log('     - Check data_quality flag (missing_amm, partial, etc.)')
    console.log('     - If quality = "ok" but PnL differs, investigate further')
    console.log('     - If quality = "missing_amm", expect gap (blocked on Goldsky)')
    console.log('\n📝 Document findings in docs/systems/database/UI_PARITY_FINDINGS.md')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

uiParitySpotCheck()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
