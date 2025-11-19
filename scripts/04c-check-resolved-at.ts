import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

async function checkResolvedAt() {
  console.log('=== Checking resolved_at Field ===\n');

  // Check how many resolutions have non-null resolved_at
  const query = `
    SELECT
      count() AS total,
      countIf(resolved_at IS NOT NULL) AS with_resolved_at,
      countIf(resolved_at IS NULL) AS without_resolved_at,
      countIf(winning_index > 0 OR arrayExists(x -> x > 0, payout_numerators)) AS has_winner_data
    FROM market_resolutions_final
  `;

  const result = await clickhouse.query({ query, format: 'JSONEachRow' });
  const data = await result.json<any[]>();

  console.log('Resolution table statistics:');
  console.log(`  Total resolutions:           ${data[0].total}`);
  console.log(`  With resolved_at (not null): ${data[0].with_resolved_at}`);
  console.log(`  With resolved_at (null):     ${data[0].without_resolved_at}`);
  console.log(`  Has winner/payout data:      ${data[0].has_winner_data}`);
  console.log('');

  // Sample of resolutions with non-null resolved_at
  if (Number(data[0].with_resolved_at) > 0) {
    console.log('Sample of resolutions WITH resolved_at:');
    const sampleQuery = `
      SELECT condition_id_norm, winning_index, resolved_at
      FROM market_resolutions_final
      WHERE resolved_at IS NOT NULL
      LIMIT 5
    `;
    const sampleResult = await clickhouse.query({ query: sampleQuery, format: 'JSONEachRow' });
    const samples = await sampleResult.json<any[]>();
    samples.forEach(s => {
      console.log(`  ${s.condition_id_norm.substring(0, 12)}... winner: ${s.winning_index}, resolved: ${s.resolved_at}`);
    });
    console.log('');
  }

  // Sample of resolutions without resolved_at but with winner data
  console.log('Sample of resolutions WITHOUT resolved_at but WITH payout data:');
  const sample2Query = `
    SELECT
      condition_id_norm,
      winning_index,
      payout_numerators,
      payout_denominator,
      resolved_at
    FROM market_resolutions_final
    WHERE resolved_at IS NULL
      AND (winning_index > 0 OR arrayExists(x -> x > 0, payout_numerators))
    LIMIT 5
  `;
  const sample2Result = await clickhouse.query({ query: sample2Query, format: 'JSONEachRow' });
  const samples2 = await sample2Result.json<any[]>();

  if (samples2.length > 0) {
    samples2.forEach(s => {
      console.log(`  ${s.condition_id_norm.substring(0, 12)}... winner: ${s.winning_index}, payouts: [${s.payout_numerators}], resolved_at: ${s.resolved_at}`);
    });
    console.log('');
    console.log('✓ These resolutions have winner/payout data but null resolved_at.');
    console.log('  We can use payout data to calculate PnL without relying on resolved_at.');
  } else {
    console.log('  (none found)');
  }
  console.log('');
}

checkResolvedAt().catch(console.error);
