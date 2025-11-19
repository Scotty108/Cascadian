/**
 * 09: CHECK RESOLVED_AT COVERAGE
 *
 * Check how many resolutions have non-null resolved_at
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('09: CHECK RESOLVED_AT COVERAGE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Checking market_resolutions_norm...\n');

  const query1 = await clickhouse.query({
    query: `
      SELECT
        count() AS total,
        countIf(winning_index IS NOT NULL) AS has_winning_index,
        countIf(resolved_at IS NOT NULL) AS has_resolved_at,
        countIf(length(payout_numerators) > 0) AS has_payout_data,
        round(countIf(resolved_at IS NOT NULL) / count() * 100, 1) AS pct_resolved_at
      FROM market_resolutions_norm
    `,
    format: 'JSONEachRow'
  });

  const result1: any = (await query1.json())[0];

  console.log('Market Resolutions Summary:\n');
  console.log(`  Total rows: ${parseInt(result1.total).toLocaleString()}`);
  console.log(`  Has winning_index: ${parseInt(result1.has_winning_index).toLocaleString()}`);
  console.log(`  Has resolved_at: ${parseInt(result1.has_resolved_at).toLocaleString()}`);
  console.log(`  Has payout data: ${parseInt(result1.has_payout_data).toLocaleString()}`);
  console.log(`  % with resolved_at: ${result1.pct_resolved_at}%\n`);

  // Sample some with resolved_at
  console.log('📊 Sampling resolutions WITH resolved_at...\n');

  const query2 = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        winning_index,
        length(payout_numerators) AS payout_len,
        payout_denominator,
        resolved_at
      FROM market_resolutions_norm
      WHERE resolved_at IS NOT NULL
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await query2.json();

  console.table(samples.map(s => ({
    condition_id: s.condition_id_norm.substring(0, 20) + '...',
    winning_idx: s.winning_index,
    payout_len: s.payout_len,
    denominator: s.payout_denominator,
    resolved_at: s.resolved_at
  })));

  console.log('\n✅ ANALYSIS COMPLETE\n');
}

main().catch(console.error);
