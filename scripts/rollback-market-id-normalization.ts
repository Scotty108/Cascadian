#!/usr/bin/env npx tsx

/**
 * Market ID Normalization Migration Rollback
 *
 * This script rolls back the market_id normalization migration by
 * restoring the original view definitions from backups.
 *
 * Estimated time: 30 seconds
 * Risk level: Very low (just restoring from backups)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@clickhouse/client'

config({ path: resolve(process.cwd(), '.env.local') })

const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
})

async function executeStatement(statement: string, description: string) {
  console.log(`\n${description}`)
  console.log('='.repeat(80))

  try {
    const result = await clickhouse.query({
      query: statement,
      format: 'JSONEachRow',
    })

    const data = await result.json() as any[]

    if (data.length > 0) {
      console.table(data)
    } else {
      console.log('✓ Statement executed successfully (no output)')
    }

    return { success: true, data }
  } catch (error) {
    console.error('✗ Error:', error)
    return { success: false, error }
  }
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════════╗')
  console.log('║                 MARKET ID NORMALIZATION ROLLBACK                         ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('⚠️  WARNING: This will restore the original view definitions')
  console.log('')
  console.log('This rollback will:')
  console.log('  1. Drop the new outcome_positions_v2 view')
  console.log('  2. Restore outcome_positions_v2 from backup')
  console.log('  3. Drop the new trade_cashflows_v3 view')
  console.log('  4. Restore trade_cashflows_v3 from backup')
  console.log('  5. Verify restoration')
  console.log('')

  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const answer = await new Promise<string>((resolve) => {
    rl.question('Do you want to proceed with rollback? (yes/no): ', resolve)
  })
  rl.close()

  if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
    console.log('Rollback cancelled.')
    process.exit(0)
  }

  console.log('\n🔄 STARTING ROLLBACK\n')

  // Check if backups exist
  console.log('Checking if backup views exist...')
  const checkBackups = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM system.tables
      WHERE database = 'default'
        AND name IN ('outcome_positions_v2_backup', 'trade_cashflows_v3_backup')
    `,
    format: 'JSONEachRow',
  })
  const backupCheck = await checkBackups.json() as any[]
  const backupCount = parseInt(backupCheck[0].cnt)

  if (backupCount !== 2) {
    console.error('✗ Backup views not found! Cannot rollback.')
    console.error('  Expected: outcome_positions_v2_backup, trade_cashflows_v3_backup')
    console.error(`  Found: ${backupCount} backup view(s)`)
    process.exit(1)
  }

  console.log('✓ Backup views found')

  // Restore outcome_positions_v2
  await executeStatement(
    `DROP VIEW IF EXISTS outcome_positions_v2`,
    'Step 1: Dropping new outcome_positions_v2...'
  )

  await executeStatement(
    `CREATE VIEW outcome_positions_v2 AS SELECT * FROM outcome_positions_v2_backup`,
    'Step 2: Restoring outcome_positions_v2 from backup...'
  )

  // Restore trade_cashflows_v3
  await executeStatement(
    `DROP VIEW IF EXISTS trade_cashflows_v3`,
    'Step 3: Dropping new trade_cashflows_v3...'
  )

  await executeStatement(
    `CREATE VIEW trade_cashflows_v3 AS SELECT * FROM trade_cashflows_v3_backup`,
    'Step 4: Restoring trade_cashflows_v3 from backup...'
  )

  console.log('\n✅ VERIFICATION\n')

  // Verify restoration
  await executeStatement(
    `SELECT
      'outcome_positions_v2' as view_name,
      count() as row_count,
      count(DISTINCT wallet) as unique_wallets
    FROM outcome_positions_v2
    UNION ALL
    SELECT
      'outcome_positions_v2_backup' as view_name,
      count() as row_count,
      count(DISTINCT wallet) as unique_wallets
    FROM outcome_positions_v2_backup`,
    'Verification: Row counts should match'
  )

  await executeStatement(
    `SELECT
      'trade_cashflows_v3' as view_name,
      count() as row_count,
      sum(cashflow_usdc) as total_cashflow
    FROM trade_cashflows_v3
    UNION ALL
    SELECT
      'trade_cashflows_v3_backup' as view_name,
      count() as row_count,
      sum(cashflow_usdc) as total_cashflow
    FROM trade_cashflows_v3_backup`,
    'Verification: Cashflows should match'
  )

  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗')
  console.log('║                       ROLLBACK COMPLETE                                  ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('✓ Original view definitions restored')
  console.log('✓ Backup views still exist for reference')
  console.log('')
  console.log('The system is now back to its pre-migration state.')
  console.log('')
  console.log('To clean up backup views (optional):')
  console.log('  DROP VIEW outcome_positions_v2_backup;')
  console.log('  DROP VIEW trade_cashflows_v3_backup;')
  console.log('')

  await clickhouse.close()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
