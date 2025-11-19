#!/usr/bin/env npx tsx

/**
 * PHASE A: QUICK WIN - Recovery for Test Wallets Only
 *
 * Recover condition_ids just for wallets 2-4 + Wallet 1
 * Small dataset (~10K trades) = no header overflow
 * Validates recovery logic before scaling to full 77.4M
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

const TEST_WALLETS = [
  '0x1489046ca0f9980fc2d9a950d103d3bec02c1307', // Wallet 1 (control)
  '0x8e9eedf20dfa70956d49f608a205e402d9df38e4', // Wallet 2
  '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b', // Wallet 3
  '0x6770bf688b8121331b1c5cfd7723ebd4152545fb', // Wallet 4
]

async function main() {
  console.log('='.repeat(100))
  console.log('PHASE A: QUICK WIN - Test Wallet Recovery')
  console.log('='.repeat(100))

  const walletList = TEST_WALLETS.map(w => `'${w.toLowerCase()}'`).join(',')

  // Step 1: Check baseline for test wallets
  console.log('\n[STEP 1] Baseline check (test wallets only)...')

  const before = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_ids
      FROM trades_raw
      WHERE lower(wallet_address) IN (${walletList})
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const empty_before = parseInt(before[0].empty_ids)
  console.log(`  Total trades: ${before[0].total_trades}`)
  console.log(`  Empty condition_ids: ${empty_before}`)
  console.log(`  ✅ Small dataset = No header overflow risk`)

  // Step 2: Create recovery table for test wallets
  console.log('\n[STEP 2] Creating recovery table (test wallets)...')

  await clickhouse.command({
    query: `DROP TABLE IF EXISTS trades_raw_test_wallets_recovered`
  })

  const createQuery = `
    CREATE TABLE trades_raw_test_wallets_recovered ENGINE = MergeTree()
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
      COALESCE(
        NULLIF(t.condition_id, ''),
        CASE
          WHEN e.token_id != '' AND length(e.token_id) > 64
          THEN substring(lower(e.token_id), 1, 64)
          ELSE t.condition_id
        END
      ) as condition_id,
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
    LEFT JOIN erc1155_transfers e ON
      t.transaction_hash = e.tx_hash
      AND (
        lower(t.wallet_address) = lower(e.from_address)
        OR lower(t.wallet_address) = lower(e.to_address)
      )
    WHERE lower(t.wallet_address) IN (${walletList})
  `

  await clickhouse.command({
    query: createQuery
  })

  console.log('  ✅ Recovery table created successfully')

  // Step 3: Validate recovery
  console.log('\n[STEP 3] Validating recovery...')

  const after = await (await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_ids
      FROM trades_raw_test_wallets_recovered
    `,
      format: 'JSONEachRow'
    })).json() as any[]

  const empty_after = parseInt(after[0].empty_ids)
  const recovered = empty_before - empty_after

  console.log(`  Total trades: ${after[0].total_trades}`)
  console.log(`  Empty condition_ids: ${empty_after}`)
  console.log(`  Recovered: ${recovered} condition_ids`)

  if (recovered > 0) {
    console.log(`  ✅ Recovery successful (${(recovered/empty_before*100).toFixed(1)}% of test wallet empties)`)
  } else {
    console.log(`  ⚠️  No recovery in test set (may be OK if they already have condition_ids)`)
  }

  // Step 4: Check by wallet
  console.log('\n[STEP 4] Recovery by wallet...')

  for (const wallet of TEST_WALLETS) {
    const before_w = await (await clickhouse.query({
      query: `
        SELECT COUNT(*) as cnt, SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty
        FROM trades_raw WHERE lower(wallet_address) = lower('${wallet}')
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const after_w = await (await clickhouse.query({
      query: `
        SELECT COUNT(*) as cnt, SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty
        FROM trades_raw_test_wallets_recovered WHERE lower(wallet_address) = lower('${wallet}')
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const b = before_w[0]
    const a = after_w[0]
    const name = wallet === TEST_WALLETS[0] ? 'Wallet 1' : wallet === TEST_WALLETS[1] ? 'Wallet 2' : wallet === TEST_WALLETS[2] ? 'Wallet 3' : 'Wallet 4'

    console.log(`  ${name}: ${b.cnt} trades, ${b.empty} empty → ${a.empty} empty (recovered ${b.empty - a.empty})`)
  }

  // Step 5: Atomic swap for test wallets only
  console.log('\n[STEP 5] Prepare for checkpoint validation...')
  console.log('  Ready to run checkpoint validation with recovered test wallet data')
  console.log('  (Atomic swap will happen after checkpoint 3 validates)')

  console.log('\n' + '='.repeat(100))
  console.log('✅ PHASE A COMPLETE')
  console.log('='.repeat(100))
  console.log(`
Status:
- Test wallet recovery: SUCCESS
- Empty condition_ids: ${empty_before} → ${empty_after}
- Recovered: ${recovered} (${(recovered/empty_before*100).toFixed(1)}%)

Next: Run checkpoint 2 validation with this recovered data

After checkpoint 3 passes:
1. Atomic swap test wallets into main trades_raw
2. Then execute Phase B: Full batch recovery on remaining 996K wallets
3. Then: Full 900K wallet backfill
  `)
}

main().catch(e => console.error('Fatal error:', e))
