#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER ?? 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  request_timeout: 120000
});

async function main() {
  console.log('\n📊 RESOLUTION COVERAGE VERIFICATION\n');
  console.log('═'.repeat(80));

  console.log('\n1️⃣ Market Coverage:\n');

  const marketCoverage = await ch.query({
    query: `
      WITH
        traded_ids AS (
          SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as cid_norm
          FROM default.fact_trades_clean
        ),
        all_resolutions AS (
          SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid_norm
          FROM default.market_resolutions_final
          WHERE payout_denominator > 0
          UNION ALL
          SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid_norm
          FROM default.resolutions_external_ingest
          WHERE payout_denominator > 0
        )
      SELECT
        COUNT(DISTINCT t.cid_norm) as total_traded,
        COUNT(DISTINCT CASE WHEN r.cid_norm IS NOT NULL THEN t.cid_norm END) as with_resolution,
        ROUND(100.0 * with_resolution / total_traded, 2) as coverage_pct
      FROM traded_ids t
      LEFT JOIN all_resolutions r ON t.cid_norm = r.cid_norm
    `,
    format: 'JSONEachRow'
  });

  const mData = await marketCoverage.json();
  console.log('  Markets:');
  console.log('    Total: ' + parseInt(mData[0].total_traded).toLocaleString());
  console.log('    With resolutions: ' + parseInt(mData[0].with_resolution).toLocaleString());
  console.log('    Coverage: ' + mData[0].coverage_pct + '%\n');

  console.log('2️⃣ Position Coverage:\n');

  const positionCoverage = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_positions,
        COUNT(CASE WHEN payout_denominator > 0 THEN 1 END) as resolved,
        ROUND(100.0 * resolved / total_positions, 2) as coverage_pct
      FROM default.vw_wallet_pnl_calculated
    `,
    format: 'JSONEachRow'
  });

  const pData = await positionCoverage.json();
  console.log('  Positions:');
  console.log('    Total: ' + parseInt(pData[0].total_positions).toLocaleString());
  console.log('    With resolutions: ' + parseInt(pData[0].resolved).toLocaleString());
  console.log('    Coverage: ' + pData[0].coverage_pct + '%\n');

  const baseline = 11.88;
  const improvement = pData[0].coverage_pct - baseline;

  console.log('3️⃣ Baseline Comparison:\n');
  console.log('  Baseline: ' + baseline + '%');
  console.log('  Current: ' + pData[0].coverage_pct + '%');
  console.log('  Change: ' + (improvement > 0 ? '+' : '') + improvement.toFixed(2) + '%\n');

  console.log('═'.repeat(80));
  console.log('\n🔍 DIAGNOSIS:\n');

  if (pData[0].coverage_pct > 25) {
    console.log('✅ SUCCESS: Resolution data working correctly\n');
  } else {
    console.log('⚠️  ISSUE: Coverage low - check joins in vw_wallet_pnl_calculated\n');
  }

  await ch.close();
}

main();
