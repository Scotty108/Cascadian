#!/usr/bin/env npx tsx
/**
 * Debug why wallet 0x9155e8cf has 0% coverage when global is 11.88%
 */
import { createClient } from '@clickhouse/client';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const ch = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER!,
  password: process.env.CLICKHOUSE_PASSWORD!,
});

const WALLET = '0x9155e8cf81a3fb557639d23d43f1528675bcfcad';

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log(`DEBUGGING WALLET ${WALLET.substring(0, 12)}...`);
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Step 1: Check if wallet exists in vw_trades_canonical
  console.log('Step 1: Checking wallet data in vw_trades_canonical...\n');

  const walletCheck = await ch.query({
    query: `
      SELECT
        COUNT(*) as trade_count,
        COUNT(DISTINCT condition_id_norm) as unique_conditions
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const walletData = await walletCheck.json<any[]>();

  console.log(`  Trades: ${parseInt(walletData[0].trade_count).toLocaleString()}`);
  console.log(`  Unique conditions: ${parseInt(walletData[0].unique_conditions).toLocaleString()}\n`);

  if (parseInt(walletData[0].trade_count) === 0) {
    console.log('❌ Wallet not found in vw_trades_canonical!');
    console.log('   This might be a "legacy era" wallet (pre-June 2024)\n');
    await ch.close();
    return;
  }

  // Step 2: Sample condition IDs from this wallet
  console.log('Step 2: Sampling condition IDs for this wallet...\n');

  const sampleIds = await ch.query({
    query: `
      SELECT DISTINCT
        condition_id_norm,
        lower(replaceAll(condition_id_norm, '0x', '')) as normalized_id
      FROM default.vw_trades_canonical
      WHERE lower(wallet_address_norm) = lower('${WALLET}')
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const ids = await sampleIds.json<any[]>();

  console.log('Sample condition IDs:');
  ids.forEach((id, i) => {
    console.log(`\n${i+1}.`);
    console.log(`   Original:    ${id.condition_id_norm}`);
    console.log(`   Normalized:  ${id.normalized_id}`);
  });

  // Step 3: Check if these IDs exist in resolution tables
  console.log('\n\nStep 3: Checking if these IDs exist in resolution tables...\n');

  const topId = ids[0].normalized_id;

  // Check market_resolutions_final
  const mrfCheck = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.market_resolutions_final
      WHERE lower(replaceAll(condition_id_norm, '0x', '')) = '${topId}'
    `,
    format: 'JSONEachRow',
  });
  const mrfCount = await mrfCheck.json<any[]>();

  // Check resolutions_external_ingest
  const reiCheck = await ch.query({
    query: `
      SELECT COUNT(*) as count
      FROM default.resolutions_external_ingest
      WHERE lower(replaceAll(condition_id, '0x', '')) = '${topId}'
    `,
    format: 'JSONEachRow',
  });
  const reiCount = await reiCheck.json<any[]>();

  console.log(`  Top ID: ${topId.substring(0, 16)}...`);
  console.log(`  In market_resolutions_final: ${mrfCount[0].count}`);
  console.log(`  In resolutions_external_ingest: ${reiCount[0].count}\n`);

  // Step 4: Check ALL wallet condition IDs for matches
  console.log('Step 4: Checking ALL wallet condition IDs for resolution matches...\n');

  const allMatches = await ch.query({
    query: `
      WITH wallet_cids AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.vw_trades_canonical
        WHERE lower(wallet_address_norm) = lower('${WALLET}')
      ),
      resolution_cids AS (
        SELECT DISTINCT lower(replaceAll(condition_id_norm, '0x', '')) as cid
        FROM default.market_resolutions_final
        WHERE payout_denominator > 0

        UNION DISTINCT

        SELECT DISTINCT lower(replaceAll(condition_id, '0x', '')) as cid
        FROM default.resolutions_external_ingest
        WHERE payout_denominator > 0
      )
      SELECT
        (SELECT COUNT(*) FROM wallet_cids) as total_wallet_cids,
        (SELECT COUNT(*) FROM resolution_cids) as total_resolution_cids,
        COUNT(*) as matched_cids
      FROM wallet_cids w
      INNER JOIN resolution_cids r ON w.cid = r.cid
    `,
    format: 'JSONEachRow',
  });
  const matchData = await allMatches.json<any[]>();

  console.log(`  Wallet condition IDs: ${parseInt(matchData[0].total_wallet_cids).toLocaleString()}`);
  console.log(`  Total resolutions: ${parseInt(matchData[0].total_resolution_cids).toLocaleString()}`);
  console.log(`  Matched: ${parseInt(matchData[0].matched_cids).toLocaleString()}`);
  console.log(`  Coverage: ${((parseInt(matchData[0].matched_cids) / parseInt(matchData[0].total_wallet_cids)) * 100).toFixed(2)}%\n`);

  // Step 5: Compare with fact_trades_clean
  console.log('Step 5: Checking if wallet exists in fact_trades_clean...\n');

  const ftcCheck = await ch.query({
    query: `
      SELECT
        COUNT(*) as trade_count,
        COUNT(DISTINCT cid) as unique_conditions
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = lower('${WALLET}')
    `,
    format: 'JSONEachRow',
  });
  const ftcData = await ftcCheck.json<any[]>();

  console.log(`  Trades in fact_trades_clean: ${parseInt(ftcData[0].trade_count).toLocaleString()}`);
  console.log(`  Unique conditions: ${parseInt(ftcData[0].unique_conditions).toLocaleString()}\n`);

  console.log('═'.repeat(80));
  console.log('DIAGNOSIS');
  console.log('═'.repeat(80));

  if (parseInt(ftcData[0].trade_count) > 0 && parseInt(walletData[0].trade_count) === 0) {
    console.log('\n⚠️  ISSUE: Wallet exists in fact_trades_clean but NOT in vw_trades_canonical');
    console.log('   This confirms the "two eras" theory:');
    console.log('   - fact_trades_clean has ALL trades (legacy + modern)');
    console.log('   - vw_trades_canonical only has modern trades (June 2024+)');
    console.log('   - Wallet 0x9155e8cf is a legacy wallet with NO modern trades\n');
    console.log('   SOLUTION: Need to use fact_trades_clean, not vw_trades_canonical');
  } else if (parseInt(matchData[0].matched_cids) === 0) {
    console.log('\n⚠️  ISSUE: Wallet trades exist but NO condition IDs match resolutions');
    console.log('   Possible causes:');
    console.log('   - IDs are in different formats (token IDs vs condition IDs)');
    console.log('   - Markets haven\'t been resolved yet');
    console.log('   - Need different ID normalization strategy');
  } else {
    console.log(`\n✅ Wallet has ${((parseInt(matchData[0].matched_cids) / parseInt(matchData[0].total_wallet_cids)) * 100).toFixed(2)}% coverage`);
  }

  console.log('');

  await ch.close();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
