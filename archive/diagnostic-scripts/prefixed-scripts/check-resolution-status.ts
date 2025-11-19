/**
 * CHECK RESOLUTION STATUS
 *
 * Purpose: Check if our 5 markets are actually resolved
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('RESOLUTION STATUS CHECK');
  console.log('═══════════════════════════════════════════════════════════\n');

  // Our 5 market_hex64 IDs from the bridge
  const marketIds = [
    '6541d506c7a337b80fb9e4ed7487347a90d8c59071136e7caa11dc42b3755eb5',
    'ee3a389d0c1345900a200d0d11d241bd30bc05a6c761d69b741a967bf98830d2',
    '272e4714ca468e123349f2aceb8d5a683c187660a1b7a1ae28fbfd2ccd4ac2a0',
    '8e02dc3233cf073a64a9f0466ef8ddbe1f984e4b87eacfd1b8d10c725e042f39',
    '03bf5c66a49c7f44661d99dc3784f3cb4484c0aa8459723bd770680512e72f82'
  ];

  const conditionIds = [
    '00029c52d867b6de3389caaa75da422c484dfaeb16c56d50eb02bbf7ffabb193',
    '009f37e89c66465d7680ef60341a76ba553bb08437df158e7046b48618c4a822',
    '0025b007710895f83b03f3726b951ac8e383c709d51d623ae531e46119bd4c13',
    '00357a089afabe5dc62bab131332a28bfcc3dc73b23d547643386e77aeab36f4',
    '0004eb7841564beb8a9fef181174d9a984bc3511874b7f4233cbf2becae4fc6c'
  ];

  for (let i = 0; i < marketIds.length; i++) {
    const marketId = marketIds[i];
    const condId = conditionIds[i];

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Market ${i + 1}:`);
    console.log(`  Market ID: ${marketId}`);
    console.log(`  Condition ID: ${condId}`);
    console.log(`${'='.repeat(80)}\n`);

    // Check if resolved in market_resolutions_by_market
    const byMarketQuery = await clickhouse.query({
      query: `
        SELECT
          market_slug,
          condition_id_norm,
          winning_index,
          payout_numerators,
          resolved_at
        FROM market_resolutions_by_market
        WHERE market_hex64 = '${marketId}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });

    const byMarket: any[] = await byMarketQuery.json();
    if (byMarket.length > 0) {
      console.log('✅ Found in market_resolutions_by_market:');
      console.log(`  Market Slug: ${byMarket[0].market_slug}`);
      console.log(`  Condition ID: ${byMarket[0].condition_id_norm}`);
      console.log(`  Winning Index: ${byMarket[0].winning_index}`);
      console.log(`  Payout: ${JSON.stringify(byMarket[0].payout_numerators)}`);
      console.log(`  Resolved At: ${byMarket[0].resolved_at}\n`);

      // Check if THIS condition_id is in market_resolutions_final
      const finalQuery = await clickhouse.query({
        query: `
          SELECT
            condition_id_norm,
            winning_index,
            payout_numerators
          FROM market_resolutions_final
          WHERE condition_id_norm = '${byMarket[0].condition_id_norm}'
          LIMIT 1
        `,
        format: 'JSONEachRow'
      });

      const final: any[] = await finalQuery.json();
      if (final.length > 0) {
        console.log('✅✅ Also in market_resolutions_final (ready to use!)');
      } else {
        console.log('❌ NOT in market_resolutions_final (missing!)');
      }
    } else {
      console.log('❌ NOT found in market_resolutions_by_market');
      console.log('   Market is likely unresolved\n');
    }
  }

  // Check overall resolution rate for this wallet
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('OVERALL RESOLUTION COVERAGE');
  console.log('═══════════════════════════════════════════════════════════\n');

  const coverageQuery = await clickhouse.query({
    query: `
      WITH wallet_positions AS (
        SELECT
          asset_id,
          sum(if(side = 'BUY', 1, -1) * size / 1000000.0) as net_shares,
          lpad(lower(hex(bitShiftRight(toUInt256(asset_id), 8))), 64, '0') AS condition_id_norm
        FROM clob_fills
        WHERE proxy_wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b'
        GROUP BY asset_id
        HAVING net_shares != 0
      )
      SELECT
        COUNT(*) as total_positions,
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as resolved_positions,
        SUM(CASE WHEN r.condition_id_norm IS NULL THEN 1 ELSE 0 END) as unresolved_positions
      FROM wallet_positions wp
      LEFT JOIN market_resolutions_final r ON wp.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow'
  });

  const coverage: any = (await coverageQuery.json())[0];
  console.log(`Total Open Positions: ${coverage.total_positions}`);
  console.log(`Resolved: ${coverage.resolved_positions}`);
  console.log(`Unresolved: ${coverage.unresolved_positions}`);
  console.log(`Resolution Rate: ${(coverage.resolved_positions / coverage.total_positions * 100).toFixed(1)}%\n`);

  console.log('✅ STATUS CHECK COMPLETE\n');
}

main().catch(console.error);
