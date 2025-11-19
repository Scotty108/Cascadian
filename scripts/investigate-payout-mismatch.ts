#!/usr/bin/env tsx
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

import { createClient } from '@clickhouse/client';

const client = createClient({
  url: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD || '',
  database: 'default'
});

async function investigatePayoutMismatch() {
  console.log('=== INVESTIGATING PAYOUT DATA MISMATCH ===\n');

  // The mystery: Why do 92% of trades show "invalid payout data"?
  // Hypothesis: The LEFT JOIN is matching, but the payout_numerators check is wrong

  console.log('1. Sample of trades WITH resolutions but "invalid payout"');
  const sample = await client.query({
    query: `
      SELECT
        t.condition_id,
        r.condition_id_norm,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        length(r.payout_numerators) as payout_length
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
        AND r.condition_id_norm IS NOT NULL
        AND (length(r.payout_numerators) = 0 OR r.payout_denominator = 0)
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const samples = await sample.json<any>();

  if (samples.length > 0) {
    console.log(`  Found ${samples.length} examples:`);
    samples.forEach((s: any, i: number) => {
      console.log(`  ${i+1}. condition_id: ${s.condition_id}`);
      console.log(`     resolution match: ${s.condition_id_norm}`);
      console.log(`     payout_numerators: [${s.payout_numerators?.join(', ') || 'NULL'}]`);
      console.log(`     payout_denominator: ${s.payout_denominator}`);
      console.log(`     payout_length: ${s.payout_length}`);
      console.log();
    });
  } else {
    console.log('  ✅ No examples found - payout data looks valid!');
  }

  console.log('\n2. Check JOIN logic - is it REALLY matching?');

  // Sample a few random condition_ids from trades
  const randomTrades = await client.query({
    query: `
      SELECT DISTINCT condition_id
      FROM trades_raw
      WHERE condition_id != ''
      LIMIT 5
    `,
    format: 'JSONEachRow'
  });
  const random = await randomTrades.json<any>();

  for (const t of random) {
    const cid = t.condition_id;
    const normalized = cid.toLowerCase().replace('0x', '');

    console.log(`\n  condition_id: ${cid}`);
    console.log(`  normalized: ${normalized}`);

    // Try to find in market_resolutions_final
    const lookup = await client.query({
      query: `
        SELECT
          condition_id_norm,
          payout_numerators,
          payout_denominator,
          winning_index,
          source
        FROM market_resolutions_final
        WHERE lower(condition_id_norm) = '${normalized}'
        LIMIT 1
      `,
      format: 'JSONEachRow'
    });
    const found = await lookup.json<any>();

    if (found.length > 0) {
      console.log(`  ✅ FOUND in market_resolutions_final:`);
      console.log(`     payout: [${found[0].payout_numerators.join(', ')}] / ${found[0].payout_denominator}`);
      console.log(`     winner: index ${found[0].winning_index}, source: ${found[0].source}`);
    } else {
      console.log(`  ❌ NOT FOUND in market_resolutions_final`);
    }
  }

  console.log('\n\n3. Re-check the 92% "invalid" claim with explicit checks');
  const recheck = await client.query({
    query: `
      SELECT
        COUNT(*) as total_with_cid,
        SUM(CASE WHEN r.condition_id_norm IS NOT NULL THEN 1 ELSE 0 END) as has_match,
        SUM(CASE WHEN r.condition_id_norm IS NULL THEN 1 ELSE 0 END) as no_match,

        -- Check payout validity more carefully
        SUM(CASE
          WHEN r.payout_numerators IS NOT NULL
            AND length(r.payout_numerators) > 0
          THEN 1 ELSE 0
        END) as has_payout_array,

        SUM(CASE
          WHEN r.payout_denominator IS NOT NULL
            AND r.payout_denominator > 0
          THEN 1 ELSE 0
        END) as has_valid_denom,

        SUM(CASE
          WHEN r.winning_index IS NOT NULL
          THEN 1 ELSE 0
        END) as has_winning_index
      FROM trades_raw t
      LEFT JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const rc = await recheck.json<any>();
  const total = parseInt(rc[0].total_with_cid);

  console.log(`  Total trades with condition_id: ${total.toLocaleString()}`);
  console.log(`  Has resolution match: ${parseInt(rc[0].has_match).toLocaleString()} (${(parseInt(rc[0].has_match)/total*100).toFixed(2)}%)`);
  console.log(`  No resolution match: ${parseInt(rc[0].no_match).toLocaleString()} (${(parseInt(rc[0].no_match)/total*100).toFixed(2)}%)`);
  console.log();
  console.log(`  Of matched resolutions:`);
  console.log(`    Has payout array: ${parseInt(rc[0].has_payout_array).toLocaleString()} (${(parseInt(rc[0].has_payout_array)/total*100).toFixed(2)}%)`);
  console.log(`    Has valid denom: ${parseInt(rc[0].has_valid_denom).toLocaleString()} (${(parseInt(rc[0].has_valid_denom)/total*100).toFixed(2)}%)`);
  console.log(`    Has winning_index: ${parseInt(rc[0].has_winning_index).toLocaleString()} (${(parseInt(rc[0].has_winning_index)/total*100).toFixed(2)}%)`);

  console.log('\n\n4. Understanding the CROSS JOIN issue (unique trade_id mismatch)');
  console.log('   Earlier we saw: 82M result rows but only 39M unique trade_ids');
  console.log('   This suggests either:');
  console.log('     a) Multiple trades with same trade_id');
  console.log('     b) trade_id is not unique in trades_raw');
  console.log('     c) Duplicate rows in trades_raw\n');

  const tradeIdCheck = await client.query({
    query: `
      SELECT
        COUNT(*) as total_rows,
        COUNT(DISTINCT trade_id) as unique_trade_ids,
        total_rows - unique_trade_ids as duplicate_count
      FROM trades_raw
      WHERE condition_id != ''
    `,
    format: 'JSONEachRow'
  });
  const tid = await tradeIdCheck.json<any>();
  console.log(`  Total rows: ${parseInt(tid[0].total_rows).toLocaleString()}`);
  console.log(`  Unique trade_ids: ${parseInt(tid[0].unique_trade_ids).toLocaleString()}`);
  console.log(`  Duplicates: ${parseInt(tid[0].duplicate_count).toLocaleString()}`);

  if (parseInt(tid[0].duplicate_count) > 0) {
    console.log(`\n  ⚠️  FOUND IT: trade_id is NOT unique! (${tid[0].duplicate_count} duplicates)`);
    console.log('     This explains the row count mismatch.');
    console.log('     Note: Duplicates don\'t affect P&L calculation accuracy if data is consistent.');
  }

  console.log('\n\n5. FINAL CHECK: Can we actually calculate P&L for a sample wallet?');

  // Pick a wallet and try to calculate P&L
  const walletSample = await client.query({
    query: `
      SELECT
        t.wallet_address,
        t.condition_id,
        t.shares,
        t.usd_value,
        r.payout_numerators,
        r.payout_denominator,
        r.winning_index,
        -- Apply PNL + CAR skills
        (t.shares * arrayElement(r.payout_numerators, r.winning_index + 1) / r.payout_denominator) - t.usd_value as pnl_usd
      FROM trades_raw t
      INNER JOIN market_resolutions_final r
        ON lower(replaceAll(t.condition_id, '0x', '')) = lower(r.condition_id_norm)
      WHERE t.condition_id != ''
        AND length(r.payout_numerators) > 0
        AND r.payout_denominator > 0
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const walletData = await walletSample.json<any>();

  console.log(`  Successfully calculated P&L for ${walletData.length} sample trades:`);
  walletData.forEach((w: any, i: number) => {
    console.log(`  ${i+1}. Wallet: ${w.wallet_address.slice(0, 10)}...`);
    console.log(`     Shares: ${w.shares}, Cost: $${parseFloat(w.usd_value).toFixed(2)}`);
    console.log(`     Payout: [${w.payout_numerators.join(', ')}]/${w.payout_denominator} (winner: ${w.winning_index})`);
    console.log(`     P&L: $${parseFloat(w.pnl_usd).toFixed(2)}`);
  });

  await client.close();
}

investigatePayoutMismatch().catch(console.error);
