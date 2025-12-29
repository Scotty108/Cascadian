#!/usr/bin/env npx tsx
/**
 * Create pm_trader_fills_dedup_v1 - deduped trade fills
 *
 * fill_key = (transaction_hash, lower(trader_wallet), token_id, side, usdc_amount, token_amount)
 *
 * Collapses maker+taker duplicates for the same wallet, keeping one row per fill.
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

async function main() {
  console.log('='.repeat(80));
  console.log('CREATING DEDUPED FILLS TABLE');
  console.log('='.repeat(80));

  // Step 1: Drop existing table
  console.log('\n1. Dropping existing table...');
  await clickhouse.command({
    query: 'DROP TABLE IF EXISTS pm_trader_fills_dedup_v1'
  });

  // The 7 regression wallets
  const REGRESSION_WALLETS = [
    '0xadb7696bd58f5faddf23e85776b5f68fba65c02c',
    '0xf9fc56e10121f20e69bb496b0b1a4b277dec4bf2',
    '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191',
    '0x13cb83542f2e821b117606aef235a7c6cb7e4ad1',
    '0x46e669b5f53bfa7d8ff438a228dd06159ec0a3a1',
    '0x88cee1fe5e14407927029b6cff5ad0fc4613d70e',
    '0x1e8d211976903f2f5bc4e7908fcbafe07b3e4bd2',
  ];
  const walletList = REGRESSION_WALLETS.map(w => `'${w}'`).join(',');

  // Step 2: Create table with fill_key dedupe (regression wallets only)
  console.log('2. Creating deduped fills table (7 regression wallets only)...');
  await clickhouse.command({
    query: `
      CREATE TABLE pm_trader_fills_dedup_v1
      ENGINE = MergeTree()
      ORDER BY (trader_wallet, token_id, trade_time)
      AS
      SELECT
        -- fill_key components
        transaction_hash,
        wallet as trader_wallet,
        token_id,
        side,
        usdc_amount,
        token_amount,
        -- other fields (take any)
        any(trade_time) as trade_time,
        any(fee_amount) as fee_amount,
        any(block_number) as block_number,
        any(role) as role,
        any(event_id) as event_id
      FROM (
        SELECT
          transaction_hash,
          lower(trader_wallet) as wallet,
          token_id,
          side,
          usdc_amount,
          token_amount,
          trade_time,
          fee_amount,
          block_number,
          role,
          event_id
        FROM pm_trader_events_v2
        WHERE is_deleted = 0
          AND lower(trader_wallet) IN (${walletList})
      )
      GROUP BY
        transaction_hash,
        wallet,
        token_id,
        side,
        usdc_amount,
        token_amount
    `
  });

  // Step 3: Verify row counts
  console.log('\n3. Verifying row counts...');

  const rawCount = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_events_v2 WHERE is_deleted = 0',
    format: 'JSONEachRow'
  });
  const raw = (await rawCount.json() as any[])[0].cnt;

  const dedupCount = await clickhouse.query({
    query: 'SELECT count() as cnt FROM pm_trader_fills_dedup_v1',
    format: 'JSONEachRow'
  });
  const dedup = (await dedupCount.json() as any[])[0].cnt;

  console.log(`   Raw rows:    ${raw.toLocaleString()}`);
  console.log(`   Deduped:     ${dedup.toLocaleString()}`);
  console.log(`   Removed:     ${(raw - dedup).toLocaleString()} (${((raw - dedup) / raw * 100).toFixed(1)}%)`);

  // Step 4: Verify Patapam222 specifically
  console.log('\n4. Verifying Patapam222 trades...');
  const patapam = '0xf70acdab62c5d2fcf3f411ae6b4ebd459d19a191';

  const patapamRaw = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_v2 WHERE lower(trader_wallet) = '${patapam}' AND is_deleted = 0`,
    format: 'JSONEachRow'
  });
  const patapamDedup = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_fills_dedup_v1 WHERE trader_wallet = '${patapam}'`,
    format: 'JSONEachRow'
  });

  console.log(`   Patapam raw:   ${(await patapamRaw.json() as any[])[0].cnt}`);
  console.log(`   Patapam dedup: ${(await patapamDedup.json() as any[])[0].cnt}`);

  // Step 5: Show sample of Patapam trades
  console.log('\n5. Patapam222 trades (deduped):');
  const trades = await clickhouse.query({
    query: `
      SELECT
        trade_time,
        token_id,
        side,
        usdc_amount / 1e6 as usdc,
        token_amount / 1e6 as shares
      FROM pm_trader_fills_dedup_v1
      WHERE trader_wallet = '${patapam}'
      ORDER BY trade_time, token_id
    `,
    format: 'JSONEachRow'
  });
  const tradeRows = await trades.json() as any[];

  console.log('\nTime                | Token (20 chars)     | Side | Shares     | USDC');
  console.log('-'.repeat(80));

  // Group by token_id for summary
  const byToken = new Map<string, { buys: number, sells: number, buyUsdc: number, sellUsdc: number }>();

  for (const t of tradeRows) {
    console.log(
      `${t.trade_time} | ${t.token_id.slice(0, 20)} | ${t.side.padEnd(4)} | ${t.shares.toFixed(2).padStart(10)} | $${t.usdc.toFixed(2).padStart(10)}`
    );

    const key = t.token_id;
    if (!byToken.has(key)) {
      byToken.set(key, { buys: 0, sells: 0, buyUsdc: 0, sellUsdc: 0 });
    }
    const entry = byToken.get(key)!;
    if (t.side === 'buy') {
      entry.buys += t.shares;
      entry.buyUsdc += t.usdc;
    } else {
      entry.sells += t.shares;
      entry.sellUsdc += t.usdc;
    }
  }

  console.log('\n6. Per-token inventory summary:');
  console.log('Token (20 chars)     | Bought     | Sold       | Net Shares | Net Cash');
  console.log('-'.repeat(80));

  for (const [tokenId, stats] of byToken.entries()) {
    const netShares = stats.buys - stats.sells;
    const netCash = stats.sellUsdc - stats.buyUsdc;
    console.log(
      `${tokenId.slice(0, 20)} | ${stats.buys.toFixed(2).padStart(10)} | ${stats.sells.toFixed(2).padStart(10)} | ${netShares.toFixed(2).padStart(10)} | $${netCash.toFixed(2).padStart(10)}`
    );
  }

  await clickhouse.close();
  console.log('\n✓ Done');
}

main().catch(console.error);
