import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

const MISSING_CTFS = [
  '001dcf4c1446fcacb42af305419f7310e7c9c356b2366367c25eb7d6fb202b48',
  '00f92278bd8759aa69d9d1286f359f02f3f3615088907c8b5ac83438bda452af',
  '00abdc242048b65fa2e976bb31bf0018931768118cd3c05e87c26d1daace4beb',
  '00a972afa513fbe4fd5aa7e2dbda3149446ee40b3127f7a144cec584ae195d22',
  '001e511c90e45a81eb1783832455ebafd10785810d27daf195a2e26bdb99516e'
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('PHASE 7.12: DETAILED BRIDGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Checking ctf_to_market_bridge_mat for these CTFs...\n');

  const query = await clickhouse.query({
    query: `
      SELECT
        ctf_hex64,
        market_hex64,
        source,
        vote_count,
        created_at
      FROM default.ctf_to_market_bridge_mat
      WHERE ctf_hex64 IN (${MISSING_CTFS.map(c => `'${c}'`).join(', ')})
      ORDER BY ctf_hex64
    `,
    format: 'JSONEachRow'
  });

  const bridges: any[] = await query.json();

  console.log(`Found ${bridges.length} / 5 CTFs in bridge\n`);

  bridges.forEach((b, i) => {
    console.log(`${i + 1}. CTF: ${b.ctf_hex64.substring(0, 20)}...`);
    console.log(`   Market: ${b.market_hex64.substring(0, 20)}...`);
    console.log(`   Identity fallback: ${b.ctf_hex64 === b.market_hex64 ? 'YES ⚠️' : 'NO ✅'}`);
    console.log(`   Source: ${b.source}`);
    console.log(`   Vote count: ${b.vote_count}`);
    console.log(`   Created: ${b.created_at}`);
    console.log();
  });

  // Check if any of these market_hex64 values exist in market_resolutions_final
  if (bridges.length > 0) {
    console.log('Checking market_resolutions_final...\n');

    const marketIds = bridges.map(b => b.market_hex64);

    const resQuery = await clickhouse.query({
      query: `
        SELECT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          resolved_at
        FROM default.market_resolutions_final
        WHERE condition_id_norm IN (${marketIds.map(m => `'${m}'`).join(', ')})
      `,
      format: 'JSONEachRow'
    });

    const resolutions: any[] = await resQuery.json();

    console.log(`Found ${resolutions.length} resolutions\n`);

    if (resolutions.length > 0) {
      resolutions.forEach((r, i) => {
        console.log(`${i + 1}. Market: ${r.condition_id_norm.substring(0, 20)}...`);
        console.log(`   Payouts: ${r.payout_numerators}`);
        console.log(`   Denominator: ${r.payout_denominator}`);
        console.log(`   Resolved: ${r.resolved_at}`);
        console.log();
      });

      console.log('✅ These CTFs already have resolution data!\n');
      console.log('The P&L calculations should already be including them.\n');
      console.log('Let me verify if they are being counted...\n');

      // Check wallet_burns_by_ctf
      const burnsQuery = await clickhouse.query({
        query: `
          SELECT
            ctf_hex64,
            shares_burned,
            has_payout_data,
            redemption_value
          FROM default.wallet_burns_by_ctf
          WHERE lower(wallet) = lower('0xcce2b7c71f21e358b8e5e797e586cbc03160d58b')
            AND ctf_hex64 IN (${MISSING_CTFS.map(c => `'${c}'`).join(', ')})
        `,
        format: 'JSONEachRow'
      });

      const burns: any[] = await burnsQuery.json();

      console.log(`Burns records for these CTFs: ${burns.length}\n`);

      if (burns.length > 0) {
        let totalRedemptionValue = 0;

        burns.forEach((b, i) => {
          const value = parseFloat(b.redemption_value || 0);
          totalRedemptionValue += value;

          console.log(`${i + 1}. CTF: ${b.ctf_hex64.substring(0, 20)}...`);
          console.log(`   Shares burned: ${parseFloat(b.shares_burned).toLocaleString()}`);
          console.log(`   Has payout: ${b.has_payout_data}`);
          console.log(`   Value: $${value.toLocaleString()}`);
          console.log();
        });

        console.log(`Total redemption value from these CTFs: $${totalRedemptionValue.toLocaleString()}\n`);

        if (totalRedemptionValue > 0) {
          console.log('✅ These CTFs are already being counted in P&L!\n');
          console.log('The gap may be smaller than we thought.\n');
        } else {
          console.log('⚠️  Redemption value is $0 despite having resolution data.\n');
          console.log('This suggests a calculation issue or wrong outcome.\n');
        }
      } else {
        console.log('❌ No burn records found for these CTFs in wallet_burns_by_ctf\n');
        console.log('This suggests burns are not being tracked for this wallet.\n');
      }
    } else {
      console.log('❌ No resolution data found in market_resolutions_final\n');
      console.log('These markets have never resolved, confirming previous findings.\n');
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`CTFs found in bridge: ${bridges.length} / 5`);
  const identityFallback = bridges.filter(b => b.ctf_hex64 === b.market_hex64).length;
  console.log(`Using identity fallback: ${identityFallback} / ${bridges.length}\n`);

  console.log('Missing from bridge:');
  const foundCtfs = bridges.map(b => b.ctf_hex64);
  MISSING_CTFS.forEach(ctf => {
    if (!foundCtfs.includes(ctf)) {
      console.log(`  - ${ctf.substring(0, 20)}...`);
    }
  });

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
