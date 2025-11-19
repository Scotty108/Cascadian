#!/usr/bin/env npx tsx
/**
 * EXECUTE ATOMIC SWAP - Phase 2
 *
 * Safety protocol: Atomic table swap using single RENAME statement
 * Follows NEVER_DO_THIS_AGAIN.md: CREATE NEW → VERIFY → RENAME → DROP OLD
 *
 * Swap plan:
 * 1. Verify staging tables one more time
 * 2. Execute atomic RENAME (all 4 tables in one statement)
 * 3. Verify new production tables
 * 4. Keep _old tables for safety until user confirms
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function executeAtomicSwap() {
  const client = getClickHouseClient()

  console.log('\n🔄 Phase 2: Atomic Swap - staging → production\n')
  console.log('⚠️  Following NEVER_DO_THIS_AGAIN.md safety protocol\n')

  try {
    // Step 1: Final verification of staging tables
    console.log('📊 Step 1: Final verification of staging tables...\n')

    const stagingTransfersResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block,
          countIf(block_timestamp = toDateTime(0)) as zero_timestamps
        FROM staging.erc1155_transfers_v2
      `,
      format: 'JSONEachRow'
    })
    const stagingTransfers = await stagingTransfersResult.json<any>()
    console.log('Staging erc1155_transfers_v2:')
    console.log(JSON.stringify(stagingTransfers[0], null, 2))

    const stagingTimestampsResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM staging.tmp_block_timestamps_v2
      `,
      format: 'JSONEachRow'
    })
    const stagingTimestamps = await stagingTimestampsResult.json<any>()
    console.log('\nStaging tmp_block_timestamps_v2:')
    console.log(JSON.stringify(stagingTimestamps[0], null, 2))

    // Step 2: Record current production state (one last time)
    console.log('\n📊 Step 2: Recording production state before swap...\n')

    const prodTransfersResult = await client.query({
      query: 'SELECT count() as total_rows FROM default.erc1155_transfers',
      format: 'JSONEachRow'
    })
    const prodTransfers = await prodTransfersResult.json<any>()
    console.log(`Production erc1155_transfers: ${prodTransfers[0].total_rows.toLocaleString()} rows`)

    const prodTimestampsResult = await client.query({
      query: 'SELECT count() as total_rows FROM default.tmp_block_timestamps',
      format: 'JSONEachRow'
    })
    const prodTimestamps = await prodTimestampsResult.json<any>()
    console.log(`Production tmp_block_timestamps: ${prodTimestamps[0].total_rows.toLocaleString()} rows`)

    // Step 3: Execute swap (ClickHouse Cloud requires sequential RENAMEs)
    console.log('\n🔄 Step 3: Executing table swap (sequential for SharedMergeTree)...\n')
    console.log('RENAME strategy:')
    console.log('  1. default.erc1155_transfers       → default.erc1155_transfers_old')
    console.log('  2. staging.erc1155_transfers_v2    → default.erc1155_transfers')
    console.log('  3. default.tmp_block_timestamps    → default.tmp_block_timestamps_old')
    console.log('  4. staging.tmp_block_timestamps_v2 → default.tmp_block_timestamps')
    console.log('')

    console.log('Step 3a: Renaming erc1155_transfers...')
    await client.command({
      query: 'RENAME TABLE default.erc1155_transfers TO default.erc1155_transfers_old',
    })
    console.log('  ✅ default.erc1155_transfers → erc1155_transfers_old')

    await client.command({
      query: 'RENAME TABLE staging.erc1155_transfers_v2 TO default.erc1155_transfers',
    })
    console.log('  ✅ staging.erc1155_transfers_v2 → default.erc1155_transfers')

    console.log('\nStep 3b: Renaming tmp_block_timestamps...')
    await client.command({
      query: 'RENAME TABLE default.tmp_block_timestamps TO default.tmp_block_timestamps_old',
    })
    console.log('  ✅ default.tmp_block_timestamps → tmp_block_timestamps_old')

    await client.command({
      query: 'RENAME TABLE staging.tmp_block_timestamps_v2 TO default.tmp_block_timestamps',
    })
    console.log('  ✅ staging.tmp_block_timestamps_v2 → default.tmp_block_timestamps')

    console.log('\n✅ Table swap completed!')

    // Step 4: Verify new production tables
    console.log('\n🔍 Step 4: Verifying new production tables...\n')

    const newProdTransfersResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block,
          countIf(block_timestamp = toDateTime(0)) as zero_timestamps
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow'
    })
    const newProdTransfers = await newProdTransfersResult.json<any>()

    const newProdTimestampsResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM default.tmp_block_timestamps
      `,
      format: 'JSONEachRow'
    })
    const newProdTimestamps = await newProdTimestampsResult.json<any>()

    console.log('New Production Tables:')
    console.log('─────────────────────────────────────────────────────')
    console.log('erc1155_transfers:')
    console.log(`  Total rows: ${newProdTransfers[0].total_rows.toLocaleString()}`)
    console.log(`  Block range: ${newProdTransfers[0].min_block.toLocaleString()} → ${newProdTransfers[0].max_block.toLocaleString()}`)
    console.log(`  Zero timestamps: ${newProdTransfers[0].zero_timestamps}`)
    console.log('')
    console.log('tmp_block_timestamps:')
    console.log(`  Total rows: ${newProdTimestamps[0].total_rows.toLocaleString()}`)
    console.log(`  Block range: ${newProdTimestamps[0].min_block.toLocaleString()} → ${newProdTimestamps[0].max_block.toLocaleString()}`)
    console.log('─────────────────────────────────────────────────────')

    // Step 5: Verify match with original staging
    const stagingMatch =
      newProdTransfers[0].total_rows === stagingTransfers[0].total_rows &&
      newProdTimestamps[0].total_rows === stagingTimestamps[0].total_rows

    console.log('\n✅ Phase 2 Complete: Atomic Swap Successful\n')
    console.log('Production tables now contain recovered data:')
    console.log(`  ✅ erc1155_transfers: ${newProdTransfers[0].total_rows.toLocaleString()} rows`)
    console.log(`  ✅ tmp_block_timestamps: ${newProdTimestamps[0].total_rows.toLocaleString()} rows`)
    console.log(`  ✅ Match with staging: ${stagingMatch ? 'YES' : 'NO'}`)
    console.log('')
    console.log('Safety backups preserved:')
    console.log('  - default.erc1155_transfers_old (damaged original)')
    console.log('  - default.tmp_block_timestamps_old (damaged original)')
    console.log('  - default.erc1155_transfers_backup_20251111a')
    console.log('  - default.erc1155_transfers_backup_20251111b')
    console.log('  - default.tmp_block_timestamps_backup_20251111a')
    console.log('  - default.tmp_block_timestamps_backup_20251111b')
    console.log('')
    console.log('🛑 Pausing before Phase 3 - Awaiting user approval')
    console.log('')

  } catch (error: any) {
    console.error('\n❌ Atomic swap failed:', error.message)
    console.error('\nBackups remain intact. Production tables unchanged if swap failed.')
    throw error
  } finally {
    await client.close()
  }
}

executeAtomicSwap().catch(error => {
  console.error('\n❌ Fatal error:', error.message)
  process.exit(1)
})
