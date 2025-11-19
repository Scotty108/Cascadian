#!/usr/bin/env tsx
/**
 * Check actual values in market_resolutions_final table
 * for wallet 0x4ce7's markets
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

const TEST_WALLET = '0x4ce73141dbfce41e65db3723e31059a730f0abad';

async function main() {
  console.log('\n' + '═'.repeat(80));
  console.log('🔍 CHECKING RESOLUTION TABLE VALUES');
  console.log('═'.repeat(80));

  // Get wallet's markets and their resolution data
  const result = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id_norm
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = '${TEST_WALLET}'
        LIMIT 10
      )
      SELECT
        r.condition_id_norm,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_outcome,
        length(r.payout_numerators) as num_outcomes
      FROM wallet_markets wm
      INNER JOIN default.market_resolutions_final r
        ON wm.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const resolutions = await result.json();

  console.log(`\n📊 Found ${resolutions.length} resolution records:\n`);

  resolutions.forEach((r: any, i: number) => {
    console.log(`${i + 1}. CID: ${r.condition_id_norm.substring(0, 16)}...`);
    console.log(`   payout_numerators: [${r.payout_numerators}]`);
    console.log(`   payout_denominator: ${r.payout_denominator}`);
    console.log(`   winning_outcome: ${r.winning_outcome}`);
    console.log(`   num_outcomes: ${r.num_outcomes}`);

    // Check if this would qualify as "resolved"
    if (r.payout_denominator > 0) {
      console.log(`   ✅ RESOLVED`);
    } else {
      console.log(`   ❌ NOT RESOLVED (denominator = ${r.payout_denominator})`);
    }
    console.log('');
  });

  // Check a sample of globally resolved markets for comparison
  console.log('\n📊 For comparison, sample of globally RESOLVED markets:\n');

  const globalSample = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_outcome,
        length(payout_numerators) as num_outcomes
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const globalResolved = await globalSample.json();
  globalResolved.forEach((r: any, i: number) => {
    console.log(`${i + 1}. CID: ${r.condition_id_norm.substring(0, 16)}...`);
    console.log(`   payout_numerators: [${r.payout_numerators}]`);
    console.log(`   payout_denominator: ${r.payout_denominator}`);
    console.log(`   ✅ This is what a resolved market looks like`);
    console.log('');
  });

  // Check table statistics
  console.log('\n📊 Table statistics:\n');

  const stats = await ch.query({
    query: `
      SELECT
        COUNT(*) as total_records,
        SUM(CASE WHEN payout_denominator > 0 THEN 1 ELSE 0 END) as has_denominator,
        SUM(CASE WHEN payout_denominator = 0 THEN 1 ELSE 0 END) as zero_denominator,
        SUM(CASE WHEN payout_denominator IS NULL THEN 1 ELSE 0 END) as null_denominator,
        SUM(CASE WHEN length(payout_numerators) = 0 THEN 1 ELSE 0 END) as empty_numerators
      FROM default.market_resolutions_final
    `,
    format: 'JSONEachRow',
  });

  const tableStats = await stats.json();
  console.log(JSON.stringify(tableStats[0], null, 2));

  console.log('\n' + '═'.repeat(80));
  console.log('✅ CHECK COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
