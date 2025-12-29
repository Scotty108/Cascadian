#!/usr/bin/env npx tsx
/**
 * TRADER-STRICT CLASSIFIER
 * =========================
 *
 * Creates a DB-native classifier view that computes per-wallet features
 * for Tier A/B/Excluded classification.
 *
 * Features computed:
 * - clob_event_count, clob_usdc_volume
 * - amm_event_count, amm_usdc_volume
 * - transfer_event_count, transfer_dominance_ratio
 * - positions_merge_count, positions_split_count
 * - unresolved_pct
 * - maker_share_pct, taker_share_pct
 * - mm_likelihood_score
 *
 * Tier Rules:
 * - Tier A: CLOB-dominant, AMM near-zero, transfer-light, low merge/split, low unresolved, non-MM
 * - Tier B: Some complexity but still mostly CLOB
 * - Excluded: Heavy AMM, heavy transfers, heavy CTF mechanics, obvious MM
 *
 * Terminal: Terminal 2 (Scaling & Hardening)
 * Date: 2025-12-09
 */

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 600000, // 10 minutes for large queries
});

// ============================================================================
// Step 1: Create the classifier view
// ============================================================================

async function createClassifierView() {
  console.log('Creating trader_strict_classifier_v1 view...');

  // Drop if exists
  await ch.command({
    query: 'DROP VIEW IF EXISTS trader_strict_classifier_v1'
  });

  // Create the classifier view
  // This aggregates multiple data sources per wallet
  const createViewQuery = `
    CREATE VIEW trader_strict_classifier_v1 AS
    WITH
      -- CLOB stats from unified ledger
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

      -- Derived metrics
      if(c.clob_event_count > 0,
         c.clob_unresolved_count * 100.0 / c.clob_event_count,
         0) as unresolved_pct,

      if(coalesce(r.maker_count, 0) + coalesce(r.taker_count, 0) > 0,
         coalesce(r.maker_count, 0) * 100.0 / (coalesce(r.maker_count, 0) + coalesce(r.taker_count, 0)),
         0) as maker_share_pct,

      if(c.clob_usdc_volume + coalesce(amm.amm_usdc_volume, 0) > 0,
         coalesce(amm.amm_usdc_volume, 0) * 100.0 / (c.clob_usdc_volume + coalesce(amm.amm_usdc_volume, 0)),
         0) as amm_dominance_pct,

      if(c.clob_event_count > 0,
         coalesce(t.transfer_count, 0) * 100.0 / c.clob_event_count,
         0) as transfer_dominance_pct,

      -- MM likelihood: high event count + high maker share + many unique conditions
      if(c.clob_event_count > 100000 AND coalesce(r.maker_count, 0) * 100.0 / (coalesce(r.maker_count, 0) + coalesce(r.taker_count, 0) + 1) > 70,
         1, 0) as mm_likelihood_flag,

      -- Tier classification
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
      ) as tier

    FROM clob_stats c
    LEFT JOIN ctf_stats ctf ON c.wallet_address = ctf.wallet_address
    LEFT JOIN amm_stats amm ON c.wallet_address = amm.wallet_address
    LEFT JOIN role_stats r ON c.wallet_address = r.wallet_address
    LEFT JOIN transfer_stats t ON c.wallet_address = t.wallet_address
  `;

  await ch.command({ query: createViewQuery });
  console.log('View created successfully.');

  // Verify the view works
  const testQuery = await ch.query({
    query: 'SELECT tier, count() as cnt FROM trader_strict_classifier_v1 GROUP BY tier ORDER BY tier',
    format: 'JSONEachRow'
  });
  const testData = await testQuery.json<any[]>();
  console.log('\nTier distribution:');
  testData.forEach(r => console.log(`  Tier ${r.tier}: ${r.cnt} wallets`));

  return testData;
}

// ============================================================================
// Step 2: Generate cohort files
// ============================================================================

async function generateCohortFiles() {
  console.log('\n' + '='.repeat(80));
  console.log('GENERATING COHORT FILES');
  console.log('='.repeat(80));

  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');

  // Tier A - ordered by CLOB volume descending
  console.log('\nFetching Tier A wallets...');
  const tierAQuery = await ch.query({
    query: `
      SELECT
        wallet_address,
        clob_event_count,
        clob_usdc_volume,
        unresolved_pct,
        maker_share_pct,
        amm_event_count,
        split_count,
        merge_count,
        transfer_count,
        mm_likelihood_flag
      FROM trader_strict_classifier_v1
      WHERE tier = 'A'
      ORDER BY clob_usdc_volume DESC
      LIMIT 10000
    `,
    format: 'JSONEachRow'
  });
  const tierAData = await tierAQuery.json<any[]>();

  const tierAOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      tier: 'A',
      description: 'CLOB-dominant, AMM-free, no splits/merges, transfer-light, low unresolved, non-MM',
      criteria: {
        amm_event_count: '= 0',
        split_count: '= 0',
        merge_count: '= 0',
        transfer_dominance_pct: '< 5%',
        unresolved_pct: '< 20%',
        clob_event_count: '>= 50',
        mm_likelihood_flag: '= 0'
      },
      total_count: tierAData.length
    },
    wallets: tierAData.map(w => ({
      wallet_address: w.wallet_address,
      clob_event_count: Number(w.clob_event_count),
      clob_usdc_volume: Number(w.clob_usdc_volume),
      unresolved_pct: Number(w.unresolved_pct),
      maker_share_pct: Number(w.maker_share_pct),
      amm_event_count: Number(w.amm_event_count),
      split_count: Number(w.split_count),
      merge_count: Number(w.merge_count),
      transfer_count: Number(w.transfer_count),
      mm_likelihood_flag: Number(w.mm_likelihood_flag)
    }))
  };

  const tierAPath = `tmp/trader_strict_tierA_${dateStr}.json`;
  fs.writeFileSync(tierAPath, JSON.stringify(tierAOutput, null, 2));
  console.log(`  Saved ${tierAData.length} Tier A wallets to ${tierAPath}`);

  // Tier B
  console.log('\nFetching Tier B wallets...');
  const tierBQuery = await ch.query({
    query: `
      SELECT
        wallet_address,
        clob_event_count,
        clob_usdc_volume,
        unresolved_pct,
        maker_share_pct,
        amm_event_count,
        amm_dominance_pct,
        split_count,
        merge_count,
        transfer_count
      FROM trader_strict_classifier_v1
      WHERE tier = 'B'
      ORDER BY clob_usdc_volume DESC
      LIMIT 5000
    `,
    format: 'JSONEachRow'
  });
  const tierBData = await tierBQuery.json<any[]>();

  const tierBOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      tier: 'B',
      description: 'CLOB-majority with some AMM or CTF mechanics',
      criteria: {
        amm_dominance_pct: '< 10%',
        ctf_dominance_pct: '< 10%',
        clob_event_count: '>= 20'
      },
      total_count: tierBData.length
    },
    wallets: tierBData.map(w => ({
      wallet_address: w.wallet_address,
      clob_event_count: Number(w.clob_event_count),
      clob_usdc_volume: Number(w.clob_usdc_volume),
      unresolved_pct: Number(w.unresolved_pct),
      maker_share_pct: Number(w.maker_share_pct),
      amm_event_count: Number(w.amm_event_count),
      amm_dominance_pct: Number(w.amm_dominance_pct),
      split_count: Number(w.split_count),
      merge_count: Number(w.merge_count),
      transfer_count: Number(w.transfer_count)
    }))
  };

  const tierBPath = `tmp/trader_strict_tierB_${dateStr}.json`;
  fs.writeFileSync(tierBPath, JSON.stringify(tierBOutput, null, 2));
  console.log(`  Saved ${tierBData.length} Tier B wallets to ${tierBPath}`);

  // Excluded (sample only - too large to export all)
  console.log('\nFetching sample of Excluded wallets...');
  const excludedQuery = await ch.query({
    query: `
      SELECT
        wallet_address,
        clob_event_count,
        clob_usdc_volume,
        amm_event_count,
        amm_dominance_pct,
        split_count,
        merge_count,
        transfer_count,
        mm_likelihood_flag
      FROM trader_strict_classifier_v1
      WHERE tier = 'X'
      ORDER BY clob_usdc_volume DESC
      LIMIT 1000
    `,
    format: 'JSONEachRow'
  });
  const excludedData = await excludedQuery.json<any[]>();

  const excludedOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      tier: 'Excluded',
      description: 'Heavy AMM, heavy transfers, heavy CTF mechanics, or obvious MM',
      note: 'This is a sample of top 1000 by CLOB volume',
      total_count: excludedData.length
    },
    wallets: excludedData.map(w => ({
      wallet_address: w.wallet_address,
      clob_event_count: Number(w.clob_event_count),
      clob_usdc_volume: Number(w.clob_usdc_volume),
      amm_event_count: Number(w.amm_event_count),
      amm_dominance_pct: Number(w.amm_dominance_pct),
      split_count: Number(w.split_count),
      merge_count: Number(w.merge_count),
      transfer_count: Number(w.transfer_count),
      mm_likelihood_flag: Number(w.mm_likelihood_flag)
    }))
  };

  const excludedPath = `tmp/trader_strict_excluded_${dateStr}.json`;
  fs.writeFileSync(excludedPath, JSON.stringify(excludedOutput, null, 2));
  console.log(`  Saved ${excludedData.length} Excluded wallets (sample) to ${excludedPath}`);

  return { tierAPath, tierBPath, excludedPath, tierACount: tierAData.length, tierBCount: tierBData.length };
}

// ============================================================================
// Step 3: Summary stats
// ============================================================================

async function printSummaryStats() {
  console.log('\n' + '='.repeat(80));
  console.log('CLASSIFIER SUMMARY STATISTICS');
  console.log('='.repeat(80));

  const statsQuery = await ch.query({
    query: `
      SELECT
        tier,
        count() as wallet_count,
        sum(clob_event_count) as total_clob_events,
        sum(clob_usdc_volume) as total_clob_volume,
        avg(unresolved_pct) as avg_unresolved_pct,
        avg(maker_share_pct) as avg_maker_share_pct,
        sum(amm_event_count) as total_amm_events,
        sum(split_count) as total_splits,
        sum(merge_count) as total_merges,
        sum(mm_likelihood_flag) as mm_flagged_count
      FROM trader_strict_classifier_v1
      GROUP BY tier
      ORDER BY tier
    `,
    format: 'JSONEachRow'
  });
  const statsData = await statsQuery.json<any[]>();

  console.log('\nPer-Tier Statistics:');
  console.log('-'.repeat(120));
  console.log('Tier | Wallets    | CLOB Events   | CLOB Volume       | Avg Unres% | Avg Maker% | AMM Events | Splits     | Merges     | MM Flagged');
  console.log('-'.repeat(120));

  for (const s of statsData) {
    console.log(
      `${s.tier.padEnd(4)} | ` +
      `${String(s.wallet_count).padStart(10)} | ` +
      `${String(s.total_clob_events).padStart(13)} | ` +
      `$${(Number(s.total_clob_volume) / 1e6).toFixed(1)}M`.padStart(17) + ` | ` +
      `${Number(s.avg_unresolved_pct).toFixed(1)}%`.padStart(10) + ` | ` +
      `${Number(s.avg_maker_share_pct).toFixed(1)}%`.padStart(10) + ` | ` +
      `${String(s.total_amm_events).padStart(10)} | ` +
      `${String(s.total_splits).padStart(10)} | ` +
      `${String(s.total_merges).padStart(10)} | ` +
      `${String(s.mm_flagged_count).padStart(10)}`
    );
  }

  // Tier A low-unresolved subset (for gold set)
  const goldCandidatesQuery = await ch.query({
    query: `
      SELECT count() as cnt
      FROM trader_strict_classifier_v1
      WHERE tier = 'A' AND unresolved_pct < 10
    `,
    format: 'JSONEachRow'
  });
  const goldData = await goldCandidatesQuery.json<any[]>();
  console.log(`\nTier A with <10% unresolved (gold candidates): ${goldData[0]?.cnt}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('TRADER-STRICT CLASSIFIER');
  console.log('='.repeat(80));
  console.log('Terminal 2: Creating DB-native Tier A cohort');
  console.log('');

  try {
    // Step 1: Create the view
    await createClassifierView();

    // Step 2: Print summary stats
    await printSummaryStats();

    // Step 3: Generate cohort files
    const files = await generateCohortFiles();

    console.log('\n' + '='.repeat(80));
    console.log('COMPLETE');
    console.log('='.repeat(80));
    console.log(`\nGenerated files:`);
    console.log(`  ${files.tierAPath} (${files.tierACount} wallets)`);
    console.log(`  ${files.tierBPath} (${files.tierBCount} wallets)`);
    console.log(`  ${files.excludedPath} (sample)`);

  } finally {
    await ch.close();
  }
}

main().catch(console.error);
