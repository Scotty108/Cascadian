/**
 * Find Egg Markets and Top Wins - Internal Data Only
 *
 * Goals:
 * 1. Find ALL egg markets for the wallet and their PnL
 * 2. Get top 30 markets by PnL
 * 3. Check if big egg market (~$41,289) exists in our data
 * 4. Identify trade coverage gaps
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function findEggMarketsAndTopWins() {
  console.log('🔍 Finding Egg Markets and Top Wins\n')
  console.log('='.repeat(80))
  console.log(`\nWallet: ${WALLET}\n`)
  console.log('='.repeat(80))

  try {
    // Query 1: ALL egg markets for this wallet
    console.log('\n🥚 Query 1: ALL Egg Markets for Wallet\n')

    const eggMarketsResult = await clickhouse.query({
      query: `
        WITH eggs AS (
          SELECT lower(condition_id) AS condition_id, question
          FROM pm_market_metadata
          WHERE lower(question) LIKE '%egg%'
        )
        SELECT
          e.question,
          p.condition_id,
          sum(p.realized_pnl) AS pnl_usdc,
          sum(p.trade_cash) AS trade_cash_usdc,
          sum(p.resolution_cash) AS resolution_cash_usdc,
          count() AS positions,
          (SELECT count()
           FROM vw_pm_ledger_v2 l
           WHERE l.wallet_address = '${WALLET}'
             AND l.condition_id = p.condition_id) AS trade_rows
        FROM vw_pm_realized_pnl_v2 p
        JOIN eggs e ON p.condition_id = e.condition_id
        WHERE p.wallet_address = '${WALLET}'
        GROUP BY e.question, p.condition_id
        ORDER BY pnl_usdc DESC
        LIMIT 50
      `,
      format: 'JSONEachRow'
    })
    const eggMarkets = await eggMarketsResult.json() as Array<{
      question: string
      condition_id: string
      pnl_usdc: number | null
      trade_cash_usdc: number
      resolution_cash_usdc: number
      positions: string
      trade_rows: string
    }>

    if (eggMarkets.length > 0) {
      console.log(`Found ${eggMarkets.length} egg market(s):\n`)
      console.log('Question (first 45)                             | PnL         | Trade Cash  | Positions | Trades')
      console.log('-'.repeat(110))

      eggMarkets.forEach(row => {
        const question = row.question.slice(0, 45).padEnd(45)
        const pnl = row.pnl_usdc !== null ? `$${row.pnl_usdc.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
        const tradeCash = `$${row.trade_cash_usdc.toFixed(2)}`.padStart(11)
        const positions = parseInt(row.positions).toString().padStart(9)
        const trades = parseInt(row.trade_rows).toString().padStart(6)
        console.log(`${question} | ${pnl} | ${tradeCash} | ${positions} | ${trades}`)
      })

      const totalEggPnL = eggMarkets.reduce((sum, r) => sum + (r.pnl_usdc || 0), 0)
      console.log()
      console.log(`Total PnL from egg markets: $${totalEggPnL.toFixed(2)}`)
      console.log()

      // Check if any egg market is close to $41,289
      const bigEgg = eggMarkets.find(m => m.pnl_usdc !== null && Math.abs(m.pnl_usdc - 41289.47) < 1000)
      if (bigEgg) {
        console.log(`✅ Found big egg market (~$41,289): ${bigEgg.question}`)
        console.log(`   PnL: $${bigEgg.pnl_usdc?.toFixed(2)}`)
        console.log(`   Condition ID: ${bigEgg.condition_id}`)
      } else {
        console.log('⚠️  No egg market with ~$41,289 PnL found in our data')
        console.log('   This suggests we are missing trade data for the big egg market from UI')
      }
    } else {
      console.log('❌ No egg markets found for this wallet in our data')
      console.log('   This could mean:')
      console.log('   1. pm_market_metadata is missing egg market entries')
      console.log('   2. Wallet did not trade egg markets (unlikely based on UI)')
      console.log('   3. Ingestion gap - trades exist but not mapped to condition_ids')
    }

    // Query 2: Top 30 markets by PnL
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 2: Top 30 Markets by PnL\n')

    const topMarketsResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          sum(realized_pnl) AS pnl_usdc,
          sum(trade_cash) AS trade_cash_usdc,
          sum(resolution_cash) AS resolution_cash_usdc,
          count() AS positions
        FROM vw_pm_realized_pnl_v2
        WHERE wallet_address = '${WALLET}'
        GROUP BY condition_id
        ORDER BY pnl_usdc DESC
        LIMIT 30
      `,
      format: 'JSONEachRow'
    })
    const topMarkets = await topMarketsResult.json() as Array<{
      condition_id: string
      pnl_usdc: number | null
      trade_cash_usdc: number
      resolution_cash_usdc: number
      positions: string
    }>

    console.log('Top 30 markets by PnL (condition_id first 24):\n')
    console.log('Condition ID (first 24)   | PnL         | Trade Cash  | Resolution Cash | Positions')
    console.log('-'.repeat(95))

    topMarkets.forEach((row, idx) => {
      const rank = (idx + 1).toString().padStart(2)
      const condId = row.condition_id.slice(0, 23).padEnd(23)
      const pnl = row.pnl_usdc !== null ? `$${row.pnl_usdc.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
      const tradeCash = `$${row.trade_cash_usdc.toFixed(2)}`.padStart(11)
      const resCash = `$${row.resolution_cash_usdc.toFixed(2)}`.padStart(15)
      const positions = parseInt(row.positions).toString().padStart(9)
      console.log(`${rank}. ${condId} | ${pnl} | ${tradeCash} | ${resCash} | ${positions}`)
    })

    // Check if any top market is ~$41,289
    const bigWin = topMarkets.find(m => m.pnl_usdc !== null && Math.abs(m.pnl_usdc - 41289.47) < 1000)
    console.log()
    if (bigWin) {
      console.log(`✅ Found big win (~$41,289) in top markets: ${bigWin.condition_id}`)
    } else {
      console.log('⚠️  No market with ~$41,289 PnL in top 30')
      console.log('   The big egg market from UI is NOT in our data')
    }

    // Query 3: Join top markets with metadata to see questions
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 3: Top Markets with Questions\n')

    const topWithQuestionsResult = await clickhouse.query({
      query: `
        WITH top_markets AS (
          SELECT
            condition_id,
            sum(realized_pnl) AS pnl_usdc,
            sum(trade_cash) AS trade_cash_usdc,
            count() AS positions
          FROM vw_pm_realized_pnl_v2
          WHERE wallet_address = '${WALLET}'
          GROUP BY condition_id
          ORDER BY pnl_usdc DESC
          LIMIT 15
        )
        SELECT
          t.condition_id,
          t.pnl_usdc,
          t.trade_cash_usdc,
          t.positions,
          m.question
        FROM top_markets t
        LEFT JOIN pm_market_metadata m ON lower(m.condition_id) = t.condition_id
        ORDER BY t.pnl_usdc DESC
      `,
      format: 'JSONEachRow'
    })
    const topWithQuestions = await topWithQuestionsResult.json() as Array<{
      condition_id: string
      pnl_usdc: number | null
      trade_cash_usdc: number
      positions: string
      question: string | null
    }>

    console.log('Top 15 markets with questions:\n')
    topWithQuestions.forEach((row, idx) => {
      const rank = (idx + 1).toString().padStart(2)
      const pnl = row.pnl_usdc !== null ? `$${row.pnl_usdc.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
      const question = row.question || '[NO METADATA]'
      console.log(`${rank}. ${pnl} - ${question}`)
    })

    // Query 4: Check for markets with missing metadata
    console.log('\n' + '='.repeat(80))
    console.log('\n⚠️  Query 4: Markets with Missing Metadata\n')

    const missingMetadataResult = await clickhouse.query({
      query: `
        WITH wallet_markets AS (
          SELECT DISTINCT condition_id
          FROM vw_pm_realized_pnl_v2
          WHERE wallet_address = '${WALLET}'
        )
        SELECT
          w.condition_id,
          CASE WHEN m.condition_id IS NOT NULL THEN 1 ELSE 0 END AS has_metadata
        FROM wallet_markets w
        LEFT JOIN pm_market_metadata m ON lower(m.condition_id) = w.condition_id
        WHERE has_metadata = 0
        LIMIT 20
      `,
      format: 'JSONEachRow'
    })
    const missingMetadata = await missingMetadataResult.json() as Array<{
      condition_id: string
      has_metadata: number
    }>

    if (missingMetadata.length > 0) {
      console.log(`Found ${missingMetadata.length} markets without metadata:\n`)
      console.log('Condition ID (first 40)')
      console.log('-'.repeat(50))
      missingMetadata.forEach(row => {
        console.log(row.condition_id.slice(0, 40))
      })
      console.log()
      console.log('⚠️  These markets exist in trades but not in pm_market_metadata')
      console.log('   Metadata ingestion may be incomplete')
    } else {
      console.log('✅ All wallet markets have metadata')
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 SUMMARY\n')
    console.log('Findings:')
    console.log()
    console.log(`Egg markets found: ${eggMarkets.length}`)
    if (eggMarkets.length > 0) {
      const totalEggPnL = eggMarkets.reduce((sum, r) => sum + (r.pnl_usdc || 0), 0)
      console.log(`Total egg market PnL: $${totalEggPnL.toFixed(2)}`)
    }
    console.log()
    console.log('Top market PnL: ' + (topMarkets[0]?.pnl_usdc !== null ? `$${topMarkets[0].pnl_usdc.toFixed(2)}` : 'NULL'))
    console.log()

    const totalEggPnL = eggMarkets.reduce((sum, r) => sum + (r.pnl_usdc || 0), 0)

    // Check if total egg PnL is close to $41,289
    if (Math.abs(totalEggPnL - 41289.47) < 2000) {
      console.log('✅ FOUND IT: Total egg market PnL matches UI!')
      console.log(`   UI likely shows aggregate egg PnL: $${totalEggPnL.toFixed(2)}`)
      console.log(`   This is close to the expected $41,289.47`)
    } else if (eggMarkets.length > 0 && eggMarkets[0].pnl_usdc && Math.abs(eggMarkets[0].pnl_usdc - 41289.47) < 2000) {
      console.log('✅ FOUND IT: Top egg market PnL matches UI!')
      console.log(`   "${eggMarkets[0].question}"`)
      console.log(`   PnL: $${eggMarkets[0].pnl_usdc.toFixed(2)}`)
    } else {
      console.log('⚠️  Egg market discrepancy analysis:')
      console.log(`   Expected from UI: ~$41,289.47`)
      console.log(`   Our total egg PnL: $${totalEggPnL.toFixed(2)}`)
      console.log(`   Difference: $${Math.abs(totalEggPnL - 41289.47).toFixed(2)}`)
      console.log()
      console.log('   Possible explanations:')
      console.log('   1. UI shows aggregate of multiple egg markets')
      console.log('   2. UI screenshot from different date (unrealized value changed)')
      console.log('   3. Different calculation methodology')
    }
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

findEggMarketsAndTopWins()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
