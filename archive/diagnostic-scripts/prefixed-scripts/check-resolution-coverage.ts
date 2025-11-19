import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });
import { clickhouse } from './lib/clickhouse/client.js';

async function main() {
  const wallet = '0xcce2b7c71f21e358b8e5e797e586cbc03160d58b';

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('RESOLUTION COVERAGE ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Check 1: How many wallet tokens have resolutions
  console.log('Check 1: Resolution Coverage for Wallet Tokens');
  console.log('─'.repeat(60));

  const coverageQuery = await clickhouse.query({
    query: `
      SELECT
        count() as total_tokens,
        countIf(t.condition_id_ctf IS NOT NULL) as tokens_with_resolution,
        countIf(t.pps IS NOT NULL) as tokens_with_pps
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t ON t.condition_id_ctf = f.condition_id_ctf
      WHERE lower(f.wallet) = lower('${wallet}')
    `,
    format: 'JSONEachRow'
  });
  const coverage = await coverageQuery.json();
  const coveragePct = (coverage[0].tokens_with_resolution / coverage[0].total_tokens * 100).toFixed(1);
  console.log(`   Total tokens: ${coverage[0].total_tokens}`);
  console.log(`   With resolution: ${coverage[0].tokens_with_resolution} (${coveragePct}%)`);
  console.log(`   With pps array: ${coverage[0].tokens_with_pps}\n`);

  // Check 2: Look at the cid_bridge - is it working?
  console.log('Check 2: cid_bridge Mapping');
  console.log('─'.repeat(60));

  const bridgeQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        condition_id_market
      FROM cid_bridge
      WHERE condition_id_ctf IN (
        SELECT condition_id_ctf
        FROM wallet_token_flows
        WHERE lower(wallet) = lower('${wallet}')
        LIMIT 5
      )
    `,
    format: 'JSONEachRow'
  });
  const bridge = await bridgeQuery.json();
  console.log(`   Found ${bridge.length} bridge mappings for wallet tokens`);
  if (bridge.length > 0) {
    bridge.forEach((b: any, i: number) => {
      const ctf = b.condition_id_ctf ? b.condition_id_ctf.substring(0, 12) : 'null';
      const market = b.condition_id_market ? b.condition_id_market.substring(0, 12) : 'null';
      console.log(`   ${i + 1}. CTF: ${ctf}... → Market: ${market}...`);
    });
  }
  console.log();

  // Check 3: Look at market_resolutions_final directly
  console.log('Check 3: market_resolutions_final Contents');
  console.log('─'.repeat(60));

  const resolutionCountQuery = await clickhouse.query({
    query: `
      SELECT count() as total_resolutions
      FROM market_resolutions_final
    `,
    format: 'JSONEachRow'
  });
  const resCount = await resolutionCountQuery.json();
  console.log(`   Total resolutions in market_resolutions_final: ${resCount[0].total_resolutions}\n`);

  // Check 4: Sample resolutions from market_resolutions_final
  const sampleResolutionsQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_index
      FROM market_resolutions_final
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const sampleResolutions = await sampleResolutionsQuery.json();
  console.log('   Sample resolutions:');
  if (sampleResolutions.length === 0) {
    console.log('   ⚠️  market_resolutions_final is EMPTY!\n');
  } else {
    sampleResolutions.forEach((r: any, i: number) => {
      console.log(`   ${i + 1}. ${r.condition_id_norm.substring(0, 12)}...`);
      console.log(`      payout_numerators: [${r.payout_numerators.join(', ')}]`);
      console.log(`      payout_denominator: ${r.payout_denominator}`);
      console.log(`      winning_index: ${r.winning_index}`);
    });
    console.log();
  }

  // Check 5: Check if winners view has data
  console.log('Check 5: winners View Contents');
  console.log('─'.repeat(60));

  const winnersCountQuery = await clickhouse.query({
    query: `
      SELECT count() as winner_count
      FROM winners
    `,
    format: 'JSONEachRow'
  });
  const winnersCount = await winnersCountQuery.json();
  console.log(`   Total winners: ${winnersCount[0].winner_count}\n`);

  // Check 6: Check token_per_share_payout view
  console.log('Check 6: token_per_share_payout View Contents');
  console.log('─'.repeat(60));

  const tpsCountQuery = await clickhouse.query({
    query: `
      SELECT count() as tps_count
      FROM token_per_share_payout
    `,
    format: 'JSONEachRow'
  });
  const tpsCount = await tpsCountQuery.json();
  console.log(`   Total token_per_share_payout entries: ${tpsCount[0].tps_count}\n`);

  // Sample from token_per_share_payout
  const tpsSampleQuery = await clickhouse.query({
    query: `
      SELECT
        condition_id_ctf,
        pps,
        winning_index
      FROM token_per_share_payout
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const tpsSample = await tpsSampleQuery.json();
  if (tpsSample.length > 0) {
    console.log('   Sample token_per_share_payout:');
    tpsSample.forEach((t: any, i: number) => {
      console.log(`   ${i + 1}. ${t.condition_id_ctf.substring(0, 12)}...`);
      console.log(`      pps: [${t.pps.map((p: number) => p.toFixed(6)).join(', ')}]`);
      console.log(`      winning_index: ${t.winning_index}`);
    });
    console.log();
  }

  // Check 7: Show which wallet tokens are MISSING resolutions
  console.log('Check 7: Wallet Tokens WITHOUT Resolutions');
  console.log('─'.repeat(60));

  const missingQuery = await clickhouse.query({
    query: `
      SELECT
        f.condition_id_ctf,
        f.net_shares,
        f.gross_cf
      FROM wallet_token_flows f
      LEFT JOIN token_per_share_payout t ON t.condition_id_ctf = f.condition_id_ctf
      WHERE lower(f.wallet) = lower('${wallet}')
        AND t.condition_id_ctf IS NULL
      ORDER BY abs(f.gross_cf) DESC
    `,
    format: 'JSONEachRow'
  });
  const missing = await missingQuery.json();
  console.log(`   Tokens without resolutions: ${missing.length}`);
  if (missing.length > 0) {
    console.log('   Top missing by |gross_cf|:');
    missing.slice(0, 10).forEach((m: any, i: number) => {
      console.log(`   ${(i + 1).toString().padStart(2)}. ${m.condition_id_ctf.substring(0, 12)}... : ` +
        `net_shares=${Number(m.net_shares).toFixed(2).padStart(10)}, ` +
        `gross_cf=$${Number(m.gross_cf).toFixed(2).padStart(10)}`);
    });
  }
  console.log();

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('DIAGNOSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (missing.length === 0) {
    console.log('✅ All wallet tokens have resolutions!');
    console.log('   The P&L gap must be due to something else.\n');
  } else {
    console.log(`⚠️  ${missing.length} tokens (${((missing.length / coverage[0].total_tokens) * 100).toFixed(1)}%) are missing resolutions!`);
    console.log('   This could explain the P&L gap if these are winning positions.\n');
    console.log('   Next steps:');
    console.log('   1. Check if market_resolutions_final has correct data');
    console.log('   2. Verify cid_bridge is mapping correctly');
    console.log('   3. Check if condition_id normalization is causing mismatches\n');
  }
}

main().catch(console.error);
