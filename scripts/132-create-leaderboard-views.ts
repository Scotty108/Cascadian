#!/usr/bin/env tsx
/**
 * Create Leaderboard Views and Export Reports
 *
 * Creates:
 * 1. pm_wallet_leaderboard - Filtered and ranked wallet leaderboard
 * 2. WHALE_LEADERBOARD.md - Top wallets by volume and P&L
 * 3. OMEGA_LEADERBOARD.md - Top wallets by Omega ratio
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log('🏆 Creating Leaderboard Views');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Create leaderboard view with filters
  console.log('Step 1: Creating pm_wallet_leaderboard view...');
  console.log('');

  await clickhouse.command({
    query: 'DROP VIEW IF EXISTS pm_wallet_leaderboard'
  });

  await clickhouse.command({
    query: `
      CREATE VIEW pm_wallet_leaderboard AS
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

        -- Ranking Metrics
        ROW_NUMBER() OVER (ORDER BY omega_ratio DESC) as omega_rank,
        ROW_NUMBER() OVER (ORDER BY total_pnl_net DESC) as pnl_rank,
        ROW_NUMBER() OVER (ORDER BY total_volume DESC) as volume_rank,
        ROW_NUMBER() OVER (ORDER BY roi_pct DESC) as roi_rank,

        -- Classification
        CASE
          WHEN total_volume >= 1000000 THEN 'whale'
          WHEN total_volume >= 100000 THEN 'large'
          WHEN total_volume >= 10000 THEN 'medium'
          ELSE 'small'
        END as wallet_tier

      FROM pm_wallet_omega_stats
      WHERE markets_traded >= 5       -- Minimum 5 markets for statistical significance
        AND total_volume >= 1000       -- Minimum $1k volume to filter noise
        AND total_trades >= 10         -- Minimum 10 trades
      ORDER BY omega_ratio DESC
    `
  });

  console.log('✅ pm_wallet_leaderboard created');
  console.log('');

  // Step 2: Generate WHALE_LEADERBOARD.md
  console.log('Step 2: Generating WHALE_LEADERBOARD.md...');
  console.log('');

  const whaleQuery = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        markets_traded,
        total_pnl_net,
        total_volume,
        omega_ratio,
        win_rate,
        roi_pct,
        external_market_pct,
        wallet_tier
      FROM pm_wallet_leaderboard
      WHERE wallet_tier IN ('whale', 'large')
      ORDER BY total_pnl_net DESC
      LIMIT 100
    `,
    format: 'JSONEachRow'
  });

  const whales = await whaleQuery.json<any>();

  const whaleMarkdown = `# Whale Leaderboard

**Generated:** ${new Date().toISOString()}
**Criteria:** wallet_tier = 'whale' or 'large' (volume >= $100k)
**Sorted by:** Total P&L (Net)

---

## Top 100 Whales by P&L

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

**Data Source:** pm_wallet_leaderboard (uses pm_trades_complete)
`;

  writeFileSync('./WHALE_LEADERBOARD.md', whaleMarkdown);
  console.log('✅ WHALE_LEADERBOARD.md created');
  console.log('');

  // Step 3: Generate OMEGA_LEADERBOARD.md
  console.log('Step 3: Generating OMEGA_LEADERBOARD.md...');
  console.log('');

  const omegaQuery = await clickhouse.query({
    query: `
      SELECT
        wallet_address,
        markets_traded,
        total_pnl_net,
        total_volume,
        omega_ratio,
        win_rate,
        roi_pct,
        sharpe_approx,
        external_market_pct,
        wallet_tier
      FROM pm_wallet_leaderboard
      WHERE omega_ratio >= 1.5           -- Minimum Omega for quality filter
        AND markets_traded >= 10         -- Higher minimum for Omega ranking
      ORDER BY omega_ratio DESC
      LIMIT 100
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

## Top 100 by Omega Ratio

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

**Data Source:** pm_wallet_leaderboard (uses pm_trades_complete)
`;

  writeFileSync('./OMEGA_LEADERBOARD.md', omegaMarkdown);
  console.log('✅ OMEGA_LEADERBOARD.md created');
  console.log('');

  console.log('='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ Leaderboard system created successfully');
  console.log('');
  console.log('Views:');
  console.log('  1. pm_wallet_leaderboard - Filtered and ranked wallet leaderboard');
  console.log('');
  console.log('Reports:');
  console.log('  1. WHALE_LEADERBOARD.md - Top 100 wallets by P&L (volume >= $100k)');
  console.log('  2. OMEGA_LEADERBOARD.md - Top 100 wallets by Omega ratio (Omega >= 1.5)');
  console.log('');
  console.log('Filters Applied:');
  console.log('  - Minimum 5 markets traded');
  console.log('  - Minimum $1k volume');
  console.log('  - Minimum 10 trades');
  console.log('');
  console.log('Rankings Available:');
  console.log('  - omega_rank: Ranked by Omega ratio');
  console.log('  - pnl_rank: Ranked by total P&L');
  console.log('  - volume_rank: Ranked by total volume');
  console.log('  - roi_rank: Ranked by ROI %');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Leaderboard creation failed:', error);
  process.exit(1);
});
