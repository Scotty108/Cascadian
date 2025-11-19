#!/usr/bin/env tsx
/**
 * Diagnose why wallet 0x4ce7 shows 0 resolved markets
 * when 55K markets globally have resolutions
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
  console.log('🔍 DIAGNOSING WALLET 0x4ce7 RESOLUTION MISMATCH');
  console.log('═'.repeat(80));

  // Step 1: Get wallet's markets from trades
  console.log('\n📊 Step 1: Markets traded by wallet 0x4ce7...');

  const tradesResult = await ch.query({
    query: `
      SELECT
        lower(replaceAll(cid, '0x', '')) as condition_id_norm,
        COUNT(*) as num_trades,
        SUM(CASE WHEN direction = 'BUY' THEN shares WHEN direction = 'SELL' THEN -shares ELSE 0 END) as net_shares,
        SUM(CASE WHEN direction = 'BUY' THEN usdc_amount WHEN direction = 'SELL' THEN -usdc_amount ELSE 0 END) as cost_basis
      FROM default.fact_trades_clean
      WHERE lower(wallet_address) = '${TEST_WALLET}'
        AND direction IN ('BUY', 'SELL')
        AND shares > 0
      GROUP BY condition_id_norm
      ORDER BY num_trades DESC
      LIMIT 10
    `,
    format: 'JSONEachRow',
  });

  const trades = await tradesResult.json();
  console.log(`\n  Found ${trades.length} markets for this wallet (showing top 10):`);
  trades.forEach((t: any, i: number) => {
    console.log(`  ${i + 1}. CID: ${t.condition_id_norm.substring(0, 16)}...`);
    console.log(`     Trades: ${t.num_trades}, Net shares: ${t.net_shares}, Cost basis: $${t.cost_basis}`);
  });

  // Step 2: Check if these markets have resolutions
  console.log('\n📊 Step 2: Checking if these markets have resolutions...');

  const firstCid = trades[0]?.condition_id_norm;
  if (!firstCid) {
    console.log('  ❌ No trades found for wallet');
    return;
  }

  const resolutionResult = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_outcome,
        length(payout_numerators) as num_outcomes
      FROM default.market_resolutions_final
      WHERE condition_id_norm = '${firstCid}'
    `,
    format: 'JSONEachRow',
  });

  const resolutions = await resolutionResult.json();

  if (resolutions.length > 0) {
    console.log(`\n  ✅ Resolution found for CID ${firstCid.substring(0, 16)}...:`);
    console.log(JSON.stringify(resolutions[0], null, 2));
  } else {
    console.log(`\n  ❌ No resolution found for CID ${firstCid.substring(0, 16)}...`);
    console.log('     This market might not be resolved yet');
  }

  // Step 3: Check total resolved vs unresolved for this wallet
  console.log('\n📊 Step 3: Resolved vs unresolved markets for this wallet...');

  const statusResult = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id_norm
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = '${TEST_WALLET}'
      )
      SELECT
        COUNT(*) as total_markets,
        SUM(CASE WHEN r.payout_denominator > 0 THEN 1 ELSE 0 END) as has_resolution,
        SUM(CASE WHEN r.payout_denominator IS NULL THEN 1 ELSE 0 END) as no_resolution
      FROM wallet_markets wm
      LEFT JOIN default.market_resolutions_final r
        ON wm.condition_id_norm = r.condition_id_norm
    `,
    format: 'JSONEachRow',
  });

  const status = await statusResult.json();
  console.log('\n  Market Resolution Status:');
  console.log(JSON.stringify(status[0], null, 2));

  // Step 4: Sample resolved markets globally to verify join works
  console.log('\n📊 Step 4: Sampling resolved markets globally...');

  const sampleResult = await ch.query({
    query: `
      SELECT
        condition_id_norm,
        payout_numerators,
        payout_denominator,
        winning_outcome
      FROM default.market_resolutions_final
      WHERE payout_denominator > 0
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });

  const samples = await sampleResult.json();
  console.log('\n  Sample of resolved markets:');
  samples.forEach((s: any, i: number) => {
    console.log(`  ${i + 1}. CID: ${s.condition_id_norm.substring(0, 16)}...`);
    console.log(`     Payout: [${s.payout_numerators}] / ${s.payout_denominator}`);
    console.log(`     Winner: ${s.winning_outcome}`);
  });

  // Step 5: Check if any of wallet's markets appear in resolved list
  console.log('\n📊 Step 5: Checking overlap between wallet markets and resolutions...');

  const overlapResult = await ch.query({
    query: `
      WITH wallet_markets AS (
        SELECT DISTINCT lower(replaceAll(cid, '0x', '')) as condition_id_norm
        FROM default.fact_trades_clean
        WHERE lower(wallet_address) = '${TEST_WALLET}'
      )
      SELECT
        wm.condition_id_norm,
        r.payout_denominator,
        r.winning_outcome,
        CASE
          WHEN r.payout_denominator > 0 THEN 'RESOLVED'
          WHEN r.condition_id_norm IS NOT NULL THEN 'HAS_RECORD_BUT_UNRESOLVED'
          ELSE 'NO_RECORD'
        END as status
      FROM wallet_markets wm
      LEFT JOIN default.market_resolutions_final r
        ON wm.condition_id_norm = r.condition_id_norm
      ORDER BY status DESC, wm.condition_id_norm
      LIMIT 20
    `,
    format: 'JSONEachRow',
  });

  const overlap = await overlapResult.json();
  console.log(`\n  Checking ${overlap.length} markets:`);

  const resolved = overlap.filter((o: any) => o.status === 'RESOLVED');
  const hasRecord = overlap.filter((o: any) => o.status === 'HAS_RECORD_BUT_UNRESOLVED');
  const noRecord = overlap.filter((o: any) => o.status === 'NO_RECORD');

  console.log(`\n  ✅ RESOLVED: ${resolved.length}`);
  if (resolved.length > 0) {
    resolved.forEach((r: any) => {
      console.log(`     ${r.condition_id_norm.substring(0, 16)}... → Winner: ${r.winning_outcome}`);
    });
  }

  console.log(`\n  ⚠️  HAS_RECORD_BUT_UNRESOLVED: ${hasRecord.length}`);
  console.log(`  ❌ NO_RECORD: ${noRecord.length}`);

  console.log('\n' + '═'.repeat(80));
  console.log('✅ DIAGNOSIS COMPLETE');
  console.log('═'.repeat(80));

  await ch.close();
}

main().catch(err => {
  console.error('\n❌ Error:', err);
  process.exit(1);
});
