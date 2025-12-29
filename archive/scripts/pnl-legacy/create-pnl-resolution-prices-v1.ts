/**
 * PnL Engine V1 - Step 2A: Create Resolution Prices View
 *
 * Creates vw_pm_resolution_prices that explodes pm_condition_resolutions.payout_numerators
 * into per-outcome rows with resolved prices.
 *
 * Per PNL_ENGINE_CANONICAL_SPEC.md:
 * - Parses JSON payout_numerators array
 * - Calculates resolved_price = numerator / sum(all_numerators)
 * - For binary markets: winner = 1.0, loser = 0.0
 * - For multi-outcome: fractional payouts possible
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function createResolutionPricesView() {
  console.log('🏗️  PnL Engine V1 - Step 2A: Creating Resolution Prices View\n')
  console.log('=' .repeat(80))

  try {
    // Step 1: Create the resolution prices view
    console.log('\n📊 Step 1: Creating vw_pm_resolution_prices VIEW...\n')

    const createViewSQL = `
      CREATE OR REPLACE VIEW vw_pm_resolution_prices AS
      SELECT
          lower(r.condition_id) AS condition_id,
          idx - 1 AS outcome_index,  -- ClickHouse arrays are 1-indexed, but outcome_index is 0-indexed
          numerator / arraySum(numerators) AS resolved_price,  -- Normalize by sum (binary: 1.0 or 0.0)
          r.resolved_at AS resolution_time,
          r.tx_hash AS resolution_tx_hash,
          r.block_number AS resolution_block
      FROM (
          SELECT
              condition_id,
              JSONExtract(payout_numerators, 'Array(Float64)') AS numerators,
              resolved_at,
              tx_hash,
              block_number
          FROM pm_condition_resolutions
          WHERE is_deleted = 0
      ) r
      ARRAY JOIN
          numerators AS numerator,
          arrayEnumerate(numerators) AS idx
    `

    await clickhouse.command({ query: createViewSQL })
    console.log('   ✅ View created successfully')

    // Verify view exists
    const viewCheck = await clickhouse.query({
      query: "SELECT count() as total FROM vw_pm_resolution_prices LIMIT 1",
      format: 'JSONEachRow',
    })
    const viewCount = await viewCheck.json() as Array<{ total: string }>
    console.log(`   📈 Total resolution rows: ${parseInt(viewCount[0].total).toLocaleString()}`)

    console.log('\n' + '='.repeat(80))
    console.log('🔍 VALIDATION CHECKS\n')

    // Check 1: Sample resolutions
    console.log('📊 Check 1: Sample Resolutions\n')
    const sampleResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          outcome_index,
          resolved_price,
          resolution_time
        FROM vw_pm_resolution_prices
        LIMIT 10
      `,
      format: 'JSONEachRow',
    })
    const samples = await sampleResult.json() as Array<{
      condition_id: string
      outcome_index: number
      resolved_price: number
      resolution_time: string
    }>

    console.log('   Condition ID (first 16)   | Outcome | Price | Time')
    console.log('   ' + '-'.repeat(70))
    samples.forEach(row => {
      const condId = row.condition_id.slice(0, 24).padEnd(24)
      const outcome = row.outcome_index.toString().padStart(7)
      const price = row.resolved_price.toFixed(4).padStart(5)
      const time = new Date(row.resolution_time).toISOString().slice(0, 10)
      console.log(`   ${condId} | ${outcome} | ${price} | ${time}`)
    })

    // Check 2: Price distribution
    console.log('\n📊 Check 2: Price Distribution\n')
    const priceDistResult = await clickhouse.query({
      query: `
        SELECT
          round(resolved_price, 2) as price_bucket,
          count() as count
        FROM vw_pm_resolution_prices
        GROUP BY price_bucket
        ORDER BY price_bucket
      `,
      format: 'JSONEachRow',
    })
    const priceDist = await priceDistResult.json() as Array<{ price_bucket: number; count: string }>

    console.log('   Price | Count of Outcomes')
    console.log('   ' + '-'.repeat(35))
    priceDist.forEach(row => {
      console.log(`   ${row.price_bucket.toFixed(2).padStart(5)} | ${parseInt(row.count).toLocaleString()}`)
    })

    // Check 3: Binary market validation
    console.log('\n📊 Check 3: Binary Market Validation\n')
    const binaryValidationResult = await clickhouse.query({
      query: `
        WITH market_outcomes AS (
          SELECT
            condition_id,
            count() as num_outcomes,
            sum(resolved_price) as total_price
          FROM vw_pm_resolution_prices
          GROUP BY condition_id
        )
        SELECT
          num_outcomes,
          count() as market_count,
          avg(total_price) as avg_total_price,
          min(total_price) as min_total_price,
          max(total_price) as max_total_price
        FROM market_outcomes
        GROUP BY num_outcomes
        ORDER BY num_outcomes
      `,
      format: 'JSONEachRow',
    })
    const binaryValidation = await binaryValidationResult.json() as Array<{
      num_outcomes: number
      market_count: string
      avg_total_price: number
      min_total_price: number
      max_total_price: number
    }>

    console.log('   Outcomes | Markets  | Avg Sum | Min Sum | Max Sum')
    console.log('   ' + '-'.repeat(60))
    binaryValidation.forEach(row => {
      const outcomes = row.num_outcomes.toString().padStart(8)
      const markets = parseInt(row.market_count).toLocaleString().padStart(8)
      const avgSum = row.avg_total_price.toFixed(4).padStart(7)
      const minSum = row.min_total_price.toFixed(4).padStart(7)
      const maxSum = row.max_total_price.toFixed(4).padStart(7)
      console.log(`   ${outcomes} | ${markets} | ${avgSum} | ${minSum} | ${maxSum}`)
    })

    console.log('\n   💡 Note: Sum of prices should equal 1.0 for each market (winner takes all)')

    // Check 4: Join with ledger
    console.log('\n📊 Check 4: Join with Ledger\n')
    const ledgerJoinResult = await clickhouse.query({
      query: `
        SELECT
          count(DISTINCT l.condition_id) as conditions_in_ledger,
          count(DISTINCT r.condition_id) as resolved_conditions,
          (count(DISTINCT r.condition_id) * 100.0 / count(DISTINCT l.condition_id)) as resolution_coverage_pct
        FROM vw_pm_ledger l
        LEFT JOIN vw_pm_resolution_prices r
          ON l.condition_id = r.condition_id
      `,
      format: 'JSONEachRow',
    })
    const ledgerJoin = await ledgerJoinResult.json() as Array<{
      conditions_in_ledger: string
      resolved_conditions: string
      resolution_coverage_pct: number
    }>

    const lj = ledgerJoin[0]
    console.log(`   Conditions in ledger:    ${parseInt(lj.conditions_in_ledger).toLocaleString()}`)
    console.log(`   Resolved conditions:     ${parseInt(lj.resolved_conditions).toLocaleString()}`)
    console.log(`   Coverage:                ${lj.resolution_coverage_pct.toFixed(2)}%`)

    // Check 5: Sample market with both outcomes
    console.log('\n📊 Check 5: Sample Binary Market (Both Outcomes)\n')
    const sampleMarketResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          outcome_index,
          resolved_price,
          resolution_time
        FROM vw_pm_resolution_prices
        WHERE condition_id IN (
          SELECT condition_id
          FROM vw_pm_resolution_prices
          GROUP BY condition_id
          HAVING count() = 2
          LIMIT 1
        )
        ORDER BY outcome_index
      `,
      format: 'JSONEachRow',
    })
    const sampleMarket = await sampleMarketResult.json() as Array<{
      condition_id: string
      outcome_index: number
      resolved_price: number
      resolution_time: string
    }>

    if (sampleMarket.length > 0) {
      console.log(`   Market: ${sampleMarket[0].condition_id.slice(0, 32)}...`)
      console.log(`   Resolution: ${new Date(sampleMarket[0].resolution_time).toISOString()}`)
      console.log()
      console.log('   Outcome | Price | Status')
      console.log('   ' + '-'.repeat(35))
      sampleMarket.forEach(row => {
        const outcome = row.outcome_index.toString().padStart(7)
        const price = row.resolved_price.toFixed(4).padStart(5)
        const status = row.resolved_price === 1.0 ? 'WINNER' : row.resolved_price === 0.0 ? 'LOSER' : 'PARTIAL'
        console.log(`   ${outcome} | ${price} | ${status}`)
      })

      const totalPrice = sampleMarket.reduce((sum, row) => sum + row.resolved_price, 0)
      console.log()
      console.log(`   Total price: ${totalPrice.toFixed(4)} (should be 1.0000)`)
    }

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ Resolution Prices View Creation Complete!\n')

    console.log('📋 Summary:')
    console.log('   - View explodes payout_numerators into per-outcome rows')
    console.log('   - Binary markets: winner = 1.0, loser = 0.0')
    console.log('   - Multi-outcome markets: fractional payouts possible')
    console.log('   - Sum of prices per market = 1.0 (winner takes all)')
    console.log()
    console.log('📋 Next Step: Create vw_pm_realized_pnl_v1 view')
    console.log('=' .repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

// Run the script
createResolutionPricesView()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
