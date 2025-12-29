#!/usr/bin/env npx tsx
/**
 * GENERATE LOW-B TIER A GATED WALLETS
 * ============================================================================
 *
 * Generates the low-B universe of wallets gated to Tier A only.
 * These are the wallets eligible for copy-trading leaderboards and metrics.
 *
 * Filters applied:
 * 1. tier = 'A' (from trader_strict_classifier_v1)
 * 2. unresolved_pct < 50% (comparable metrics)
 * 3. clob_event_count >= 50 (minimum activity)
 *
 * Output: tmp/lowB_tierA_wallets_2025_12_09.json
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
  request_timeout: 300000,
});

async function main() {
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');

  console.log('═'.repeat(80));
  console.log('GENERATING LOW-B TIER A GATED WALLETS');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Filters:');
  console.log('  - tier = A');
  console.log('  - unresolved_pct < 50%');
  console.log('  - clob_event_count >= 50');
  console.log('');

  // Step 1: Get count
  console.log('Step 1: Counting eligible wallets...');
  const countQuery = await ch.query({
    query: `
      SELECT count() as cnt
      FROM trader_strict_classifier_v1
      WHERE tier = 'A'
        AND unresolved_pct < 50
        AND clob_event_count >= 50
    `,
    format: 'JSONEachRow'
  });
  const countData = (await countQuery.json<any[]>())[0];
  console.log(`  Total eligible: ${countData.cnt} wallets`);

  // Step 2: Fetch all eligible wallets
  console.log('\nStep 2: Fetching wallet data...');
  const walletsQuery = await ch.query({
    query: `
      SELECT
        wallet_address,
        clob_event_count,
        clob_usdc_volume,
        unresolved_pct,
        maker_share_pct
      FROM trader_strict_classifier_v1
      WHERE tier = 'A'
        AND unresolved_pct < 50
        AND clob_event_count >= 50
      ORDER BY clob_usdc_volume DESC
    `,
    format: 'JSONEachRow'
  });
  const wallets = await walletsQuery.json<any[]>();
  console.log(`  Fetched ${wallets.length} wallets`);

  // Step 3: Compute stats
  const stats = {
    total: wallets.length,
    total_volume: wallets.reduce((s, w) => s + Number(w.clob_usdc_volume), 0),
    avg_events: wallets.reduce((s, w) => s + Number(w.clob_event_count), 0) / wallets.length,
    avg_unresolved_pct: wallets.reduce((s, w) => s + Number(w.unresolved_pct), 0) / wallets.length,
    avg_maker_share_pct: wallets.reduce((s, w) => s + Number(w.maker_share_pct), 0) / wallets.length,
  };

  console.log('\nStep 3: Statistics:');
  console.log(`  Total wallets: ${stats.total.toLocaleString()}`);
  console.log(`  Total CLOB volume: $${(stats.total_volume / 1e6).toFixed(1)}M`);
  console.log(`  Avg events per wallet: ${stats.avg_events.toFixed(0)}`);
  console.log(`  Avg unresolved %: ${stats.avg_unresolved_pct.toFixed(1)}%`);
  console.log(`  Avg maker share %: ${stats.avg_maker_share_pct.toFixed(1)}%`);

  // Step 4: Save output
  const output = {
    metadata: {
      generated_at: new Date().toISOString(),
      description: 'Low-B universe: Tier A wallets eligible for copy-trading metrics',
      filters: {
        tier: 'A',
        unresolved_pct_max: 50,
        clob_event_count_min: 50
      },
      use_case: 'Copy-trading leaderboards, smart money signals'
    },
    stats,
    wallets: wallets.map(w => ({
      wallet_address: w.wallet_address,
      clob_event_count: Number(w.clob_event_count),
      clob_usdc_volume: Number(w.clob_usdc_volume),
      unresolved_pct: Number(w.unresolved_pct),
      maker_share_pct: Number(w.maker_share_pct)
    }))
  };

  const outputFile = `tmp/lowB_tierA_wallets_${dateStr}.json`;
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\nSaved to: ${outputFile}`);

  // Step 5: Summary by volume buckets
  console.log('\n' + '─'.repeat(80));
  console.log('VOLUME DISTRIBUTION');
  console.log('─'.repeat(80));

  const buckets = [
    { name: '>$10M', filter: (w: any) => w.clob_usdc_volume > 10_000_000 },
    { name: '$1M-$10M', filter: (w: any) => w.clob_usdc_volume > 1_000_000 && w.clob_usdc_volume <= 10_000_000 },
    { name: '$100K-$1M', filter: (w: any) => w.clob_usdc_volume > 100_000 && w.clob_usdc_volume <= 1_000_000 },
    { name: '$10K-$100K', filter: (w: any) => w.clob_usdc_volume > 10_000 && w.clob_usdc_volume <= 100_000 },
    { name: '<$10K', filter: (w: any) => w.clob_usdc_volume <= 10_000 },
  ];

  for (const bucket of buckets) {
    const count = wallets.filter(bucket.filter).length;
    const pct = (count / wallets.length * 100).toFixed(1);
    console.log(`  ${bucket.name.padEnd(15)}: ${count.toLocaleString().padStart(8)} (${pct}%)`);
  }

  await ch.close();

  console.log('\n' + '═'.repeat(80));
  console.log('LOW-B TIER A GATING COMPLETE');
  console.log('═'.repeat(80));
}

main().catch(console.error);
