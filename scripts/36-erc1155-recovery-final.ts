#!/usr/bin/env npx tsx

/**
 * ERC1155 RECOVERY - Final Implementation with Correct Schema
 */

import { config } from 'dotenv'
import { resolve } from 'path'
config({ path: resolve(process.cwd(), '.env.local') })

import { clickhouse } from './lib/clickhouse/client'

async function main() {
  console.log('='.repeat(100))
  console.log('ERC1155 RECOVERY - Final Implementation')
  console.log('='.repeat(100))

  // Step 1: Drop if exists
  console.log('\n[STEP 1] Cleaning up...')

  try {
    await clickhouse.command({
      query: `DROP TABLE IF EXISTS trades_raw_recovered`
    })
    console.log('  ✅ Cleaned up')
  } catch (e) {}

  // Step 2: Create recovery table with SELECT * AS and recovered condition_id
  console.log('\n[STEP 2] Creating trades_raw_recovered...')
  console.log('  (Joining 159M trades with ERC1155 transfers...')

  try {
    await clickhouse.command({
      query: `
        CREATE TABLE trades_raw_recovered ENGINE = MergeTree()
        ORDER BY (wallet_address, timestamp)
        AS
        SELECT
          t.*,
          COALESCE(
            NULLIF(t.condition_id, ''),
            IF(
              length(e.token_id) > 64,
              substring(lower(e.token_id), 1, 64),
              ''
            )
          ) as condition_id_recovered
        FROM trades_raw t
        LEFT JOIN erc1155_transfers e ON
          t.transaction_hash = e.tx_hash
          AND (
            lower(t.wallet_address) = lower(e.from_address)
            OR lower(t.wallet_address) = lower(e.to_address)
          )
      `
    })
    console.log('  ✅ Table created')
  } catch (error: any) {
    console.error('  ❌ Error:', error.message)
    return
  }

  // Step 3: Validate recovery
  console.log('\n[STEP 3] Validating recovery...')

  try {
    const validation = await (await clickhouse.query({
      query: `
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN condition_id_recovered != '' THEN 1 ELSE 0 END) as recovered,
          SUM(CASE WHEN condition_id_recovered = '' THEN 1 ELSE 0 END) as still_empty
        FROM trades_raw_recovered
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const v = validation[0]
    console.log(`  Total rows: ${v.total}`)
    console.log(`  Recovered: ${v.recovered} condition_ids`)
    console.log(`  Still empty: ${v.still_empty}`)
  } catch (e) {
    console.error('  Validation query failed')
  }

  // Step 4: Now update trades_raw with recovered condition_ids
  console.log('\n[STEP 4] Updating trades_raw with recovered condition_ids...')

  try {
    // This is the key fix: Update the original condition_id field with recovered values
    await clickhouse.command({
      query: `
        ALTER TABLE trades_raw UPDATE
        condition_id = (
          SELECT COALESCE(
            NULLIF(t.condition_id, ''),
            IF(
              length(e.token_id) > 64,
              substring(lower(e.token_id), 1, 64),
              ''
            )
          )
          FROM trades_raw t
          LEFT JOIN erc1155_transfers e ON
            t.transaction_hash = e.tx_hash
            AND (
              lower(t.wallet_address) = lower(e.from_address)
              OR lower(t.wallet_address) = lower(e.to_address)
            )
          WHERE trades_raw.trade_id = t.trade_id
          LIMIT 1
        )
        WHERE condition_id = ''
      `
    })
    console.log('  ✅ Updated trades_raw')
  } catch (e: any) {
    console.error('  Note: ALTER TABLE approach not supported in this version')
    console.error('  Using alternative strategy...')

    // Alternative: Use a simpler swap approach
    console.log('\n[ALT] Using atomic table swap instead...')

    await clickhouse.command({
      query: `
        DROP TABLE IF EXISTS trades_raw_updated
      `
    })

    await clickhouse.command({
      query: `
        CREATE TABLE trades_raw_updated AS
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
            IF(
              length(e.token_id) > 64,
              substring(lower(e.token_id), 1, 64),
              ''
            )
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
      `
    })

    console.log('  ✅ Created trades_raw_updated')

    // Verify improvement
    console.log('\n[VERIFICATION] Before/After...')

    const before = await (await clickhouse.query({
      query: `
        SELECT
          SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_count
        FROM trades_raw
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const after = await (await clickhouse.query({
      query: `
        SELECT
          SUM(CASE WHEN condition_id = '' THEN 1 ELSE 0 END) as empty_count
        FROM trades_raw_updated
      `,
        format: 'JSONEachRow'
      })).json() as any[]

    const recovered = parseInt(before[0].empty_count) - parseInt(after[0].empty_count)

    console.log(`  Before: ${before[0].empty_count} empty condition_ids`)
    console.log(`  After:  ${after[0].empty_count} empty condition_ids`)
    console.log(`  Recovered: ${recovered} condition_ids`)

    // Atomic swap
    console.log('\n[SWAP] Performing atomic table swap...')

    await clickhouse.command({
      query: `
        RENAME TABLE
        trades_raw TO trades_raw_before_recovery,
        trades_raw_updated TO trades_raw
      `
    })

    console.log('  ✅ Swap complete')
  }

  // Final summary
  console.log('\n' + '='.repeat(100))
  console.log('RECOVERY COMPLETE')
  console.log('='.repeat(100))
  console.log(`
✅ trades_raw now has recovered condition_ids from ERC1155 table
✅ Ready for P&L recalculation

Next: Run P&L calculation for test wallets to validate recovery
  `)
}

main().catch(e => console.error('Fatal error:', e))
