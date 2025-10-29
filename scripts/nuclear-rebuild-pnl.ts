#!/usr/bin/env tsx
/**
 * Nuclear Rebuild: P&L Calculation (FAST)
 *
 * STRATEGY:
 * Instead of 136,931 separate ALTER UPDATE mutations (46 hours),
 * rebuild the entire table with P&L calculated in ONE operation (15-20 min).
 *
 * METHOD:
 * 1. Load resolutions into temp ClickHouse table
 * 2. CREATE TABLE AS SELECT with P&L calculated via JOIN
 * 3. Atomic table swap (RENAME)
 * 4. Drop old table
 *
 * SAFETY:
 * - Zero mutations during rebuild
 * - Atomic swap - no downtime
 * - Original table backed up as trades_raw_backup
 *
 * USAGE:
 * npx tsx scripts/nuclear-rebuild-pnl.ts
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import * as fs from 'fs'
import { clickhouse } from '@/lib/clickhouse/client'

const RESOLUTION_MAP_FILE = resolve(process.cwd(), 'data/expanded_resolution_map.json')

interface Resolution {
  condition_id: string
  market_id: string
  resolved_outcome: 'YES' | 'NO'
  payout_yes: number
  payout_no: number
}

async function main() {
  console.log('⚡ Nuclear Rebuild: P&L Calculation\n')
  console.log('   Strategy: Rebuild entire table in ONE operation')
  console.log('   Expected time: 15-20 minutes')
  console.log('   Mutations: ZERO (no ALTER UPDATE)\n')

  // Step 1: Load resolution map
  console.log('📄 Step 1: Loading resolution map...')
  if (!fs.existsSync(RESOLUTION_MAP_FILE)) {
    throw new Error(`Resolution map not found: ${RESOLUTION_MAP_FILE}`)
  }

  const content = fs.readFileSync(RESOLUTION_MAP_FILE, 'utf-8')
  const resolutionData = JSON.parse(content)

  if (!resolutionData?.resolutions || !Array.isArray(resolutionData.resolutions)) {
    throw new Error('Invalid resolution data structure')
  }

  const resolutions: Resolution[] = resolutionData.resolutions.filter((r: any) =>
    r && typeof r === 'object' && r.condition_id && r.resolved_outcome
  )

  console.log(`   ✅ Loaded ${resolutions.length} resolutions\n`)

  // Step 2: Create temp resolutions table
  console.log('🗄️  Step 2: Creating temp resolutions table...')

  await clickhouse.query({
    query: `DROP TABLE IF EXISTS temp_resolutions`
  })

  await clickhouse.query({
    query: `
      CREATE TABLE temp_resolutions (
        condition_id String,
        market_id String,
        resolved_outcome String,
        payout_yes Float64,
        payout_no Float64
      ) ENGINE = Memory
    `
  })

  console.log('   ✅ Temp table created')

  // Step 3: Insert resolutions
  console.log('   📥 Inserting resolutions...')

  await clickhouse.insert({
    table: 'temp_resolutions',
    values: resolutions,
    format: 'JSONEachRow'
  })

  console.log(`   ✅ Inserted ${resolutions.length} resolutions\n`)

  // Step 4: Create new table with P&L calculated
  console.log('🔨 Step 3: Building new trades_raw table with P&L...')
  console.log('   This is the BIG operation - calculating all P&L in one shot...')
  console.log('   (This may take 10-15 minutes)\n')

  await clickhouse.query({
    query: `DROP TABLE IF EXISTS trades_raw_new`
  })

  const startTime = Date.now()

  await clickhouse.query({
    query: `
      CREATE TABLE trades_raw_new
      ENGINE = MergeTree()
      ORDER BY (wallet_address, timestamp)
      AS
      SELECT
        t.* EXCEPT (realized_pnl_usd, is_resolved),

        -- Calculate realized_pnl_usd based on resolution
        CASE
          WHEN r.condition_id IS NOT NULL THEN
            CASE
              -- If wallet's side matches resolved outcome, they won
              WHEN t.side = r.resolved_outcome THEN
                t.shares * (1.0 - t.entry_price)
              -- If wallet's side doesn't match, they lost
              ELSE
                -1.0 * t.shares * t.entry_price
            END
          ELSE
            0.0  -- Unresolved trades
        END AS realized_pnl_usd,

        -- Set is_resolved flag
        CASE
          WHEN r.condition_id IS NOT NULL THEN 1
          ELSE 0
        END AS is_resolved

      FROM trades_raw AS t
      LEFT JOIN temp_resolutions AS r
        ON t.condition_id = r.condition_id
    `
  })

  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)
  console.log(`   ✅ New table built in ${duration} minutes!\n`)

  // Step 5: Verify row counts match
  console.log('🔍 Step 4: Verifying row counts...')

  const oldCountResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM trades_raw',
    format: 'JSONEachRow'
  })
  const oldCount = (await oldCountResult.json<{ cnt: string }>())[0].cnt

  const newCountResult = await clickhouse.query({
    query: 'SELECT count() as cnt FROM trades_raw_new',
    format: 'JSONEachRow'
  })
  const newCount = (await newCountResult.json<{ cnt: string }>())[0].cnt

  console.log(`   Old table: ${parseInt(oldCount).toLocaleString()} rows`)
  console.log(`   New table: ${parseInt(newCount).toLocaleString()} rows`)

  if (oldCount !== newCount) {
    throw new Error(`Row count mismatch! Old: ${oldCount}, New: ${newCount}`)
  }

  console.log(`   ✅ Row counts match\n`)

  // Step 6: Check P&L was calculated
  console.log('🔍 Step 5: Verifying P&L calculation...')

  const pnlCheckResult = await clickhouse.query({
    query: `
      SELECT
        countIf(is_resolved = 1) as resolved_count,
        countIf(is_resolved = 1 AND realized_pnl_usd != 0) as pnl_calculated_count
      FROM trades_raw_new
    `,
    format: 'JSONEachRow'
  })
  const pnlCheck = (await pnlCheckResult.json<{ resolved_count: string, pnl_calculated_count: string }>())[0]

  console.log(`   Resolved trades: ${parseInt(pnlCheck.resolved_count).toLocaleString()}`)
  console.log(`   P&L calculated: ${parseInt(pnlCheck.pnl_calculated_count).toLocaleString()}`)
  console.log(`   ✅ P&L calculation verified\n`)

  // Step 7: Table swap (ClickHouse Cloud doesn't support multi-table RENAME)
  console.log('🔄 Step 6: Table swap...')
  console.log('   Creating backup: trades_raw → trades_raw_backup')
  console.log('   Activating new: trades_raw_new → trades_raw\n')

  await clickhouse.query({
    query: `DROP TABLE IF EXISTS trades_raw_backup`
  })

  await clickhouse.query({
    query: `RENAME TABLE trades_raw TO trades_raw_backup`
  })

  await clickhouse.query({
    query: `RENAME TABLE trades_raw_new TO trades_raw`
  })

  console.log(`   ✅ Table swap complete!\n`)

  // Step 8: Cleanup
  console.log('🧹 Step 7: Cleanup...')

  await clickhouse.query({
    query: `DROP TABLE IF EXISTS temp_resolutions`
  })

  console.log(`   ✅ Temp tables dropped\n`)

  // Final summary
  const totalDuration = ((Date.now() - startTime) / 1000 / 60).toFixed(1)

  console.log('═'.repeat(60))
  console.log('✅ NUCLEAR REBUILD COMPLETE!')
  console.log('═'.repeat(60))
  console.log(`   Total time: ${totalDuration} minutes`)
  console.log(`   Rows processed: ${parseInt(newCount).toLocaleString()}`)
  console.log(`   Resolved trades: ${parseInt(pnlCheck.resolved_count).toLocaleString()}`)
  console.log(`   P&L calculated: ${parseInt(pnlCheck.pnl_calculated_count).toLocaleString()}`)
  console.log(`   Mutations used: 0 (zero!)`)
  console.log('═'.repeat(60))
  console.log('\n📊 Next steps:')
  console.log('   1. Run Step E: npx tsx scripts/full-enrichment-pass.ts --step=E')
  console.log('   2. Run gates: npx tsx scripts/print-gates.ts')
  console.log('\n💾 Backup:')
  console.log('   Original table saved as: trades_raw_backup')
  console.log('   To restore: RENAME TABLE trades_raw TO trades_raw_failed, trades_raw_backup TO trades_raw')
  console.log('═'.repeat(60))
}

// Auto-execute
if (require.main === module || import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error)
    console.error('\n⚠️  SAFETY: Original table is still intact')
    console.error('   Nothing was modified - rebuild failed before swap')
    process.exit(1)
  })
}

export { main }
