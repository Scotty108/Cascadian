/**
 * Find Missing Egg Markets - Deep Dive
 *
 * UI shows 4 big egg wins totaling ~$77K:
 * - $41K, $25K, ~$6K, ~$5K
 *
 * We found 19 egg markets totaling $42.8K
 *
 * Goals:
 * 1. List all egg markets we have (sorted by PnL desc)
 * 2. Search for exact UI phrases in metadata
 * 3. Find condition_ids in token map but not metadata
 * 4. Check trade coverage for candidate markets
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function findMissingEggMarkets() {
  console.log('🔍 Finding Missing Egg Markets - Deep Dive\n')
  console.log('='.repeat(80))
  console.log(`\nWallet: ${WALLET}\n`)
  console.log('UI shows 4 big egg wins: ~$41K, ~$25K, ~$6K, ~$5K = ~$77K total')
  console.log('We found 19 egg markets: $42.8K total')
  console.log('Gap: ~$34K in missing egg markets')
  console.log('='.repeat(80))

  try {
    // Query 1: List ALL egg markets we have (with PnL)
    console.log('\n📊 Query 1: ALL Egg Markets We Have (sorted by PnL desc)\n')

    const eggMarketsResult = await clickhouse.query({
      query: `
        SELECT
          m.question,
          p.condition_id,
          sum(p.realized_pnl) AS pnl_usdc,
          sum(p.trade_cash) AS trade_cash_usdc,
          sum(p.resolution_cash) AS resolution_cash_usdc,
          count() AS positions
        FROM vw_pm_realized_pnl_v2 p
        JOIN pm_market_metadata m ON p.condition_id = lower(m.condition_id)
        WHERE p.wallet_address = '${WALLET}'
          AND lower(m.question) LIKE '%egg%'
        GROUP BY m.question, p.condition_id
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
    }>

    console.log(`Found ${eggMarkets.length} egg markets:\n`)
    console.log('PnL         | Question (first 60)')
    console.log('-'.repeat(90))

    eggMarkets.forEach((row, idx) => {
      const rank = (idx + 1).toString().padStart(2)
      const pnl = row.pnl_usdc !== null ? `$${row.pnl_usdc.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
      const question = row.question.slice(0, 60).padEnd(60)
      console.log(`${rank}. ${pnl} - ${question}`)
    })

    const totalEggPnL = eggMarkets.reduce((sum, r) => sum + (r.pnl_usdc || 0), 0)
    console.log()
    console.log(`Total: $${totalEggPnL.toFixed(2)}`)

    // Check for UI target amounts
    console.log()
    console.log('Looking for UI target amounts (~$41K, ~$25K, ~$6K, ~$5K):')
    const match41K = eggMarkets.find(m => m.pnl_usdc && Math.abs(m.pnl_usdc - 41000) < 5000)
    const match25K = eggMarkets.find(m => m.pnl_usdc && Math.abs(m.pnl_usdc - 25000) < 5000)
    const match6K = eggMarkets.find(m => m.pnl_usdc && Math.abs(m.pnl_usdc - 6000) < 2000)
    const match5K = eggMarkets.find(m => m.pnl_usdc && Math.abs(m.pnl_usdc - 5000) < 2000)

    if (match41K) console.log(`  ✅ Found ~$41K: ${match41K.question} ($${match41K.pnl_usdc?.toFixed(2)})`)
    else console.log('  ❌ Missing ~$41K egg market')

    if (match25K) console.log(`  ✅ Found ~$25K: ${match25K.question} ($${match25K.pnl_usdc?.toFixed(2)})`)
    else console.log('  ❌ Missing ~$25K egg market')

    if (match6K) console.log(`  ✅ Found ~$6K: ${match6K.question} ($${match6K.pnl_usdc?.toFixed(2)})`)
    else console.log('  ❌ Missing ~$6K egg market')

    if (match5K) console.log(`  ✅ Found ~$5K: ${match5K.question} ($${match5K.pnl_usdc?.toFixed(2)})`)
    else console.log('  ❌ Missing ~$5K egg market')

    // Query 2: Search for exact UI phrases in metadata
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 2: Search for Exact UI Phrases in Metadata\n')

    const uiPhrasesResult = await clickhouse.query({
      query: `
        SELECT lower(condition_id) AS condition_id, question
        FROM pm_market_metadata
        WHERE lower(question) LIKE '%egg%'
          AND (
            lower(question) LIKE '%below $4.50%'
            OR lower(question) LIKE '%more than $6%'
            OR lower(question) LIKE '%3.25-3.50%'
            OR lower(question) LIKE '%below $3%'
            OR lower(question) LIKE '%above $5%'
          )
        ORDER BY question
      `,
      format: 'JSONEachRow'
    })
    const uiPhrases = await uiPhrasesResult.json() as Array<{
      condition_id: string
      question: string
    }>

    console.log(`Found ${uiPhrases.length} egg markets matching UI phrases:\n`)
    uiPhrases.forEach(row => {
      console.log(`  ${row.question}`)
      console.log(`    condition_id: ${row.condition_id}`)

      // Check if wallet traded this market
      const tradedMarket = eggMarkets.find(m => m.condition_id === row.condition_id)
      if (tradedMarket) {
        console.log(`    ✅ Wallet traded: PnL = $${tradedMarket.pnl_usdc?.toFixed(2)}`)
      } else {
        console.log(`    ❌ Wallet DID NOT trade this market (or no PnL)`)
      }
      console.log()
    })

    // Query 3: Condition IDs in token map but not metadata
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Query 3: Condition IDs in Token Map but Missing Metadata\n')

    const missingMetadataResult = await clickhouse.query({
      query: `
        SELECT DISTINCT lower(t.condition_id) AS condition_id
        FROM pm_token_to_condition_map_v3 t
        LEFT JOIN pm_market_metadata m ON lower(t.condition_id) = lower(m.condition_id)
        WHERE m.condition_id IS NULL
        LIMIT 100
      `,
      format: 'JSONEachRow'
    })
    const missingMetadata = await missingMetadataResult.json() as Array<{ condition_id: string }>

    console.log(`Found ${missingMetadata.length} condition_ids with missing metadata\n`)

    if (missingMetadata.length > 0) {
      console.log('Sample (first 10):')
      missingMetadata.slice(0, 10).forEach(row => {
        console.log(`  ${row.condition_id}`)
      })

      // Query 4: Check if wallet traded any of these
      console.log('\n' + '='.repeat(80))
      console.log('\n📊 Query 4: Wallet Trades on Markets Missing Metadata\n')

      const walletTradesNoMetadataResult = await clickhouse.query({
        query: `
          SELECT
            condition_id,
            count(*) AS trades,
            sum(shares_delta) AS net_shares,
            sum(cash_delta_usdc) AS net_cash_usdc
          FROM vw_pm_ledger_v2
          WHERE wallet_address = '${WALLET}'
            AND condition_id IN (
              SELECT DISTINCT lower(t.condition_id)
              FROM pm_token_to_condition_map_v3 t
              LEFT JOIN pm_market_metadata m ON lower(t.condition_id) = lower(m.condition_id)
              WHERE m.condition_id IS NULL
            )
          GROUP BY condition_id
          ORDER BY trades DESC
          LIMIT 50
        `,
        format: 'JSONEachRow'
      })
      const walletTradesNoMetadata = await walletTradesNoMetadataResult.json() as Array<{
        condition_id: string
        trades: string
        net_shares: number
        net_cash_usdc: number
      }>

      if (walletTradesNoMetadata.length > 0) {
        console.log(`⚠️  Wallet traded ${walletTradesNoMetadata.length} markets with missing metadata!\n`)
        console.log('These could be the missing egg markets:\n')
        console.log('Condition ID (first 40)                    | Trades | Net Cash')
        console.log('-'.repeat(70))

        walletTradesNoMetadata.forEach(row => {
          const condId = row.condition_id.slice(0, 40).padEnd(40)
          const trades = parseInt(row.trades).toString().padStart(6)
          const cash = `$${row.net_cash_usdc.toFixed(2)}`.padStart(11)
          console.log(`${condId} | ${trades} | ${cash}`)
        })

        // Query 5: Trade coverage for candidate markets
        console.log('\n' + '='.repeat(80))
        console.log('\n📊 Query 5: Trade Coverage for Top Candidates (Missing Metadata)\n')

        for (const candidate of walletTradesNoMetadata.slice(0, 5)) {
          console.log(`\nCondition: ${candidate.condition_id}`)

          const coverageResult = await clickhouse.query({
            query: `
              SELECT
                condition_id,
                count(*) AS trade_rows,
                sum(shares_delta) AS net_shares,
                sum(cash_delta_usdc) AS net_cash_usdc,
                min(block_time) AS first_trade,
                max(block_time) AS last_trade
              FROM vw_pm_ledger_v2
              WHERE wallet_address = '${WALLET}'
                AND condition_id = '${candidate.condition_id}'
              GROUP BY condition_id
            `,
            format: 'JSONEachRow'
          })
          const coverage = await coverageResult.json() as Array<{
            condition_id: string
            trade_rows: string
            net_shares: number
            net_cash_usdc: number
            first_trade: string
            last_trade: string
          }>

          if (coverage.length > 0) {
            const c = coverage[0]
            console.log(`  Trade rows:   ${c.trade_rows}`)
            console.log(`  Net shares:   ${c.net_shares.toFixed(2)}`)
            console.log(`  Net cash:     $${c.net_cash_usdc.toFixed(2)}`)
            console.log(`  First trade:  ${c.first_trade}`)
            console.log(`  Last trade:   ${c.last_trade}`)

            // Check if it has resolution
            const resolutionResult = await clickhouse.query({
              query: `
                SELECT
                  lower(condition_id) AS condition_id,
                  payout_numerators,
                  resolved_at
                FROM pm_condition_resolutions
                WHERE lower(condition_id) = '${candidate.condition_id}'
                  AND is_deleted = 0
                LIMIT 1
              `,
              format: 'JSONEachRow'
            })
            const resolution = await resolutionResult.json() as Array<{
              condition_id: string
              payout_numerators: string
              resolved_at: string
            }>

            if (resolution.length > 0) {
              console.log(`  ✅ Has resolution: ${resolution[0].payout_numerators}`)
              console.log(`     Resolved at: ${resolution[0].resolved_at}`)
            } else {
              console.log(`  ❌ NO RESOLUTION - market unresolved or missing`)
            }
          }
        }
      } else {
        console.log('✅ Wallet did not trade any markets with missing metadata')
      }
    } else {
      console.log('✅ All condition_ids in token map have metadata')
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 SUMMARY\n')
    console.log('What we found:')
    console.log()
    console.log(`1. Egg markets in our data: ${eggMarkets.length}`)
    console.log(`   Total PnL: $${totalEggPnL.toFixed(2)}`)
    console.log()
    console.log('2. UI target matches:')
    console.log(`   ~$41K: ${match41K ? '✅ FOUND' : '❌ MISSING'}`)
    console.log(`   ~$25K: ${match25K ? '✅ FOUND' : '❌ MISSING'}`)
    console.log(`   ~$6K:  ${match6K ? '✅ FOUND' : '❌ MISSING'}`)
    console.log(`   ~$5K:  ${match5K ? '✅ FOUND' : '❌ MISSING'}`)
    console.log()
    console.log(`3. Markets with missing metadata: ${missingMetadata.length}`)
    if (walletTradesNoMetadata && walletTradesNoMetadata.length > 0) {
      console.log(`   Wallet traded ${walletTradesNoMetadata.length} of these!`)
      console.log('   ⚠️  These are likely the missing egg markets')
    }
    console.log()
    console.log('Next steps:')
    console.log('  1. Backfill metadata for condition_ids with missing metadata')
    console.log('  2. Re-run PnL calculation to include these markets')
    console.log('  3. Verify if these are the missing egg markets from UI')
    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

findMissingEggMarkets()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
