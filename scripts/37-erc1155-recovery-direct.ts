#!/usr/bin/env npx tsx

/**
 * ERC1155 RECOVERY - Direct Update Approach
 *
 * Instead of CREATE TABLE AS SELECT (which has header overflow),
 * use a simpler approach: Build the join directly and stream results
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('ERC1155 RECOVERY - Direct Update (No Header Overflow)')
  console.log('='.repeat(100))

  console.log('\n[STEP 1] Get baseline empty count...')

  const before = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty
      FROM trades_raw
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const beforeEmpty = parseInt(before[0].empty)
  console.log(`  Before: ${before[0].total} total trades, ${beforeEmpty} empty condition_ids`)

  // Step 2: Create recovery mapping table (small, manageable)
  console.log('\n[STEP 2] Building recovery mapping (tx_hash → condition_id)...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS recovery_mapping`
  })

  // Create mapping of transaction_hash to recovered condition_id
  await clickhouse.command({
    query: `
      CREATE TABLE recovery_mapping AS
      SELECT DISTINCT
        e.tx_hash,
        COALESCE(
          NULLIF(substring(lower(e.token_id), 1, 64), ''),
          ''
        ) as recovered_condition_id
      FROM erc1155_transfers e
      WHERE e.token_id != '' AND length(e.token_id) > 64
    `
  })

  console.log('  ✅ Mapping table created')

  // Step 3: Build recovery table with JOIN
  console.log('\n[STEP 3] Creating recovery table with mappings...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS trades_raw_recovered`
  })

  await clickhouse.command({
    query: `
      CREATE TABLE trades_raw_recovered AS
      SELECT
        t.trade_id,
        t.wallet_address,
        t.market_id,
        t.timestamp,
        t.side,
        t.entry_price,
        t.exit_price,
        t.shares,
        t.usd_value,
        t.pnl,
        t.is_closed,
        t.transaction_hash,
        t.created_at,
        t.close_price,
        t.fee_usd,
        t.slippage_usd,
        t.hours_held,
        t.bankroll_at_entry,
        t.outcome,
        t.fair_price_at_entry,
        t.pnl_gross,
        t.pnl_net,
        t.return_pct,
        COALESCE(NULLIF(t.condition_id, ''), COALESCE(m.recovered_condition_id, '')) as condition_id,
        t.was_win,
        t.tx_timestamp,
        t.canonical_category,
        t.raw_tags,
        t.realized_pnl_usd,
        t.is_resolved,
        t.resolved_outcome,
        t.outcome_index,
        t.recovery_status
      FROM trades_raw t
      LEFT JOIN recovery_mapping m ON t.transaction_hash = m.tx_hash
    `
  })

  console.log('  ✅ Recovery table created')

  // Step 4: Validate
  console.log('\n[STEP 4] Validating recovery...')

  const after = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty
      FROM trades_raw_recovered
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const afterEmpty = parseInt(after[0].empty)
  const recovered = beforeEmpty - afterEmpty
  const recoveryRate = (recovered / beforeEmpty * 100).toFixed(2)

  console.log(`  After:  ${after[0].total} total trades, ${afterEmpty} empty condition_ids`)
  console.log(`  Recovered: ${recovered} condition_ids (${recoveryRate}%)`)

  if (recovered > 0) {
    console.log(`  ✅ Recovery successful!`)
  } else {
    console.log(`  ⚠️  No recovery occurred - check mapping`)
  }

  // Step 5: Check test wallets
  console.log('\n[STEP 5] Checking test wallets...')

  const testWallets = [
    '0x1489046ca0f9980fc2d9a950d103d3bec02c1307',
    '0x8e9eedf20dfa70956d49f608a205e402d9df38e4',
    '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b',
    '0x6770bf688b8121331b1c5cfd7723ebd4152545fb',
  ]

  for (const addr of testWallets) {
    const before_w = await (await clickhouse.query({
      query: `
        SELECT SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty FROM trades_raw
        WHERE lower(wallet_address) = lower('${addr}')
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const after_w = await (await clickhouse.query({
      query: `
        SELECT SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty FROM trades_raw_recovered
        WHERE lower(wallet_address) = lower('${addr}')
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const empty_before = parseInt(before_w[0]?.empty || 0)
    const empty_after = parseInt(after_w[0]?.empty || 0)
    console.log(`  ${addr.substring(0, 12)}...: ${empty_before} → ${empty_after} empty (${empty_before - empty_after} recovered)`)
  }

  // Step 6: Atomic swap
  console.log('\n[STEP 6] Performing atomic table swap...')

  try {
    await clickhouse.command({
      query: `
        RENAME TABLE
        trades_raw TO trades_raw_before_erc1155_recovery,
        trades_raw_recovered TO trades_raw
      `
    })
    console.log('  ✅ Swap complete - trades_raw now has recovered condition_ids')
  } catch (e) {
    console.error('  Error during swap:', e)
  }

  // Step 7: Cleanup
  console.log('\n[STEP 7] Cleaning up temporary tables...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS recovery_mapping`
  })

  console.log('  ✅ Cleanup complete')

  console.log('\n' + '='.repeat(100))
  console.log('✅ ERC1155 RECOVERY COMPLETE')
  console.log('='.repeat(100))
  console.log(`
Summary:
- Empty condition_ids reduced: ${beforeEmpty} → ${afterEmpty}
- Recovered: ${recovered} condition_ids (${recoveryRate}%)
- Status: Ready for P&L recalculation

Next: Run Checkpoint 2 validation queries
  `)
}

main().catch(e => console.error('Fatal error:', e))
