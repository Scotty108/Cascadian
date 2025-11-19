/**
 * 02: CHECK RESOLUTION COVERAGE
 *
 * Verify that market_resolutions_norm has data for 2024
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('02: CHECK RESOLUTION COVERAGE');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Resolutions by month
  console.log('📊 Resolutions by month:\n');

  const monthlyQuery = await clickhouse.query({
    query: `
      SELECT
        toStartOfMonth(resolved_at) AS month,
        count() AS n
      FROM market_resolutions_norm
      WHERE resolved_at IS NOT NULL
      GROUP BY month
      ORDER BY month DESC
      LIMIT 24
    `,
    format: 'JSONEachRow'
  });

  const monthly: any[] = await monthlyQuery.json();

  let has2024Data = false;
  let has2025Data = false;

  for (const m of monthly) {
    console.log(`  ${m.month}: ${m.n.toLocaleString()} resolutions`);

    const year = new Date(m.month).getFullYear();
    if (year === 2024) has2024Data = true;
    if (year === 2025) has2025Data = true;
  }

  console.log();

  if (has2024Data) {
    console.log('✅ Resolution data EXISTS for 2024\n');
  } else {
    console.log('❌ NO resolution data for 2024\n');
    console.log('⚠️  BLOCKER: Pipeline is missing recent resolutions\n');
    console.log('Action: Fix ingestion before proceeding\n');
    return;
  }

  // Sample some 2024 resolutions
  console.log('📊 Sample 2024 resolutions:\n');

  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        resolved_at
      FROM market_resolutions_norm
      WHERE resolved_at >= '2024-01-01'
        AND resolved_at < '2025-01-01'
      ORDER BY resolved_at DESC
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  for (const s of samples) {
    console.log(`  ${s.condition_id_norm.substring(0, 30)}... (${s.resolved_at})`);
  }

  console.log('\n✅ RESOLUTION COVERAGE VERIFIED\n');
  console.log('Next: Run 03-find-control-wallet-normalized.ts\n');
}

main().catch(console.error);
