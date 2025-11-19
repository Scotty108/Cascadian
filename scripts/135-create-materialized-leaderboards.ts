#!/usr/bin/env tsx
/**
 * Create Materialized Leaderboard Tables
 *
 * Creates materialized tables instead of views to avoid header overflow on queries.
 * This pre-computes the aggregations and stores them for fast querying.
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log('🏗️  Creating Materialized Leaderboard Tables');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Create wallet_leaderboard table
  console.log('Step 1: Creating wallet_leaderboard table...');
  console.log('');

  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS wallet_leaderboard'
  });

  await clickhouse.command({
    query: `
      CREATE TABLE wallet_leaderboard
      ENGINE = MergeTree()
      ORDER BY (total_pnl_net, omega_ratio)
      AS
      SELECT
        wallet_address,
        markets_traded,
        total_trades,
        total_volume,
        total_pnl_net,
        total_pnl_gross,
        omega_ratio,
        win_rate,
        avg_pnl_per_market,
        roi_pct,
        sharpe_approx,
        external_market_pct,
        first_trade_ts,
        last_trade_ts,
        days_active,

        -- Classification
        CASE
          WHEN total_volume >= 1000000 THEN 'whale'
          WHEN total_volume >= 100000 THEN 'large'
          WHEN total_volume >= 10000 THEN 'medium'
          ELSE 'small'
        END as wallet_tier

      FROM pm_wallet_omega_stats
      WHERE markets_traded >= 5
        AND total_volume >= 1000
        AND total_trades >= 10
    `
  });

  console.log('✅ wallet_leaderboard table created');
  console.log('');

  // Step 2: Query and generate WHALE_LEADERBOARD.md
  console.log('Step 2: Generating WHALE_LEADERBOARD.md from materialized table...');
  console.log('');

  const whaleQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_leaderboard
      WHERE wallet_tier IN ('whale', 'large')
      ORDER BY total_pnl_net DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  const whales = await whaleQuery.json<any>();

  const whaleMarkdown = `# Whale Leaderboard

**Generated:** ${new Date().toISOString()}
**Criteria:** Wallet tier = 'whale' or 'large' (volume >= $100k)
**Sorted by:** Total P&L (Net)

---

## Top 30 Whales by P&L

| Rank | Wallet | Markets | P&L Net | Volume | Omega | Win Rate | ROI % | External % | Tier |
|------|--------|---------|---------|--------|-------|----------|-------|------------|------|
${whales.map((w, i) => {
  return `| ${i + 1} | \`${w.wallet_address.substring(0, 12)}...\` | ${w.markets_traded} | $${parseFloat(w.total_pnl_net).toLocaleString()} | $${parseFloat(w.total_volume).toLocaleString()} | ${parseFloat(w.omega_ratio).toFixed(2)} | ${w.win_rate}% | ${w.roi_pct}% | ${w.external_market_pct}% | ${w.wallet_tier} |`;
}).join('\n')}

---

## Summary Stats

- **Total Wallets:** ${whales.length}
- **Total P&L:** $${whales.reduce((sum, w) => sum + parseFloat(w.total_pnl_net), 0).toLocaleString()}
- **Total Volume:** $${whales.reduce((sum, w) => sum + parseFloat(w.total_volume), 0).toLocaleString()}
- **Average Omega:** ${(whales.reduce((sum, w) => sum + parseFloat(w.omega_ratio), 0) / whales.length).toFixed(2)}
- **Average Win Rate:** ${(whales.reduce((sum, w) => sum + parseFloat(w.win_rate), 0) / whales.length).toFixed(2)}%

---

**Data Source:** wallet_leaderboard (materialized from pm_wallet_omega_stats)
`;

  writeFileSync('./WHALE_LEADERBOARD.md', whaleMarkdown);
  console.log('✅ WHALE_LEADERBOARD.md created');
  console.log('');

  // Step 3: Generate OMEGA_LEADERBOARD.md
  console.log('Step 3: Generating OMEGA_LEADERBOARD.md...');
  console.log('');

  const omegaQuery = await clickhouse.query({
    query: `
      SELECT *
      FROM wallet_leaderboard
      WHERE omega_ratio >= 1.5
        AND markets_traded >= 10
      ORDER BY omega_ratio DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  const omegaLeaders = await omegaQuery.json<any>();

  const omegaMarkdown = `# Omega Leaderboard

**Generated:** ${new Date().toISOString()}
**Criteria:** Omega >= 1.5, markets >= 10
**Sorted by:** Omega Ratio (descending)

---

## What is Omega?

**Omega Ratio** = Sum(Positive Returns) / Abs(Sum(Negative Returns))

- **Omega > 1:** Wallet has positive expected value (more gains than losses)
- **Omega = 1:** Break-even expected value
- **Omega < 1:** Negative expected value (more losses than gains)
- **Omega = 999:** Perfect record (all wins, no losses)

Higher Omega = Better risk-adjusted performance

---

## Top 30 by Omega Ratio

| Rank | Wallet | Markets | Omega | Win Rate | P&L Net | Volume | ROI % | Sharpe | External % | Tier |
|------|--------|---------|-------|----------|---------|--------|-------|--------|------------|------|
${omegaLeaders.map((w, i) => {
  const omegaDisplay = parseFloat(w.omega_ratio) >= 999 ? '∞' : parseFloat(w.omega_ratio).toFixed(2);
  return `| ${i + 1} | \`${w.wallet_address.substring(0, 12)}...\` | ${w.markets_traded} | ${omegaDisplay} | ${w.win_rate}% | $${parseFloat(w.total_pnl_net).toLocaleString()} | $${parseFloat(w.total_volume).toLocaleString()} | ${w.roi_pct}% | ${parseFloat(w.sharpe_approx).toFixed(2)} | ${w.external_market_pct}% | ${w.wallet_tier} |`;
}).join('\n')}

---

## Summary Stats

- **Total Wallets:** ${omegaLeaders.length}
- **Average Omega:** ${(omegaLeaders.filter(w => parseFloat(w.omega_ratio) < 999).reduce((sum, w) => sum + parseFloat(w.omega_ratio), 0) / omegaLeaders.filter(w => parseFloat(w.omega_ratio) < 999).length).toFixed(2)}
- **Perfect Records (Omega = ∞):** ${omegaLeaders.filter(w => parseFloat(w.omega_ratio) >= 999).length}
- **Total P&L:** $${omegaLeaders.reduce((sum, w) => sum + parseFloat(w.total_pnl_net), 0).toLocaleString()}
- **Average Win Rate:** ${(omegaLeaders.reduce((sum, w) => sum + parseFloat(w.win_rate), 0) / omegaLeaders.length).toFixed(2)}%
- **Average ROI:** ${(omegaLeaders.reduce((sum, w) => sum + parseFloat(w.roi_pct), 0) / omegaLeaders.length).toFixed(2)}%

---

**Data Source:** wallet_leaderboard (materialized from pm_wallet_omega_stats)
`;

  writeFileSync('./OMEGA_LEADERBOARD.md', omegaMarkdown);
  console.log('✅ OMEGA_LEADERBOARD.md created');
  console.log('');

  console.log('='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ Materialized leaderboard system created successfully');
  console.log('');
  console.log('Table:');
  console.log('  - wallet_leaderboard (materialized table for fast queries)');
  console.log('');
  console.log('Reports:');
  console.log('  1. WHALE_LEADERBOARD.md - Top 30 wallets by P&L (volume >= $100k)');
  console.log('  2. OMEGA_LEADERBOARD.md - Top 30 wallets by Omega ratio (Omega >= 1.5)');
  console.log('');
  console.log('Note: Materialized table avoids header overflow on queries');
  console.log('      Refresh by re-running this script');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Materialized leaderboard creation failed:', error);
  process.exit(1);
});
