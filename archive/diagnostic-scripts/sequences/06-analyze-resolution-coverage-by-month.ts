/**
 * 06: ANALYZE RESOLUTION COVERAGE BY MONTH
 *
 * Find months where traded assets have resolution data
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('06: ANALYZE RESOLUTION COVERAGE BY MONTH');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 Checking resolution overlap for traded assets...\n');

  const query = await clickhouse.query({
    query: `
      WITH cm AS (
        SELECT asset_id, condition_id_norm, outcome_index
        FROM ctf_token_map_norm
      )
      SELECT
        toStartOfMonth(cf.timestamp) AS month,
        countDistinct(cf.asset_id) AS assets_traded,
        countDistinctIf(cf.asset_id, r.winning_index IS NOT NULL) AS assets_with_resolution,
        round(countDistinctIf(cf.asset_id, r.winning_index IS NOT NULL) / countDistinct(cf.asset_id) * 100, 1) AS pct_coverage
      FROM clob_fills cf
      INNER JOIN cm ON cm.asset_id = cf.asset_id
      LEFT JOIN market_resolutions_norm r ON r.condition_id_norm = cm.condition_id_norm
      WHERE cf.timestamp >= '2024-01-01'
      GROUP BY month
      ORDER BY month DESC
    `,
    format: 'JSONEachRow'
  });

  const results: any[] = await query.json();

  console.log('Month-by-Month Coverage:\n');
  console.table(results.map((r: any) => ({
    month: r.month,
    traded: parseInt(r.assets_traded).toLocaleString(),
    resolved: parseInt(r.assets_with_resolution).toLocaleString(),
    coverage: r.pct_coverage + '%'
  })));

  // Find best month
  const bestMonth = results.reduce((best, curr) => {
    const currCoverage = parseFloat(curr.pct_coverage);
    const bestCoverage = best ? parseFloat(best.pct_coverage) : 0;
    return (currCoverage > bestCoverage && currCoverage > 0) ? curr : best;
  }, null);

  if (bestMonth && parseFloat(bestMonth.pct_coverage) >= 50) {
    console.log('\n✅ FOUND VIABLE MONTH:\n');
    console.log(`  Month: ${bestMonth.month}`);
    console.log(`  Assets traded: ${parseInt(bestMonth.assets_traded).toLocaleString()}`);
    console.log(`  Assets resolved: ${parseInt(bestMonth.assets_with_resolution).toLocaleString()}`);
    console.log(`  Coverage: ${bestMonth.pct_coverage}%\n`);
    console.log('📝 Use this month for control wallet search\n');
  } else if (bestMonth) {
    console.log('\n⚠️  BEST MONTH HAS LOW COVERAGE:\n');
    console.log(`  Month: ${bestMonth.month}`);
    console.log(`  Coverage: ${bestMonth.pct_coverage}%\n`);
    console.log('📝 Consider cross-wallet fixture or different date range\n');
  } else {
    console.log('\n❌ NO MONTHS WITH RESOLUTION COVERAGE\n');
    console.log('📝 Need to investigate resolution data pipeline\n');
  }

  console.log('✅ ANALYSIS COMPLETE\n');
}

main().catch(console.error);
