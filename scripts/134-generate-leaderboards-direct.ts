#!/usr/bin/env tsx
/**
 * Generate Leaderboard Reports (Direct Query Approach)
 *
 * Queries pm_wallet_omega_stats directly to avoid view overhead
 */

import { resolve } from 'path';
import { config } from 'dotenv';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client.js';
import { writeFileSync } from 'fs';

async function main() {
  console.log('📊 Generating Leaderboard Reports (Direct Query)');
  console.log('='.repeat(80));
  console.log('');

  // Step 1: Generate WHALE_LEADERBOARD.md
  console.log('Step 1: Querying whale wallets...');
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
        CASE
          WHEN total_volume >= 1000000 THEN 'whale'
          WHEN total_volume >= 100000 THEN 'large'
          ELSE 'other'
        END as wallet_tier
      FROM pm_wallet_omega_stats
      WHERE total_volume >= 100000
        AND markets_traded >= 5
        AND total_trades >= 10
      ORDER BY total_pnl_net DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  const whales = await whaleQuery.json<any>();
  console.log(`✅ Found ${whales.length} whale wallets`);
  console.log('');

  const whaleMarkdown = `# Whale Leaderboard

**Generated:** ${new Date().toISOString()}
**Criteria:** Volume >= $100k, markets >= 5, trades >= 10
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

**Data Source:** pm_wallet_omega_stats (uses pm_trades_complete)
`;

  writeFileSync('./WHALE_LEADERBOARD.md', whaleMarkdown);
  console.log('✅ WHALE_LEADERBOARD.md created');
  console.log('');

  // Step 2: Generate OMEGA_LEADERBOARD.md
  console.log('Step 2: Querying high Omega wallets...');
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
        CASE
          WHEN total_volume >= 1000000 THEN 'whale'
          WHEN total_volume >= 100000 THEN 'large'
          WHEN total_volume >= 10000 THEN 'medium'
          ELSE 'small'
        END as wallet_tier
      FROM pm_wallet_omega_stats
      WHERE omega_ratio >= 1.5
        AND markets_traded >= 10
        AND total_volume >= 1000
      ORDER BY omega_ratio DESC
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  const omegaLeaders = await omegaQuery.json<any>();
  console.log(`✅ Found ${omegaLeaders.length} high-Omega wallets`);
  console.log('');

  const omegaMarkdown = `# Omega Leaderboard

**Generated:** ${new Date().toISOString()}
**Criteria:** Omega >= 1.5, markets >= 10, volume >= $1k
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

**Data Source:** pm_wallet_omega_stats (uses pm_trades_complete)
`;

  writeFileSync('./OMEGA_LEADERBOARD.md', omegaMarkdown);
  console.log('✅ OMEGA_LEADERBOARD.md created');
  console.log('');

  console.log('='.repeat(80));
  console.log('📋 SUMMARY');
  console.log('='.repeat(80));
  console.log('');
  console.log('✅ Leaderboard reports generated successfully');
  console.log('');
  console.log('Reports:');
  console.log('  1. WHALE_LEADERBOARD.md - Top 30 wallets by P&L (volume >= $100k)');
  console.log('  2. OMEGA_LEADERBOARD.md - Top 30 wallets by Omega ratio (Omega >= 1.5)');
  console.log('');
}

main().catch((error) => {
  console.error('❌ Report generation failed:', error);
  process.exit(1);
});
