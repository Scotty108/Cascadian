/**
 * Fetch Polymarket API PnL for validation cohort
 * Stores in pm_pnl_baseline_api_v2
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../../lib/clickhouse/client';

const POLYMARKET_API = 'https://user-pnl-api.polymarket.com/user-pnl';

async function fetchPnL(wallet: string): Promise<number | null> {
  try {
    const resp = await fetch(`${POLYMARKET_API}?user_address=${wallet.toLowerCase()}`, {
      headers: { 'Accept': 'application/json' }
    });

    if (!resp.ok) {
      return null;
    }

    const data = await resp.json() as Array<{ t: number; p: number }>;
    // API returns array of { t: timestamp, p: pnl }
    // Empty array means no data for this wallet
    if (!data || data.length === 0) {
      return null;
    }

    // Return the latest PnL value
    return data[data.length - 1].p;
  } catch (e) {
    return null;
  }
}

async function main() {
  console.log('=== Fetching API Baseline for Validation Cohort ===\n');

  // Step 1: Create table
  console.log('Step 1: Creating pm_pnl_baseline_api_v2...');
  await clickhouse.command({ query: 'DROP TABLE IF EXISTS pm_pnl_baseline_api_v2' });
  await clickhouse.command({
    query: `
      CREATE TABLE pm_pnl_baseline_api_v2 (
        wallet String,
        api_pnl Float64,
        fetched_at DateTime DEFAULT now()
      ) ENGINE = ReplacingMergeTree()
      ORDER BY wallet
    `
  });
  console.log('  Done.\n');

  // Step 2: Get wallets
  const walletsResult = await clickhouse.query({
    query: 'SELECT wallet, cohort_type FROM pm_validation_wallets_v2',
    format: 'JSONEachRow'
  });
  const wallets = await walletsResult.json() as { wallet: string; cohort_type: string }[];
  console.log(`Step 2: Fetching PnL for ${wallets.length} wallets...\n`);

  // Step 3: Fetch in batches with rate limiting
  const results: { wallet: string; api_pnl: number }[] = [];
  const batchSize = 10;
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < wallets.length; i += batchSize) {
    const batch = wallets.slice(i, i + batchSize);

    const promises = batch.map(async ({ wallet }) => {
      const pnl = await fetchPnL(wallet);
      if (pnl !== null) {
        successCount++;
        return { wallet, api_pnl: pnl };
      }
      failCount++;
      return null;
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter((r): r is { wallet: string; api_pnl: number } => r !== null));

    process.stdout.write(`  ${i + batch.length}/${wallets.length} (${successCount} success, ${failCount} fail)\r`);

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }

  console.log(`\n  Success: ${successCount}, Failed: ${failCount}\n`);

  // Step 4: Insert results
  console.log('Step 4: Inserting into pm_pnl_baseline_api_v2...');
  if (results.length > 0) {
    await clickhouse.insert({
      table: 'pm_pnl_baseline_api_v2',
      values: results,
      format: 'JSONEachRow'
    });
  }
  console.log(`  Inserted ${results.length} rows.\n`);

  // Step 5: Summary
  console.log('=== API Baseline Summary ===\n');
  const summary = await clickhouse.query({
    query: `
      SELECT
        v.cohort_type,
        count() as cnt,
        round(avg(b.api_pnl), 2) as avg_pnl,
        round(min(b.api_pnl), 2) as min_pnl,
        round(max(b.api_pnl), 2) as max_pnl,
        countIf(b.api_pnl > 0) as profitable,
        countIf(b.api_pnl < 0) as losing
      FROM pm_pnl_baseline_api_v2 b
      JOIN pm_validation_wallets_v2 v ON b.wallet = v.wallet
      GROUP BY v.cohort_type
      ORDER BY v.cohort_type
    `,
    format: 'JSONEachRow'
  });

  const rows = await summary.json() as any[];
  console.log('Cohort Type      | Count | Avg PnL      | Min PnL      | Max PnL       | Profitable | Losing');
  console.log('-'.repeat(100));
  for (const r of rows) {
    console.log(
      `${r.cohort_type.padEnd(16)} | ${String(r.cnt).padStart(5)} | ` +
      `$${Number(r.avg_pnl).toLocaleString().padStart(10)} | ` +
      `$${Number(r.min_pnl).toLocaleString().padStart(10)} | ` +
      `$${Number(r.max_pnl).toLocaleString().padStart(11)} | ` +
      `${String(r.profitable).padStart(10)} | ` +
      `${String(r.losing).padStart(6)}`
    );
  }

  console.log('\n✅ API baseline ready!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
