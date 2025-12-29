#!/usr/bin/env npx tsx
/**
 * Debug: Compare streaming approach vs original aggregation
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
  request_timeout: 120000,
});

const wallet = '0x132b505596fadb6971bbb0fbded509421baf3a16';

async function main() {
  // Method A: Original query (aggregation in CH)
  console.log('=== METHOD A: ClickHouse aggregation ===');
  const qA = await clickhouse.query({
    query: `
      SELECT
        m.condition_id,
        m.outcome_index,
        sumIf(usdc_amount, side = 'buy') / 1e6 as buy_usdc,
        sumIf(usdc_amount, side = 'sell') / 1e6 as sell_usdc,
        sumIf(token_amount, side = 'buy') / 1e6 as buy_tokens,
        sumIf(token_amount, side = 'sell') / 1e6 as sell_tokens
      FROM (
        SELECT event_id, any(side) as side, any(usdc_amount) as usdc_amount,
               any(token_amount) as token_amount, any(token_id) as token_id
        FROM pm_trader_events_v2
        WHERE lower(trader_wallet) = '${wallet}'
        GROUP BY event_id
      ) t
      JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      GROUP BY m.condition_id, m.outcome_index
      ORDER BY buy_usdc DESC
    `,
    format: 'JSONEachRow'
  });
  const positionsA = await qA.json() as any[];
  let totalBuyA = 0, totalSellA = 0;
  for (const p of positionsA) {
    totalBuyA += Number(p.buy_usdc);
    totalSellA += Number(p.sell_usdc);
  }
  console.log('Total buy:', totalBuyA.toFixed(2), 'Total sell:', totalSellA.toFixed(2));
  console.log('Positions:', positionsA.length);

  // Method B: Streaming approach (raw events + TS dedupe)
  console.log('\n=== METHOD B: Streaming + TS dedupe ===');
  const qB = await clickhouse.query({
    query: `
      SELECT
        event_id,
        lower(trader_wallet) as wallet,
        m.condition_id,
        m.outcome_index,
        side,
        usdc_amount,
        token_amount
      FROM pm_trader_events_v2 t
      ANY INNER JOIN pm_token_to_condition_map_v3 m ON t.token_id = m.token_id_dec
      WHERE lower(trader_wallet) = '${wallet}'
      ORDER BY trade_time
    `,
    format: 'JSONEachRow'
  });
  const eventsB = await qB.json() as any[];

  // Dedupe in TS
  const seen = new Set<string>();
  const positions = new Map<string, { buy_usdc: number; sell_usdc: number; buy_tokens: number; sell_tokens: number }>();

  for (const e of eventsB) {
    if (seen.has(e.event_id)) continue;
    seen.add(e.event_id);

    const key = `${e.condition_id}_${e.outcome_index}`;
    if (!positions.has(key)) {
      positions.set(key, { buy_usdc: 0, sell_usdc: 0, buy_tokens: 0, sell_tokens: 0 });
    }
    const pos = positions.get(key)!;
    const usdc = Number(e.usdc_amount) / 1e6;
    const tokens = Number(e.token_amount) / 1e6;

    if (e.side === 'buy') {
      pos.buy_usdc += usdc;
      pos.buy_tokens += tokens;
    } else {
      pos.sell_usdc += usdc;
      pos.sell_tokens += tokens;
    }
  }

  let totalBuyB = 0, totalSellB = 0;
  for (const [, p] of positions) {
    totalBuyB += p.buy_usdc;
    totalSellB += p.sell_usdc;
  }
  console.log('Total buy:', totalBuyB.toFixed(2), 'Total sell:', totalSellB.toFixed(2));
  console.log('Positions:', positions.size);
  console.log('Raw events:', eventsB.length, '-> Deduped:', seen.size);

  // Compare
  console.log('\n=== COMPARISON ===');
  console.log('Buy diff:', (totalBuyA - totalBuyB).toFixed(2));
  console.log('Sell diff:', (totalSellA - totalSellB).toFixed(2));

  // Check redemptions
  console.log('\n=== REDEMPTIONS ===');
  const redemptionsQ = await clickhouse.query({
    query: `SELECT condition_id, redemption_payout FROM pm_redemption_payouts_agg WHERE lower(wallet) = '${wallet}'`,
    format: 'JSONEachRow'
  });
  const redemptions = await redemptionsQ.json() as any[];
  let totalRedemption = 0;
  for (const r of redemptions) {
    totalRedemption += Number(r.redemption_payout);
  }
  console.log('Redemption count:', redemptions.length, 'Total:', totalRedemption.toFixed(2));

  await clickhouse.close();
}

main().catch(console.error);
