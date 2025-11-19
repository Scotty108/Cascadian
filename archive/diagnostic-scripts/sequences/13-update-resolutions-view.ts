/**
 * 13: UPDATE MARKET_RESOLUTIONS_NORM VIEW
 *
 * Enrich market_resolutions_norm with resolution_timestamps
 * Using coalesce to fill in missing resolved_at values
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('13: UPDATE MARKET_RESOLUTIONS_NORM VIEW');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Updating market_resolutions_norm with timestamp enrichment...\n');

  // Update view with coalesce logic
  await clickhouse.command({
    query: `
      CREATE OR REPLACE VIEW market_resolutions_norm AS
      SELECT
        mr.condition_id_norm,
        mr.winning_index,
        mr.payout_numerators,
        ifNull(mr.payout_denominator, 1) AS payout_denominator,
        coalesce(mr.resolved_at, rt.resolved_at) AS resolved_at
      FROM market_resolutions_final mr
      LEFT JOIN resolution_timestamps rt
        ON rt.condition_id_norm = mr.condition_id_norm
    `
  });

  console.log('✅ Updated market_resolutions_norm view\n');

  // Validate enrichment
  const query = await clickhouse.query({
    query: `
      SELECT
        count() AS total,
        countIf(resolved_at IS NOT NULL) AS has_resolved_at,
        round(countIf(resolved_at IS NOT NULL) / count() * 100, 1) AS pct_enriched
      FROM market_resolutions_norm
    `,
    format: 'JSONEachRow'
  });

  const stats: any = (await query.json())[0];

  console.log('Market Resolutions After Enrichment:\n');
  console.log(`  Total rows: ${parseInt(stats.total).toLocaleString()}`);
  console.log(`  Has resolved_at: ${parseInt(stats.has_resolved_at).toLocaleString()}`);
  console.log(`  % enriched: ${stats.pct_enriched}%\n`);

  console.log('✅ VIEW UPDATE COMPLETE\n');
  console.log('Next: Check overlap with traded assets\n');
}

main().catch(console.error);
