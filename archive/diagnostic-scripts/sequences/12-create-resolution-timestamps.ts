/**
 * 12: CREATE RESOLUTION_TIMESTAMPS TABLE
 *
 * Build authoritative resolution timestamps from on-chain events
 * Fix: Enrich resolved_at from resolutions_external_ingest table
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('12: CREATE RESOLUTION_TIMESTAMPS TABLE');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Building resolution_timestamps from resolutions_external_ingest...\n');

  // Create authoritative resolution_timestamps table
  await clickhouse.command({
    query: `
      CREATE TABLE IF NOT EXISTS resolution_timestamps
      ENGINE = ReplacingMergeTree()
      ORDER BY condition_id_norm
      AS
      SELECT
        condition_id_norm,
        earliest_resolved_at AS resolved_at,
        payout_numerators_from_chain,
        winning_index_from_chain
      FROM (
        SELECT
          lpad(lower(replaceAll(condition_id, '0x', '')), 64, '0') AS condition_id_norm,
          min(resolved_at) AS earliest_resolved_at,
          anyLast(payout_numerators) AS payout_numerators_from_chain,
          anyLast(winning_index) AS winning_index_from_chain
        FROM resolutions_external_ingest
        WHERE resolutions_external_ingest.resolved_at IS NOT NULL
        GROUP BY condition_id_norm
      )
    `
  });

  console.log('✅ Created resolution_timestamps table\n');

  // Validate
  const query = await clickhouse.query({
    query: `
      SELECT
        count() AS total_resolutions,
        countIf(resolved_at IS NOT NULL) AS has_timestamp,
        countIf(length(payout_numerators_from_chain) > 0) AS has_payouts,
        min(resolved_at) AS earliest_resolution,
        max(resolved_at) AS latest_resolution
      FROM resolution_timestamps
    `,
    format: 'JSONEachRow'
  });

  const stats: any = (await query.json())[0];

  console.log('Resolution Timestamps Summary:\n');
  console.log(`  Total resolutions: ${parseInt(stats.total_resolutions).toLocaleString()}`);
  console.log(`  Has timestamp: ${parseInt(stats.has_timestamp).toLocaleString()}`);
  console.log(`  Has payouts: ${parseInt(stats.has_payouts).toLocaleString()}`);
  console.log(`  Date range: ${stats.earliest_resolution} to ${stats.latest_resolution}\n`);

  // Sample some rows
  const sampleQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        resolved_at,
        length(payout_numerators_from_chain) AS payout_len,
        winning_index_from_chain
      FROM resolution_timestamps
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });

  const samples: any[] = await sampleQuery.json();

  console.log('Sample resolutions:\n');
  console.table(samples.map(s => ({
    condition_id: s.condition_id_norm.substring(0, 20) + '...',
    resolved_at: s.resolved_at,
    payout_len: s.payout_len,
    winning_idx: s.winning_index_from_chain
  })));

  console.log('\n✅ RESOLUTION_TIMESTAMPS TABLE READY\n');
  console.log('Next: Update market_resolutions_norm view with coalesce logic\n');
}

main().catch(console.error);
