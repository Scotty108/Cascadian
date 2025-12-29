/**
 * PnL Engine V1 - Step 2 Prep: Examine Resolution Data
 *
 * Inspects pm_condition_resolutions to understand:
 * - Table structure
 * - Payout numerator format (array structure)
 * - Resolution counts
 * - Sample resolutions
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function examineResolutions() {
  console.log('🔍 PnL Engine V1 - Step 2 Prep: Examining Resolution Data\n')
  console.log('=' .repeat(80))

  try {
    // Check if table exists
    console.log('\n📋 Step 1: Check if pm_condition_resolutions exists...\n')
    const tablesResult = await clickhouse.query({
      query: "SHOW TABLES LIKE 'pm_condition_resolutions'",
      format: 'JSONEachRow',
    })
    const tables = await tablesResult.json() as Array<{ name: string }>

    if (tables.length === 0) {
      console.log('❌ Table pm_condition_resolutions does not exist!')
      console.log('   Need to create or identify the correct resolutions table.')
      return
    }

    console.log('✅ Table exists: pm_condition_resolutions')

    // Describe table structure
    console.log('\n📊 Step 2: Table Structure\n')
    const describeResult = await clickhouse.query({
      query: 'DESCRIBE TABLE pm_condition_resolutions',
      format: 'JSONEachRow',
    })
    const schema = await describeResult.json() as Array<{ name: string; type: string; default_type: string; default_expression: string }>

    console.log('   Column Name                    | Type')
    console.log('   ' + '-'.repeat(70))
    schema.forEach(col => {
      console.log(`   ${col.name.padEnd(30)} | ${col.type}`)
    })

    // Count resolutions
    console.log('\n📊 Step 3: Resolution Counts\n')
    const countResult = await clickhouse.query({
      query: 'SELECT count() as total FROM pm_condition_resolutions',
      format: 'JSONEachRow',
    })
    const count = await countResult.json() as Array<{ total: string }>
    console.log(`   Total resolved conditions: ${parseInt(count[0].total).toLocaleString()}`)

    // Sample resolutions
    console.log('\n📊 Step 4: Sample Resolutions\n')
    const sampleResult = await clickhouse.query({
      query: 'SELECT * FROM pm_condition_resolutions LIMIT 5',
      format: 'JSONEachRow',
    })
    const samples = await sampleResult.json() as any[]

    samples.forEach((row, i) => {
      console.log(`   Resolution ${i + 1}:`)
      console.log(`   ${JSON.stringify(row, null, 2)}\n`)
    })

    // Check payout_numerators structure
    console.log('=' .repeat(80))
    console.log('📊 Step 5: Payout Numerators Analysis\n')

    const payoutAnalysisResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          payout_numerators,
          payout_denominator
        FROM pm_condition_resolutions
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const payoutAnalysis = await payoutAnalysisResult.json() as Array<{
      condition_id: string
      payout_numerators: string
      payout_denominator: string
    }>

    console.log('   Condition ID (first 16 chars)  | Numerators | Denominator')
    console.log('   ' + '-'.repeat(70))
    payoutAnalysis.forEach(row => {
      const condId = row.condition_id.slice(0, 16).padEnd(30)
      const numerators = row.payout_numerators.padEnd(12)
      const denominator = row.payout_denominator.padEnd(11)
      console.log(`   ${condId} | ${numerators} | ${denominator}`)

      // Parse and show calculation
      try {
        const nums = JSON.parse(row.payout_numerators) as number[]
        const denom = parseInt(row.payout_denominator)
        const prices = nums.map(n => (n / denom).toFixed(2))
        console.log(`      → Prices: ${prices.join(', ')}`)
      } catch (e) {
        console.log(`      → Error parsing numerators`)
      }
    })

    // Distribution of outcome counts
    console.log('\n📊 Step 6: Outcome Distribution\n')
    const outcomeDistResult = await clickhouse.query({
      query: `
        SELECT
          length(JSONExtract(payout_numerators, 'Array(UInt64)')) as num_outcomes,
          count() as count
        FROM pm_condition_resolutions
        GROUP BY num_outcomes
        ORDER BY num_outcomes
      `,
      format: 'JSONEachRow',
    })
    const outcomeDist = await outcomeDistResult.json() as Array<{ num_outcomes: number; count: string }>

    console.log('   # Outcomes | Count of Markets')
    console.log('   ' + '-'.repeat(40))
    outcomeDist.forEach(row => {
      console.log(`   ${row.num_outcomes.toString().padStart(10)} | ${parseInt(row.count).toLocaleString()}`)
    })

    // Check for conditions with trades
    console.log('\n=' .repeat(80))
    console.log('📊 Step 7: Resolutions with Trades\n')

    const tradesWithResolutionsResult = await clickhouse.query({
      query: `
        SELECT
          count(DISTINCT r.condition_id) as resolved_with_trades,
          count(DISTINCT l.condition_id) as total_conditions_with_trades,
          (count(DISTINCT r.condition_id) * 100.0 / count(DISTINCT l.condition_id)) as coverage_pct
        FROM vw_pm_ledger l
        LEFT JOIN pm_condition_resolutions r
          ON l.condition_id = r.condition_id
      `,
      format: 'JSONEachRow',
    })
    const tradesWithResolutions = await tradesWithResolutionsResult.json() as Array<{
      resolved_with_trades: string
      total_conditions_with_trades: string
      coverage_pct: number
    }>

    const twr = tradesWithResolutions[0]
    console.log(`   Conditions with trades:     ${parseInt(twr.total_conditions_with_trades).toLocaleString()}`)
    console.log(`   Resolved conditions:        ${parseInt(twr.resolved_with_trades).toLocaleString()}`)
    console.log(`   Coverage:                   ${twr.coverage_pct.toFixed(2)}%`)

    console.log('\n=' .repeat(80))
    console.log('✅ Resolution Data Examination Complete!\n')

    console.log('📋 Summary:')
    console.log(`   - Resolution table exists: pm_condition_resolutions`)
    console.log(`   - Payout numerators are stored as arrays`)
    console.log(`   - Ready to create vw_pm_resolution_prices view`)

    console.log('\n=' .repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the examination
examineResolutions()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
