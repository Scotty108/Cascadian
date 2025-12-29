/**
 * Step 0: Mark Known Data Gaps
 *
 * Create pm_market_data_quality table to track data quality issues
 * Flag known problems:
 * - 8e02dc... → 'missing_amm' (awaiting Goldsky backfill)
 * - ee3a38... → 'partial' (until view math fix verified)
 */

import { config } from 'dotenv'
import { resolve } from 'path'

config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from '@/lib/clickhouse/client'

async function createDataQualityFlags() {
  console.log('📊 Step 0: Creating Market Data Quality Flags\n')
  console.log('='.repeat(80))

  try {
    // Create table for data quality tracking
    console.log('\n1. Creating pm_market_data_quality table...\n')

    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS pm_market_data_quality (
        condition_id String,
        data_quality Enum('ok', 'partial', 'missing_trades', 'missing_amm'),
        note String,
        flagged_at DateTime DEFAULT now(),
        verified_at Nullable(DateTime)
      )
      ENGINE = ReplacingMergeTree(flagged_at)
      ORDER BY condition_id
      SETTINGS index_granularity = 8192
    `

    await clickhouse.command({ query: createTableSQL })
    console.log('✅ Table created: pm_market_data_quality')

    // Insert known issues
    console.log('\n2. Flagging known data quality issues...\n')

    const insertIssuesSQL = `
      INSERT INTO pm_market_data_quality (condition_id, data_quality, note)
      VALUES
        (
          '8e02dc3233cf073a64a9f0466ef8ddbe1f984e4b87eacfd1b8d10c725e042f39',
          'missing_amm',
          'AMM market - zero trades in pm_trader_events_v2. Awaiting Goldsky pipeline fix v20.'
        ),
        (
          'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2',
          'partial',
          'Loser-share leak in view aggregation ($1,263.73 discrepancy). Fixed in V3.'
        )
    `

    await clickhouse.command({ query: insertIssuesSQL })
    console.log('✅ Flagged 2 known issues:')
    console.log('   - 8e02dc... → missing_amm (more than $6 March)')
    console.log('   - ee3a38... → partial (below $4.50 May)')

    // Create view with quality flags joined
    console.log('\n3. Creating quality-flagged PnL view...\n')

    const createFlaggedViewSQL = `
      CREATE OR REPLACE VIEW vw_pm_realized_pnl_v2_with_quality AS
      SELECT
        p.*,
        COALESCE(q.data_quality, 'ok') AS data_quality,
        q.note AS quality_note
      FROM vw_pm_realized_pnl_v2 p
      LEFT JOIN pm_market_data_quality q ON p.condition_id = lower(q.condition_id)
    `

    await clickhouse.command({ query: createFlaggedViewSQL })
    console.log('✅ Created view: vw_pm_realized_pnl_v2_with_quality')

    // Verify flags
    console.log('\n4. Verifying quality flags...\n')

    const verifyResult = await clickhouse.query({
      query: `
        SELECT
          condition_id,
          data_quality,
          note
        FROM pm_market_data_quality
        ORDER BY data_quality, condition_id
      `,
      format: 'JSONEachRow'
    })
    const flags = await verifyResult.json() as Array<{
      condition_id: string
      data_quality: string
      note: string
    }>

    console.log('Current quality flags:\n')
    console.log('Quality      | Condition ID (first 40)                    | Note')
    console.log('-'.repeat(100))
    flags.forEach(f => {
      const quality = f.data_quality.padEnd(12)
      const condId = f.condition_id.slice(0, 40).padEnd(42)
      const note = f.note.slice(0, 40)
      console.log(`${quality} | ${condId} | ${note}`)
    })

    // Test the flagged view
    console.log('\n5. Testing quality-flagged view...\n')

    const testResult = await clickhouse.query({
      query: `
        SELECT
          data_quality,
          count(DISTINCT condition_id) AS markets,
          sum(realized_pnl) AS total_pnl
        FROM vw_pm_realized_pnl_v2_with_quality
        WHERE wallet_address = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
          AND is_resolved = 1
        GROUP BY data_quality
        ORDER BY data_quality
      `,
      format: 'JSONEachRow'
    })
    const test = await testResult.json() as Array<{
      data_quality: string
      markets: string
      total_pnl: number | null
    }>

    console.log('Test wallet PnL by quality:\n')
    console.log('Quality      | Markets | Total PnL')
    console.log('-'.repeat(45))
    test.forEach(t => {
      const quality = t.data_quality.padEnd(12)
      const markets = parseInt(t.markets).toString().padStart(7)
      const pnl = t.total_pnl !== null ? `$${t.total_pnl.toFixed(2)}`.padStart(11) : 'NULL'.padStart(11)
      console.log(`${quality} | ${markets} | ${pnl}`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ STEP 0 COMPLETE\n')
    console.log('Created:')
    console.log('  - pm_market_data_quality table')
    console.log('  - vw_pm_realized_pnl_v2_with_quality view')
    console.log()
    console.log('Flagged issues:')
    console.log('  - 8e02dc... (missing_amm) - awaiting Goldsky backfill')
    console.log('  - ee3a38... (partial) - view math fix needed')
    console.log()
    console.log('Next: Step 1 - Fix loser-share leak in PnL view')
    console.log('='.repeat(80))

  } catch (error) {
    console.error('❌ Error:', error)
    throw error
  }
}

createDataQualityFlags()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error)
    process.exit(1)
  })
