/**
 * Step 7: Export Forecaster Cohorts
 *
 * Exports:
 * - Top 10k discovery (all tiers)
 * - Top 1k Tier A (CLOB-primary, high confidence)
 * - Top 200 spotcheck pack
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';
import * as fs from 'fs';

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

async function main() {
  console.log('=== Exporting Forecaster Cohorts ===\n');

  // Create exports directory
  const exportDir = 'exports/forecasters';
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().slice(0, 10);

  // 1. Top 10k Discovery
  console.log('1. Exporting Top 10k Discovery...');
  const top10kQ = await ch.query({
    query: `
      SELECT
        wallet,
        n_trades_60d,
        n_markets_60d,
        notional_60d,
        p24_coverage,
        clv_24h_weighted,
        clv_24h_hit_rate,
        confidence_tier
      FROM pm_wallet_forecaster_candidates_60d
      LIMIT 10000
    `,
    format: 'JSONEachRow',
  });
  const top10k = (await top10kQ.json()) as any[];

  fs.writeFileSync(
    `${exportDir}/top_10k_discovery_${timestamp}.json`,
    JSON.stringify(top10k, null, 2)
  );
  console.log(`   Exported ${top10k.length} wallets to ${exportDir}/top_10k_discovery_${timestamp}.json`);

  // 2. Top 1k Tier A
  console.log('\n2. Exporting Top 1k Tier A...');
  const top1kAQ = await ch.query({
    query: `
      SELECT
        wallet,
        n_trades_60d,
        n_markets_60d,
        notional_60d,
        p24_coverage,
        clv_24h_weighted,
        clv_24h_hit_rate
      FROM pm_wallet_forecaster_candidates_60d
      WHERE confidence_tier = 'A'
      LIMIT 1000
    `,
    format: 'JSONEachRow',
  });
  const top1kA = (await top1kAQ.json()) as any[];

  fs.writeFileSync(
    `${exportDir}/top_1k_tier_a_${timestamp}.json`,
    JSON.stringify(top1kA, null, 2)
  );
  console.log(`   Exported ${top1kA.length} wallets to ${exportDir}/top_1k_tier_a_${timestamp}.json`);

  // Also create CSV for easy viewing
  const csvHeader = 'wallet,trades,markets,notional,coverage,clv_24h,hit_rate\n';
  const csvRows = top1kA.map(w =>
    `${w.wallet},${w.n_trades_60d},${w.n_markets_60d},${w.notional_60d.toFixed(2)},${(w.p24_coverage * 100).toFixed(1)},${w.clv_24h_weighted?.toFixed(4) || 0},${(w.clv_24h_hit_rate * 100).toFixed(1)}`
  ).join('\n');
  fs.writeFileSync(
    `${exportDir}/top_1k_tier_a_${timestamp}.csv`,
    csvHeader + csvRows
  );
  console.log(`   Also exported to ${exportDir}/top_1k_tier_a_${timestamp}.csv`);

  // 3. Top 200 Spotcheck Pack
  console.log('\n3. Exporting Top 200 Spotcheck Pack...');
  const spotcheckQ = await ch.query({
    query: `
      SELECT
        wallet,
        n_trades_60d,
        n_markets_60d,
        notional_60d,
        p24_coverage,
        clv_24h_weighted,
        clv_24h_hit_rate,
        confidence_tier,
        median_entry_price,
        active_days_60d
      FROM pm_wallet_forecaster_candidates_60d
      WHERE confidence_tier = 'A'
      LIMIT 200
    `,
    format: 'JSONEachRow',
  });
  const spotcheck = (await spotcheckQ.json()) as any[];

  // Add Polymarket URLs for easy manual verification
  const spotcheckWithUrls = spotcheck.map(w => ({
    ...w,
    polymarket_url: `https://polymarket.com/profile/${w.wallet}`,
  }));

  fs.writeFileSync(
    `${exportDir}/spotcheck_200_${timestamp}.json`,
    JSON.stringify(spotcheckWithUrls, null, 2)
  );
  console.log(`   Exported ${spotcheck.length} wallets to ${exportDir}/spotcheck_200_${timestamp}.json`);

  // Summary
  console.log('\n=== Export Summary ===');
  console.log(`\nFiles created in ${exportDir}/:`);
  console.log(`  - top_10k_discovery_${timestamp}.json (${top10k.length} wallets)`);
  console.log(`  - top_1k_tier_a_${timestamp}.json (${top1kA.length} wallets)`);
  console.log(`  - top_1k_tier_a_${timestamp}.csv (${top1kA.length} wallets)`);
  console.log(`  - spotcheck_200_${timestamp}.json (${spotcheck.length} wallets with URLs)`);

  // Quick stats on exported cohorts
  console.log('\n=== Cohort Stats ===');
  console.log('\nTop 10k Discovery:');
  const tier10k = { A: 0, B: 0, C: 0 };
  for (const w of top10k) {
    tier10k[w.confidence_tier as keyof typeof tier10k]++;
  }
  console.log(`  Tier A: ${tier10k.A}, Tier B: ${tier10k.B}, Tier C: ${tier10k.C}`);
  console.log(`  Avg CLV: ${(top10k.reduce((s, w) => s + (w.clv_24h_weighted || 0), 0) / top10k.length).toFixed(4)}`);
  console.log(`  Avg Hit Rate: ${(top10k.reduce((s, w) => s + (w.clv_24h_hit_rate || 0), 0) / top10k.length * 100).toFixed(1)}%`);

  console.log('\nTop 1k Tier A:');
  console.log(`  Avg CLV: ${(top1kA.reduce((s, w) => s + (w.clv_24h_weighted || 0), 0) / top1kA.length).toFixed(4)}`);
  console.log(`  Avg Hit Rate: ${(top1kA.reduce((s, w) => s + (w.clv_24h_hit_rate || 0), 0) / top1kA.length * 100).toFixed(1)}%`);
  console.log(`  Min CLV: ${Math.min(...top1kA.map(w => w.clv_24h_weighted || 0)).toFixed(4)}`);
  console.log(`  Max CLV: ${Math.max(...top1kA.map(w => w.clv_24h_weighted || 0)).toFixed(4)}`);

  console.log('\nTop 200 Spotcheck:');
  console.log(`  Avg CLV: ${(spotcheck.reduce((s, w) => s + (w.clv_24h_weighted || 0), 0) / spotcheck.length).toFixed(4)}`);
  console.log(`  Avg Hit Rate: ${(spotcheck.reduce((s, w) => s + (w.clv_24h_hit_rate || 0), 0) / spotcheck.length * 100).toFixed(1)}%`);

  await ch.close();
}

main().catch(console.error);
