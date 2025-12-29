#!/usr/bin/env npx tsx
/**
 * PROMOTE TRADER-STRICT CLASSIFIER TO MATERIALIZED TABLE
 * ============================================================================
 *
 * Promotes the trader_strict_classifier_v1 view to a stable materialized table
 * with additional columns for benchmark compatibility.
 *
 * Changes from view:
 * 1. Creates trader_strict_classifier_v1_tbl (materialized table)
 * 2. Adds unresolved_pct_benchmark_compatible column
 *    - Uses pm_condition_resolutions_norm join with empty string check
 *    - Matches V12 benchmark logic exactly
 * 3. Scheduled for periodic refresh via external cron
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 900000, // 15 minutes
});

async function createMaterializedTable() {
  console.log('═'.repeat(80));
  console.log('PROMOTING TRADER-STRICT CLASSIFIER TO MATERIALIZED TABLE');
  console.log('═'.repeat(80));
  console.log('');

  // Step 1: Drop old table if exists (atomic rebuild pattern)
  console.log('Step 1: Dropping old table if exists...');
  await ch.command({
    query: 'DROP TABLE IF EXISTS trader_strict_classifier_v1_tbl_new'
  });

  // Step 2: Create new materialized table with benchmark-compatible unresolved
  console.log('Step 2: Creating trader_strict_classifier_v1_tbl_new...');
  console.log('        (This may take several minutes for 1.7M wallets)');

  const createTableQuery = `
    CREATE TABLE trader_strict_classifier_v1_tbl_new
    ENGINE = MergeTree()
    ORDER BY (tier, wallet_address)
    SETTINGS index_granularity = 8192
    AS
    WITH
      -- CLOB stats from unified ledger (classifier definition)
      clob_stats AS (
        SELECT
          wallet_address,
          count() as clob_event_count,
          sum(abs(usdc_delta)) as clob_usdc_volume,
          countIf(payout_norm IS NULL) as clob_unresolved_count
        FROM pm_unified_ledger_v8_tbl
        WHERE source_type = 'CLOB'
        GROUP BY wallet_address
      ),

      -- Benchmark-compatible unresolved calculation
      -- Matches V12 benchmark: uses pm_trader_events_v2 with resolution join
      benchmark_unresolved AS (
        SELECT
          d.wallet_address,
          count(*) as benchmark_total_events,
          countIf(
            res.raw_numerators IS NULL
            OR res.raw_numerators = ''
            OR length(res.norm_prices) = 0
          ) as benchmark_unresolved_events
        FROM (
          SELECT
            trader_wallet as wallet_address,
            argMax(token_id, trade_time) as token_id
          FROM pm_trader_events_v2
          WHERE is_deleted = 0
          GROUP BY trader_wallet, event_id
        ) d
        LEFT JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
        LEFT JOIN pm_condition_resolutions_norm res ON m.condition_id = res.condition_id
        GROUP BY d.wallet_address
      ),

      -- Split/Merge stats from unified ledger
      ctf_stats AS (
        SELECT
          wallet_address,
          countIf(source_type = 'PositionSplit') as split_count,
          countIf(source_type = 'PositionsMerge') as merge_count,
          countIf(source_type = 'PayoutRedemption') as redemption_count
        FROM pm_unified_ledger_v8_tbl
        WHERE source_type IN ('PositionSplit', 'PositionsMerge', 'PayoutRedemption')
        GROUP BY wallet_address
      ),

      -- AMM/FPMM stats
      amm_stats AS (
        SELECT
          trader_wallet as wallet_address,
          count() as amm_event_count,
          sum(abs(usdc_amount)) as amm_usdc_volume
        FROM pm_fpmm_trades
        WHERE is_deleted = 0
        GROUP BY trader_wallet
      ),

      -- Maker/Taker stats from CLOB events
      role_stats AS (
        SELECT
          trader_wallet as wallet_address,
          countIf(role = 'maker') as maker_count,
          countIf(role = 'taker') as taker_count,
          count(DISTINCT event_id) as unique_events
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
        GROUP BY trader_wallet
      ),

      -- External transfer stats (excluding 0x0 mint/burn addresses)
      transfer_stats AS (
        SELECT
          wallet_address,
          count() as transfer_count
        FROM (
          SELECT from_address as wallet_address
          FROM pm_erc1155_transfers
          WHERE from_address != '0x0000000000000000000000000000000000000000'
            AND to_address != '0x0000000000000000000000000000000000000000'
            AND is_deleted = 0
          UNION ALL
          SELECT to_address as wallet_address
          FROM pm_erc1155_transfers
          WHERE from_address != '0x0000000000000000000000000000000000000000'
            AND to_address != '0x0000000000000000000000000000000000000000'
            AND is_deleted = 0
        )
        GROUP BY wallet_address
      )

    SELECT
      c.wallet_address as wallet_address,

      -- CLOB metrics
      c.clob_event_count as clob_event_count,
      c.clob_usdc_volume as clob_usdc_volume,
      c.clob_unresolved_count as clob_unresolved_count,

      -- CTF mechanics
      coalesce(ctf.split_count, 0) as split_count,
      coalesce(ctf.merge_count, 0) as merge_count,
      coalesce(ctf.redemption_count, 0) as redemption_count,

      -- AMM metrics
      coalesce(amm.amm_event_count, 0) as amm_event_count,
      coalesce(amm.amm_usdc_volume, 0) as amm_usdc_volume,

      -- Role metrics
      coalesce(r.maker_count, 0) as maker_count,
      coalesce(r.taker_count, 0) as taker_count,
      coalesce(r.unique_events, 0) as unique_clob_events,

      -- Transfer metrics
      coalesce(t.transfer_count, 0) as transfer_count,

      -- Derived: Classifier unresolved % (from unified ledger payout_norm IS NULL)
      if(c.clob_event_count > 0,
         c.clob_unresolved_count * 100.0 / c.clob_event_count,
         0) as unresolved_pct,

      -- Derived: Benchmark-compatible unresolved % (from resolution join with empty string check)
      if(coalesce(bu.benchmark_total_events, 0) > 0,
         coalesce(bu.benchmark_unresolved_events, 0) * 100.0 / bu.benchmark_total_events,
         0) as unresolved_pct_benchmark_compatible,

      -- Derived: Maker share
      if(coalesce(r.maker_count, 0) + coalesce(r.taker_count, 0) > 0,
         coalesce(r.maker_count, 0) * 100.0 / (coalesce(r.maker_count, 0) + coalesce(r.taker_count, 0)),
         0) as maker_share_pct,

      -- Derived: AMM dominance
      if(c.clob_usdc_volume + coalesce(amm.amm_usdc_volume, 0) > 0,
         coalesce(amm.amm_usdc_volume, 0) * 100.0 / (c.clob_usdc_volume + coalesce(amm.amm_usdc_volume, 0)),
         0) as amm_dominance_pct,

      -- Derived: Transfer dominance
      if(c.clob_event_count > 0,
         coalesce(t.transfer_count, 0) * 100.0 / c.clob_event_count,
         0) as transfer_dominance_pct,

      -- Derived: MM likelihood flag
      if(c.clob_event_count > 100000 AND coalesce(r.maker_count, 0) * 100.0 / (coalesce(r.maker_count, 0) + coalesce(r.taker_count, 0) + 1) > 70,
         1, 0) as mm_likelihood_flag,

      -- Tier classification (uses classifier unresolved_pct, not benchmark version)
      multiIf(
        -- Tier A: CLOB-dominant, safe for metrics
        coalesce(amm.amm_event_count, 0) = 0
        AND coalesce(ctf.split_count, 0) = 0
        AND coalesce(ctf.merge_count, 0) = 0
        AND coalesce(t.transfer_count, 0) * 100.0 / (c.clob_event_count + 1) < 5
        AND c.clob_unresolved_count * 100.0 / (c.clob_event_count + 1) < 20
        AND c.clob_event_count >= 50
        AND NOT (c.clob_event_count > 100000 AND coalesce(r.maker_count, 0) * 100.0 / (coalesce(r.maker_count, 0) + coalesce(r.taker_count, 0) + 1) > 70),
        'A',

        -- Tier B: Some complexity but still mostly CLOB
        coalesce(amm.amm_usdc_volume, 0) * 100.0 / (c.clob_usdc_volume + coalesce(amm.amm_usdc_volume, 0) + 1) < 10
        AND (coalesce(ctf.split_count, 0) + coalesce(ctf.merge_count, 0)) * 100.0 / (c.clob_event_count + 1) < 10
        AND c.clob_event_count >= 20,
        'B',

        -- Excluded: everything else
        'X'
      ) as tier,

      -- Metadata
      now() as created_at

    FROM clob_stats c
    LEFT JOIN benchmark_unresolved bu ON c.wallet_address = bu.wallet_address
    LEFT JOIN ctf_stats ctf ON c.wallet_address = ctf.wallet_address
    LEFT JOIN amm_stats amm ON c.wallet_address = amm.wallet_address
    LEFT JOIN role_stats r ON c.wallet_address = r.wallet_address
    LEFT JOIN transfer_stats t ON c.wallet_address = t.wallet_address
  `;

  const startTime = Date.now();
  await ch.command({ query: createTableQuery });
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`        Created in ${elapsed}s`);

  // Step 3: Verify the new table
  console.log('\nStep 3: Verifying new table...');
  const verifyQuery = await ch.query({
    query: `
      SELECT
        tier,
        count() as wallet_count,
        avg(unresolved_pct) as avg_classifier_unres,
        avg(unresolved_pct_benchmark_compatible) as avg_benchmark_unres
      FROM trader_strict_classifier_v1_tbl_new
      GROUP BY tier
      ORDER BY tier
    `,
    format: 'JSONEachRow'
  });
  const verifyData = await verifyQuery.json<any[]>();

  console.log('\nTier verification:');
  console.log('Tier | Wallets    | Avg Classifier Unres% | Avg Benchmark Unres%');
  console.log('-'.repeat(70));
  for (const r of verifyData) {
    console.log(
      `${r.tier.padEnd(4)} | ` +
      `${String(r.wallet_count).padStart(10)} | ` +
      `${Number(r.avg_classifier_unres).toFixed(2)}%`.padStart(21) + ` | ` +
      `${Number(r.avg_benchmark_unres).toFixed(2)}%`.padStart(20)
    );
  }

  // Check for Tier A leakage (wallets that are Tier A by classifier but >20% by benchmark)
  const leakageQuery = await ch.query({
    query: `
      SELECT count() as leakage_count
      FROM trader_strict_classifier_v1_tbl_new
      WHERE tier = 'A' AND unresolved_pct_benchmark_compatible > 20
    `,
    format: 'JSONEachRow'
  });
  const leakageData = await leakageQuery.json<any[]>();
  const leakageCount = leakageData[0]?.leakage_count || 0;

  console.log(`\nTier A leakage check (classifier A but benchmark unres >20%): ${leakageCount} wallets`);
  if (leakageCount > 0) {
    console.log('  WARNING: Some Tier A wallets have high benchmark-unresolved rates');
  }

  // Step 4: Atomic rename
  console.log('\nStep 4: Atomic rename (swap tables)...');
  await ch.command({
    query: 'DROP TABLE IF EXISTS trader_strict_classifier_v1_tbl_old'
  });

  // Check if old table exists
  const tableExistsQuery = await ch.query({
    query: `SELECT count() as cnt FROM system.tables WHERE database = 'default' AND name = 'trader_strict_classifier_v1_tbl'`,
    format: 'JSONEachRow'
  });
  const tableExists = (await tableExistsQuery.json<any[]>())[0]?.cnt > 0;

  if (tableExists) {
    await ch.command({
      query: 'RENAME TABLE trader_strict_classifier_v1_tbl TO trader_strict_classifier_v1_tbl_old'
    });
  }

  await ch.command({
    query: 'RENAME TABLE trader_strict_classifier_v1_tbl_new TO trader_strict_classifier_v1_tbl'
  });

  if (tableExists) {
    await ch.command({
      query: 'DROP TABLE IF EXISTS trader_strict_classifier_v1_tbl_old'
    });
  }

  console.log('        Done!');

  // Step 5: Final stats
  console.log('\n' + '═'.repeat(80));
  console.log('PROMOTION COMPLETE');
  console.log('═'.repeat(80));

  const finalQuery = await ch.query({
    query: `
      SELECT
        count() as total_wallets,
        countIf(tier = 'A') as tier_a,
        countIf(tier = 'B') as tier_b,
        countIf(tier = 'X') as tier_x,
        countIf(tier = 'A' AND unresolved_pct_benchmark_compatible < 10) as tier_a_low_unres,
        min(created_at) as created_at
      FROM trader_strict_classifier_v1_tbl
    `,
    format: 'JSONEachRow'
  });
  const finalData = (await finalQuery.json<any[]>())[0];

  console.log(`\nTable: trader_strict_classifier_v1_tbl`);
  console.log(`Created: ${finalData.created_at}`);
  console.log(`Total wallets: ${finalData.total_wallets}`);
  console.log(`  Tier A: ${finalData.tier_a}`);
  console.log(`  Tier B: ${finalData.tier_b}`);
  console.log(`  Tier X: ${finalData.tier_x}`);
  console.log(`  Tier A with <10% benchmark unresolved: ${finalData.tier_a_low_unres}`);
}

async function main() {
  try {
    await createMaterializedTable();
  } finally {
    await ch.close();
  }
}

main().catch(console.error);
