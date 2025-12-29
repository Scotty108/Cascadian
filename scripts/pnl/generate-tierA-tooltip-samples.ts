#!/usr/bin/env npx tsx
/**
 * GENERATE TIER A UI TOOLTIP SAMPLES
 * ============================================================================
 *
 * Creates two sample sets for Playwright tooltip validation:
 * 1. Top 200 by CLOB volume (high-value wallets)
 * 2. Random 200 from remaining Tier A (long-tail validation)
 *
 * These samples will be used with Playwright to capture UI tooltip truth,
 * then validated against V12 computed values.
 *
 * Outputs:
 * - tmp/tierA_ui_tooltip_sample_top_volume_200.json
 * - tmp/tierA_ui_tooltip_sample_random_200.json
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

interface WalletSample {
  wallet_address: string;
  clob_event_count: number;
  clob_usdc_volume: number;
  unresolved_pct: number;
  maker_share_pct: number;
}

interface SampleOutput {
  metadata: {
    generated_at: string;
    sample_type: 'top_volume' | 'random';
    description: string;
    count: number;
    use_case: string;
  };
  wallets: WalletSample[];
}

async function main() {
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '_');

  console.log('═'.repeat(80));
  console.log('GENERATING TIER A UI TOOLTIP SAMPLES');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Sample sizes:');
  console.log('  - Top 200 by CLOB volume');
  console.log('  - Random 200 from remaining Tier A');
  console.log('');
  console.log('Filters (Tier A criteria):');
  console.log('  - tier = A');
  console.log('  - unresolved_pct < 50% (for comparable metrics)');
  console.log('');

  // Step 1: Get top 200 by CLOB volume
  console.log('Step 1: Fetching top 200 by CLOB volume...');
  const topQuery = await ch.query({
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
      ORDER BY clob_usdc_volume DESC
      LIMIT 200
    `,
    format: 'JSONEachRow'
  });
  const topWallets = (await topQuery.json<any[]>()).map(w => ({
    wallet_address: w.wallet_address,
    clob_event_count: Number(w.clob_event_count),
    clob_usdc_volume: Number(w.clob_usdc_volume),
    unresolved_pct: Number(w.unresolved_pct),
    maker_share_pct: Number(w.maker_share_pct)
  }));
  console.log(`  Got ${topWallets.length} top wallets`);

  // Step 2: Get random 200 from remaining Tier A
  console.log('Step 2: Fetching random 200 from remaining Tier A...');
  const randomQuery = await ch.query({
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
        AND wallet_address NOT IN (
          SELECT wallet_address
          FROM trader_strict_classifier_v1
          WHERE tier = 'A' AND unresolved_pct < 50
          ORDER BY clob_usdc_volume DESC
          LIMIT 200
        )
      ORDER BY rand()
      LIMIT 200
    `,
    format: 'JSONEachRow'
  });
  const randomWallets = (await randomQuery.json<any[]>()).map(w => ({
    wallet_address: w.wallet_address,
    clob_event_count: Number(w.clob_event_count),
    clob_usdc_volume: Number(w.clob_usdc_volume),
    unresolved_pct: Number(w.unresolved_pct),
    maker_share_pct: Number(w.maker_share_pct)
  }));
  console.log(`  Got ${randomWallets.length} random wallets`);

  // Step 3: Generate statistics
  console.log('\n' + '─'.repeat(80));
  console.log('SAMPLE STATISTICS');
  console.log('─'.repeat(80));

  const topStats = {
    total_volume: topWallets.reduce((s, w) => s + w.clob_usdc_volume, 0),
    avg_events: topWallets.reduce((s, w) => s + w.clob_event_count, 0) / topWallets.length,
    avg_unresolved: topWallets.reduce((s, w) => s + w.unresolved_pct, 0) / topWallets.length,
    min_volume: Math.min(...topWallets.map(w => w.clob_usdc_volume)),
    max_volume: Math.max(...topWallets.map(w => w.clob_usdc_volume))
  };

  const randomStats = {
    total_volume: randomWallets.reduce((s, w) => s + w.clob_usdc_volume, 0),
    avg_events: randomWallets.reduce((s, w) => s + w.clob_event_count, 0) / randomWallets.length,
    avg_unresolved: randomWallets.reduce((s, w) => s + w.unresolved_pct, 0) / randomWallets.length,
    min_volume: Math.min(...randomWallets.map(w => w.clob_usdc_volume)),
    max_volume: Math.max(...randomWallets.map(w => w.clob_usdc_volume))
  };

  console.log('\nTop 200 by Volume:');
  console.log(`  Total volume: $${(topStats.total_volume / 1e6).toFixed(1)}M`);
  console.log(`  Avg events: ${topStats.avg_events.toFixed(0)}`);
  console.log(`  Avg unresolved: ${topStats.avg_unresolved.toFixed(1)}%`);
  console.log(`  Volume range: $${(topStats.min_volume / 1e6).toFixed(2)}M - $${(topStats.max_volume / 1e6).toFixed(2)}M`);

  console.log('\nRandom 200:');
  console.log(`  Total volume: $${(randomStats.total_volume / 1e6).toFixed(1)}M`);
  console.log(`  Avg events: ${randomStats.avg_events.toFixed(0)}`);
  console.log(`  Avg unresolved: ${randomStats.avg_unresolved.toFixed(1)}%`);
  console.log(`  Volume range: $${(randomStats.min_volume / 1e3).toFixed(0)}K - $${(randomStats.max_volume / 1e6).toFixed(2)}M`);

  // Step 4: Save outputs
  console.log('\n' + '─'.repeat(80));
  console.log('SAVING OUTPUTS');
  console.log('─'.repeat(80));

  const topOutput: SampleOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      sample_type: 'top_volume',
      description: 'Top 200 Tier A wallets by CLOB volume for UI tooltip validation',
      count: topWallets.length,
      use_case: 'Playwright tooltip scraping - high-value wallet validation'
    },
    wallets: topWallets
  };

  const randomOutput: SampleOutput = {
    metadata: {
      generated_at: new Date().toISOString(),
      sample_type: 'random',
      description: 'Random 200 Tier A wallets (excluding top 200) for UI tooltip validation',
      count: randomWallets.length,
      use_case: 'Playwright tooltip scraping - long-tail wallet validation'
    },
    wallets: randomWallets
  };

  const topFile = `tmp/tierA_ui_tooltip_sample_top_volume_200.json`;
  const randomFile = `tmp/tierA_ui_tooltip_sample_random_200.json`;

  fs.writeFileSync(topFile, JSON.stringify(topOutput, null, 2));
  console.log(`  Saved: ${topFile}`);

  fs.writeFileSync(randomFile, JSON.stringify(randomOutput, null, 2));
  console.log(`  Saved: ${randomFile}`);

  // Step 5: Generate combined sample for convenience
  const combinedWallets = [...topWallets, ...randomWallets];
  const combinedFile = `tmp/tierA_ui_tooltip_sample_combined_400.json`;
  fs.writeFileSync(combinedFile, JSON.stringify({
    metadata: {
      generated_at: new Date().toISOString(),
      description: 'Combined 400 Tier A wallets (200 top + 200 random) for UI tooltip validation',
      count: combinedWallets.length,
      samples: {
        top_volume: topWallets.length,
        random: randomWallets.length
      }
    },
    wallets: combinedWallets
  }, null, 2));
  console.log(`  Saved: ${combinedFile}`);

  await ch.close();

  console.log('\n' + '═'.repeat(80));
  console.log('TIER A UI TOOLTIP SAMPLES GENERATED');
  console.log('═'.repeat(80));
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run Playwright tooltip scraping on these samples');
  console.log('  2. Use scripts/pnl/scrape-ui-tooltip-truth.ts (when available)');
  console.log('  3. Validate with scripts/pnl/validate-v12-vs-tooltip-truth.ts');
  console.log('');
}

main().catch(console.error);
