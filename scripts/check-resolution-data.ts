import { config } from 'dotenv';
import { resolve } from 'path';
import { clickhouse } from '../lib/clickhouse/client';

config({ path: resolve(process.cwd(), '.env.local') });

async function checkResolutions() {
  console.log('Checking resolution data coverage...\n');

  // Check how many markets have resolution data
  const stats = await clickhouse.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        SUM(CASE WHEN resolved_at IS NOT NULL AND resolved_at != '' THEN 1 ELSE 0 END) as resolved_count,
        SUM(CASE WHEN resolved_at IS NULL OR resolved_at = '' THEN 1 ELSE 0 END) as unresolved_count,
        MIN(resolved_at) as earliest_resolution,
        MAX(resolved_at) as latest_resolution
      FROM realized_pnl_by_market_final
    `,
    format: 'JSONEachRow',
  });

  const data = await stats.json();
  console.log('Overall resolution stats:');
  console.log(JSON.stringify(data[0], null, 2));
  console.log();

  // Sample some resolved markets
  const resolved = await clickhouse.query({
    query: `
      SELECT
        wallet,
        market_id,
        realized_pnl_usd,
        resolved_at
      FROM realized_pnl_by_market_final
      WHERE resolved_at IS NOT NULL AND resolved_at != ''
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const resolvedSample = await resolved.json();
  console.log('Sample of resolved markets:');
  console.log(JSON.stringify(resolvedSample, null, 2));
  console.log();

  // Check if problem is with this specific wallet or system-wide
  const totalResolved = parseInt(data[0].resolved_count);
  const totalUnresolved = parseInt(data[0].unresolved_count);
  const totalMarkets = totalResolved + totalUnresolved;
  const resolvedPct = (totalResolved / totalMarkets) * 100;

  console.log('ANALYSIS:');
  console.log(`  Total markets in DB: ${totalMarkets}`);
  console.log(`  Resolved: ${totalResolved} (${resolvedPct.toFixed(1)}%)`);
  console.log(`  Unresolved: ${totalUnresolved} (${(100 - resolvedPct).toFixed(1)}%)`);
  console.log();

  if (resolvedPct < 5) {
    console.log('CRITICAL: Less than 5% of markets have resolution data!');
    console.log('This suggests the resolved_at field is not being populated.');
  }
}

checkResolutions().catch(console.error);
