#!/usr/bin/env npx tsx
import { createClient } from '@clickhouse/client';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function investigate() {
  // Wallet with 2x issue
  const wallet = '0x11c28d55e3d2a962d48687dc2d2e554b34bd4ecd';

  console.log('=== Investigating 2x PnL Issue ===');
  console.log('Wallet:', wallet);
  console.log('Our PnL: $97.55, UI PnL: $48.13 (2x ratio)');
  console.log('');

  // Check raw fills vs canonical
  const rawQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_events_v2 WHERE trader_wallet = '${wallet}' AND is_deleted = 0`,
    format: 'JSONEachRow',
  });
  const raw = (await rawQ.json())[0] as any;

  const canonQ = await clickhouse.query({
    query: `SELECT count() as cnt FROM pm_trader_fills_canonical_v1 WHERE trader_wallet = '${wallet}'`,
    format: 'JSONEachRow',
  });
  const canon = (await canonQ.json())[0] as any;

  console.log('Raw pm_trader_events_v2:', raw.cnt, 'rows');
  console.log('Canonical fills:', canon.cnt, 'rows');
  console.log('Dedup ratio:', (raw.cnt / canon.cnt).toFixed(2) + 'x');

  // Check if canonical view has internal duplicates
  const dupQ = await clickhouse.query({
    query: `
      SELECT
        transaction_hash, token_id, side, token_amount, usdc_amount, count() as cnt
      FROM pm_trader_fills_canonical_v1
      WHERE trader_wallet = '${wallet}'
      GROUP BY transaction_hash, token_id, side, token_amount, usdc_amount
      HAVING cnt > 1
      LIMIT 5
    `,
    format: 'JSONEachRow',
  });
  const dups = await dupQ.json();
  console.log('\nDuplicates in canonical view:', dups.length);

  // Get all fills with condition mapping
  const fillsQ = await clickhouse.query({
    query: `
      SELECT
        f.transaction_hash,
        f.token_id,
        f.side,
        f.token_amount / 1000000.0 as tokens,
        f.usdc_amount / 1000000.0 as usdc,
        m.condition_id,
        m.outcome_index
      FROM pm_trader_fills_canonical_v1 f
      INNER JOIN pm_token_to_condition_map_v5 m ON f.token_id = m.token_id_dec
      WHERE f.trader_wallet = '${wallet}'
      ORDER BY f.trade_time
    `,
    format: 'JSONEachRow',
  });
  const fills = await fillsQ.json() as any[];

  console.log('\nTotal fills after condition mapping:', fills.length);

  // Group by (tx_hash, condition_id) to detect paired-outcome trades
  const groups = new Map<string, any[]>();
  for (const fill of fills) {
    const key = `${fill.transaction_hash}_${fill.condition_id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(fill);
  }

  let pairedCount = 0;
  for (const [key, groupFills] of groups) {
    const outcomes = new Set(groupFills.map(f => f.outcome_index));
    if (outcomes.has('0') && outcomes.has('1') && groupFills.length >= 2) {
      pairedCount++;
      if (pairedCount <= 3) {
        console.log('\nPaired-outcome group found:');
        console.log('  TX:', groupFills[0].transaction_hash.slice(0, 16) + '...');
        for (const f of groupFills) {
          console.log(`  O${f.outcome_index} ${f.side}: ${Number(f.tokens).toFixed(2)} tokens @ $${Number(f.usdc).toFixed(2)}`);
        }
      }
    }
  }
  console.log('\nTotal paired-outcome groups:', pairedCount);

  // Aggregate and compute PnL per outcome
  const aggs = new Map<string, {
    condition_id: string;
    outcome_index: string;
    buy_tokens: number;
    sell_tokens: number;
    buy_usdc: number;
    sell_usdc: number;
  }>();

  for (const fill of fills) {
    const key = `${fill.condition_id}_${fill.outcome_index}`;
    if (!aggs.has(key)) {
      aggs.set(key, {
        condition_id: fill.condition_id,
        outcome_index: fill.outcome_index,
        buy_tokens: 0,
        sell_tokens: 0,
        buy_usdc: 0,
        sell_usdc: 0,
      });
    }
    const agg = aggs.get(key)!;
    if (fill.side === 'buy') {
      agg.buy_tokens += Number(fill.tokens);
      agg.buy_usdc += Number(fill.usdc);
    } else {
      agg.sell_tokens += Number(fill.tokens);
      agg.sell_usdc += Number(fill.usdc);
    }
  }

  // Get resolutions
  const conditionIds = [...new Set(fills.map(f => f.condition_id))];
  const resQ = await clickhouse.query({
    query: `SELECT condition_id, payout_numerators FROM pm_condition_resolutions WHERE condition_id IN ('${conditionIds.join("','")}')`,
    format: 'JSONEachRow',
  });
  const resRows = await resQ.json() as any[];
  const resMap = new Map(resRows.map(r => [r.condition_id, JSON.parse(r.payout_numerators || '[]')]));

  console.log('\n=== PnL Breakdown (WITHOUT paired-outcome normalization) ===');

  let totalPnl = 0;
  for (const [key, agg] of aggs) {
    const payouts = resMap.get(agg.condition_id) || [];
    const resPrice = payouts[Number(agg.outcome_index)] ?? null;
    const cashFlow = agg.sell_usdc - agg.buy_usdc;
    const finalShares = agg.buy_tokens - agg.sell_tokens;

    if (resPrice !== null) {
      const pnl = cashFlow + finalShares * resPrice;
      totalPnl += pnl;
      if (Math.abs(pnl) > 1) {
        console.log(`${agg.condition_id.slice(0, 10)}... O${agg.outcome_index}: cash=$${cashFlow.toFixed(2)}, shares=${finalShares.toFixed(2)}, res=${resPrice}, pnl=$${pnl.toFixed(2)}`);
      }
    }
  }

  console.log('\nTotal Realized PnL (no normalization):', '$' + totalPnl.toFixed(2));
  console.log('UI shows: $48.13');
  console.log('Ratio:', (totalPnl / 48.13).toFixed(2) + 'x');

  await clickhouse.close();
}

investigate().catch(console.error);
