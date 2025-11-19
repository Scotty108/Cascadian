#!/usr/bin/env npx tsx
/**
 * CREATE DUAL BACKUPS - Phase 1
 *
 * Safety protocol: Create TWO independent backups of production tables
 * before any swap operation. Follows NEVER_DO_THIS_AGAIN.md guidelines.
 *
 * Creates:
 * - erc1155_transfers_backup_20251111a
 * - erc1155_transfers_backup_20251111b
 * - tmp_block_timestamps_backup_20251111a
 * - tmp_block_timestamps_backup_20251111b
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { getClickHouseClient } from '../lib/clickhouse/client'

async function createDualBackups() {
  const client = getClickHouseClient()

  console.log('\n🔒 Phase 1: Creating Dual Backups\n')
  console.log('⚠️  Following NEVER_DO_THIS_AGAIN.md safety protocol\n')

  try {
    // Step 1: Record current production state
    console.log('📊 Step 1: Recording current production state...\n')

    const prodTransfersResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM default.erc1155_transfers
      `,
      format: 'JSONEachRow'
    })
    const prodTransfers = await prodTransfersResult.json<any>()
    console.log('Current erc1155_transfers:')
    console.log(JSON.stringify(prodTransfers[0], null, 2))

    const prodTimestampsResult = await client.query({
      query: `
        SELECT
          count() as total_rows,
          min(block_number) as min_block,
          max(block_number) as max_block
        FROM default.tmp_block_timestamps
      `,
      format: 'JSONEachRow'
    })
    const prodTimestamps = await prodTimestampsResult.json<any>()
    console.log('\nCurrent tmp_block_timestamps:')
    console.log(JSON.stringify(prodTimestamps[0], null, 2))

    // Step 2: Create first backup (a)
    console.log('\n📋 Step 2: Creating backup_a...\n')

    console.log('Creating erc1155_transfers_backup_20251111a...')
    await client.command({
      query: `
        CREATE TABLE default.erc1155_transfers_backup_20251111a
        ENGINE = MergeTree()
        ORDER BY (block_number, log_index)
        AS SELECT * FROM default.erc1155_transfers
      `
    })
    console.log('✅ erc1155_transfers_backup_20251111a created')

    console.log('Creating tmp_block_timestamps_backup_20251111a...')
    await client.command({
      query: `
        CREATE TABLE default.tmp_block_timestamps_backup_20251111a
        ENGINE = MergeTree()
        ORDER BY block_number
        AS SELECT * FROM default.tmp_block_timestamps
      `
    })
    console.log('✅ tmp_block_timestamps_backup_20251111a created')

    // Step 3: Create second backup (b)
    console.log('\n📋 Step 3: Creating backup_b...\n')

    console.log('Creating erc1155_transfers_backup_20251111b...')
    await client.command({
      query: `
        CREATE TABLE default.erc1155_transfers_backup_20251111b
        ENGINE = MergeTree()
        ORDER BY (block_number, log_index)
        AS SELECT * FROM default.erc1155_transfers
      `
    })
    console.log('✅ erc1155_transfers_backup_20251111b created')

    console.log('Creating tmp_block_timestamps_backup_20251111b...')
    await client.command({
      query: `
        CREATE TABLE default.tmp_block_timestamps_backup_20251111b
        ENGINE = MergeTree()
        ORDER BY block_number
        AS SELECT * FROM default.tmp_block_timestamps
      `
    })
    console.log('✅ tmp_block_timestamps_backup_20251111b created')

    // Step 4: Verify backups
    console.log('\n🔍 Step 4: Verifying backups...\n')

    const backupATransfersResult = await client.query({
      query: 'SELECT count() as total_rows FROM default.erc1155_transfers_backup_20251111a',
      format: 'JSONEachRow'
    })
    const backupATransfers = await backupATransfersResult.json<any>()

    const backupBTransfersResult = await client.query({
      query: 'SELECT count() as total_rows FROM default.erc1155_transfers_backup_20251111b',
      format: 'JSONEachRow'
    })
    const backupBTransfers = await backupBTransfersResult.json<any>()

    const backupATimestampsResult = await client.query({
      query: 'SELECT count() as total_rows FROM default.tmp_block_timestamps_backup_20251111a',
      format: 'JSONEachRow'
    })
    const backupATimestamps = await backupATimestampsResult.json<any>()

    const backupBTimestampsResult = await client.query({
      query: 'SELECT count() as total_rows FROM default.tmp_block_timestamps_backup_20251111b',
      format: 'JSONEachRow'
    })
    const backupBTimestamps = await backupBTimestampsResult.json<any>()

    console.log('Backup Verification:')
    console.log('─────────────────────────────────────────────────────')
    console.log(`Production erc1155_transfers:      ${prodTransfers[0].total_rows.toLocaleString()} rows`)
    console.log(`Backup A erc1155_transfers:        ${backupATransfers[0].total_rows.toLocaleString()} rows`)
    console.log(`Backup B erc1155_transfers:        ${backupBTransfers[0].total_rows.toLocaleString()} rows`)
    console.log(`Match: ${prodTransfers[0].total_rows === backupATransfers[0].total_rows && prodTransfers[0].total_rows === backupBTransfers[0].total_rows ? '✅' : '❌'}`)
    console.log('')
    console.log(`Production tmp_block_timestamps:   ${prodTimestamps[0].total_rows.toLocaleString()} rows`)
    console.log(`Backup A tmp_block_timestamps:     ${backupATimestamps[0].total_rows.toLocaleString()} rows`)
    console.log(`Backup B tmp_block_timestamps:     ${backupBTimestamps[0].total_rows.toLocaleString()} rows`)
    console.log(`Match: ${prodTimestamps[0].total_rows === backupATimestamps[0].total_rows && prodTimestamps[0].total_rows === backupBTimestamps[0].total_rows ? '✅' : '❌'}`)
    console.log('─────────────────────────────────────────────────────')

    // Step 5: Final summary
    console.log('\n✅ Phase 1 Complete: Dual Backups Created\n')
    console.log('Backup Tables Created:')
    console.log('  - default.erc1155_transfers_backup_20251111a')
    console.log('  - default.erc1155_transfers_backup_20251111b')
    console.log('  - default.tmp_block_timestamps_backup_20251111a')
    console.log('  - default.tmp_block_timestamps_backup_20251111b')
    console.log('')
    console.log('Original production tables remain untouched.')
    console.log('Ready to proceed with Phase 2 (atomic swap).')
    console.log('')

  } catch (error: any) {
    console.error('\n❌ Backup creation failed:', error.message)
    console.error('\nNo changes made to production tables.')
    throw error
  } finally {
    await client.close()
  }
}

createDualBackups().catch(error => {
  console.error('\n❌ Fatal error:', error.message)
  process.exit(1)
})
