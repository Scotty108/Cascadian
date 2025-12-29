#!/usr/bin/env npx tsx
/**
 * Fill Key Collision Report
 *
 * Checks if our fill_key deduplication is too aggressive by looking for:
 * 1. Groups with count > 2 (suspicious - might be deleting real fills)
 * 2. Groups with count == 1 (unique fills - good)
 * 3. Groups with count == 2 (maker+taker duplicates - expected)
 *
 * If count > 2, we might be collapsing legitimate separate fills.
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 300000,
});

// Sign-flip wallets from cohort analysis
const SIGN_FLIP_WALLETS = [
  '0xb29630d7b3c3b6d3f5d9ee9b22ad20c2c7e1cc61',  // +$43 vs -$117
  '0x7ea09d2d4e8fe0a1d9c2d5ae8a7c6e9c1f2b3a4d',  // Sign flip
  '0xf1ffada11dab3013fa5c4c7b86d6e3b1c4f3b2a1',  // Sign flip
];

interface CollisionResult {
  wallet: string;
  token_id: string;
  side: string;
  usdc_amount: number;
  token_amount: number;
  fill_count: number;
  tx_hashes: string;
  trade_times: string;
}

async function checkWalletCollisions(wallet: string) {
  console.log('\n' + '='.repeat(100));
  console.log('FILL KEY COLLISION REPORT: ' + wallet);
  console.log('='.repeat(100));

  // First check if wallet exists and how many raw rows
  const rawCountQ = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const rawCount = await rawCountQ.json() as Array<{ cnt: string }>;
  console.log('\nRaw rows in pm_trader_events_v2: ' + rawCount[0].cnt);

  // Check with different casing patterns
  const casingQ = await clickhouse.query({
    query: `
      SELECT
        trader_wallet,
        count() as cnt
      FROM pm_trader_events_v2
      WHERE trader_wallet ILIKE '${wallet}'
        AND is_deleted = 0
      GROUP BY trader_wallet
    `,
    format: 'JSONEachRow'
  });
  const casingResults = await casingQ.json() as Array<{ trader_wallet: string; cnt: string }>;
  console.log('Wallet address variants found:');
  for (const r of casingResults) {
    console.log('  ' + r.trader_wallet + ': ' + r.cnt + ' rows');
  }

  // Now check fill_key collisions
  const collisionQ = await clickhouse.query({
    query: `
      SELECT
        lower(trader_wallet) as wallet,
        token_id,
        side,
        usdc_amount,
        token_amount,
        count() as fill_count,
        groupArray(transaction_hash) as tx_hashes,
        groupArray(toString(trade_time)) as trade_times
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY wallet, token_id, side, usdc_amount, token_amount
      HAVING fill_count > 1
      ORDER BY fill_count DESC
      LIMIT 20
    `,
    format: 'JSONEachRow'
  });
  const collisions = await collisionQ.json() as CollisionResult[];

  if (collisions.length === 0) {
    console.log('\nNo fill_key collisions found (all fills are unique by fill_key)');
  } else {
    console.log('\nFill Key Collisions (groups with count > 1):');
    console.log('-'.repeat(100));

    let suspicious = 0;
    let expected = 0;

    for (const c of collisions) {
      const status = c.fill_count > 2 ? '⚠️ SUSPICIOUS' : '✓ expected (maker+taker)';
      if (c.fill_count > 2) suspicious++;
      else expected++;

      console.log('\nToken: ' + c.token_id.slice(0, 20) + '...');
      console.log('  Side: ' + c.side + ', USDC: $' + (c.usdc_amount / 1e6).toFixed(2) + ', Tokens: ' + (c.token_amount / 1e6).toFixed(2));
      console.log('  Fill count: ' + c.fill_count + ' ' + status);
      console.log('  TX hashes: ' + c.tx_hashes);
      console.log('  Trade times: ' + c.trade_times);
    }

    console.log('\n' + '-'.repeat(100));
    console.log('SUMMARY:');
    console.log('  Expected duplicates (count=2): ' + expected);
    console.log('  Suspicious collisions (count>2): ' + suspicious);
  }

  // Also check deduped count
  const dedupedQ = await clickhouse.query({
    query: `
      SELECT count() as cnt
      FROM (
        SELECT 1
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY transaction_hash, lower(trader_wallet), token_id, side, usdc_amount, token_amount
      )
    `,
    format: 'JSONEachRow'
  });
  const dedupedCount = await dedupedQ.json() as Array<{ cnt: string }>;
  console.log('\nDeduped fill count: ' + dedupedCount[0].cnt);
  console.log('Reduction: ' + rawCount[0].cnt + ' → ' + dedupedCount[0].cnt + ' (' +
    ((1 - Number(dedupedCount[0].cnt) / Number(rawCount[0].cnt)) * 100).toFixed(1) + '% removed)');
}

async function main() {
  const targetWallet = process.argv[2];

  if (targetWallet) {
    await checkWalletCollisions(targetWallet);
  } else {
    // Check all sign-flip wallets
    for (const w of SIGN_FLIP_WALLETS) {
      await checkWalletCollisions(w);
    }
  }

  await clickhouse.close();
}

main().catch(console.error);
