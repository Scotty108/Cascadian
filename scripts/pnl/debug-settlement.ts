#!/usr/bin/env npx tsx
/**
 * Debug Settlement Calculation
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const ch = createClient({
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
  totalCost: bigint;
  conditionId: string;
  outcomeIndex: number;
}

async function main() {
  const wallet = process.argv[2] || '0x114d7a8e7a1dd2dde555744a432ddcb871454c92';

  // Load resolutions
  const resQ = await ch.query({
    query: 'SELECT condition_id, payout_numerators, payout_denominator FROM pm_condition_resolutions WHERE is_deleted = 0',
    format: 'JSONEachRow'
  });
  const resolutions = new Map<string, { payout_numerators: number[]; payout_denominator: number }>();
  for (const r of await resQ.json() as any[]) {
    const payouts = r.payout_numerators ? JSON.parse(r.payout_numerators) : [];
    resolutions.set(r.condition_id.toLowerCase(), {
      payout_numerators: payouts,
      payout_denominator: Number(r.payout_denominator) || 1,
    });
  }

  // Load trades
  const tradesQ = await ch.query({
    query: `
      SELECT m.condition_id, m.outcome_index, t.token_id, t.trade_time, t.side,
             t.token_amount, t.usdc_amount
      FROM (
        SELECT token_id, any(trade_time) as trade_time, side, usdc_amount, token_amount
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = lower('${wallet}') AND is_deleted = 0
        GROUP BY transaction_hash, lower(trader_wallet), token_id, side, usdc_amount, token_amount
      ) t
      LEFT JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      ORDER BY m.condition_id, m.outcome_index, t.trade_time
    `,
    format: 'JSONEachRow'
  });
  const trades = await tradesQ.json() as any[];

  // Build positions
  const positions = new Map<string, Position>();
  for (const t of trades) {
    if (!t.condition_id) continue;
    const key = t.condition_id.toLowerCase() + '_' + t.outcome_index;
    let pos = positions.get(key) || {
      amount: 0n, avgPrice: 0n, realizedPnl: 0n, totalCost: 0n,
      conditionId: t.condition_id.toLowerCase(), outcomeIndex: t.outcome_index
    };

    const tokenAmt = BigInt(Math.round(Number(t.token_amount)));
    const usdcAmt = BigInt(Math.round(Number(t.usdc_amount)));
    const price = tokenAmt > 0n ? (usdcAmt * COLLATERAL_SCALE) / tokenAmt : 0n;

    if (t.side === 'buy') {
      if (pos.amount === 0n) pos.avgPrice = price;
      else if (tokenAmt > 0n) pos.avgPrice = (pos.avgPrice * pos.amount + price * tokenAmt) / (pos.amount + tokenAmt);
      pos.amount += tokenAmt;
      pos.totalCost += usdcAmt;
    } else {
      const adj = tokenAmt > pos.amount ? pos.amount : tokenAmt;
      if (adj > 0n) {
        pos.realizedPnl += (adj * (price - pos.avgPrice)) / COLLATERAL_SCALE;
        pos.amount -= adj;
        pos.totalCost -= (adj * pos.avgPrice) / COLLATERAL_SCALE;
      }
    }
    positions.set(key, pos);
  }

  console.log('Wallet: ' + wallet);
  console.log('Positions with remaining shares (> 0.001 tokens):');
  console.log('='.repeat(100));

  let totalSettlement = 0n;
  let totalTradingPnl = 0n;
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const [key, pos] of positions.entries()) {
    totalTradingPnl += pos.realizedPnl;

    if (pos.amount > 1000n) {  // > 0.001 tokens
      const res = resolutions.get(pos.conditionId);
      const sharesUsd = Number(pos.amount) / 1e6;
      const avgCostUsd = Number(pos.avgPrice) / 1e6;

      if (res && res.payout_numerators.length > pos.outcomeIndex) {
        const payoutNum = res.payout_numerators[pos.outcomeIndex];
        const payoutDen = res.payout_denominator;
        const payoutPrice = BigInt(Math.round((payoutNum / payoutDen) * 1e6));
        const settlement = (pos.amount * (payoutPrice - pos.avgPrice)) / COLLATERAL_SCALE;
        totalSettlement += settlement;
        resolvedCount++;

        const settleUsd = Number(settlement) / 1e6;
        const payoutUsd = (payoutNum / payoutDen);

        console.log(`${key.slice(0, 50)}...`);
        console.log(`  Shares: ${sharesUsd.toFixed(2)}, AvgCost: $${avgCostUsd.toFixed(4)}, Resolution: $${payoutUsd.toFixed(2)}`);
        console.log(`  Settlement: $${settleUsd.toFixed(2)}`);
      } else {
        unresolvedCount++;
        console.log(`${key.slice(0, 50)}... UNRESOLVED`);
        console.log(`  Shares: ${sharesUsd.toFixed(2)}, AvgCost: $${avgCostUsd.toFixed(4)}`);
      }
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('SUMMARY:');
  console.log('  Trading Realized PnL: $' + (Number(totalTradingPnl) / 1e6).toFixed(2));
  console.log('  Settlement PnL:       $' + (Number(totalSettlement) / 1e6).toFixed(2));
  console.log('  TOTAL:                $' + (Number(totalTradingPnl + totalSettlement) / 1e6).toFixed(2));
  console.log('  Resolved positions:   ' + resolvedCount);
  console.log('  Unresolved positions: ' + unresolvedCount);

  await ch.close();
}

main().catch(console.error);
