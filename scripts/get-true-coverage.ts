#!/usr/bin/env npx tsx
/**
 * Get TRUE Coverage
 * Simple, straightforward coverage calculation
 */

import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
});

async function main() {
  console.log('\n📊 TRUE COVERAGE CALCULATION\n');
  console.log('═'.repeat(80));

  // 1. Count unique traded condition_ids
  console.log('\n1️⃣ Counting unique traded markets:\n');

  const tradedCount = await ch.query({
    query: `
      SELECT COUNT(DISTINCT lower(replaceAll(cid, '0x', ''))) as count
      FROM default.fact_trades_clean
    `,
    format: 'JSONEachRow'
  });

  const traded = await tradedCount.json<any>();
  console.log(`  Unique traded markets: ${parseInt(traded[0].count).toLocaleString()}\n`);

  // 2. Count unique resolved condition_ids
  console.log('2️⃣ Counting unique resolved markets:\n');

  const resolvedCount = await ch.query({
    query: `
      SELECT COUNT(DISTINCT cid_norm) as count
      FROM (
        SELECT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0
        UNION ALL
        SELECT lower(replaceAll(condition_id, '0x', '')) as cid_norm
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
    `,
    format: 'JSONEachRow'
  });

  const resolved = await resolvedCount.json<any>();
  console.log(`  Unique resolved markets: ${parseInt(resolved[0].count).toLocaleString()}\n`);

  // 3. Count overlap (traded AND resolved)
  console.log('3️⃣ Counting overlap (traded AND resolved):\n');

  const overlapCount = await ch.query({
    query: `
      WITH
        traded AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        ),
        resolved AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      SELECT COUNT(*) as count
      FROM traded t
      INNER JOIN resolved r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const overlap = await overlapCount.json<any>();
  console.log(`  Overlap (traded AND resolved): ${parseInt(overlap[0].count).toLocaleString()}\n`);

  // 4. Calculate coverage
  const totalTraded = parseInt(traded[0].count);
  const totalResolved = parseInt(resolved[0].count);
  const totalOverlap = parseInt(overlap[0].count);

  const marketCoverage = (totalOverlap / totalTraded * 100).toFixed(2);

  console.log('4️⃣ Coverage calculation:\n');
  console.log(`  Traded markets: ${totalTraded.toLocaleString()}`);
  console.log(`  With resolutions: ${totalOverlap.toLocaleString()}`);
  console.log(`  Without resolutions: ${(totalTraded - totalOverlap).toLocaleString()}`);
  console.log(`  Market coverage: ${marketCoverage}%\n`);

  // 5. Position coverage
  console.log('5️⃣ Position coverage:\n');

  const positionCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved,
        ROUND(resolved / total * 100, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });

  const posData = await positionCoverage.json<any>();
  console.log(`  Total positions: ${parseInt(posData[0].total).toLocaleString()}`);
  console.log(`  Resolved: ${parseInt(posData[0].resolved).toLocaleString()}`);
  console.log(`  Coverage: ${posData[0].coverage_pct}%\n`);

  console.log('═'.repeat(80));
  console.log('📊 TRUTH\n');

  console.log(`Market coverage: ${marketCoverage}%`);
  console.log(`Position coverage: ${posData[0].coverage_pct}%\n`);

  const marketPct = parseFloat(marketCoverage);

  if (marketPct >= 75) {
    console.log('✅ Coverage is good (≥75%)');
  } else if (marketPct >= 50) {
    console.log('⚠️  Coverage is moderate (50-75%)');
  } else {
    console.log('❌ Coverage is low (<50%)');
  }

  console.log(`\nMissing: ${(totalTraded - totalOverlap).toLocaleString()} markets need resolutions\n`);

  console.log('═'.repeat(80) + '\n');

  await ch.close();
}

main();
