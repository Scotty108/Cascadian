#!/usr/bin/env npx tsx
/**
 * Test Benchmark Wallet - Compare our engine vs UI benchmark
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

const COLLATERAL_SCALE = 1_000_000n;

interface Trade {
  trade_time: string;
  transaction_hash: string;
  token_id: string;
  side: string;
  token_amount: number;
  usdc_amount: number;
}

async function testWallet(walletPrefix: string) {
  // Get full wallet address and UI PnL from benchmark
  const wQ = await clickhouse.query({
    query: `SELECT wallet, pnl_value FROM pm_ui_pnl_benchmarks_v1 WHERE wallet LIKE '${walletPrefix}%' LIMIT 1`,
    format: 'JSONEachRow'
  });
  const wResult = await wQ.json() as Array<{ wallet: string; pnl_value: number }>;
  if (wResult.length === 0) {
    console.log('No benchmark found for prefix: ' + walletPrefix);
    return;
  }
  const wallet = wResult[0].wallet;
  const uiPnl = wResult[0].pnl_value;

  console.log('='.repeat(80));
  console.log('Testing wallet: ' + wallet);
  console.log('UI Benchmark: $' + uiPnl.toFixed(2));
  console.log('='.repeat(80));

  // Get raw count
  const rawQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_v2 WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0`,
    format: 'JSONEachRow'
  });
  const rawCount = await rawQ.json() as Array<{ cnt: string }>;
  console.log('\nRaw rows in CLOB: ' + rawCount[0].cnt);

  // Get deduped trades
  const tradesQ = await clickhouse.query({
    query: `
      SELECT
        trade_time,
        transaction_hash,
        token_id,
        side,
        token_amount,
        usdc_amount
      FROM (
        SELECT
          transaction_hash,
          lower(trader_wallet) as wallet,
          token_id,
          side,
          usdc_amount,
          token_amount,
          any(trade_time) as trade_time
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY transaction_hash, wallet, token_id, side, usdc_amount, token_amount
      )
      ORDER BY token_id, trade_time
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQ.json() as Trade[];
  console.log('Deduped trades: ' + trades.length);

  // Check for collisions (groups with > 2 rows before dedupe)
  const collisionQ = await clickhouse.query({
    query: `
      SELECT
        token_id,
        side,
        usdc_amount,
        token_amount,
        count() as fill_count
      FROM pm_trader_events_v2
      WHERE lower(trader_wallet) = lower('${wallet}')
        AND is_deleted = 0
      GROUP BY token_id, side, usdc_amount, token_amount
      HAVING fill_count > 2
    `,
    format: 'JSONEachRow'
  });
  const collisions = await collisionQ.json() as Array<{ token_id: string; fill_count: string }>;
  if (collisions.length > 0) {
    console.log('\n⚠️  SUSPICIOUS COLLISIONS (count > 2):');
    for (const c of collisions) {
      console.log('  Token ' + c.token_id.slice(0, 16) + '... count=' + c.fill_count);
    }
  }

  // Group by token
  const byToken = new Map<string, Trade[]>();
  for (const t of trades) {
    if (!byToken.has(t.token_id)) byToken.set(t.token_id, []);
    byToken.get(t.token_id)!.push(t);
  }

  console.log('Unique tokens: ' + byToken.size);

  // Calculate PnL
  interface Position {
    amount: bigint;
    avgPrice: bigint;
    realizedPnl: bigint;
  }

  const positions = new Map<string, Position>();
  const tokenPnls: Array<{ token: string; pnl: number; trades: number }> = [];

  for (const [tokenId, tokenTrades] of byToken.entries()) {
    let pos: Position = { amount: 0n, avgPrice: 0n, realizedPnl: 0n };

    for (const t of tokenTrades) {
      const tokenAmt = BigInt(Math.round(t.token_amount));
      const usdcAmt = BigInt(Math.round(t.usdc_amount));
      const price = tokenAmt > 0n ? (usdcAmt * COLLATERAL_SCALE) / tokenAmt : 0n;

      if (t.side === 'buy') {
        if (pos.amount === 0n) {
          pos.avgPrice = price;
        } else {
          pos.avgPrice = (pos.avgPrice * pos.amount + price * tokenAmt) / (pos.amount + tokenAmt);
        }
        pos.amount += tokenAmt;
      } else {
        const adjusted = tokenAmt > pos.amount ? pos.amount : tokenAmt;
        if (adjusted > 0n) {
          pos.realizedPnl += (adjusted * (price - pos.avgPrice)) / COLLATERAL_SCALE;
          pos.amount -= adjusted;
        }
      }
    }

    positions.set(tokenId, pos);
    tokenPnls.push({
      token: tokenId,
      pnl: Number(pos.realizedPnl) / 1e6,
      trades: tokenTrades.length
    });
  }

  // Sort by absolute PnL contribution
  tokenPnls.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  let totalPnl = 0n;
  for (const pos of positions.values()) {
    totalPnl += pos.realizedPnl;
  }

  const calcPnl = Number(totalPnl) / 1e6;
  const delta = calcPnl - uiPnl;

  console.log('\n--- TOP 5 TOKENS BY |PNL| ---');
  for (const tp of tokenPnls.slice(0, 5)) {
    console.log('  ' + tp.token.slice(0, 20) + '... PnL=$' + tp.pnl.toFixed(2) + ', trades=' + tp.trades);
  }

  console.log('\n' + '='.repeat(80));
  console.log('RESULT:');
  console.log('  Calculated: $' + calcPnl.toFixed(2));
  console.log('  UI Target:  $' + uiPnl.toFixed(2));
  console.log('  Delta:      $' + delta.toFixed(2) + ' (' + ((delta / Math.abs(uiPnl)) * 100).toFixed(1) + '%)');
  console.log('='.repeat(80));
}

async function main() {
  const prefix = process.argv[2] || '0x18f343d8f03234321d';
  await testWallet(prefix);
  await clickhouse.close();
}

main().catch(console.error);
