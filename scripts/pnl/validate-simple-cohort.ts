#!/usr/bin/env npx tsx
/**
 * Validate Simple Cohort
 *
 * Tests PnL calculation on wallets with:
 * 1. No PayoutRedemption events (pure CLOB trading)
 * 2. Benchmark values available
 *
 * For these wallets, CLOB-only avg-cost should be EXACT.
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

interface Position {
  amount: bigint;
  avgPrice: bigint;
  realizedPnl: bigint;
}

async function getSimpleCohort(): Promise<Array<{ wallet: string; pnl_value: number }>> {
  // Get benchmark wallets with minimal or no redemptions
  const q = await clickhouse.query({
    query: `
      SELECT
        b.wallet,
        b.pnl_value,
        coalesce(r.redemption_total, 0) as redemption_total
      FROM pm_ui_pnl_benchmarks_v1 b
      LEFT JOIN (
        SELECT
          lower(user_address) as wallet,
          sum(toFloat64(amount_or_payout)) / 1e6 as redemption_total
        FROM pm_ctf_events
        WHERE event_type = 'PayoutRedemption'
        GROUP BY wallet
      ) r ON lower(b.wallet) = r.wallet
      WHERE abs(b.pnl_value) > 1
        AND abs(b.pnl_value) < 10000
      ORDER BY abs(coalesce(r.redemption_total, 0))
      LIMIT 30
    `,
    format: 'JSONEachRow'
  });

  return await q.json() as Array<{ wallet: string; pnl_value: number }>;
}

async function calculateClobPnl(wallet: string): Promise<{ pnl: number; trades: number }> {
  // Get deduped trades
  const tradesQ = await clickhouse.query({
    query: `
      SELECT side, token_id, token_amount, usdc_amount
      FROM (
        SELECT
          side, token_id, usdc_amount, token_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}')
          AND is_deleted = 0
        GROUP BY transaction_hash, lower(trader_wallet), token_id, side, usdc_amount, token_amount
      )
      ORDER BY token_id
    `,
    format: 'JSONEachRow'
  });

  const trades = await tradesQ.json() as any[];

  if (trades.length === 0) {
    return { pnl: 0, trades: 0 };
  }

  // Group by token and calculate avg-cost PnL
  const positions = new Map<string, Position>();

  for (const t of trades) {
    let pos = positions.get(t.token_id);
    if (!pos) {
      pos = { amount: 0n, avgPrice: 0n, realizedPnl: 0n };
      positions.set(t.token_id, pos);
    }

    const tokenAmt = BigInt(Math.round(Number(t.token_amount)));
    const usdcAmt = BigInt(Math.round(Number(t.usdc_amount)));
    const price = tokenAmt > 0n ? (usdcAmt * COLLATERAL_SCALE) / tokenAmt : 0n;

    if (t.side === 'buy') {
      if (pos.amount === 0n) {
        pos.avgPrice = price;
      } else if (tokenAmt > 0n) {
        pos.avgPrice = (pos.avgPrice * pos.amount + price * tokenAmt) / (pos.amount + tokenAmt);
      }
      pos.amount += tokenAmt;
    } else {
      const adj = tokenAmt > pos.amount ? pos.amount : tokenAmt;
      if (adj > 0n) {
        pos.realizedPnl += (adj * (price - pos.avgPrice)) / COLLATERAL_SCALE;
        pos.amount -= adj;
      }
    }
  }

  let totalPnl = 0n;
  for (const pos of positions.values()) {
    totalPnl += pos.realizedPnl;
  }

  return { pnl: Number(totalPnl) / 1e6, trades: trades.length };
}

async function main() {
  console.log('='.repeat(100));
  console.log('SIMPLE COHORT VALIDATION');
  console.log('Testing CLOB-only avg-cost calculation on wallets with NO PayoutRedemption events');
  console.log('='.repeat(100));

  const cohort = await getSimpleCohort();
  console.log(`\nFound ${cohort.length} simple cohort wallets\n`);

  if (cohort.length === 0) {
    console.log('No wallets found in simple cohort. All benchmark wallets have redemptions.');
    await clickhouse.close();
    return;
  }

  console.log('Wallet                                     | Trades | Our PnL   | UI Target | Delta     | %        | Status');
  console.log('-'.repeat(100));

  let passed = 0;
  let failed = 0;
  let exact = 0;

  for (const w of cohort) {
    const result = await calculateClobPnl(w.wallet);
    const delta = result.pnl - w.pnl_value;
    const deltaPct = Math.abs(w.pnl_value) > 0 ? Math.abs(delta / w.pnl_value) * 100 : 0;

    // Check for exact match (within $0.05)
    const isExact = Math.abs(delta) < 0.05;
    // Check for 20% tolerance or $50 absolute
    const isPass = deltaPct <= 20 || Math.abs(delta) <= 50;

    if (isExact) exact++;
    if (isPass) passed++;
    else failed++;

    const status = isExact ? '✅ EXACT' : (isPass ? '✅' : '❌');

    console.log(
      w.wallet.slice(0, 42) + ' | ' +
      String(result.trades).padStart(6) + ' | ' +
      ('$' + result.pnl.toFixed(2)).padStart(9) + ' | ' +
      ('$' + w.pnl_value.toFixed(2)).padStart(9) + ' | ' +
      ('$' + delta.toFixed(2)).padStart(9) + ' | ' +
      (deltaPct.toFixed(1) + '%').padStart(8) + ' | ' +
      status
    );
  }

  console.log('-'.repeat(100));
  console.log('\nRESULTS:');
  console.log(`  Exact matches (<$0.05): ${exact}/${cohort.length} (${(exact / cohort.length * 100).toFixed(1)}%)`);
  console.log(`  Within 20%/$50:         ${passed}/${cohort.length} (${(passed / cohort.length * 100).toFixed(1)}%)`);
  console.log(`  Failed:                 ${failed}/${cohort.length}`);

  await clickhouse.close();
}

main().catch(console.error);
