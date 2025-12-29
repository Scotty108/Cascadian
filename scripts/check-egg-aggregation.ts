/**
 * Check if $41K is an aggregation of egg markets
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

const WALLET = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'

async function checkEggAggregation() {
  console.log('🔍 Checking Egg Market Aggregations\n')

  const result = await clickhouse.query({
    query: `
      SELECT
        p.condition_id,
        m.question,
        sum(p.realized_pnl) AS pnl
      FROM vw_pm_realized_pnl_v2 p
      JOIN pm_market_metadata m ON p.condition_id = lower(m.condition_id)
      WHERE p.wallet_address = '${WALLET}'
        AND lower(m.question) LIKE '%egg%'
      GROUP BY p.condition_id, m.question
      ORDER BY pnl DESC
    `,
    format: 'JSONEachRow'
  })

  const markets = await result.json() as Array<{
    condition_id: string
    question: string
    pnl: number
  }>

  console.log('Top egg markets:')
  markets.slice(0, 10).forEach((m, idx) => {
    console.log(`${idx + 1}. $${m.pnl.toFixed(2).padStart(11)} - ${m.question}`)
  })

  // Check combinations
  console.log('\n' + '='.repeat(80))
  console.log('\nChecking if $41K is aggregate:\n')

  // Top 2
  const top2Sum = markets[0].pnl + markets[1].pnl
  console.log(`Top 2 sum: $${top2Sum.toFixed(2)}`)
  if (Math.abs(top2Sum - 41000) < 3000) {
    console.log('  ✅ Close to $41K!')
  }

  // Top 3
  const top3Sum = markets[0].pnl + markets[1].pnl + markets[2].pnl
  console.log(`Top 3 sum: $${top3Sum.toFixed(2)}`)
  if (Math.abs(top3Sum - 41000) < 3000) {
    console.log('  ✅ Close to $41K!')
  }

  //Total
  const total = markets.reduce((sum, m) => sum + m.pnl, 0)
  console.log(`\nAll egg markets total: $${total.toFixed(2)}`)
  if (Math.abs(total - 41000) < 3000) {
    console.log('  ✅ Total is close to $41K!')
  }

  console.log('\n' + '='.repeat(80))
  console.log('\nConclusion:')
  console.log()
  console.log(`Our egg market total: $${total.toFixed(2)}`)
  console.log(`UI expected ~$41K:    ~$41,000`)
  console.log(`Difference:           $${Math.abs(total - 41000).toFixed(2)}`)
  console.log()
  if (Math.abs(total - 41289) < 2000) {
    console.log('✅ OUR TOTAL MATCHES UI!')
    console.log('   UI likely shows aggregate egg PnL as single number')
    console.log('   NOT 4 separate egg wins')
  }
}

checkEggAggregation()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
