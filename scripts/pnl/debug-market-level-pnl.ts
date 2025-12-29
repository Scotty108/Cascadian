/**
 * Market-level debug dump for investigating PnL discrepancies
 */
import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@clickhouse/client';

const clickhouse = createClient({
  url: process.env.CLICKHOUSE_HOST,
  username: process.env.CLICKHOUSE_USER || 'default',
  password: process.env.CLICKHOUSE_PASSWORD,
  database: process.env.CLICKHOUSE_DATABASE || 'default',
});

const wallet = process.argv[2] || '0x8677df7105d1146eecf515fa00a88a83a661cd6a';
const uiValue = parseFloat(process.argv[3] || '265.59');

async function main() {
  console.log('='.repeat(80));
  console.log('MARKET-LEVEL DEBUG DUMP: ' + wallet.slice(0, 10) + '...');
  console.log(`UI Net Total: $${uiValue}`);
  console.log('='.repeat(80));

  // Get raw trades with dedup pattern
  const tradesQuery = `
    WITH deduped AS (
      SELECT
        event_id,
        any(token_id) as token_id,
        any(side) as side,
        any(token_amount) / 1000000.0 as tokens,
        any(usdc_amount) / 1000000.0 as usdc
      FROM pm_trader_events_v2
      WHERE trader_wallet = '${wallet.toLowerCase()}' AND is_deleted = 0
      GROUP BY event_id
    )
    SELECT
      m.condition_id,
      m.outcome_index,
      d.side,
      count() as trade_count,
      round(sum(d.tokens), 4) as total_tokens,
      round(sum(d.usdc), 4) as total_usdc
    FROM deduped d
    INNER JOIN pm_token_to_condition_map_v5 m ON d.token_id = m.token_id_dec
    GROUP BY m.condition_id, m.outcome_index, d.side
    ORDER BY m.condition_id, m.outcome_index, d.side
  `;

  const trades = await clickhouse.query({ query: tradesQuery, format: 'JSONEachRow' });
  const tradeRows = (await trades.json()) as any[];

  console.log('\nRaw trades by condition_id/outcome:');
  console.table(tradeRows);

  // Now get resolutions for these conditions
  const conditionIds = [...new Set(tradeRows.map((r: any) => r.condition_id))];

  const resQuery = `
    SELECT condition_id, payout_numerators
    FROM pm_condition_resolutions
    WHERE condition_id IN ('${conditionIds.join("','")}')
  `;

  const res = await clickhouse.query({ query: resQuery, format: 'JSONEachRow' });
  const resRows = (await res.json()) as any[];

  console.log('\nResolution data:');
  for (const r of resRows) {
    console.log(`  ${r.condition_id.slice(0, 16)}...: payout_numerators = ${r.payout_numerators}`);
  }

  // Aggregate by condition_id and compute PnL
  console.log('\n' + '='.repeat(80));
  console.log('PNL BY MARKET (condition_id)');
  console.log('='.repeat(80));

  const byCondition = new Map<string, any>();
  for (const t of tradeRows) {
    const key = t.condition_id + '_' + t.outcome_index;
    if (!byCondition.has(key)) {
      byCondition.set(key, {
        condition_id: t.condition_id,
        outcome_index: t.outcome_index,
        buy_tokens: 0,
        sell_tokens: 0,
        buy_usdc: 0,
        sell_usdc: 0,
        trade_count: 0,
      });
    }
    const agg = byCondition.get(key);
    if (t.side === 'buy') {
      agg.buy_tokens += t.total_tokens;
      agg.buy_usdc += t.total_usdc;
    } else {
      agg.sell_tokens += t.total_tokens;
      agg.sell_usdc += t.total_usdc;
    }
    agg.trade_count += t.trade_count;
  }

  // Create resolution lookup
  const resolutionMap = new Map<string, number[]>();
  for (const r of resRows) {
    resolutionMap.set(r.condition_id.toLowerCase(), JSON.parse(r.payout_numerators || '[]'));
  }

  let totalCashflow = 0;
  let totalSynthetic = 0;

  for (const [, agg] of byCondition) {
    const payouts = resolutionMap.get(agg.condition_id.toLowerCase()) || [];
    const resPrice = payouts[agg.outcome_index] ?? null;

    const cashflow = agg.sell_usdc - agg.buy_usdc;
    const finalShares = agg.buy_tokens - agg.sell_tokens;
    const syntheticRedemption = resPrice !== null ? finalShares * resPrice : 0;
    const marketPnl = cashflow + syntheticRedemption;

    totalCashflow += cashflow;
    totalSynthetic += syntheticRedemption;

    console.log(`\nCondition: ${agg.condition_id.slice(0, 16)}... [outcome ${agg.outcome_index}]`);
    console.log(`  Trades: ${agg.trade_count}`);
    console.log(`  Buy:  ${agg.buy_tokens.toFixed(2)} tokens @ $${agg.buy_usdc.toFixed(2)}`);
    console.log(`  Sell: ${agg.sell_tokens.toFixed(2)} tokens @ $${agg.sell_usdc.toFixed(2)}`);
    console.log(`  ---`);
    console.log(`  Cash flow (sell - buy): $${cashflow.toFixed(2)}`);
    console.log(`  Final shares: ${finalShares.toFixed(2)}`);
    console.log(`  Resolution price: ${resPrice}`);
    console.log(`  Synthetic redemption: $${syntheticRedemption.toFixed(2)}`);
    console.log(`  MARKET PNL: $${marketPnl.toFixed(2)}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('TOTALS:');
  console.log(`  Total cash flow:          $${totalCashflow.toFixed(2)}`);
  console.log(`  Total synthetic redemp:   $${totalSynthetic.toFixed(2)}`);
  console.log(`  TOTAL PNL (V17 formula):  $${(totalCashflow + totalSynthetic).toFixed(2)}`);
  console.log(`  UI Net Total:             $${uiValue}`);
  console.log(`  Delta:                    $${(totalCashflow + totalSynthetic - uiValue).toFixed(2)}`);
  console.log('='.repeat(80));

  await clickhouse.close();
}

main().catch(console.error);
