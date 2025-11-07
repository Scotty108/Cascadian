#!/usr/bin/env npx tsx

/**
 * ERC1155 RECOVERY - Simplest Approach
 *
 * Just extract from erc1155_transfers without fancy JOINs
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('ERC1155 RECOVERY - Simplest Approach')
  console.log('='.repeat(100))

  console.log('\n[STEP 1] Build recovery mapping from ERC1155...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS condition_id_recovery`
  })

  // Create mapping table with condition_id extraction
  await clickhouse.command({
    query: `
      CREATE TABLE condition_id_recovery ENGINE = Memory AS
      SELECT DISTINCT
        tx_hash,
        substring(lower(token_id), 1, 64) as condition_id
      FROM erc1155_transfers
      WHERE token_id != '' AND length(token_id) > 64
    `
  })

  console.log('  ✅ Mapping created')

  console.log('\n[STEP 2] Check baseline...')

  const before = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty
      FROM trades_raw
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const empty_before = parseInt(before[0].empty)
  console.log(`  Before: ${before[0].total} trades, ${empty_before} empty`)

  console.log('\n[STEP 3] Create updated trades_raw...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS trades_raw_fixed`
  })

  // Use INSERT SELECT with the mapping
  await clickhouse.command({
    query: `
      CREATE TABLE trades_raw_fixed ENGINE = MergeTree()
      ORDER BY (wallet_address, timestamp)
      AS
      SELECT
        t.*,
        CASE
          WHEN t.condition_id != '' THEN t.condition_id
          ELSE COALESCE(c.condition_id, '')
        END as condition_id_final
      FROM trades_raw t
      LEFT JOIN condition_id_recovery c ON t.transaction_hash = c.tx_hash
    `
  })

  console.log('  ✅ Fixed table created')

  // But wait - this creates 2 condition_id columns. Let me do it properly...
  // Drop and try again with just the fields we need

  console.log('\n[STEP 4] Actually, just UPDATE the original table...')

  // Let's try a different approach using UPDATE
  // But ClickHouse doesn't support UPDATE on large tables easily

  // Let's just validate how many we can recover
  const recovery_stats = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(DISTINCT t.transaction_hash) as trades_with_matches,
        COUNT(DISTINCT c.condition_id) as unique_condition_ids_recovered
      FROM trades_raw t
      INNER JOIN condition_id_recovery c ON t.transaction_hash = c.tx_hash
      WHERE t.condition_id = ''
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  console.log(`  Trades with empty condition_id that can be recovered: ${recovery_stats[0].trades_with_matches}`)
  console.log(`  Unique condition_ids that can be recovered: ${recovery_stats[0].unique_condition_ids_recovered}`)

  // OK, the recovery is possible. Now let's actually do it properly.
  // Use RENAME TABLE approach since that's atomic and works

  console.log('\n[STEP 5] Build complete recovery table...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS trades_raw_updated`
  })

  // This time, manually specify all columns to avoid the condition_id_final issue
  const createSQL = `
    CREATE TABLE trades_raw_updated ENGINE = MergeTree()
    ORDER BY (wallet_address, timestamp)
    AS
    SELECT
      trade_id,
      wallet_address,
      market_id,
      timestamp,
      side,
      entry_price,
      exit_price,
      shares,
      usd_value,
      pnl,
      is_closed,
      transaction_hash,
      created_at,
      close_price,
      fee_usd,
      slippage_usd,
      hours_held,
      bankroll_at_entry,
      outcome,
      fair_price_at_entry,
      pnl_gross,
      pnl_net,
      return_pct,
      COALESCE(NULLIF(t.condition_id, ''), COALESCE(c.condition_id, '')) as condition_id,
      was_win,
      tx_timestamp,
      canonical_category,
      raw_tags,
      realized_pnl_usd,
      is_resolved,
      resolved_outcome,
      outcome_index,
      recovery_status
    FROM trades_raw t
    LEFT JOIN condition_id_recovery c ON t.transaction_hash = c.tx_hash
  `

  await clickhouse.command({
    query: createSQL
  })

  console.log('  ✅ Updated table created')

  console.log('\n[STEP 6] Validate recovery...')

  const after = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty
      FROM trades_raw_updated
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const empty_after = parseInt(after[0].empty)
  const recovered = empty_before - empty_after

  console.log(`  After:  ${after[0].total} trades, ${empty_after} empty`)
  console.log(`  Recovered: ${recovered} condition_ids`)
  console.log(`  Recovery rate: ${(recovered / empty_before * 100).toFixed(2)}%`)

  console.log('\n[STEP 7] Atomic swap...')

  await clickhouse.command({
    query: `
      RENAME TABLE
      trades_raw TO trades_raw_before_recovery,
      trades_raw_updated TO trades_raw
    `
  })

  console.log('  ✅ Swap complete')

  console.log('\n[STEP 8] Cleanup...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS condition_id_recovery, trades_raw_fixed`
  })

  console.log('  ✅ Cleanup done')

  console.log('\n' + '='.repeat(100))
  console.log('✅ RECOVERY COMPLETE!')
  console.log('='.repeat(100))
  console.log(`
Status:
- Empty condition_ids: ${empty_before} → ${empty_after}
- Recovered: ${recovered} (${(recovered/empty_before*100).toFixed(2)}%)
- Backup: trades_raw_before_recovery (can be dropped)

Ready for Checkpoint 2 validation.
  `)
}

main().catch(e => console.error('Fatal error:', e))
