/**
 * Build Dual PnL System
 *
 * Creates:
 * 1. pm_wallet_profiles_v1 - wallet classification (trader/market_maker/mixed)
 * 2. vw_wallet_pnl_trading_v1 - CLOB-only position-based PnL
 * 3. vw_wallet_pnl_cashflow_v1 - CLOB + PayoutRedemption cash-flow PnL
 * 4. vw_wallet_pnl_comparison_v1 - benchmark comparison view
 */

import { clickhouse } from '../../lib/clickhouse/client';

async function main() {
  console.log('='.repeat(100));
  console.log('BUILDING DUAL PNL SYSTEM');
  console.log('='.repeat(100));
  console.log('');

  // ========================================
  // 1. Create pm_wallet_profiles_v1
  // ========================================
  console.log('STEP 1: Creating pm_wallet_profiles_v1 table...');

  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_wallet_profiles_v1' });

  const createProfilesTable = `
    CREATE TABLE pm_wallet_profiles_v1 (
      wallet_address String,
      clob_usdc_abs Float64,
      mm_usdc_abs Float64,
      mm_ratio Float64,
      profile_type String,
      clob_trade_count UInt64,
      mm_event_count UInt64,
      computed_at DateTime DEFAULT now()
    ) ENGINE = ReplacingMergeTree(computed_at)
    ORDER BY wallet_address
  `;
  await clickhouse.command({ query: createProfilesTable });
  console.log('  Table created.');

  // Populate with all wallets from unified ledger
  console.log('  Populating wallet profiles...');

  const populateProfiles = `
    INSERT INTO pm_wallet_profiles_v1
    SELECT
      wallet_address,
      clob_usdc_abs,
      mm_usdc_abs,
      if(clob_usdc_abs + mm_usdc_abs > 0, mm_usdc_abs / (clob_usdc_abs + mm_usdc_abs), 0) as mm_ratio,
      multiIf(
        mm_usdc_abs / (clob_usdc_abs + mm_usdc_abs + 0.0001) > 0.5, 'market_maker',
        mm_usdc_abs / (clob_usdc_abs + mm_usdc_abs + 0.0001) < 0.2, 'trader',
        'mixed'
      ) as profile_type,
      clob_count as clob_trade_count,
      mm_count as mm_event_count,
      now() as computed_at
    FROM (
      SELECT
        wallet_addr as wallet_address,
        sumIf(abs(usdc_delta), source_type = 'CLOB') as clob_usdc_abs,
        sumIf(abs(usdc_delta), source_type IN ('PositionsMerge', 'PositionSplit')) as mm_usdc_abs,
        countIf(source_type = 'CLOB') as clob_count,
        countIf(source_type IN ('PositionsMerge', 'PositionSplit')) as mm_count
      FROM (
        SELECT lower(wallet_address) as wallet_addr, source_type, usdc_delta
        FROM pm_unified_ledger_v9
      )
      GROUP BY wallet_addr
      HAVING clob_usdc_abs + mm_usdc_abs > 0
    )
  `;
  await clickhouse.command({ query: populateProfiles });

  // Get profile distribution
  const profileDist = await clickhouse.query({
    query: `
      SELECT profile_type, count() as cnt, sum(clob_usdc_abs + mm_usdc_abs) as total_volume
      FROM pm_wallet_profiles_v1
      GROUP BY profile_type
      ORDER BY cnt DESC
    `,
    format: 'JSONEachRow'
  });
  const profiles = await profileDist.json() as any[];
  console.log('  Profile distribution:');
  for (const p of profiles) {
    console.log(`    ${p.profile_type.padEnd(15)}: ${Number(p.cnt).toLocaleString().padStart(10)} wallets, $${Number(p.total_volume).toLocaleString()} volume`);
  }
  console.log('');

  // ========================================
  // 2. Create vw_wallet_pnl_trading_v1
  // ========================================
  console.log('STEP 2: Creating vw_wallet_pnl_trading_v1 (CLOB position-based)...');

  await clickhouse.command({ query: 'DROP VIEW IF EXISTS vw_wallet_pnl_trading_v1' });

  const createTradingView = `
    CREATE VIEW vw_wallet_pnl_trading_v1 AS
    SELECT
      wallet_address,
      sum(position_pnl) as pnl_trading,
      count() as position_count,
      countIf(payout_norm IS NOT NULL) as resolved_positions,
      countIf(payout_norm IS NULL) as unresolved_positions
    FROM (
      SELECT
        lower(wallet_address) as wallet_address,
        canonical_condition_id,
        outcome_index,
        sum(usdc_delta) as cash_flow,
        sum(token_delta) as final_tokens,
        any(payout_norm) as payout_norm,
        -- Position PnL: cash_flow + final_tokens * resolution_price
        -- For unresolved: resolution_price = 0 (conservative)
        sum(usdc_delta) + sum(token_delta) * coalesce(any(payout_norm), 0) as position_pnl
      FROM pm_unified_ledger_v9
      WHERE source_type = 'CLOB'
        AND canonical_condition_id IS NOT NULL
        AND canonical_condition_id != ''
      GROUP BY lower(wallet_address), canonical_condition_id, outcome_index
    )
    GROUP BY wallet_address
  `;
  await clickhouse.command({ query: createTradingView });
  console.log('  View created.');
  console.log('');

  // ========================================
  // 3. Create vw_wallet_pnl_cashflow_v1
  // ========================================
  console.log('STEP 3: Creating vw_wallet_pnl_cashflow_v1 (CLOB + PayoutRedemption)...');

  await clickhouse.command({ query: 'DROP VIEW IF EXISTS vw_wallet_pnl_cashflow_v1' });

  // Cash-flow PnL: sum of usdc_delta from CLOB + PayoutRedemption
  // Excludes PositionsMerge/Split as they are inventory-neutral
  const createCashflowView = `
    CREATE VIEW vw_wallet_pnl_cashflow_v1 AS
    SELECT
      lower(wallet_address) as wallet_address,
      sumIf(usdc_delta, source_type = 'CLOB') as pnl_clob_cash,
      sumIf(usdc_delta, source_type = 'PayoutRedemption') as pnl_redemption,
      sumIf(usdc_delta, source_type IN ('CLOB', 'PayoutRedemption')) as pnl_cashflow,
      countIf(source_type = 'CLOB') as clob_events,
      countIf(source_type = 'PayoutRedemption') as redemption_events
    FROM pm_unified_ledger_v9
    WHERE source_type IN ('CLOB', 'PayoutRedemption')
    GROUP BY lower(wallet_address)
  `;
  await clickhouse.command({ query: createCashflowView });
  console.log('  View created.');
  console.log('');

  // ========================================
  // 4. Create vw_wallet_pnl_comparison_v1
  // ========================================
  console.log('STEP 4: Creating vw_wallet_pnl_comparison_v1...');

  await clickhouse.command({ query: 'DROP VIEW IF EXISTS vw_wallet_pnl_comparison_v1' });

  const createComparisonView = `
    CREATE VIEW vw_wallet_pnl_comparison_v1 AS
    SELECT
      p.wallet_address,
      p.profile_type,
      p.mm_ratio,
      t.pnl_trading,
      c.pnl_cashflow,
      c.pnl_clob_cash,
      c.pnl_redemption,
      t.position_count,
      t.resolved_positions,
      t.unresolved_positions,
      c.clob_events,
      c.redemption_events,
      -- Difference between two methods
      c.pnl_cashflow - t.pnl_trading as pnl_diff,
      -- For market-makers, cashflow should be more accurate
      -- For traders, trading PnL should be more accurate
      if(p.profile_type = 'market_maker', c.pnl_cashflow, t.pnl_trading) as pnl_recommended
    FROM pm_wallet_profiles_v1 p
    LEFT JOIN vw_wallet_pnl_trading_v1 t ON p.wallet_address = t.wallet_address
    LEFT JOIN vw_wallet_pnl_cashflow_v1 c ON p.wallet_address = c.wallet_address
  `;
  await clickhouse.command({ query: createComparisonView });
  console.log('  View created.');
  console.log('');

  // ========================================
  // 5. Verify with sample wallets
  // ========================================
  console.log('STEP 5: Verifying with sample wallets...');

  const sampleQuery = `
    SELECT
      wallet_address,
      profile_type,
      round(mm_ratio, 3) as mm_ratio,
      round(pnl_trading, 2) as pnl_trading,
      round(pnl_cashflow, 2) as pnl_cashflow,
      round(pnl_diff, 2) as pnl_diff,
      round(pnl_recommended, 2) as pnl_recommended,
      position_count,
      resolved_positions
    FROM vw_wallet_pnl_comparison_v1
    WHERE pnl_trading IS NOT NULL AND pnl_cashflow IS NOT NULL
    ORDER BY abs(pnl_trading) DESC
    LIMIT 20
  `;

  const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
  const samples = await sampleResult.json() as any[];

  console.log('');
  console.log('Top 20 wallets by trading PnL:');
  console.log('Wallet (first 12)   | Profile      | MM%   | Trading PnL     | Cashflow PnL    | Diff           | Recommended');
  console.log('-'.repeat(120));

  for (const s of samples) {
    const wallet = (s.wallet_address || '').substring(0, 12).padEnd(12);
    const profile = (s.profile_type || '').padEnd(12);
    const mmRatio = (Number(s.mm_ratio) * 100).toFixed(1).padStart(5) + '%';
    const trading = ('$' + Number(s.pnl_trading).toLocaleString()).padStart(15);
    const cashflow = ('$' + Number(s.pnl_cashflow).toLocaleString()).padStart(15);
    const diff = ('$' + Number(s.pnl_diff).toLocaleString()).padStart(14);
    const recommended = ('$' + Number(s.pnl_recommended).toLocaleString()).padStart(15);

    console.log(`${wallet} | ${profile} | ${mmRatio} | ${trading} | ${cashflow} | ${diff} | ${recommended}`);
  }

  console.log('');
  console.log('='.repeat(100));
  console.log('DUAL PNL SYSTEM BUILD COMPLETE');
  console.log('='.repeat(100));
  console.log('');
  console.log('Created:');
  console.log('  - pm_wallet_profiles_v1: Wallet classification (trader/market_maker/mixed)');
  console.log('  - vw_wallet_pnl_trading_v1: CLOB-only position-based PnL');
  console.log('  - vw_wallet_pnl_cashflow_v1: CLOB + PayoutRedemption cash-flow PnL');
  console.log('  - vw_wallet_pnl_comparison_v1: Combined comparison view');
  console.log('');
  console.log('Usage:');
  console.log('  SELECT * FROM vw_wallet_pnl_comparison_v1 WHERE wallet_address = \'0x...\'');
}

main().catch(console.error);
