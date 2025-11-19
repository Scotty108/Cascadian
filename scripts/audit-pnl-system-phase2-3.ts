import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';
import fs from 'fs';

async function phase2And3() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE 2: PAYOUT COVERAGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 1. Overall payout coverage
  console.log('1. OVERALL PAYOUT COVERAGE\n');

  const coverageQuery = `
    WITH market_stats AS (
      SELECT
        condition_id_norm_v3 AS cid,
        count() AS trades,
        sum(usd_value) AS volume
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE condition_id_norm_v3 != ''
      GROUP BY cid
    )
    SELECT
      count() AS total_markets_traded,
      countIf(r.condition_id_norm IS NOT NULL) AS markets_with_payouts,
      sum(volume) AS total_volume,
      sumIf(volume, r.condition_id_norm IS NOT NULL) AS volume_with_payouts,
      (markets_with_payouts * 100.0 / total_markets_traded) AS pct_markets_covered,
      (volume_with_payouts * 100.0 / total_volume) AS pct_volume_covered
    FROM market_stats m
    LEFT JOIN market_resolutions_final r ON m.cid = r.condition_id_norm
  `;

  const coverageResult = await clickhouse.query({ query: coverageQuery, format: 'JSONEachRow' });
  const coverageData = await coverageResult.json();

  if (coverageData.length > 0) {
    const c = coverageData[0];
    console.log(`  Total markets traded: ${Number(c.total_markets_traded).toLocaleString()}`);
    console.log(`  Markets with payouts: ${Number(c.markets_with_payouts).toLocaleString()}`);
    console.log(`  Coverage rate: ${Number(c.pct_markets_covered).toFixed(2)}%\n`);
    console.log(`  Total volume: $${Number(c.total_volume).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    console.log(`  Volume with payouts: $${Number(c.volume_with_payouts).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
    console.log(`  Volume coverage: ${Number(c.pct_volume_covered).toFixed(2)}%\n`);
  }

  // 2. Coverage by wallet volume tier
  console.log('2. PAYOUT COVERAGE BY WALLET TIER\n');

  const tierCoverageQuery = `
    WITH wallet_volume AS (
      SELECT
        wallet_canonical AS wallet,
        sum(usd_value) AS total_volume
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE condition_id_norm_v3 != ''
      GROUP BY wallet
    ),
    wallet_tiers AS (
      SELECT
        wallet,
        total_volume,
        CASE
          WHEN total_volume >= 100000 THEN 'Tier 1: $100K+'
          WHEN total_volume >= 10000 THEN 'Tier 2: $10K-100K'
          WHEN total_volume >= 1000 THEN 'Tier 3: $1K-10K'
          ELSE 'Tier 4: <$1K'
        END AS tier
      FROM wallet_volume
    ),
    wallet_market_coverage AS (
      SELECT
        wt.wallet,
        wt.tier,
        count(DISTINCT t.condition_id_norm_v3) AS markets_traded,
        countIf(r.condition_id_norm IS NOT NULL) AS markets_with_payouts
      FROM wallet_tiers wt
      INNER JOIN vw_trades_canonical_with_canonical_wallet t ON wt.wallet = t.wallet_canonical
      LEFT JOIN market_resolutions_final r ON t.condition_id_norm_v3 = r.condition_id_norm
      WHERE t.condition_id_norm_v3 != ''
      GROUP BY wt.wallet, wt.tier
    )
    SELECT
      tier,
      count() AS wallets_in_tier,
      avg(markets_traded) AS avg_markets_per_wallet,
      avg(markets_with_payouts) AS avg_markets_with_payouts,
      avg(markets_with_payouts * 100.0 / markets_traded) AS avg_coverage_pct
    FROM wallet_market_coverage
    GROUP BY tier
    ORDER BY tier
  `;

  const tierResult = await clickhouse.query({ query: tierCoverageQuery, format: 'JSONEachRow' });
  const tierData = await tierResult.json();

  tierData.forEach(t => {
    console.log(`  ${t.tier}:`);
    console.log(`    Wallets: ${Number(t.wallets_in_tier).toLocaleString()}`);
    console.log(`    Avg markets traded: ${Number(t.avg_markets_per_wallet).toFixed(1)}`);
    console.log(`    Avg with payouts: ${Number(t.avg_markets_with_payouts).toFixed(1)}`);
    console.log(`    Avg coverage: ${Number(t.avg_coverage_pct).toFixed(1)}%\n`);
  });

  // 3. Check for specific wallets (top 10 by volume)
  console.log('3. TOP 10 WALLETS BY VOLUME - PAYOUT COVERAGE\n');

  const top10Query = `
    WITH wallet_summary AS (
      SELECT
        wallet_canonical AS wallet,
        count() AS trades,
        sum(usd_value) AS volume,
        uniq(condition_id_norm_v3) AS markets_traded
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE condition_id_norm_v3 != ''
      GROUP BY wallet
      ORDER BY volume DESC
      LIMIT 10
    )
    SELECT
      substring(w.wallet, 1, 16) || '...' AS wallet_short,
      w.trades,
      w.volume,
      w.markets_traded,
      countIf(r.condition_id_norm IS NOT NULL) AS markets_with_payouts,
      (countIf(r.condition_id_norm IS NOT NULL) * 100.0 / w.markets_traded) AS coverage_pct
    FROM wallet_summary w
    LEFT JOIN vw_trades_canonical_with_canonical_wallet t ON w.wallet = t.wallet_canonical
    LEFT JOIN market_resolutions_final r ON t.condition_id_norm_v3 = r.condition_id_norm
    WHERE t.condition_id_norm_v3 != ''
    GROUP BY w.wallet, w.trades, w.volume, w.markets_traded
  `;

  const top10Result = await clickhouse.query({ query: top10Query, format: 'JSONEachRow' });
  const top10Data = await top10Result.json();

  top10Data.forEach((w, i) => {
    console.log(`  ${i + 1}. ${w.wallet_short}`);
    console.log(`     Volume: $${Number(w.volume).toLocaleString('en-US', { maximumFractionDigits: 2 })} | Trades: ${w.trades}`);
    console.log(`     Markets: ${w.markets_traded} | With payouts: ${w.markets_with_payouts} (${Number(w.coverage_pct).toFixed(1)}%)\n`);
  });

  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE 3: MULTI-WALLET REALITY CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Pick 5 "normal" wallets from medium volume tier
  console.log('1. SELECTING SAMPLE WALLETS\n');

  const sampleWalletsQuery = `
    WITH wallet_stats AS (
      SELECT
        wallet_canonical AS wallet,
        count() AS trades,
        sum(usd_value) AS volume,
        uniq(condition_id_norm_v3) AS markets
      FROM vw_trades_canonical_with_canonical_wallet
      WHERE condition_id_norm_v3 != ''
      GROUP BY wallet
    )
    SELECT wallet
    FROM wallet_stats
    WHERE volume BETWEEN 1000 AND 50000
      AND trades BETWEEN 20 AND 200
      AND markets >= 10
    ORDER BY rand()
    LIMIT 5
  `;

  const sampleResult = await clickhouse.query({ query: sampleWalletsQuery, format: 'JSONEachRow' });
  const sampleWallets = await sampleResult.json();

  console.log(`Selected ${sampleWallets.length} sample wallets:\n`);

  // Calculate PnL for each sample wallet
  const PAYOUT_SOURCE = 'market_resolutions_final';

  for (let i = 0; i < sampleWallets.length; i++) {
    const wallet = sampleWallets[i].wallet;
    console.log(`Wallet ${i + 1}: ${wallet.substring(0, 16)}...\n`);

    const pnlQuery = `
      WITH trades_by_market AS (
        SELECT
          condition_id_norm_v3 AS cid,
          outcome_index_v3 AS outcome_idx,
          sumIf(toFloat64(shares), trade_direction = 'BUY') AS shares_buy,
          sumIf(toFloat64(shares), trade_direction = 'SELL') AS shares_sell,
          shares_buy - shares_sell AS net_shares,
          sumIf(toFloat64(usd_value), trade_direction = 'BUY') AS cost_buy,
          sumIf(toFloat64(usd_value), trade_direction = 'SELL') AS proceeds_sell,
          count() AS trades
        FROM vw_trades_canonical_with_canonical_wallet
        WHERE wallet_canonical = '${wallet}'
          AND condition_id_norm_v3 != ''
        GROUP BY cid, outcome_idx
      ),
      with_resolutions AS (
        SELECT
          t.*,
          r.winning_outcome,
          COALESCE(
            toFloat64(r.payout_numerators[t.outcome_idx + 1]) / toFloat64(r.payout_denominator),
            0
          ) AS payout_per_share,
          t.net_shares * payout_per_share AS settlement_value
        FROM trades_by_market t
        LEFT JOIN ${PAYOUT_SOURCE} r ON t.cid = r.condition_id_norm
      ),
      resolved_only AS (
        SELECT * FROM with_resolutions WHERE winning_outcome IS NOT NULL
      ),
      unresolved AS (
        SELECT * FROM with_resolutions WHERE winning_outcome IS NULL
      )
      SELECT
        (SELECT COALESCE(sum(proceeds_sell - cost_buy + settlement_value), 0) FROM resolved_only) AS realized_pnl,
        (SELECT COALESCE(sum(proceeds_sell - cost_buy), 0) FROM unresolved) AS unrealized_pnl,
        (SELECT COALESCE(sum(cost_buy + proceeds_sell), 0) FROM with_resolutions) AS total_volume,
        (SELECT COALESCE(sum(trades), 0) FROM with_resolutions) AS total_trades,
        (SELECT count(DISTINCT cid) FROM with_resolutions) AS total_markets,
        (SELECT COALESCE(sum(settlement_value), 0) FROM resolved_only) AS settlement_value,
        (SELECT count() FROM resolved_only) AS resolved_positions,
        (SELECT count() FROM unresolved) AS open_positions,
        (SELECT COALESCE(sum(cost_buy), 0) FROM with_resolutions) AS total_cost,
        (SELECT COALESCE(sum(proceeds_sell), 0) FROM with_resolutions) AS total_proceeds
    `;

    const pnlResult = await clickhouse.query({ query: pnlQuery, format: 'JSONEachRow' });
    const pnlData = await pnlResult.json();

    if (pnlData.length > 0) {
      const p = pnlData[0];
      const net_pnl = Number(p.realized_pnl) + Number(p.unrealized_pnl);
      const trade_pnl = Number(p.total_proceeds) - Number(p.total_cost);

      console.log(`  Volume: $${Number(p.total_volume).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
      console.log(`  Trades: ${p.total_trades} | Markets: ${p.total_markets}`);
      console.log();
      console.log(`  Trade P&L: $${trade_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Realized P&L (with settlements): $${Number(p.realized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Unrealized P&L: $${Number(p.unrealized_pnl).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log(`  Net P&L: $${net_pnl.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log();
      console.log(`  Resolved positions: ${p.resolved_positions}/${p.total_markets} (${(100 * p.resolved_positions / p.total_markets).toFixed(1)}%)`);
      console.log(`  Settlement value: $${Number(p.settlement_value).toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      console.log();

      // Sanity check
      const sanity_checks = [];
      if (Number(p.total_volume) < 0) sanity_checks.push('❌ Negative volume');
      if (Math.abs(trade_pnl) > Number(p.total_volume)) sanity_checks.push('⚠️  Trade P&L exceeds volume');
      if (Number(p.total_cost) > 0 && Number(p.total_proceeds) > 0) {
        const proceeds_ratio = Number(p.total_proceeds) / Number(p.total_cost);
        if (proceeds_ratio > 2) sanity_checks.push(`⚠️  High proceeds ratio: ${proceeds_ratio.toFixed(2)}x`);
      }

      if (sanity_checks.length > 0) {
        console.log(`  Sanity checks:`);
        sanity_checks.forEach(c => console.log(`    ${c}`));
        console.log();
      } else {
        console.log(`  ✅ Sanity checks passed\n`);
      }
    }
  }

  // Summary for Phase 2 & 3
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PHASE 2 & 3 COMPLETE');
  console.log('═══════════════════════════════════════════════════════════\n');
}

phase2And3()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
