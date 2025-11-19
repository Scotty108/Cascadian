#!/usr/bin/env npx tsx

/**
 * Deploy XCN View Fix - Apply Sign Correction
 *
 * Root Cause: Sell shares stored as positive instead of negative
 * Fix: Apply IF(trade_direction = 'BUY', shares, -shares) AS shares
 *
 * Impact: XCN Xi market net shares: 2.1M → -1.1M (CORRECTED)
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
  console.log('DEPLOYING XCN VIEW FIX - SIGN CORRECTION')
  console.log('════════════════════════════════════════════════════════════════════\n')

  // Step 1: Drop existing view
  console.log('Step 1: Dropping existing view...')
  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS vw_trades_canonical_with_canonical_wallet',
  })
  console.log('✅ View dropped\n')

  // Step 2: Create view with sign correction
  console.log('Step 2: Creating view with sign correction...')
  const createViewSQL = `
    CREATE VIEW vw_trades_canonical_with_canonical_wallet AS
    SELECT
      -- Wallet attribution
      COALESCE(wim.canonical_wallet, t.wallet_address) AS wallet_canonical,
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
    LEFT JOIN wallet_identity_map AS wim
      ON t.wallet_address = wim.proxy_wallet
      OR t.wallet_address = wim.user_eoa
  `

  await clickhouse.command({ query: createViewSQL })
  console.log('✅ View created with sign correction\n')

  console.log('════════════════════════════════════════════════════════════════════')
  console.log('DEPLOYMENT COMPLETE')
  console.log('════════════════════════════════════════════════════════════════════\n')

  await clickhouse.close()
}

main().catch(console.error)
