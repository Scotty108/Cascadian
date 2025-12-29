#!/usr/bin/env npx tsx
/**
 * Investigate why our PnL is ~2x what Polymarket shows
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST!,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD!,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

async function main() {
  const wallet = '0x2826c943697778f624cd46b6a488e8ee4fae3f4f';

  // Check if same token_id maps to multiple condition_ids
  console.log('=== Checking for duplicate token→condition mappings ===');
  const dupCheck = await clickhouse.query({
    query: `
      SELECT token_id_dec, count() as cnt, groupArray(condition_id) as conditions
      FROM pm_token_to_condition_map_v5
      GROUP BY token_id_dec
      HAVING cnt > 1
      LIMIT 10
    `,
    format: 'JSONEachRow'
  });
  const dups = await dupCheck.json() as any[];
  console.log('Token IDs with multiple condition_ids:', dups.length > 0 ? dups : 'NONE');

  // Get all trades with full mapping info for this wallet
  console.log('\n=== Full trade analysis for wallet ===');

  // Step 1: Get raw trades filtered by wallet
  const rawQ = await clickhouse.query({
    query: `
      SELECT
        event_id,
        side,
        usdc_amount / 1000000.0 as usdc,
        token_amount / 1000000.0 as tokens,
        token_id,
        trade_time
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet}' AND is_deleted = 0
    `,
    format: 'JSONEachRow'
  });
  const rawTrades = await rawQ.json() as any[];
  console.log('Raw trades (before dedup):', rawTrades.length);

  // Step 2: Dedupe by event_id in JS
  const dedupMap = new Map<string, any>();
  for (const t of rawTrades) {
    if (!dedupMap.has(t.event_id)) {
      dedupMap.set(t.event_id, t);
    }
  }
  const dedupedTrades = Array.from(dedupMap.values());
  console.log('Deduped trades:', dedupedTrades.length);

  // Step 3: Get token mappings for all token_ids
  const tokenIds = [...new Set(dedupedTrades.map(t => t.token_id))];
  const mapQ = await clickhouse.query({
    query: `
      SELECT token_id_dec, condition_id, outcome_index, question
      FROM pm_token_to_condition_map_v5
      WHERE token_id_dec IN (${tokenIds.map(t => `'${t}'`).join(',')})
    `,
    format: 'JSONEachRow'
  });
  const mapRows = await mapQ.json() as any[];
  const tokenMap = new Map<string, any>();
  for (const m of mapRows) {
    tokenMap.set(m.token_id_dec, m);
  }

  // Step 4: Join in JS
  const trades = dedupedTrades.map(t => ({
    ...t,
    ...(tokenMap.get(t.token_id) || {})
  }));

  console.log('Total deduped trades:', trades.length);
  console.log('\nAll trades:');
  trades.forEach((t, i) => {
    console.log(`${i+1}. ${t.side} $${t.usdc.toFixed(2)} for ${t.tokens.toFixed(2)} shares, outcome_index=${t.outcome_index}, question=${t.question?.slice(0,40) || 'N/A'}`);
  });

  console.log('\nUnique token_ids in trades:', tokenIds.length);

  // Group by condition_id and outcome_index to see positions
  console.log('\n=== Positions by condition_id/outcome ===');
  const positions: Record<string, any> = {};
  for (const t of trades) {
    const key = `${t.condition_id}_${t.outcome_index}`;
    if (!positions[key]) {
      positions[key] = {
        condition_id: t.condition_id,
        outcome_index: t.outcome_index,
        question: t.question,
        buys: 0, sells: 0,
        buy_usdc: 0, sell_usdc: 0,
        buy_shares: 0, sell_shares: 0
      };
    }
    if (t.side === 'buy') {
      positions[key].buys++;
      positions[key].buy_usdc += t.usdc;
      positions[key].buy_shares += t.tokens;
    } else {
      positions[key].sells++;
      positions[key].sell_usdc += t.usdc;
      positions[key].sell_shares += t.tokens;
    }
  }

  // Get resolution prices
  console.log('\n=== Position PnL calculation ===');
  let totalPnl = 0;

  for (const [key, p] of Object.entries(positions)) {
    const cashFlow = -p.buy_usdc + p.sell_usdc;
    const netShares = p.buy_shares - p.sell_shares;

    // Get resolution price
    const resQ = await clickhouse.query({
      query: `
        SELECT payout_numerators
        FROM pm_condition_resolutions
        WHERE lower(condition_id) = lower('${p.condition_id}')
      `,
      format: 'JSONEachRow'
    });
    const resRows = await resQ.json() as any[];
    let resolutionPrice = 0;
    if (resRows.length > 0 && resRows[0].payout_numerators) {
      const payouts = JSON.parse(resRows[0].payout_numerators);
      const payout = payouts[p.outcome_index];
      resolutionPrice = payout >= 1000 ? 1.0 : payout;
    }

    const pnl = cashFlow + (netShares * resolutionPrice);
    totalPnl += pnl;

    console.log(`\nCondition: ${p.condition_id?.slice(0,20)}... outcome_index=${p.outcome_index}`);
    console.log(`  Question: ${p.question?.slice(0,50) || 'unknown'}`);
    console.log(`  Buys: ${p.buys} trades, $${p.buy_usdc.toFixed(2)}, ${p.buy_shares.toFixed(2)} shares`);
    console.log(`  Sells: ${p.sells} trades, $${p.sell_usdc.toFixed(2)}, ${p.sell_shares.toFixed(2)} shares`);
    console.log(`  Cash flow: $${cashFlow.toFixed(2)}, Net shares: ${netShares.toFixed(2)}`);
    console.log(`  Resolution price: ${resolutionPrice}`);
    console.log(`  PnL: $${pnl.toFixed(2)}`);
  }

  console.log('\n=== TOTAL ===');
  console.log(`Our calculated PnL: $${totalPnl.toFixed(2)}`);
  console.log(`Polymarket shows:   $633.20`);
  console.log(`Ratio:              ${(totalPnl / 633.20).toFixed(2)}x`);

  await clickhouse.close();
}

main().catch(console.error);
