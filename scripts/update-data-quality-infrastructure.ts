/**
 * Update Data Quality Infrastructure
 *
 * Expand pm_market_data_quality ENUM to include 'missing_resolution'
 * and create quality-flagged output views
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function updateDataQualityInfrastructure() {
  console.log('🔧 Update Data Quality Infrastructure\n')
  console.log('='.repeat(80))

  try {
    // Step 1: Drop and recreate table with expanded ENUM
    console.log('\n1. Recreating pm_market_data_quality with expanded ENUM...\n')

    await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_market_data_quality' })

    const createTableSQL = `
      CREATE TABLE pm_market_data_quality (
        condition_id String,
        data_quality Enum('ok', 'partial', 'missing_trades', 'missing_amm', 'missing_resolution'),
        note String,
        flagged_at DateTime DEFAULT now(),
        verified_at Nullable(DateTime)
      )
      ENGINE = ReplacingMergeTree(flagged_at)
      ORDER BY condition_id
      SETTINGS index_granularity = 8192
    `

    await clickhouse.command({ query: createTableSQL })
    console.log('✅ Table recreated with expanded ENUM:')
    console.log('   - ok, partial, missing_trades, missing_amm, missing_resolution')

    // Step 2: Seed known issues
    console.log('\n2. Seeding known data quality issues...\n')

    const insertIssuesSQL = `
      INSERT INTO pm_market_data_quality (condition_id, data_quality, note)
      VALUES
        (
          '8e02dc3233cf073a64a9f0466ef8ddbe1f984e4b87eacfd1b8d10c725e042f39',
          'missing_amm',
          'AMM market - zero trades in pm_trader_events_v2. Awaiting Goldsky pipeline fix (ticket cmidn49pmaklj01sv0xbja6hu).'
        ),
        (
          'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2',
          'ok',
          'Loser-share leak fixed in V3. PnL now matches recomputation ($24,924.15).'
        )
    `

    await clickhouse.command({ query: insertIssuesSQL })
    console.log('✅ Seeded 2 known issues:')
    console.log('   - 8e02dc... → missing_amm (awaiting Goldsky backfill)')
    console.log('   - ee3a38... → ok (fixed in V3)')

    // Step 3: Create quality-flagged views
    console.log('\n3. Creating quality-flagged output views...\n')

    // V3 with quality flags
    const createV3QualityViewSQL = `
      CREATE OR REPLACE VIEW vw_pm_realized_pnl_v3_with_quality AS
      SELECT
        p.*,
        COALESCE(q.data_quality, 'ok') AS data_quality,
        q.note AS quality_note,
        q.flagged_at,
        q.verified_at
      FROM vw_pm_realized_pnl_v3 p
      LEFT JOIN pm_market_data_quality q ON p.condition_id = lower(q.condition_id)
    `

    await clickhouse.command({ query: createV3QualityViewSQL })
    console.log('✅ Created: vw_pm_realized_pnl_v3_with_quality')

    // V3 detail with quality flags
    const createV3DetailQualityViewSQL = `
      CREATE OR REPLACE VIEW vw_pm_realized_pnl_v3_detail_with_quality AS
      SELECT
        p.*,
        COALESCE(q.data_quality, 'ok') AS data_quality,
        q.note AS quality_note
      FROM vw_pm_realized_pnl_v3_detail p
      LEFT JOIN pm_market_data_quality q ON p.condition_id = lower(q.condition_id)
    `

    await clickhouse.command({ query: createV3DetailQualityViewSQL })
    console.log('✅ Created: vw_pm_realized_pnl_v3_detail_with_quality')

    // Step 4: Test the quality flags
    console.log('\n4. Testing quality flags...\n')

    const testResult = await clickhouse.query({
      query: `
        SELECT
          data_quality,
          count(DISTINCT condition_id) AS markets,
          count(*) AS positions
        FROM vw_pm_realized_pnl_v3_with_quality
        WHERE is_resolved = 1
        GROUP BY data_quality
        ORDER BY data_quality
      `,
      format: 'JSONEachRow'
    })
    const test = await testResult.json() as Array<{
      data_quality: string
      markets: string
      positions: string
    }>

    console.log('Quality Distribution (Resolved Markets):\n')
    console.log('Quality        | Markets     | Positions')
    console.log('-'.repeat(50))
    test.forEach(t => {
      const quality = t.data_quality.padEnd(14)
      const markets = parseInt(t.markets).toLocaleString().padStart(11)
      const positions = parseInt(t.positions).toLocaleString().padStart(11)
      console.log(`${quality} | ${markets} | ${positions}`)
    })

    // Step 5: Summary
    console.log('\n' + '='.repeat(80))
    console.log('\n✅ DATA QUALITY INFRASTRUCTURE UPDATED\n')
    console.log('Created:')
    console.log('  - pm_market_data_quality (expanded ENUM)')
    console.log('  - vw_pm_realized_pnl_v3_with_quality')
    console.log('  - vw_pm_realized_pnl_v3_detail_with_quality')
    console.log()
    console.log('Flagged Markets:')
    console.log('  - 8e02dc... (missing_amm) - blocked on Goldsky')
    console.log('  - ee3a38... (ok) - fixed in V3')
    console.log()
    console.log('Usage:')
    console.log('  -- Get all resolved PnL with quality flags')
    console.log('  SELECT * FROM vw_pm_realized_pnl_v3_with_quality WHERE is_resolved = 1')
    console.log()
    console.log('  -- Filter to only high-quality data')
    console.log("  SELECT * FROM vw_pm_realized_pnl_v3_with_quality WHERE data_quality = 'ok'")
    console.log()
    console.log('  -- Exclude problematic markets')
    console.log("  SELECT * FROM vw_pm_realized_pnl_v3_with_quality WHERE data_quality NOT IN ('missing_amm', 'missing_resolution')")
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

updateDataQualityInfrastructure()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
