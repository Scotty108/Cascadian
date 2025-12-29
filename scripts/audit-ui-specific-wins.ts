/**
 * Audit UI Specific Wins - Per Market Analysis
 *
 * UI shows 4 big egg wins:
 * 1. "Will a dozen eggs be below $4.50 in May?" ~$41,289.47
 * 2. "Will egg prices be more than $6.00 in March?" ~$25,528.83
 * 3. "Will a dozen eggs be between $3.25-3.50 in August?" ~$5,925.46
 * 4. "Will a dozen eggs be between $3.25-3.50 in July?" ~$5,637.10
 * Total: ~$78,380
 *
 * Our total: $42,782.14 (GAP: ~$35,598)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function auditUISpecificWins() {
  console.log('🔍 Auditing UI Specific Wins - Per Market\n')
  console.log('='.repeat(80))
  console.log(`\nWallet: ${WALLET}\n`)
  console.log('UI Target Egg Wins:')
  console.log('  1. "below $4.50 in May"           ~$41,289.47')
  console.log('  2. "more than $6.00 in March"     ~$25,528.83')
  console.log('  3. "$3.25-3.50 in August"         ~$5,925.46')
  console.log('  4. "$3.25-3.50 in July"           ~$5,637.10')
  console.log('  Total:                            ~$78,380')
  console.log()
  console.log('Our total egg PnL: $42,782.14')
  console.log('GAP: ~$35,598')
  console.log('='.repeat(80))

  try {
    // Step 1: Find candidate condition_ids for the 4 egg questions
    console.log('\n📊 Step 1: Find Candidate Condition IDs\n')

    const candidatesResult = await clickhouse.query({
      query: `
        SELECT lower(condition_id) AS condition_id, question
        FROM pm_market_metadata
        WHERE lower(question) LIKE '%egg%'
          AND (
               lower(question) LIKE '%below $4.50%'
            OR lower(question) LIKE '%more than $6%'
            OR lower(question) LIKE '%3.25-3.50%'
          )
        ORDER BY question
      `,
      format: 'JSONEachRow'
    })
    const candidates = await candidatesResult.json() as Array<{
      condition_id: string
      question: string
    }>

    console.log(`Found ${candidates.length} candidate egg markets:\n`)
    candidates.forEach((c, idx) => {
      console.log(`${idx + 1}. ${c.question}`)
      console.log(`   condition_id: ${c.condition_id}`)
      console.log()
    })

    // Map UI questions to condition_ids
    const below450May = candidates.find(c => c.question.toLowerCase().includes('below $4.50') && c.question.toLowerCase().includes('may'))
    const moreThan6March = candidates.find(c => c.question.toLowerCase().includes('more than $6') && c.question.toLowerCase().includes('march'))
    const range325350Aug = candidates.find(c => c.question.toLowerCase().includes('3.25-3.50') && c.question.toLowerCase().includes('august'))
    const range325350Jul = candidates.find(c => c.question.toLowerCase().includes('3.25-3.50') && c.question.toLowerCase().includes('july'))

    console.log('Mapping UI questions to condition_ids:\n')
    console.log('1. "below $4.50 in May":')
    console.log(`   ${below450May ? '✅ ' + below450May.condition_id : '❌ NOT FOUND'}`)
    console.log()
    console.log('2. "more than $6.00 in March":')
    console.log(`   ${moreThan6March ? '✅ ' + moreThan6March.condition_id : '❌ NOT FOUND'}`)
    console.log()
    console.log('3. "$3.25-3.50 in August":')
    console.log(`   ${range325350Aug ? '✅ ' + range325350Aug.condition_id : '❌ NOT FOUND'}`)
    console.log()
    console.log('4. "$3.25-3.50 in July":')
    console.log(`   ${range325350Jul ? '✅ ' + range325350Jul.condition_id : '❌ NOT FOUND'}`)

    // Collect all found condition_ids
    const eggIds: string[] = []
    if (below450May) eggIds.push(below450May.condition_id)
    if (moreThan6March) eggIds.push(moreThan6March.condition_id)
    if (range325350Aug) eggIds.push(range325350Aug.condition_id)
    if (range325350Jul) eggIds.push(range325350Jul.condition_id)

    if (eggIds.length === 0) {
      console.log('\n❌ No egg markets found - cannot continue audit')
      return
    }

    // Step 2: Our PnL for these specific markets
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Step 2: Our PnL for These 4 Egg Markets\n')

    const pnlResult = await clickhouse.query({
      query: `
        SELECT
          m.question,
          p.condition_id,
          sum(p.realized_pnl) AS pnl_usdc,
          sum(p.trade_cash) AS trade_cash_usdc,
          sum(p.resolution_cash) AS resolution_cash_usdc,
          count(*) AS pnl_rows,
          max(p.resolution_time) AS resolution_time
        FROM vw_pm_realized_pnl_v2 p
        JOIN pm_market_metadata m ON p.condition_id = lower(m.condition_id)
        WHERE p.wallet_address = '${WALLET}'
          AND p.condition_id IN (${eggIds.map(id => `'${id}'`).join(', ')})
        GROUP BY m.question, p.condition_id
        ORDER BY pnl_usdc DESC
      `,
      format: 'JSONEachRow'
    })
    const pnl = await pnlResult.json() as Array<{
      question: string
      condition_id: string
      pnl_usdc: number | null
      trade_cash_usdc: number
      resolution_cash_usdc: number
      pnl_rows: string
      resolution_time: string | null
    }>

    console.log('PnL comparison:\n')
    console.log('Question (first 50)                              | Our PnL     | UI Target   | Gap')
    console.log('-'.repeat(105))

    const targets = [
      { name: 'below $4.50 in May', target: 41289.47 },
      { name: 'more than $6', target: 25528.83 },
      { name: '3.25-3.50 in August', target: 5925.46 },
      { name: '3.25-3.50 in July', target: 5637.10 }
    ]

    targets.forEach(t => {
      const match = pnl.find(p => p.question.toLowerCase().includes(t.name.toLowerCase()))
      if (match) {
        const question = match.question.slice(0, 48).padEnd(48)
        const ourPnl = match.pnl_usdc !== null ? `$${match.pnl_usdc.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
        const targetPnl = `$${t.target.toFixed(2)}`.padStart(11)
        const gap = match.pnl_usdc !== null ? `$${(match.pnl_usdc - t.target).toFixed(2)}`.padStart(11) : 'N/A'.padStart(11)
        console.log(`${question} | ${ourPnl} | ${targetPnl} | ${gap}`)
      } else {
        const question = t.name.slice(0, 48).padEnd(48)
        console.log(`${question} | ❌ MISSING  | $${t.target.toFixed(2).padStart(10)} | -$${t.target.toFixed(2)}`)
      }
    })

    const ourTotal = pnl.reduce((sum, p) => sum + (p.pnl_usdc || 0), 0)
    const targetTotal = 78380.86
    console.log()
    console.log(`Total: $${ourTotal.toFixed(2).padStart(10)} | $${targetTotal.toFixed(2).padStart(10)} | $${(ourTotal - targetTotal).toFixed(2)}`)

    // Step 3: Trade coverage for these markets
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Step 3: Trade Coverage for These 4 Markets\n')

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
          AND condition_id IN (${eggIds.map(id => `'${id}'`).join(', ')})
        GROUP BY condition_id
        ORDER BY condition_id
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

    console.log('Trade coverage:\n')
    console.log('Condition ID (first 40)                    | Trades | Net Shares  | Net Cash')
    console.log('-'.repeat(90))

    coverage.forEach(c => {
      const condId = c.condition_id.slice(0, 40).padEnd(40)
      const trades = parseInt(c.trade_rows).toString().padStart(6)
      const shares = c.net_shares.toFixed(2).padStart(11)
      const cash = `$${c.net_cash_usdc.toFixed(2)}`.padStart(11)
      console.log(`${condId} | ${trades} | ${shares} | ${cash}`)
    })

    // Step 4: Look for trades with missing metadata
    console.log('\n' + '='.repeat(80))
    console.log('\n📊 Step 4: Trades with Missing Metadata (Potential Hidden Markets)\n')

    const missingMetadataResult = await clickhouse.query({
      query: `
        SELECT
          l.condition_id,
          count(*) AS trade_count
        FROM vw_pm_ledger_v2 l
        LEFT JOIN pm_market_metadata m ON l.condition_id = lower(m.condition_id)
        WHERE l.wallet_address = '${WALLET}'
          AND m.condition_id IS NULL
        GROUP BY l.condition_id
        ORDER BY trade_count DESC
        LIMIT 50
      `,
      format: 'JSONEachRow'
    })
    const missingMetadata = await missingMetadataResult.json() as Array<{
      condition_id: string
      trade_count: string
    }>

    if (missingMetadata.length > 0) {
      console.log(`⚠️  Found ${missingMetadata.length} condition_ids with trades but NO metadata!\n`)
      console.log('Condition ID (first 64)                                            | Trades')
      console.log('-'.repeat(80))

      missingMetadata.forEach(m => {
        const condId = m.condition_id.slice(0, 64).padEnd(64)
        const trades = parseInt(m.trade_count).toString().padStart(6)
        console.log(`${condId} | ${trades}`)
      })

      console.log()
      console.log('🔴 CRITICAL: These could be the missing egg markets!')
      console.log('   Need to backfill metadata for these condition_ids')
    } else {
      console.log('✅ No trades with missing metadata')
    }

    // Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n📋 SUMMARY\n')
    console.log('Per-market audit results:\n')

    targets.forEach(t => {
      const match = pnl.find(p => p.question.toLowerCase().includes(t.name.toLowerCase()))
      console.log(`${t.name}:`)
      if (match) {
        const ourPnl = match.pnl_usdc || 0
        const gap = ourPnl - t.target
        console.log(`  Our PnL:  $${ourPnl.toFixed(2)}`)
        console.log(`  UI shows: $${t.target.toFixed(2)}`)
        console.log(`  Gap:      $${gap.toFixed(2)} (${((gap/t.target)*100).toFixed(1)}%)`)
        if (Math.abs(gap) > t.target * 0.1) {
          console.log(`  ⚠️  SIGNIFICANT GAP - possible data issue`)
        } else {
          console.log(`  ✅ Close match`)
        }
      } else {
        console.log(`  ❌ MARKET NOT FOUND IN OUR DATA`)
        console.log(`  UI shows: $${t.target.toFixed(2)}`)
        console.log(`  Gap:      -$${t.target.toFixed(2)} (100% missing)`)
      }
      console.log()
    })

    console.log('Totals:')
    console.log(`  Our 4 markets:  $${ourTotal.toFixed(2)}`)
    console.log(`  UI 4 markets:   $${targetTotal.toFixed(2)}`)
    console.log(`  Gap:            $${(ourTotal - targetTotal).toFixed(2)}`)
    console.log()

    if (missingMetadata.length > 0) {
      console.log('🔴 NEXT STEPS:')
      console.log(`  1. Investigate ${missingMetadata.length} condition_ids with missing metadata`)
      console.log('  2. Backfill metadata from Polymarket API')
      console.log('  3. Re-run PnL calculation')
      console.log('  4. Verify if these are the missing egg markets')
    } else {
      console.log('Conclusion:')
      console.log('  - No metadata gaps found')
      console.log('  - Gap is likely due to different calculation methodology or data sources')
    }

    console.log()
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

auditUISpecificWins()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
