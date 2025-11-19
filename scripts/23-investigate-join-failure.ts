import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { clickhouse } from '../lib/clickhouse/client';

const EOA = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

async function investigateJoinFailure() {
  console.log('=== Investigating Join Failure ===\n');
  console.log('Why do vw_trades_canonical condition_ids NOT match market_resolutions_final?\n');

  // Sample condition IDs from vw_trades_canonical
  const vwQuery = `
    SELECT DISTINCT
      condition_id_norm,
      length(condition_id_norm) AS len
    FROM vw_trades_canonical
    WHERE lower(wallet_address_norm) = lower('${EOA}')
      AND condition_id_norm IS NOT NULL
      AND condition_id_norm != ''
    LIMIT 10
  `;

  const vwResult = await clickhouse.query({ query: vwQuery, format: 'JSONEachRow' });
  const vwSample = await vwResult.json<any[]>();

  console.log('Sample condition_ids from vw_trades_canonical:');
  vwSample.forEach((row, i) => {
    console.log(`  [${i + 1}] ${row.condition_id_norm} (len=${row.len})`);
  });
  console.log('');

  // Sample condition IDs from pm_trades_canonical_v3
  const v3Query = `
    SELECT DISTINCT
      condition_id_norm_v3,
      length(condition_id_norm_v3) AS len
    FROM pm_trades_canonical_v3
    WHERE lower(wallet_address) = lower('${EOA}')
      AND condition_id_norm_v3 IS NOT NULL
      AND condition_id_norm_v3 != ''
    LIMIT 10
  `;

  const v3Result = await clickhouse.query({ query: v3Query, format: 'JSONEachRow' });
  const v3Sample = await v3Result.json<any[]>();

  console.log('Sample condition_ids from pm_trades_canonical_v3:');
  v3Sample.forEach((row, i) => {
    console.log(`  [${i + 1}] ${row.condition_id_norm_v3} (len=${row.len})`);
  });
  console.log('');

  // Sample condition IDs from market_resolutions_final
  const resQuery = `
    SELECT condition_id_norm, length(condition_id_norm) AS len
    FROM market_resolutions_final
    WHERE payout_denominator > 0
    LIMIT 10
  `;

  const resResult = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resSample = await resResult.json<any[]>();

  console.log('Sample condition_ids from market_resolutions_final:');
  resSample.forEach((row, i) => {
    console.log(`  [${i + 1}] ${row.condition_id_norm} (len=${row.len})`);
  });
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('KEY FINDING:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Check if vw_trades_canonical has 0x prefix
  if (vwSample.length > 0 && vwSample[0].len === 66) {
    console.log('⚠️  vw_trades_canonical condition_ids have 0x prefix (66 chars)');
  } else if (vwSample.length > 0 && vwSample[0].len === 64) {
    console.log('✅ vw_trades_canonical condition_ids are normalized (64 chars)');
  }

  if (v3Sample.length > 0 && v3Sample[0].len === 66) {
    console.log('⚠️  pm_trades_canonical_v3 condition_ids have 0x prefix (66 chars)');
  } else if (v3Sample.length > 0 && v3Sample[0].len === 64) {
    console.log('✅ pm_trades_canonical_v3 condition_ids are normalized (64 chars)');
  }

  if (resSample.length > 0 && resSample[0].len === 64) {
    console.log('✅ market_resolutions_final condition_ids are normalized (64 chars)');
  }

  console.log('');

  // Try to find matches manually
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('MANUAL JOIN TEST:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  if (vwSample.length > 0) {
    const testCondition = vwSample[0].condition_id_norm;
    console.log(`Testing condition: ${testCondition}\n`);

    // Try exact match
    const exactQuery = `
      SELECT count() AS matches
      FROM market_resolutions_final
      WHERE condition_id_norm = '${testCondition}'
    `;

    const exactResult = await clickhouse.query({ query: exactQuery, format: 'JSONEachRow' });
    const exact = await exactResult.json<any[]>();

    console.log(`Exact match in market_resolutions_final: ${exact[0].matches}`);

    if (exact[0].matches === 0) {
      // Try without 0x
      const normalized = testCondition.toLowerCase().replace('0x', '');
      const normalizedQuery = `
        SELECT count() AS matches
        FROM market_resolutions_final
        WHERE condition_id_norm = '${normalized}'
      `;

      const normalizedResult = await clickhouse.query({ query: normalizedQuery, format: 'JSONEachRow' });
      const normalizedMatches = await normalizedResult.json<any[]>();

      console.log(`Match after removing 0x: ${normalizedMatches[0].matches}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('SOLUTION:');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');
  console.log('vw_trades_canonical likely has 0x-prefixed condition_ids that need normalization');
  console.log('to match market_resolutions_final (which uses 64-char hex without 0x).');
  console.log('');
  console.log('Recommendation: Use pm_trades_canonical_v3 which already has normalized IDs.');
  console.log('');
}

investigateJoinFailure().catch(console.error);
