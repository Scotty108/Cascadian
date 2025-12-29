/**
 * Test DUEL Engine
 *
 * Validate the dual PnL metrics engine on a batch of wallets.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createDuelEngine, summarizeDuelBatch, DuelMetrics } from '../../lib/pnl/duelEngine';

// Test wallets - mix of CTF-active and CLOB-only
const TEST_WALLETS = [
  // CTF-active wallets (have ERC1155 transfers)
  '0xb48ef6deecd526c0974c35e1f7b5c3bbd12fa144', // Original target, CTF-active
  '0x654ee63920c474c83a1fae56f02754e9bf6da732', // ~$10M volume, CTF-active
  // CLOB-only wallets (no ERC1155, no split/merge)
  '0xd44e29936409019f93993de8bd603ef6cb1bb15e', // 1.8M trades, CLOB-only
  '0x30cecdf29f069563ea21b8ae94492e41e53a6b2b', // 636K trades, CLOB-only
  '0xa4b8acd82d21d7ef33811d20f2dc4a40b8e498b9', // 199K trades, 1 ERC1155, CLOB-only
];

function formatUSD(value: number): string {
  const sign = value >= 0 ? '' : '-';
  return `${sign}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

async function main() {
  console.log('='.repeat(100));
  console.log('DUEL ENGINE TEST - Dual PnL Metrics');
  console.log('='.repeat(100));
  console.log('');

  const engine = createDuelEngine();
  const results: DuelMetrics[] = [];

  console.log(`Testing ${TEST_WALLETS.length} wallets...`);
  console.log('');

  for (let i = 0; i < TEST_WALLETS.length; i++) {
    const wallet = TEST_WALLETS[i];
    console.log(`[${i + 1}/${TEST_WALLETS.length}] ${wallet.slice(0, 10)}...`);

    try {
      const result = await engine.compute(wallet);
      results.push(result);
      console.log(`  realized_economic: ${formatUSD(result.realized_economic)}`);
      console.log(`  realized_cash:     ${formatUSD(result.realized_cash)}`);
      console.log(`  delta:             ${formatUSD(result.economic_vs_cash_delta)}`);
      console.log(`  is_rankable:       ${result.is_rankable ? 'YES' : 'NO'}`);
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
    }
    console.log('');
  }

  // Summary table
  console.log('='.repeat(100));
  console.log('RESULTS SUMMARY');
  console.log('='.repeat(100));
  console.log('');

  console.log('| Wallet (10)  | Economic    | Cash        | Delta       | USDC Cov | Tier | Rankable |');
  console.log('|--------------|-------------|-------------|-------------|----------|------|----------|');

  for (const r of results) {
    const walletShort = r.wallet.slice(0, 10) + '..';
    const rankStr = r.is_rankable ? ' YES' : '  NO';
    const covStr = r.data_coverage.usdc_coverage_pct.toFixed(1) + '%';
    const tier = r.data_coverage.rankability_tier;
    console.log(
      `| ${walletShort} | ${formatUSD(r.realized_economic).padStart(11)} | ${formatUSD(r.realized_cash).padStart(11)} | ${formatUSD(r.economic_vs_cash_delta).padStart(11)} | ${covStr.padStart(8)} |   ${tier}  | ${rankStr}     |`
    );
  }
  console.log('');

  // Decomposition for first wallet
  if (results.length > 0) {
    const r = results[0];
    console.log('='.repeat(100));
    console.log('DECOMPOSITION (First Wallet)');
    console.log('='.repeat(100));
    console.log('');
    console.log(`Wallet: ${r.wallet}`);
    console.log('');
    console.log('| Component                | Value         |');
    console.log('|--------------------------|---------------|');
    console.log(`| resolved_trade_cashflow  | ${formatUSD(r.resolved_trade_cashflow).padStart(13)} |`);
    console.log(`| unresolved_trade_cashflow| ${formatUSD(r.unresolved_trade_cashflow).padStart(13)} |`);
    console.log(`| synthetic_redemptions    | ${formatUSD(r.synthetic_redemptions).padStart(13)} |`);
    console.log(`| explicit_redemptions     | ${formatUSD(r.explicit_redemptions).padStart(13)} |`);
    console.log('|--------------------------|---------------|');
    console.log(`| ECONOMIC = cf + synth    | ${formatUSD(r.realized_economic).padStart(13)} |`);
    console.log(`| CASH = cf + explicit     | ${formatUSD(r.realized_cash).padStart(13)} |`);
    console.log('');
    console.log('Classification:');
    console.log(`  CLOB-only: ${r.clob_only_check.is_clob_only ? 'YES' : 'NO'}`);
    console.log(`  Reasons: ${r.clob_only_check.reasons.join(', ')}`);
    console.log(`  Split/Merge: ${r.clob_only_check.split_merge_count}`);
    console.log(`  ERC1155 transfers: ${r.clob_only_check.erc1155_transfer_count}`);
    console.log(`  CLOB trades: ${r.clob_only_check.clob_trade_count}`);
    console.log('');
    console.log('Data Coverage:');
    console.log(`  Trade coverage: ${r.data_coverage.trade_coverage_pct.toFixed(1)}% (${r.data_coverage.mapped_trades.toLocaleString()}/${r.data_coverage.total_trades.toLocaleString()})`);
    console.log(`  USDC coverage: ${r.data_coverage.usdc_coverage_pct.toFixed(1)}% (${formatUSD(r.data_coverage.mapped_usdc)}/${formatUSD(r.data_coverage.total_usdc)})`);
    console.log(`  Unmapped: ${r.data_coverage.unmapped_trades} trades, ${formatUSD(r.data_coverage.unmapped_usdc)} volume, ${formatUSD(r.data_coverage.unmapped_net_cashflow)} net cashflow`);
    console.log(`  Rankability tier: ${r.data_coverage.rankability_tier} (${r.data_coverage.is_high_coverage ? 'rankable' : 'not rankable'})`);
    console.log('');
  }

  // Batch summary
  const summary = summarizeDuelBatch(results);
  console.log('='.repeat(100));
  console.log('BATCH SUMMARY');
  console.log('='.repeat(100));
  console.log('');
  console.log(`Total wallets:     ${summary.total_wallets}`);
  console.log(`Rankable wallets:  ${summary.rankable_wallets} (${((summary.rankable_wallets / summary.total_wallets) * 100).toFixed(0)}%)`);
  console.log(`CTF-active:        ${summary.ctf_active_wallets} (${((summary.ctf_active_wallets / summary.total_wallets) * 100).toFixed(0)}%)`);
  console.log(`Avg delta:         ${formatUSD(summary.avg_economic_vs_cash_delta)}`);
  console.log('');

  console.log('='.repeat(100));
}

main().catch(console.error);
