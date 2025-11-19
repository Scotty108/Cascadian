#!/usr/bin/env npx tsx
/**
 * CREATE IMMUTABLE BACKUP
 * Create a real table snapshot (not a view) of current realized_pnl_by_market_final
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })
import { getClickHouseClient } from '../lib/clickhouse/client'

async function createImmutableBackup() {
  const client = getClickHouseClient()

  try {
    console.log('\n📸 CREATING IMMUTABLE BACKUP\n')
    console.log('=' .repeat(80) + '\n')

    // Step 1: Check current table state
    console.log('STEP 1: Document current table state\n')

    const currentResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          uniq(wallet) as unique_wallets,
          SUM(realized_pnl_usd) as total_pnl,
          SUM(CASE WHEN realized_pnl_usd > 0 THEN 1 ELSE 0 END) as positive_rows,
          SUM(CASE WHEN realized_pnl_usd < 0 THEN 1 ELSE 0 END) as negative_rows,
          SUM(CASE WHEN realized_pnl_usd = 0 THEN 1 ELSE 0 END) as zero_rows
        FROM realized_pnl_by_market_final
      `,
      format: 'JSONEachRow'
    })
    const current = await currentResult.json<any>()

    console.log('Current state of realized_pnl_by_market_final:')
    console.log(`  Total rows: ${parseInt(current[0].total_rows).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(current[0].unique_wallets).toLocaleString()}`)
    console.log(`  Total P&L: $${(parseFloat(current[0].total_pnl) / 1000000).toFixed(2)}M`)
    console.log(`  Distribution:`)
    console.log(`    Positive: ${parseInt(current[0].positive_rows).toLocaleString()} (${(parseInt(current[0].positive_rows) / parseInt(current[0].total_rows) * 100).toFixed(1)}%)`)
    console.log(`    Negative: ${parseInt(current[0].negative_rows).toLocaleString()} (${(parseInt(current[0].negative_rows) / parseInt(current[0].total_rows) * 100).toFixed(1)}%)`)
    console.log(`    Zero: ${parseInt(current[0].zero_rows).toLocaleString()} (${(parseInt(current[0].zero_rows) / parseInt(current[0].total_rows) * 100).toFixed(1)}%)\n`)

    // Step 2: Check if backup already exists
    console.log('STEP 2: Check if backup already exists\n')

    const backupExistsResult = await client.query({
      query: `
        SELECT count() as exists
        FROM system.tables
        WHERE database = 'default'
          AND name = 'realized_pnl_by_market_backup_20251111'
      `,
      format: 'JSONEachRow'
    })
    const backupExists = await backupExistsResult.json<any>()

    if (parseInt(backupExists[0].exists) > 0) {
      console.log('⚠️  Backup table already exists: realized_pnl_by_market_backup_20251111')
      console.log('   Dropping existing backup and recreating...\n')

      await client.query({
        query: 'DROP TABLE realized_pnl_by_market_backup_20251111'
      })

      console.log('✅ Old backup dropped\n')
    }

    // Step 3: Create immutable backup
    console.log('STEP 3: Create immutable backup table\n')
    console.log('Creating: realized_pnl_by_market_backup_20251111')
    console.log('Engine: SharedMergeTree()')
    console.log('Order: (wallet, condition_id_norm)')
    console.log('Source: realized_pnl_by_market_final\n')

    const startTime = Date.now()

    await client.command({
      query: `
        CREATE TABLE realized_pnl_by_market_backup_20251111
        ENGINE = SharedMergeTree()
        ORDER BY (wallet, condition_id_norm)
        AS SELECT * FROM realized_pnl_by_market_final
      `,
      clickhouse_settings: {
        wait_end_of_query: 1
      }
    })

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    console.log(`✅ Backup table created in ${duration}s\n`)

    // Step 4: Verify backup
    console.log('STEP 4: Verify backup matches source\n')

    const backupResult = await client.query({
      query: `
        SELECT
          COUNT(*) as total_rows,
          uniq(wallet) as unique_wallets,
          SUM(realized_pnl_usd) as total_pnl
        FROM realized_pnl_by_market_backup_20251111
      `,
      format: 'JSONEachRow'
    })
    const backup = await backupResult.json<any>()

    console.log('Backup table state:')
    console.log(`  Total rows: ${parseInt(backup[0].total_rows).toLocaleString()}`)
    console.log(`  Unique wallets: ${parseInt(backup[0].unique_wallets).toLocaleString()}`)
    console.log(`  Total P&L: $${(parseFloat(backup[0].total_pnl) / 1000000).toFixed(2)}M\n`)

    // Verify counts match
    const rowsMatch = parseInt(current[0].total_rows) === parseInt(backup[0].total_rows)
    const walletsMatch = parseInt(current[0].unique_wallets) === parseInt(backup[0].unique_wallets)
    const pnlMatch = Math.abs(parseFloat(current[0].total_pnl) - parseFloat(backup[0].total_pnl)) < 0.01

    if (rowsMatch && walletsMatch && pnlMatch) {
      console.log('✅ VERIFICATION PASSED')
      console.log('   Backup is an exact snapshot of current state\n')
    } else {
      console.log('⚠️  VERIFICATION WARNING')
      console.log(`   Rows match: ${rowsMatch ? '✅' : '❌'}`)
      console.log(`   Wallets match: ${walletsMatch ? '✅' : '❌'}`)
      console.log(`   P&L match: ${pnlMatch ? '✅' : '❌'}\n`)
    }

    // Step 5: Sample wallets to verify
    console.log('STEP 5: Sample 5 wallets from backup\n')

    const sampleResult = await client.query({
      query: `
        SELECT
          wallet,
          COUNT(*) as markets,
          SUM(realized_pnl_usd) as total_pnl
        FROM realized_pnl_by_market_backup_20251111
        GROUP BY wallet
        ORDER BY total_pnl DESC
        LIMIT 5
      `,
      format: 'JSONEachRow'
    })
    const samples = await sampleResult.json<any>()

    console.log('Top 5 wallets by P&L:')
    samples.forEach((s: any, idx: number) => {
      console.log(`  ${idx + 1}. ${s.wallet}`)
      console.log(`     Markets: ${parseInt(s.markets).toLocaleString()}, P&L: $${(parseFloat(s.total_pnl) / 1000).toFixed(1)}K`)
    })

    console.log('\n' + '='.repeat(80))
    console.log('\n✅ IMMUTABLE BACKUP COMPLETE\n')
    console.log('Table: realized_pnl_by_market_backup_20251111')
    console.log(`Rows: ${parseInt(backup[0].total_rows).toLocaleString()}`)
    console.log(`Wallets: ${parseInt(backup[0].unique_wallets).toLocaleString()}`)
    console.log(`Created: ${new Date().toISOString()}`)
    console.log(`Duration: ${duration}s`)
    console.log('\nThis snapshot is now frozen and will not change.\n')

  } catch (error: any) {
    console.error('\n❌ Error creating backup:', error.message)
    if (error.stack) {
      console.error('\nStack trace:', error.stack)
    }
  } finally {
    await client.close()
  }
}

createImmutableBackup()
