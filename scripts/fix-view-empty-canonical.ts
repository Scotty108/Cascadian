#!/usr/bin/env npx tsx

/**
 * Fix view to handle empty canonical_wallet properly
 *
 * Issue: COALESCE doesn't work with empty string '' in ClickHouse LEFT JOIN
 * Fix: Use if(canonical_wallet != '', canonical_wallet, wallet_address)
 */

import { createClient } from '@clickhouse/client'

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST || 'https://igm38nvzub.us-central1.gcp.clickhouse.cloud:8443',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
})

async function main() {
  console.log('════════════════════════════════════════════════════════════════════')
  console.log('FIXING VIEW - EMPTY CANONICAL WALLET HANDLING')
  console.log('════════════════════════════════════════════════════════════════════\n')

  console.log('Step 1: Dropping existing view...')
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS vw_trades_canonical_with_canonical_wallet',
  })
  console.log('✅ View dropped\n')

  console.log('Step 2: Creating view with fixed COALESCE logic...')
  const createViewSQL = `
    CREATE VIEW vw_trades_canonical_with_canonical_wallet AS
    SELECT
      -- Wallet attribution (handle empty string from LEFT JOIN)
      if(wim.canonical_wallet != '', wim.canonical_wallet, t.wallet_address) AS wallet_canonical,
      t.wallet_address AS wallet_raw,
      t.condition_id_norm_v3 AS cid_norm,

      -- Trade details (pass-through)
      t.trade_id,
      t.trade_key,
      t.transaction_hash,
      t.wallet_address,
      t.condition_id_norm_v2,
      t.outcome_index_v2,
      t.market_id_norm_v2,
      t.condition_id_norm_v3,
      t.outcome_index_v3,
      t.market_id_norm_v3,
      t.condition_source_v3,
      t.condition_id_norm_orig,
      t.outcome_index_orig,
      t.market_id_norm_orig,
      t.trade_direction,
      t.direction_confidence,

      -- ✨ SIGN CORRECTION APPLIED HERE ✨
      IF(t.trade_direction = 'BUY', t.shares, -t.shares) AS shares,

      t.price,
      t.usd_value,
      t.fee,
      t.timestamp,
      t.created_at,
      t.source,
      t.id_repair_source,
      t.id_repair_confidence,
      t.is_orphan,
      t.orphan_reason,
      t.build_version,
      t.build_timestamp,
      t.version

    FROM pm_trades_canonical_v3 AS t
    LEFT JOIN wallet_identity_overrides AS wim
      ON t.wallet_address = wim.executor_wallet
  `

  await clickhouse.command({ query: createViewSQL })
  console.log('✅ View created with:')
  console.log("   - Empty string handling: if(canonical != '', canonical, wallet_address)")
  console.log('   - Sign correction: IF(trade_direction = BUY, shares, -shares)')
  console.log('   - Correct wallet table: wallet_identity_overrides\n')

  console.log('════════════════════════════════════════════════════════════════════')
  console.log('FIX COMPLETE')
  console.log('════════════════════════════════════════════════════════════════════\n')

  await clickhouse.close()
}

main().catch(console.error)
