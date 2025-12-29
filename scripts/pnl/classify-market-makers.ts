/**
 * Market Maker Classification Script for V8 PnL Engine (SET-BASED VERSION)
 *
 * This script identifies and classifies market makers by their CTF:CLOB ratio.
 * Market makers are wallets that:
 * 1. Have significant CTF minting volume (> $1M)
 * 2. Have CTF:CLOB ratio > 10:1
 *
 * These wallets mint tokens via CTF for inventory, not trading, so they should
 * be excluded from standard PnL calculations.
 *
 * PERFORMANCE: Uses set-based SQL with UNION ALL instead of looping through wallets.
 *
 * Usage: npx tsx scripts/pnl/classify-market-makers.ts
 */

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: 'https://ja9egedrv0.us-central1.gcp.clickhouse.cloud:8443',
  username: 'default',
  password: 'Lbr.jYtw5ikf3',
  database: 'default',
  request_timeout: 600000
});

// Thresholds for market maker classification
const CTF_VOLUME_THRESHOLD = 1_000_000; // $1M minimum CTF volume
const CTF_CLOB_RATIO_THRESHOLD = 10;     // 10:1 CTF:CLOB ratio

async function main() {
  console.log('='.repeat(80));
  console.log('MARKET MAKER CLASSIFICATION SCRIPT (SET-BASED)');
  console.log('='.repeat(80));
  console.log('');
  console.log(`Thresholds:`);
  console.log(`  - CTF volume: > $${(CTF_VOLUME_THRESHOLD/1e6).toFixed(1)}M`);
  console.log(`  - CTF:CLOB ratio: > ${CTF_CLOB_RATIO_THRESHOLD}:1`);
  console.log('');

  // =========================================================================
  // STEP 1: Check current classification status
  // =========================================================================
  console.log('--- Step 1: Current classification status ---');

  const currentStats = await client.query({
    query: `
      SELECT
        wallet_type,
        count() AS count
      FROM pm_wallet_classification
      WHERE is_deleted = 0
      GROUP BY wallet_type
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const currentData = await currentStats.json() as any[];

  if (currentData.length > 0) {
    console.log('Current classifications:');
    for (const row of currentData) {
      console.log(`  ${row.wallet_type}: ${row.count} wallets`);
    }
  } else {
    console.log('  No classifications yet');
  }
  console.log('');

  // =========================================================================
  // STEP 2: Build wallet activity summary (two-phase approach to avoid memory issues)
  // =========================================================================
  console.log('--- Step 2: Computing wallet activity summary ---');

  // Phase 2a: Get high-CTF wallets first (small result set)
  console.log('  Phase 2a: Finding wallets with CTF volume > $1M...');

  const ctfWalletsQuery = `
    SELECT
      wallet,
      SUM(ctf_deposits) AS ctf_deposits_usd,
      SUM(ctf_payouts) AS ctf_payouts_usd,
      SUM(ctf_deposits + ctf_payouts) AS total_ctf_volume
    FROM vw_ctf_ledger
    GROUP BY wallet
    HAVING total_ctf_volume > ${CTF_VOLUME_THRESHOLD}
    ORDER BY total_ctf_volume DESC
  `;

  const ctfResult = await client.query({
    query: ctfWalletsQuery,
    format: 'JSONEachRow'
  });
  const ctfWallets = await ctfResult.json() as any[];
  console.log(`  Found ${ctfWallets.length} wallets with CTF volume > $${(CTF_VOLUME_THRESHOLD/1e6).toFixed(1)}M`);

  // Phase 2b: Get CLOB volumes ONLY for the high-CTF wallets (targeted query)
  // Using batched approach to avoid memory issues
  console.log('  Phase 2b: Computing CLOB volumes for these wallets in batches...');

  const clobVolumeMap = new Map<string, number>();
  const BATCH_SIZE = 50;
  const walletAddresses = ctfWallets.map(w => w.wallet.toLowerCase());

  for (let i = 0; i < walletAddresses.length; i += BATCH_SIZE) {
    const batch = walletAddresses.slice(i, i + BATCH_SIZE);
    const walletList = batch.map(w => `'${w}'`).join(',');

    const clobQuery = `
      SELECT
        lower(trader_wallet) AS wallet,
        SUM(usdc) AS total_clob_volume
      FROM (
        SELECT
          event_id,
          any(trader_wallet) AS trader_wallet,
          any(usdc_amount) / 1000000.0 AS usdc
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND lower(trader_wallet) IN (${walletList})
        GROUP BY event_id
      )
      GROUP BY lower(trader_wallet)
    `;

    try {
      const clobResult = await client.query({
        query: clobQuery,
        format: 'JSONEachRow'
      });
      const clobData = await clobResult.json() as any[];

      for (const row of clobData) {
        clobVolumeMap.set(row.wallet.toLowerCase(), Number(row.total_clob_volume));
      }

      console.log(`    Batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(walletAddresses.length/BATCH_SIZE)}: ${clobData.length} wallets`);
    } catch (e) {
      console.error(`    Batch ${Math.floor(i/BATCH_SIZE) + 1} error:`, (e as Error).message);
    }
  }

  // Merge CTF and CLOB data
  const activityData = ctfWallets.map(w => {
    const clobVolume = clobVolumeMap.get(w.wallet.toLowerCase()) || 0;
    const ctfVolume = Number(w.total_ctf_volume);
    return {
      wallet: w.wallet,
      ctf_deposits_usd: w.ctf_deposits_usd,
      ctf_payouts_usd: w.ctf_payouts_usd,
      total_ctf_volume: ctfVolume,
      total_clob_volume: clobVolume,
      ctf_clob_ratio: clobVolume > 0 ? ctfVolume / clobVolume : 999999
    };
  });

  console.log(`  Found ${activityData.length} wallets with CTF volume > $${(CTF_VOLUME_THRESHOLD/1e6).toFixed(1)}M`);
  console.log('');

  // =========================================================================
  // STEP 3: Identify market makers (CTF:CLOB > threshold)
  // =========================================================================
  console.log('--- Step 3: Identifying market makers ---');

  const marketMakers = activityData.filter(w =>
    Number(w.ctf_clob_ratio) > CTF_CLOB_RATIO_THRESHOLD
  );

  console.log(`Found ${marketMakers.length} wallets with CTF:CLOB ratio > ${CTF_CLOB_RATIO_THRESHOLD}:1`);
  console.log('');

  if (marketMakers.length > 0) {
    console.log('Top 10 market makers by CTF volume:');
    console.log('-'.repeat(100));
    console.log('Wallet                                       | CTF Volume    | CLOB Volume   | Ratio');
    console.log('-'.repeat(100));

    for (const mm of marketMakers.slice(0, 10)) {
      const ctfVol = Number(mm.total_ctf_volume) / 1e6;
      const clobVol = Number(mm.total_clob_volume) / 1e6;
      const ratio = Number(mm.ctf_clob_ratio);

      console.log(
        `${mm.wallet} | $${ctfVol.toFixed(2).padStart(10)}M | $${clobVol.toFixed(2).padStart(10)}M | ${ratio > 1000 ? 'INF' : ratio.toFixed(1)}:1`
      );
    }
    console.log('');
  }

  // =========================================================================
  // STEP 4: Insert market maker classifications (set-based INSERT)
  // =========================================================================
  console.log('--- Step 4: Inserting market maker classifications (set-based) ---');

  // Get wallets already classified as market_maker to skip
  const existingMM = await client.query({
    query: `
      SELECT wallet FROM pm_wallet_classification
      WHERE wallet_type = 'market_maker' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const existingMMData = await existingMM.json() as any[];
  const existingMMSet = new Set(existingMMData.map((r: any) => r.wallet.toLowerCase()));

  // Filter to only new market makers
  const newMarketMakers = marketMakers.filter(mm =>
    !existingMMSet.has(mm.wallet.toLowerCase())
  );

  console.log(`  Already classified: ${existingMMSet.size} wallets`);
  console.log(`  New market makers to insert: ${newMarketMakers.length} wallets`);

  if (newMarketMakers.length > 0) {
    // Build VALUES clause for batch insert
    const values = newMarketMakers.map(mm => {
      const ratio = Number(mm.ctf_clob_ratio);
      const ratioStr = ratio > 1000 ? 'INF' : ratio.toFixed(1);
      return `('${mm.wallet.toLowerCase()}', 'market_maker', 'High CTF:CLOB ratio (${ratioStr}:1)', 'heuristic')`;
    }).join(',\n');

    const insertSQL = `
      INSERT INTO pm_wallet_classification (wallet, wallet_type, label, classification_source)
      VALUES ${values}
    `;

    try {
      await client.command({ query: insertSQL });
      console.log(`  ✓ Inserted ${newMarketMakers.length} market maker classifications`);
    } catch (e) {
      console.error('  Error inserting:', (e as Error).message);
    }
  } else {
    console.log('  No new classifications to insert');
  }
  console.log('');

  // =========================================================================
  // STEP 5: Verify final classification counts
  // =========================================================================
  console.log('--- Step 5: Final classification counts ---');

  const finalStats = await client.query({
    query: `
      SELECT
        wallet_type,
        count() AS count,
        SUM(CASE WHEN classification_source = 'heuristic' THEN 1 ELSE 0 END) AS heuristic_count,
        SUM(CASE WHEN classification_source = 'manual' THEN 1 ELSE 0 END) AS manual_count
      FROM pm_wallet_classification
      WHERE is_deleted = 0
      GROUP BY wallet_type
      ORDER BY count DESC
    `,
    format: 'JSONEachRow'
  });
  const finalData = await finalStats.json() as any[];

  console.log('Classification summary:');
  for (const row of finalData) {
    console.log(`  ${row.wallet_type}: ${row.count} wallets (${row.heuristic_count} heuristic, ${row.manual_count} manual)`);
  }
  console.log('');

  // =========================================================================
  // STEP 6: Create vw_ctf_ledger_user view (excludes infra + market_maker)
  // =========================================================================
  console.log('--- Step 6: Creating vw_ctf_ledger_user view ---');

  const userViewSQL = `
CREATE OR REPLACE VIEW vw_ctf_ledger_user AS
SELECT
  l.*,
  COALESCE(c.wallet_type, 'proxy') AS wallet_type
FROM vw_ctf_ledger l
LEFT JOIN pm_wallet_classification c ON l.wallet = c.wallet AND c.is_deleted = 0
WHERE COALESCE(c.wallet_type, 'proxy') NOT IN ('infra', 'market_maker')
  `;

  try {
    await client.command({ query: userViewSQL });
    console.log('✓ View vw_ctf_ledger_user created successfully');
  } catch (e) {
    console.error('Error creating view:', (e as Error).message);
  }

  // Verify the view
  const userViewStats = await client.query({
    query: `
      SELECT
        count() AS total_entries,
        uniqExact(wallet) AS unique_wallets,
        SUM(ctf_deposits) AS total_deposits,
        SUM(ctf_payouts) AS total_payouts,
        SUM(net_ctf_cash) AS net_cash
      FROM vw_ctf_ledger_user
    `,
    format: 'JSONEachRow'
  });
  const userStats = (await userViewStats.json() as any[])[0];

  console.log('vw_ctf_ledger_user stats:');
  console.log(`  Total entries: ${Number(userStats.total_entries).toLocaleString()}`);
  console.log(`  Unique wallets: ${Number(userStats.unique_wallets).toLocaleString()}`);
  console.log(`  Total CTF deposits: $${(Number(userStats.total_deposits)/1e6).toFixed(2)}M`);
  console.log(`  Total CTF payouts: $${(Number(userStats.total_payouts)/1e6).toFixed(2)}M`);
  console.log(`  Net CTF cash: $${(Number(userStats.net_ctf_cash)/1e6).toFixed(2)}M`);
  console.log('');

  // Compare with unfiltered vw_ctf_ledger
  const fullStats = await client.query({
    query: `
      SELECT
        count() AS total_entries,
        uniqExact(wallet) AS unique_wallets,
        SUM(ctf_deposits) AS total_deposits,
        SUM(ctf_payouts) AS total_payouts,
        SUM(net_ctf_cash) AS net_cash
      FROM vw_ctf_ledger
    `,
    format: 'JSONEachRow'
  });
  const fullData = (await fullStats.json() as any[])[0];

  console.log('Comparison with unfiltered vw_ctf_ledger:');
  console.log(`  Entries removed: ${Number(fullData.total_entries) - Number(userStats.total_entries)}`);
  console.log(`  Wallets removed: ${Number(fullData.unique_wallets) - Number(userStats.unique_wallets)}`);
  console.log(`  CTF deposits removed: $${((Number(fullData.total_deposits) - Number(userStats.total_deposits))/1e6).toFixed(2)}M`);
  console.log(`  CTF payouts removed: $${((Number(fullData.total_payouts) - Number(userStats.total_payouts))/1e6).toFixed(2)}M`);
  console.log('');

  // =========================================================================
  // STEP 7: Update vw_realized_pnl_v8_proxy to use vw_ctf_ledger_user
  // =========================================================================
  console.log('--- Step 7: Updating vw_realized_pnl_v8_proxy to use user-only CTF ledger ---');

  const v8ViewSQL = `
CREATE OR REPLACE VIEW vw_realized_pnl_v8_proxy AS
WITH
-- Step 1: Aggregate CTF ledger (user-filtered: excludes infra AND market_maker)
ctf_user_summary AS (
  SELECT
    wallet,
    SUM(ctf_deposits) AS total_ctf_deposits,
    SUM(ctf_payouts) AS total_ctf_payouts,
    SUM(net_ctf_cash) AS net_ctf_cash
  FROM vw_ctf_ledger_user
  GROUP BY wallet
),

-- Step 2: Deduplicate CLOB trades by event_id (per CLAUDE.md requirement)
clob_deduped AS (
  SELECT
    event_id,
    any(trader_wallet) AS trader_wallet,
    any(token_id) AS token_id,
    any(side) AS side,
    any(usdc_amount) / 1000000.0 AS usdc,
    any(token_amount) / 1000000.0 AS tokens
  FROM pm_trader_events_v2
  WHERE is_deleted = 0
  GROUP BY event_id
),

-- Step 3: Aggregate to wallet + token level
wallet_token_clob AS (
  SELECT
    lower(trader_wallet) AS wallet,
    token_id,
    SUM(CASE WHEN side = 'buy' THEN -usdc ELSE usdc END) AS clob_net_cash,
    SUM(CASE WHEN side = 'buy' THEN tokens ELSE -tokens END) AS clob_net_tokens
  FROM clob_deduped
  GROUP BY lower(trader_wallet), token_id
),

-- Step 4: Map tokens to conditions
with_mapping AS (
  SELECT
    c.wallet,
    c.token_id,
    c.clob_net_cash,
    c.clob_net_tokens,
    m.condition_id,
    m.outcome_index
  FROM wallet_token_clob c
  INNER JOIN pm_token_to_condition_map_v3 m ON c.token_id = m.token_id_dec
),

-- Step 5: Join resolution data (using Nullable pattern per CLAUDE.md)
with_resolution AS (
  SELECT
    w.wallet,
    w.token_id,
    w.clob_net_cash,
    w.clob_net_tokens,
    w.condition_id,
    w.outcome_index,
    r.payout_numerators,
    r.resolved_at IS NOT NULL AS is_resolved
  FROM with_mapping w
  LEFT JOIN pm_condition_resolutions r ON lower(w.condition_id) = lower(r.condition_id)
),

-- Step 6: Extract payout price (1-indexed arrays per CLAUDE.md)
with_payout AS (
  SELECT
    wallet,
    token_id,
    condition_id,
    outcome_index,
    clob_net_cash,
    clob_net_tokens,
    is_resolved,
    CASE
      WHEN is_resolved AND payout_numerators IS NOT NULL
      THEN arrayElement(
        JSONExtract(payout_numerators, 'Array(Float64)'),
        toUInt32(outcome_index + 1)
      )
      ELSE 0.0
    END AS payout_price
  FROM with_resolution
),

-- Step 7: Calculate per-outcome CLOB PnL
clob_pnl AS (
  SELECT
    wallet,
    condition_id,
    outcome_index,
    clob_net_cash,
    clob_net_tokens,
    payout_price,
    is_resolved,
    CASE
      WHEN is_resolved
      THEN clob_net_cash + (clob_net_tokens * payout_price)
      ELSE NULL
    END AS realized_pnl_clob
  FROM with_payout
)

-- Final: Aggregate to wallet level with user-filtered CTF
SELECT
  c.wallet AS wallet,
  SUM(c.clob_net_cash) AS total_clob_net_cash,
  COALESCE(ctf.total_ctf_deposits, 0) AS total_ctf_deposits,
  COALESCE(ctf.total_ctf_payouts, 0) AS total_ctf_payouts,
  COALESCE(ctf.net_ctf_cash, 0) AS net_ctf_cash,
  SUM(CASE WHEN c.is_resolved THEN c.realized_pnl_clob ELSE 0 END) AS realized_pnl_clob,
  -- V8 formula: CLOB PnL + user-filtered CTF net cash
  SUM(CASE WHEN c.is_resolved THEN c.realized_pnl_clob ELSE 0 END) + COALESCE(ctf.net_ctf_cash, 0) AS realized_pnl_v8,
  countIf(c.is_resolved = 1) AS resolved_outcomes,
  countIf(c.is_resolved = 0) AS unresolved_outcomes
FROM clob_pnl c
LEFT JOIN ctf_user_summary ctf ON c.wallet = ctf.wallet
GROUP BY c.wallet, ctf.total_ctf_deposits, ctf.total_ctf_payouts, ctf.net_ctf_cash
  `;

  try {
    await client.command({ query: v8ViewSQL });
    console.log('✓ View vw_realized_pnl_v8_proxy updated to use vw_ctf_ledger_user');
  } catch (e) {
    console.error('Error updating V8 view:', (e as Error).message);
  }

  // Quick stats on V8 view
  const v8Stats = await client.query({
    query: `
      SELECT
        count() AS total_wallets,
        SUM(total_ctf_deposits) AS total_deposits,
        SUM(total_ctf_payouts) AS total_payouts,
        SUM(realized_pnl_clob) AS total_clob_pnl,
        SUM(realized_pnl_v8) AS total_v8_pnl
      FROM vw_realized_pnl_v8_proxy
    `,
    format: 'JSONEachRow'
  });
  const v8StatsData = (await v8Stats.json() as any[])[0];

  console.log('');
  console.log('vw_realized_pnl_v8_proxy stats:');
  console.log(`  Total wallets: ${Number(v8StatsData.total_wallets).toLocaleString()}`);
  console.log(`  Total CTF deposits: $${(Number(v8StatsData.total_deposits)/1e6).toFixed(2)}M`);
  console.log(`  Total CTF payouts: $${(Number(v8StatsData.total_payouts)/1e6).toFixed(2)}M`);
  console.log(`  Total CLOB PnL: $${(Number(v8StatsData.total_clob_pnl)/1e6).toFixed(2)}M`);
  console.log(`  Total V8 PnL: $${(Number(v8StatsData.total_v8_pnl)/1e6).toFixed(2)}M`);
  console.log('');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('='.repeat(80));
  console.log('MARKET MAKER CLASSIFICATION COMPLETE');
  console.log('='.repeat(80));
  console.log('');
  console.log('Created/Updated:');
  console.log('  1. pm_wallet_classification - Added market_maker entries');
  console.log('  2. vw_ctf_ledger_user - Excludes infra AND market_maker wallets');
  console.log('  3. vw_realized_pnl_v8_proxy - Uses user-only CTF ledger');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run validation against API for trader-like wallets');
  console.log('  2. Document findings in PNL_V8_PROXY_PNL_NOTES.md');

  await client.close();
}

main().catch(console.error);
