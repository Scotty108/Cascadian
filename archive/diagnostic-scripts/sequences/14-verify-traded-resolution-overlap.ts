/**
 * 14: VERIFY TRADED RESOLUTION OVERLAP
 *
 * Check if enriched timestamps now provide overlap with traded assets
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('14: VERIFY TRADED RESOLUTION OVERLAP');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Checking overlap between traded assets and resolutions...\n');

  const query = await clickhouse.query({
    query: `
      WITH cm AS (
        SELECT asset_id, condition_id_norm, outcome_index
        FROM ctf_token_map_norm
      )
      SELECT
        count() AS total_fills,
        countDistinct(cf.asset_id) AS unique_assets,
        countDistinctIf(cf.asset_id, r.winning_index IS NOT NULL) AS assets_with_winning_index,
        countDistinctIf(cf.asset_id, r.resolved_at IS NOT NULL) AS assets_with_resolved_at,
        countDistinctIf(cf.asset_id, r.resolved_at IS NOT NULL AND r.winning_index IS NOT NULL) AS assets_fully_resolved,
        round(countDistinctIf(cf.asset_id, r.resolved_at IS NOT NULL) / countDistinct(cf.asset_id) * 100, 1) AS pct_with_timestamp
      FROM clob_fills cf
      INNER JOIN cm ON cm.asset_id = cf.asset_id
      LEFT JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
      WHERE cf.timestamp >= '2024-01-01'
    `,
    format: 'JSONEachRow'
  });

  const stats: any = (await query.json())[0];

  console.log('Traded Assets vs Resolutions:\n');
  console.log(`  Total fills: ${parseInt(stats.total_fills).toLocaleString()}`);
  console.log(`  Unique assets: ${parseInt(stats.unique_assets).toLocaleString()}`);
  console.log(`  With winning_index: ${parseInt(stats.assets_with_winning_index).toLocaleString()}`);
  console.log(`  With resolved_at: ${parseInt(stats.assets_with_resolved_at).toLocaleString()}`);
  console.log(`  Fully resolved: ${parseInt(stats.assets_fully_resolved).toLocaleString()}`);
  console.log(`  % with timestamp: ${stats.pct_with_timestamp}%\n`);

  // Check by month
  console.log('📊 Checking overlap by month...\n');

  const monthQuery = await clickhouse.query({
    query: `
      WITH cm AS (
        SELECT asset_id, condition_id_norm, outcome_index
        FROM ctf_token_map_norm
      )
      SELECT
        toStartOfMonth(cf.timestamp) AS month,
        countDistinct(cf.asset_id) AS assets_traded,
        countDistinctIf(cf.asset_id, r.resolved_at IS NOT NULL) AS assets_resolved,
        round(countDistinctIf(cf.asset_id, r.resolved_at IS NOT NULL) / countDistinct(cf.asset_id) * 100, 1) AS pct_resolved
      FROM clob_fills cf
      INNER JOIN cm ON cm.asset_id = cf.asset_id
      LEFT JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
      WHERE cf.timestamp >= '2024-01-01'
      GROUP BY month
      ORDER BY month DESC
      LIMIT 12
    `,
    format: 'JSONEachRow'
  });

  const months: any[] = await monthQuery.json();

  console.table(months.map(m => ({
    month: m.month,
    traded: parseInt(m.assets_traded).toLocaleString(),
    resolved: parseInt(m.assets_resolved).toLocaleString(),
    pct: m.pct_resolved + '%'
  })));

  console.log('\n✅ OVERLAP VERIFICATION COMPLETE\n');

  if (parseInt(stats.assets_fully_resolved) > 0) {
    console.log('🎉 SUCCESS: Found resolved positions in traded assets!\n');
    console.log('Next: Rebuild fixture with proper W/L/O distribution\n');
  } else {
    console.log('⚠️  Still no overlap - need to investigate further\n');
  }
}

main().catch(console.error);
