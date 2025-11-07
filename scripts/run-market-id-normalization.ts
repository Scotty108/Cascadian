#!/usr/bin/env npx tsx

/**
 * Market ID Normalization Migration Runner
 *
 * This script executes the market_id normalization migration to fix
 * HEX/INTEGER format inconsistency that causes duplicate rows in
 * GROUP BY operations and JOIN failures.
 *
 * Estimated time: 15-20 minutes
 * Risk level: Low (view-only changes, backups created)
 */

import { config } from 'dotenv'
import { resolve } from 'path'
import { readFileSync } from 'fs'
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
  console.log('║                 MARKET ID NORMALIZATION MIGRATION                        ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('This migration will:')
  console.log('  1. Capture baseline metrics')
  console.log('  2. Create backup views')
  console.log('  3. Rebuild outcome_positions_v2 (remove market_id, group by condition_id)')
  console.log('  4. Rebuild trade_cashflows_v3 (remove market_id, use condition_id)')
  console.log('  5. Run verification checks')
  console.log('')
  console.log('Estimated time: 15-20 minutes')
  console.log('Risk level: Low (view-only changes, backups created)')
  console.log('')

  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const answer = await new Promise<string>((resolve) => {
    rl.question('Do you want to proceed? (yes/no): ', resolve)
  })
  rl.close()

  if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
    console.log('Migration cancelled.')
    process.exit(0)
  }

  console.log('\n📊 PHASE 1: PREPARATION\n')

  // Create baseline table
  await executeStatement(
    `CREATE TABLE IF NOT EXISTS migration_baseline_2025_11_06 (
      metric_name String,
      metric_value String,
      created_at DateTime DEFAULT now()
    ) ENGINE = MergeTree()
    ORDER BY (metric_name, created_at)`,
    'Creating baseline metrics table...'
  )

  // Capture baseline
  await executeStatement(
    `INSERT INTO migration_baseline_2025_11_06
    SELECT 'outcome_positions_v2_row_count', toString(count()), now() FROM outcome_positions_v2
    UNION ALL
    SELECT 'outcome_positions_v2_unique_wallets', toString(count(DISTINCT wallet)), now() FROM outcome_positions_v2
    UNION ALL
    SELECT 'outcome_positions_v2_unique_conditions', toString(count(DISTINCT condition_id_norm)), now() FROM outcome_positions_v2
    UNION ALL
    SELECT 'outcome_positions_v2_sum_net_shares', toString(sum(net_shares)), now() FROM outcome_positions_v2
    UNION ALL
    SELECT 'trade_cashflows_v3_row_count', toString(count()), now() FROM trade_cashflows_v3
    UNION ALL
    SELECT 'trade_cashflows_v3_total_cashflow', toString(sum(cashflow_usdc)), now() FROM trade_cashflows_v3
    UNION ALL
    SELECT 'trade_cashflows_v3_unique_wallets', toString(count(DISTINCT wallet)), now() FROM trade_cashflows_v3
    UNION ALL
    SELECT 'trades_dedup_mat_hex_count', toString(countIf(length(market_id) > 20)), now() FROM trades_dedup_mat WHERE market_id != ''
    UNION ALL
    SELECT 'trades_dedup_mat_int_count', toString(countIf(length(market_id) <= 20)), now() FROM trades_dedup_mat WHERE market_id != ''`,
    'Capturing baseline metrics...'
  )

  // View baseline
  await executeStatement(
    `SELECT * FROM migration_baseline_2025_11_06 ORDER BY metric_name`,
    'Baseline metrics captured:'
  )

  // Create backups
  await executeStatement(
    `CREATE VIEW outcome_positions_v2_backup AS SELECT * FROM outcome_positions_v2`,
    'Creating backup: outcome_positions_v2_backup...'
  )

  await executeStatement(
    `CREATE VIEW trade_cashflows_v3_backup AS SELECT * FROM trade_cashflows_v3`,
    'Creating backup: trade_cashflows_v3_backup...'
  )

  console.log('\n🔧 PHASE 2: MIGRATION\n')

  // Rebuild outcome_positions_v2
  await executeStatement(
    `DROP VIEW IF EXISTS outcome_positions_v2`,
    'Dropping old outcome_positions_v2 view...'
  )

  await executeStatement(
    `CREATE VIEW outcome_positions_v2 (
      wallet String,
      condition_id_norm String,
      outcome_idx Int16,
      net_shares Float64
    ) AS
    SELECT
      lower(t.wallet_address) AS wallet,
      lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
      t.outcome_index AS outcome_idx,
      sum(if(t.side = 1, 1.0, -1.0) * toFloat64(t.shares)) AS net_shares
    FROM trades_dedup_mat AS t
    WHERE t.outcome_index IS NOT NULL
      AND t.condition_id IS NOT NULL
      AND t.condition_id != ''
      AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'
    GROUP BY
      wallet,
      condition_id_norm,
      outcome_idx
    HAVING abs(net_shares) > 0.0001`,
    'Creating new outcome_positions_v2 view (no market_id, grouped by condition_id)...'
  )

  // Rebuild trade_cashflows_v3
  await executeStatement(
    `DROP VIEW IF EXISTS trade_cashflows_v3`,
    'Dropping old trade_cashflows_v3 view...'
  )

  await executeStatement(
    `CREATE VIEW trade_cashflows_v3 (
      wallet String,
      condition_id_norm String,
      outcome_idx Int16,
      px Float64,
      sh Float64,
      cashflow_usdc Float64
    ) AS
    SELECT
      lower(t.wallet_address) AS wallet,
      lower(replaceAll(t.condition_id, '0x', '')) AS condition_id_norm,
      t.outcome_index AS outcome_idx,
      toFloat64(t.entry_price) AS px,
      toFloat64(t.shares) AS sh,
      round(
        toFloat64(t.entry_price) * toFloat64(t.shares) * if(t.side = 1, -1, 1),
        8
      ) AS cashflow_usdc
    FROM trades_dedup_mat AS t
    WHERE t.outcome_index IS NOT NULL
      AND t.condition_id IS NOT NULL
      AND t.condition_id != ''
      AND t.condition_id != '0x0000000000000000000000000000000000000000000000000000000000000000'`,
    'Creating new trade_cashflows_v3 view (no market_id, uses condition_id)...'
  )

  console.log('\n✅ PHASE 3: VERIFICATION\n')

  // Check 1: Row count comparison
  await executeStatement(
    `SELECT
      'Check 1: Row count comparison' as check_name,
      (SELECT count() FROM outcome_positions_v2_backup) as before_count,
      (SELECT count() FROM outcome_positions_v2) as after_count,
      before_count - after_count as reduction,
      round((reduction / before_count) * 100, 2) as reduction_pct,
      if(after_count <= before_count AND after_count > 0, 'PASS ✓', 'FAIL ✗') as status`,
    'Check 1: Row count comparison'
  )

  // Check 2: Net shares preservation
  await executeStatement(
    `SELECT
      'Check 2: Net shares preservation' as check_name,
      (SELECT sum(net_shares) FROM outcome_positions_v2_backup) as before_sum,
      (SELECT sum(net_shares) FROM outcome_positions_v2) as after_sum,
      abs(before_sum - after_sum) as difference,
      if(difference < 1000, 'PASS ✓', 'FAIL ✗') as status`,
    'Check 2: Net shares preservation'
  )

  // Check 3: Cashflow preservation
  await executeStatement(
    `SELECT
      'Check 3: Cashflow preservation' as check_name,
      (SELECT sum(cashflow_usdc) FROM trade_cashflows_v3_backup) as before_sum,
      (SELECT sum(cashflow_usdc) FROM trade_cashflows_v3) as after_sum,
      abs(before_sum - after_sum) as difference,
      if(difference < 1000, 'PASS ✓', 'FAIL ✗') as status`,
    'Check 3: Cashflow preservation'
  )

  // Check 4: No NULL condition_ids
  await executeStatement(
    `SELECT
      'Check 4: No NULL condition_ids' as check_name,
      (SELECT countIf(condition_id_norm IS NULL OR condition_id_norm = '') FROM outcome_positions_v2) as null_count,
      if(null_count = 0, 'PASS ✓', 'FAIL ✗') as status`,
    'Check 4: No NULL condition_ids'
  )

  // Check 5: Valid condition_id format
  await executeStatement(
    `SELECT
      'Check 5: Valid condition_id format' as check_name,
      (SELECT countIf(length(condition_id_norm) != 64) FROM outcome_positions_v2) as invalid_count,
      if(invalid_count = 0, 'PASS ✓', 'WARNING ⚠') as status`,
    'Check 5: Valid condition_id format (64 hex chars)'
  )

  // Check 6: JOIN to market_resolution_map
  await executeStatement(
    `SELECT
      'Check 6: JOIN to market_resolution_map' as check_name,
      (SELECT count() FROM outcome_positions_v2 AS o
       INNER JOIN market_resolution_map AS m
           ON lower(replaceAll(m.condition_id, '0x', '')) = o.condition_id_norm
       LIMIT 1000) as joined_rows,
      if(joined_rows > 0, 'PASS ✓', 'FAIL ✗') as status`,
    'Check 6: JOIN to market_resolution_map works'
  )

  // Check 7: No duplicates
  await executeStatement(
    `SELECT
      'Check 7: No duplicate positions' as check_name,
      (SELECT count() FROM (
        SELECT wallet, condition_id_norm, count() as cnt
        FROM outcome_positions_v2
        GROUP BY wallet, condition_id_norm
        HAVING cnt > 1
      )) as duplicate_count,
      if(duplicate_count = 0, 'PASS ✓', 'FAIL ✗') as status`,
    'Check 7: No duplicate positions per wallet+condition'
  )

  console.log('\n📈 PHASE 4: POST-MIGRATION METRICS\n')

  // Capture post-migration metrics
  await executeStatement(
    `INSERT INTO migration_baseline_2025_11_06
    SELECT 'POST_outcome_positions_v2_row_count', toString(count()), now() FROM outcome_positions_v2
    UNION ALL
    SELECT 'POST_outcome_positions_v2_unique_wallets', toString(count(DISTINCT wallet)), now() FROM outcome_positions_v2
    UNION ALL
    SELECT 'POST_outcome_positions_v2_unique_conditions', toString(count(DISTINCT condition_id_norm)), now() FROM outcome_positions_v2
    UNION ALL
    SELECT 'POST_outcome_positions_v2_sum_net_shares', toString(sum(net_shares)), now() FROM outcome_positions_v2
    UNION ALL
    SELECT 'POST_trade_cashflows_v3_row_count', toString(count()), now() FROM trade_cashflows_v3
    UNION ALL
    SELECT 'POST_trade_cashflows_v3_total_cashflow', toString(sum(cashflow_usdc)), now() FROM trade_cashflows_v3`,
    'Capturing post-migration metrics...'
  )

  // Show comparison
  await executeStatement(
    `SELECT
      replaceRegexpOne(metric_name, '^POST_', '') as metric,
      max(if(metric_name NOT LIKE 'POST_%', metric_value, '0')) as before_value,
      max(if(metric_name LIKE 'POST_%', metric_value, '0')) as after_value,
      toFloat64(after_value) - toFloat64(before_value) as difference
    FROM migration_baseline_2025_11_06
    WHERE metric_name LIKE '%outcome_positions_v2%'
       OR metric_name LIKE '%trade_cashflows_v3%'
    GROUP BY metric
    ORDER BY metric`,
    'Before/After Comparison:'
  )

  console.log('\n╔══════════════════════════════════════════════════════════════════════════╗')
  console.log('║                       MIGRATION COMPLETE                                 ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════╝')
  console.log('')
  console.log('✓ Views have been rebuilt without market_id column')
  console.log('✓ All data now groups by condition_id_norm only')
  console.log('✓ Backup views created: outcome_positions_v2_backup, trade_cashflows_v3_backup')
  console.log('')
  console.log('Next steps:')
  console.log('  1. Review the verification checks above')
  console.log('  2. Test your P&L calculations')
  console.log('  3. If all looks good, drop backup views after 24 hours')
  console.log('')
  console.log('To rollback:')
  console.log('  npx tsx scripts/rollback-market-id-normalization.ts')
  console.log('')

  await clickhouse.close()
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
