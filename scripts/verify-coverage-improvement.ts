#!/usr/bin/env tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

(async () => {
  console.log('\n📊 Verifying P&L Coverage Improvement...\n');

  // Before: Only market_resolutions_final
  const beforeCoverage = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      )
      SELECT
        COUNT(*) as total_traded,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout
      FROM traded_markets tm
      LEFT JOIN default.market_resolutions_final r
        ON tm.condition_id = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  // After: Including resolutions_external_ingest
  const afterCoverage = await ch.query({
    query: `
      WITH traded_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id
        FROM default.fact_trades_clean
      ),
      all_resolutions AS (
        SELECT condition_id_norm as condition_id, payout_denominator
        FROM default.market_resolutions_final
        UNION ALL
        SELECT condition_id, payout_denominator
        FROM default.resolutions_external_ingest
      )
      SELECT
        COUNT(*) as total_traded,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_payout
      FROM traded_markets tm
      LEFT JOIN all_resolutions r
        ON tm.condition_id = r.condition_id
    `,
    format: 'JSONEachRow',
  });

  const beforeStats = await beforeCoverage.json();
  const afterStats = await afterCoverage.json();

  const totalTraded = parseInt(beforeStats[0].total_traded);
  const beforePayout = parseInt(beforeStats[0].has_payout);
  const afterPayout = parseInt(afterStats[0].has_payout);

  const beforePct = (beforePayout / totalTraded) * 100;
  const afterPct = (afterPayout / totalTraded) * 100;
  const improvement = afterPayout - beforePayout;

  console.log('📈 Coverage Improvement Results:\n');
  console.log(`  Total traded markets: ${totalTraded.toLocaleString()}`);
  console.log(`  Before: ${beforePayout.toLocaleString()} markets (${beforePct.toFixed(1)}%)`);
  console.log(`  After:  ${afterPayout.toLocaleString()} markets (${afterPct.toFixed(1)}%)`);
  console.log(`  Improvement: +${improvement.toLocaleString()} markets (+${(afterPct - beforePct).toFixed(1)}%)\n`);

  if (afterPct >= 85) {
    console.log('✅ SUCCESS: Achieved target of 85%+ coverage!');
  } else if (afterPct >= 75) {
    console.log('✅ GOOD: Achieved 75%+ coverage (close to target)');
  } else {
    console.log('⚠️  Below target: Additional investigation needed');
  }

  await ch.close();
})();
